#!/usr/bin/env python3
"""
Сверка контрольных цифр с Odoo. Только чтение.

    python3 tools/reconcile_odoo.py            отчёт в stdout
    python3 tools/reconcile_odoo.py --json     то же машиночитаемо

Зачем. В `docs/handoff.md`, п. 3 записаны контрольные цифры на 13.09.2026, и
на них ссылается приёмка импорта. Цифры записаны рукой, а Odoo с тех пор
живёт. Этот скрипт спрашивает Odoo и кладёт рядом ожидание и факт — построчно,
а не «примерно сходится» (практики §3, Nichebox G3).

Правила, которые он не нарушает:
  * Odoo только на чтение: `search_count`, `search_read`, ничего больше.
  * Ключ не печатается и не логируется (см. tools/odoo_rpc.py).
  * В отчёте только количества и суммы. Ни имён, ни телефонов, ни VIN —
    отчёт можно положить куда угодно.

Код возврата 1, если хоть одна строка разошлась: скрипт годится как гейт.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from typing import Callable

sys.path.insert(0, __file__.rsplit("/", 1)[0])
from odoo_rpc import Odoo  # noqa: E402

TETRI = 100


@dataclass
class Check:
    id: str
    label: str
    expected: float | int | None
    fn: Callable[[Odoo], float | int | None]
    unit: str = "шт"
    source: str = "handoff §3"
    note: str = ""
    # Правда ли мы уверены, что спрашиваем Odoo ровно о том же, о чём писали
    # в handoff. Где не уверены — печатаем факт и не выносим приговор.
    mapping_confirmed: bool = True
    # Счёт кредитовой природы: Odoo держит сальдо со знаком минус.
    credit_side: bool = False
    # Расхождение, у которого уже есть разобранная причина. Оно остаётся
    # видимым, но не требует ответа — молча подгонять ожидание нельзя.
    explained: str = ""
    actual: float | int | None = field(default=None, init=False)
    error: str | None = field(default=None, init=False)


def account_balance(o: Odoo, code: str) -> float | None:
    """Сальдо счёта по проведённым проводкам, в GEL.

    Складываем строки сами, а не через `read_group`: на saas-19.4 он отвечает
    Fault, а сотня строк по счёту читается за один запрос и без сюрпризов.
    """
    acc = o.search_read("account.account", [("code", "=", code)], ["id"], limit=1)
    if not acc:
        return None
    rows = o.search_read(
        "account.move.line",
        [("account_id", "=", acc[0]["id"]), ("parent_state", "=", "posted")],
        ["balance"],
        limit=20000,
    )
    return round(sum(r["balance"] for r in rows), 2)


def has_field(o: Odoo, model: str, name: str) -> bool:
    try:
        return name in o.call(model, "fields_get", [], {"attributes": []})
    except Exception:
        return False


def rental_orders(o: Odoo) -> int | None:
    # Odoo помечает заказ аренды флагом; если поля нет, признаться, а не гадать.
    if not has_field(o, "sale.order", "is_rental_order"):
        return None
    return o.count("sale.order", [("is_rental_order", "=", True)])


def plain_sales(o: Odoo) -> int | None:
    if not has_field(o, "sale.order", "is_rental_order"):
        return None
    return o.count("sale.order", [("is_rental_order", "=", False), ("state", "in", ["sale", "done"])])


def fleet_by_state(o: Odoo, name_fragment: str) -> int:
    states = o.search_read("fleet.vehicle.state", [("name", "ilike", name_fragment)], ["id"])
    if not states:
        return 0
    return o.count("fleet.vehicle", [("state_id", "in", [s["id"] for s in states])])


def _open_invoices(o: Odoo) -> list[dict]:
    return o.search_read(
        "account.move",
        [("move_type", "=", "out_invoice"), ("state", "=", "posted"), ("payment_state", "!=", "paid")],
        ["amount_residual", "invoice_origin"],
        limit=5000,
    )


def open_receivable_total(o: Odoo) -> float:
    """Незакрытый остаток по всем счетам покупателям, в GEL."""
    return round(sum(r["amount_residual"] for r in _open_invoices(o)), 2)


def _origin_is_rental(o: Odoo, invoices: list[dict]) -> dict[str, bool]:
    """Каждый счёт помнит, из какого заказа он вырос. Спрашиваем заказы разом."""
    names = sorted({(r.get("invoice_origin") or "").strip() for r in invoices} - {""})
    if not names or not has_field(o, "sale.order", "is_rental_order"):
        return {}
    orders = o.search_read("sale.order", [("name", "in", names)], ["name", "is_rental_order"], limit=5000)
    return {x["name"]: bool(x["is_rental_order"]) for x in orders}


def open_receivable_sales(o: Odoo) -> float:
    """Та же дебиторка, но только по продажам — цифра из журнала 14.08.2026."""
    inv = _open_invoices(o)
    kind = _origin_is_rental(o, inv)
    return round(sum(r["amount_residual"] for r in inv if kind.get((r.get("invoice_origin") or "").strip()) is False), 2)


def open_receivable_rental(o: Odoo) -> float:
    inv = _open_invoices(o)
    kind = _origin_is_rental(o, inv)
    return round(sum(r["amount_residual"] for r in inv if kind.get((r.get("invoice_origin") or "").strip()) is True), 2)


def contacts_without_own_company(o: Odoo) -> int:
    """Контакты без карточки самой компании — её в 72 не считали."""
    own = [c["partner_id"][0] for c in o.search_read("res.company", [], ["partner_id"]) if c.get("partner_id")]
    return o.count("res.partner", [("id", "not in", own)] if own else [])


def contacts_since_handoff(o: Odoo) -> int:
    """Сколько контактов заведено после дня, которым датированы цифры."""
    return o.count("res.partner", [("create_date", ">", "2026-09-13 23:59:59")])


def tiny_residuals(o: Odoo) -> int:
    """Счета, где висит меньше лари: обычно это копейка округления НДС."""
    return sum(1 for r in _open_invoices(o) if 0 < r["amount_residual"] < 1)


EXPLAIN: list[Check] = [
    Check("X-CNT", "из них заведено после 13.09.2026", None, contacts_since_handoff, source="объяснение"),
    Check("X-AR", "счетов с остатком меньше 1 GEL", None, tiny_residuals, source="объяснение",
          note="сегодня это один счёт на 0,01 по аренде S00025, а не копейка S00010 из журнала"),
]


CHECKS: list[Check] = [
    Check("PRD", "Товары", 33, lambda o: o.count("product.template")),
    Check(
        "CNT", "Контакты", 72, contacts_without_own_company,
        note="73 записи в res.partner минус карточка самой компании: собственный контакт — не клиент",
    ),
    Check("LOT", "Серийные номера (VIN)", 48, lambda o: o.count("stock.lot")),
    Check("FLT", "Мопеды во Fleet", 31, lambda o: o.count("fleet.vehicle")),
    Check("FLT-R", "Fleet: Ready", 25, lambda o: fleet_by_state(o, "Ready")),
    Check("FLT-S", "Fleet: In Service", 6, lambda o: fleet_by_state(o, "Service")),
    Check(
        "RNT", "Заказы аренды", 44, rental_orders,
        note="включая тестовый S00060, который не переносится",
    ),
    Check(
        "SAL", "Продажи (подтверждённые)", 15, plain_sales,
        note="подтверждённые не-арендные заказы; сопоставление проверено 15.09.2026 — совпало ровно",
    ),
    Check("PUR", "Закупки", 11, lambda o: o.count("purchase.order"), note="P00012 — черновик выкупа"),
    Check("INV", "Счета покупателям", 58, lambda o: o.count("account.move", [("move_type", "=", "out_invoice")])),
    Check("PAY", "Платежи", 159, lambda o: o.count("account.payment")),
    Check("DEP", "Залоги на руках, счёт 310620", 7510.00, lambda o: account_balance(o, "310620"), unit="GEL",
          credit_side=True, note="обязательство: сальдо кредитовое, сравнивается по модулю"),
    Check("REV-R", "Выручка аренды, счёт 611201", 23847.05, lambda o: account_balance(o, "611201"), unit="GEL",
          credit_side=True),
    Check("REV-S", "Выручка продаж, счёт 611101", 48703.37, lambda o: account_balance(o, "611101"), unit="GEL",
          credit_side=True),
    Check(
        "AR-S", "Открытая дебиторка по продажам", 11100.04, open_receivable_sales, unit="GEL",
        source="odoo-data-checklist 14.08.2026",
        note="S00007 — 4 000 не найдено в выписках, S00009 — 2 700 не поступали, S00012 — 4 400 ждёт выписку Credo",
        explained="копейка округления НДС по S00010 (в инвойсе 488,10, Odoo считал 488,14) погашена после 14.08.2026; "
                  "единственный остаток меньше лари сегодня — 0,01 по S00025, а это аренда",
    ),
    Check(
        "AR-R", "Открытая дебиторка по аренде", None, open_receivable_rental, unit="GEL",
        source="справочно",
        note="в handoff отдельной цифрой не записана",
    ),
    Check(
        "AR", "Открытая дебиторка, всего", None, open_receivable_total, unit="GEL",
        source="справочно",
        note="сумма двух строк выше — это и есть 23 963,60 из START-PROMPT, цифра не выдумана, а просто про другое",
    ),
]


def run(o: Odoo) -> list[Check]:
    for c in CHECKS + EXPLAIN:
        try:
            v = c.fn(o)
            # Обязательства и доходы в Odoo кредитовые, то есть сальдо
            # отрицательное. Сравниваем по модулю — в handoff записаны суммы.
            c.actual = abs(v) if (c.credit_side and v is not None) else v
        except Exception as e:  # noqa: BLE001 — отчёт важнее стектрейса
            c.error = f"{type(e).__name__}: {e}"
    return CHECKS + EXPLAIN


def fmt(v, unit: str) -> str:
    if v is None:
        return "—"
    return f"{v:,.2f}".replace(",", " ") if unit == "GEL" else f"{v}"


def report(checks: list[Check]) -> int:
    bad = 0
    unsure = 0
    print("Сверка с Odoo — только чтение\n")
    print(f"{'ID':<6} {'что':<44} {'ожидалось':>13} {'в Odoo':>13}  вердикт")
    print("-" * 104)
    for c in checks:
        if c.error:
            verdict = f"ОШИБКА · {c.error[:48]}"
            bad += 1
        elif c.actual is None:
            verdict = "не спросить · поля нет в этой версии Odoo"
            unsure += 1
        elif c.expected is None:
            verdict = "справочно"
        else:
            diff = round(c.actual - c.expected, 2)
            if abs(diff) < 0.005:
                verdict = "сходится" if c.mapping_confirmed else "сходится (сопоставление не подтверждено)"
            elif c.explained:
                sign = "+" if diff > 0 else ""
                verdict = f"разошлось {sign}{fmt(diff, c.unit)} {c.unit} · объяснено"
            else:
                sign = "+" if diff > 0 else ""
                verdict = f"РАСХОЖДЕНИЕ {sign}{fmt(diff, c.unit)} {c.unit}"
                if not c.mapping_confirmed:
                    verdict += " · сопоставление не подтверждено"
                    unsure += 1
                else:
                    bad += 1
        print(f"{c.id:<6} {c.label:<44} {fmt(c.expected, c.unit):>13} {fmt(c.actual, c.unit):>13}  {verdict}")
        if c.note:
            print(f"{'':<6} {'':<44} {'':>13} {'':>13}  — {c.note} ({c.source})")
        if c.explained:
            print(f"{'':<6} {'':<44} {'':>13} {'':>13}  ↳ {c.explained}")
    print("-" * 104)
    print(f"Расхождений, требующих ответа: {bad}. Строк, где сопоставление надо подтвердить: {unsure}.")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Read-only reconciliation against Odoo.")
    ap.add_argument("--json", action="store_true", help="машиночитаемый вывод")
    args = ap.parse_args()

    checks = run(Odoo())
    if args.json:
        print(json.dumps(
            [{"id": c.id, "label": c.label, "expected": c.expected, "actual": c.actual,
              "unit": c.unit, "error": c.error, "mapping_confirmed": c.mapping_confirmed} for c in checks],
            ensure_ascii=False, indent=2,
        ))
        return 1 if any(c.error or (c.expected is not None and c.actual is not None
                                    and abs(c.actual - c.expected) >= 0.005 and c.mapping_confirmed)
                        for c in checks) else 0
    return report(checks)


if __name__ == "__main__":
    raise SystemExit(main())
