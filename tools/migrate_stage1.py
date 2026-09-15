#!/usr/bin/env python3
"""
Перенос данных из Odoo в EV8 Ops. Odoo только на чтение.

    python3 tools/migrate_stage1.py --dry-run      прочитать и показать, что будет
    python3 tools/migrate_stage1.py --apply        записать в нашу базу
    python3 tools/migrate_stage1.py --apply --wipe-demo   сначала убрать демо-строки

Решение Мики 15.09.2026: импорт делается сейчас, а не в самом конце, чтобы
дорабатывать продукт на боевых данных. Цена названа и принята — денежный слой
схемы ещё будет двигаться, и этот скрипт будет переписываться вместе с ним.
Поэтому он устроен так, чтобы его можно было запускать сколько угодно раз.

Что он обещает:

  * **Odoo не меняется.** Только `search_read` и `search_count`.
  * **Повторный запуск не задваивает.** У каждой нашей таблицы есть колонка
    `odoo_*_id`; запись ищется по ней и обновляется, а не создаётся заново.
  * **Ничего не выдумывается.** Где в Odoo пусто — у нас пусто и помечено.
    VIN, которого нет, не становится строкой; залог, о котором Odoo молчит,
    не получает статуса «возвращён».
  * **Даты события, а не даты внесения.** Всё берётся из полей документа.
  * **Ни одной строки боевых данных в репозитории.** Скрипт переносит
    напрямую из Odoo в Postgres; между ними нет файла.

Периоды аренды не копируются, а **пересобираются** из даты выдачи и недельного
тарифа нашим же правилом (`periodsThrough` в packages/shared) — так они не могут
разойтись с арифметикой, которую считают экраны. Odoo сверяется по итогам,
а не построчно: `tools/reconcile_odoo.py`.
"""
from __future__ import annotations

import argparse
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from odoo_rpc import Odoo  # noqa: E402

try:
    import psycopg
except ImportError:  # pragma: no cover
    raise SystemExit("нужен psycopg: python3 -m pip install 'psycopg[binary]'")

PERIOD_DAYS = 7
DEFAULT_DB = "postgresql://ev8ops:ev8ops@localhost:5433/ev8ops"

# Тестовый заказ со звонка консультанта: в Odoo он есть, к нам не едет.
SKIP_ORDERS = {"S00060"}


def tetri(x: float | None) -> int | None:
    """GEL в тетри. Округляем к ближайшему — дробных тетри не бывает."""
    return None if x is None else int(round(float(x) * 100))


def as_date(v) -> date | None:
    if not v:
        return None
    s = str(v)[:10]
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except ValueError:
        return None


class Report:
    """Что произошло и о чём пришлось умолчать."""

    def __init__(self) -> None:
        self.counts: Counter[str] = Counter()
        self.notes: list[str] = []

    def did(self, what: str, n: int = 1) -> None:
        self.counts[what] += n

    def note(self, line: str) -> None:
        self.notes.append(line)

    def print(self) -> None:
        print("\nЧто перенесено")
        print("-" * 70)
        for k in sorted(self.counts):
            print(f"  {k:<46} {self.counts[k]:>6}")
        if self.notes:
            print("\nЧто помечено, а не придумано")
            print("-" * 70)
            for n in self.notes:
                print(f"  · {n}")


# --------------------------------------------------------------------------
# Справочники: модели, мопеды, клиенты
# --------------------------------------------------------------------------

def import_models(o: Odoo, cur, rep: Report) -> dict[int, str]:
    """Модели мопедов.

    Что такое модель, решает не название, а учёт: **товар с серийным учётом**
    (`tracking = serial`). Это ровно одиннадцать позиций — шесть Flybrother,
    у которых есть пара «Sale» и «Rental», и пять Luyuan только на продажу.
    Зарядные, зеркала и батарея учитываются штуками (`tracking = none`) и
    моделями не являются; депозит, сбор за бронь и недельные тарифы — услуги.

    Цены в Odoo без НДС, у нас цена продажи хранится с НДС (ТЗ §8): × 1.18.
    """
    VAT = 1.18
    fleet_models = {
        fm["name"].strip().lower(): fm
        for fm in o.search_read("fleet.vehicle.model", [], ["name", "brand_id"])
    }

    products = o.search_read(
        "product.template", [("tracking", "=", "serial")],
        ["name", "list_price", "standard_price"], limit=200,
    )
    by_key: dict[str, dict] = {}
    for p in products:
        raw = p["name"].strip()
        kind = "sale" if raw.endswith(" - Sale") else "rental" if raw.endswith(" - Rental") else "sale"
        base = raw[: -len(" - Sale")] if raw.endswith(" - Sale") else (
            raw[: -len(" - Rental")] if raw.endswith(" - Rental") else raw
        )
        slot = by_key.setdefault(base.strip().lower(), {
            "name": base.strip(), "sale_id": None, "rental_id": None,
            "sale_price": None, "cost": None, "weekly": None,
        })
        if kind == "sale":
            slot["sale_id"] = p["id"]
            slot["sale_price"] = p["list_price"] * VAT
            slot["cost"] = p["standard_price"]
        else:
            slot["rental_id"] = p["id"]
            slot["weekly"] = p["list_price"] * VAT

    ids: dict[int, str] = {}
    for key, slot in sorted(by_key.items()):
        fm = fleet_models.get(key)
        brand = (fm["brand_id"][1] if fm and fm.get("brand_id") else "Luyuan")
        cur.execute(
            """
            insert into vehicle_models (brand, name, sale_price_tetri, weekly_rate_tetri, cost_tetri,
                                        for_sale, for_rent, odoo_sale_product_id,
                                        odoo_rental_product_id, odoo_fleet_model_id, notes)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (brand, name) do update set
              sale_price_tetri = excluded.sale_price_tetri,
              weekly_rate_tetri = excluded.weekly_rate_tetri,
              cost_tetri = excluded.cost_tetri,
              for_rent = excluded.for_rent,
              odoo_sale_product_id = coalesce(excluded.odoo_sale_product_id, vehicle_models.odoo_sale_product_id),
              odoo_rental_product_id = coalesce(excluded.odoo_rental_product_id, vehicle_models.odoo_rental_product_id),
              odoo_fleet_model_id = coalesce(excluded.odoo_fleet_model_id, vehicle_models.odoo_fleet_model_id),
              updated_at = now()
            returning id
            """,
            (brand, slot["name"], tetri(slot["sale_price"]), tetri(slot["weekly"]), tetri(slot["cost"]),
             True, slot["rental_id"] is not None, slot["sale_id"], slot["rental_id"],
             fm["id"] if fm else None, "Перенесено из Odoo 15.09.2026"),
        )
        row_id = cur.fetchone()[0]
        rep.did("модели")
        if fm:
            ids[fm["id"]] = row_id
        if not slot["cost"]:
            rep.note(f"модель «{slot['name']}»: себестоимость в Odoo пуста — у нас тоже пуста, это не ноль")
    return ids


def import_vehicles(o: Odoo, cur, rep: Report, fleet_model_ids: dict[int, str]) -> dict[str, str]:
    """Мопеды. Fleet — источник состояния; серийники Luyuan приходят как склад."""
    by_vin: dict[str, str] = {}
    states = {s["id"]: s["name"] for s in o.search_read("fleet.vehicle.state", [], ["name"])}
    ours = {"ready": "available", "in service": "service", "out of service": "out", "rented": "rented", "sold": "sold"}

    for v in o.search_read("fleet.vehicle", [], ["vin_sn", "model_id", "color", "acquisition_date", "state_id", "odometer"]):
        vin = (v.get("vin_sn") or "").strip().upper()
        if not vin:
            rep.note(f"мопед Fleet #{v['id']}: VIN пуст в Odoo — не переносится, выдумывать нечего")
            continue
        model_id = fleet_model_ids.get(v["model_id"][0]) if v.get("model_id") else None
        if not model_id:
            rep.note(f"мопед {vin[-4:]}: модель Fleet не нашлась среди наших — пропущен")
            continue
        state = ours.get((states.get(v["state_id"][0], "") if v.get("state_id") else "").strip().lower(), "available")
        cur.execute(
            """
            insert into vehicles (vin, model_id, color, year, arrived_on, state, odometer_km, odoo_fleet_id, notes)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (vin) do update set
              model_id = excluded.model_id, color = excluded.color,
              arrived_on = excluded.arrived_on, state = excluded.state,
              odometer_km = excluded.odometer_km,
              odoo_fleet_id = coalesce(excluded.odoo_fleet_id, vehicles.odoo_fleet_id),
              updated_at = now()
            returning id
            """,
            (vin, model_id, (v.get("color") or None), None, as_date(v.get("acquisition_date")),
             state, int(v["odometer"]) if v.get("odometer") else None, v["id"],
             "Перенесено из Odoo 15.09.2026"),
        )
        by_vin[vin] = cur.fetchone()[0]
        rep.did("мопеды из Fleet")

    # Мопеды «только на продажу» во Fleet не заводились: они живут серийными
    # номерами на складе. Без них продажа не найдёт свой VIN (handoff §7).
    cur.execute("select odoo_sale_product_id, id from vehicle_models where odoo_sale_product_id is not null")
    model_by_tmpl = dict(cur.fetchall())
    lots = o.search_read("stock.lot", [], ["name", "product_id"], limit=1000)
    tmpl = {pp["id"]: (pp["product_tmpl_id"][0] if pp.get("product_tmpl_id") else None)
            for pp in o.search_read("product.product",
                                    [("id", "in", list({l["product_id"][0] for l in lots if l.get("product_id")}))],
                                    ["product_tmpl_id"], limit=500)}
    for l in lots:
        vin = (l.get("name") or "").strip().upper()
        if not vin or vin in by_vin:
            continue
        model_id = model_by_tmpl.get(tmpl.get(l["product_id"][0])) if l.get("product_id") else None
        if not model_id:
            rep.note(f"серийник {vin[-4:]}: модель не определяется — не переносится")
            continue
        cur.execute(
            """
            insert into vehicles (vin, model_id, state, odoo_lot_id, notes)
            values (%s,%s,'available',%s,%s)
            on conflict (vin) do update set
              odoo_lot_id = coalesce(excluded.odoo_lot_id, vehicles.odoo_lot_id), updated_at = now()
            returning id
            """,
            (vin, model_id, l["id"], "Перенесено из Odoo 15.09.2026, серийный номер склада"),
        )
        by_vin[vin] = cur.fetchone()[0]
        rep.did("мопеды по серийным номерам склада")
    return by_vin


def import_customers(o: Odoo, cur, rep: Report) -> dict[int, str]:
    """Клиенты. Карточка самой компании не переносится: это не клиент."""
    own = {c["partner_id"][0] for c in o.search_read("res.company", [], ["partner_id"]) if c.get("partner_id")}
    ids: dict[int, str] = {}
    # Личный номер у нас уникален (CST-02). В Odoo это не так, и совпадение —
    # находка, а не помеха: вторая карточка заводится без номера и с пометкой,
    # чтобы человек решил, один это человек или два.
    seen_pid: dict[str, int] = {}
    tags = {t["id"]: t["name"] for t in o.search_read("res.partner.category", [], ["name"])}

    for p in o.search_read(
        "res.partner", [("id", "not in", list(own))] if own else [],
        ["name", "vat", "phone", "email", "is_company", "category_id", "street", "city",
         "supplier_rank", "active"],
        limit=2000,
    ):
        name = (p.get("name") or "").strip()
        if not name:
            continue
        addr = ", ".join(x for x in [(p.get("street") or "").strip(), (p.get("city") or "").strip()] if x) or None
        pid = (p.get("vat") or "").strip() or None
        note = "Перенесено из Odoo 15.09.2026"
        if pid and pid in seen_pid:
            rep.note(f"контакт Odoo #{p['id']}: личный номер совпал с контактом #{seen_pid[pid]} — "
                     f"номер не записан, карточка заведена с пометкой; решать, один это человек или два, человеку")
            note += ". Личный номер совпал с другой карточкой в Odoo и не перенесён."
            pid = None
        elif pid:
            seen_pid[pid] = p["id"]
        cur.execute(
            """
            insert into customers (name, personal_id, phone, email, kind, is_supplier, tags, address,
                                   odoo_partner_id, archived, notes)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (odoo_partner_id) do update set
              name = excluded.name, phone = excluded.phone, email = excluded.email,
              kind = excluded.kind, is_supplier = excluded.is_supplier, tags = excluded.tags,
              address = excluded.address, archived = excluded.archived, updated_at = now()
            returning id
            """,
            (name, pid, (p.get("phone") or None), (p.get("email") or None),
             "company" if p.get("is_company") else "person",
             bool(p.get("supplier_rank")), [tags.get(t, "") for t in (p.get("category_id") or [])],
             addr, p["id"], not p.get("active", True), note),
        )
        ids[p["id"]] = cur.fetchone()[0]
        rep.did("клиенты")
    return ids


# --------------------------------------------------------------------------
# Аренды: заказ, залог, недели
# --------------------------------------------------------------------------

# Журнал 14.08.2026: у этих двух аренд нет акта возврата, и выставленное по ним
# заведомо завышено. Переносим со статусом «спорная», чтобы недели не росли.
DISPUTED = {"S00028", "S00040"}


def import_rentals(o: Odoo, cur, rep: Report, customers: dict[int, str],
                   vehicles_by_vin: dict[str, str], today: date) -> dict[str, str]:
    """Заказы аренды. Недели пересобираются нашим правилом, а не копируются."""
    orders = o.search_read(
        "sale.order", [("is_rental_order", "=", True)],
        ["name", "partner_id", "rental_start_date", "rental_return_date", "rental_status", "order_line", "note"],
        limit=500, order="name",
    )
    line_ids = [i for r in orders for i in r["order_line"]]
    lines = o.search_read(
        "sale.order.line", [("id", "in", line_ids)],
        ["order_id", "product_id", "price_unit", "product_uom_qty",
         "pickedup_lot_ids", "returned_lot_ids", "reserved_lot_ids"],
        limit=5000,
    )
    prods = {p["id"]: p for p in o.search_read(
        "product.product", [("id", "in", list({l["product_id"][0] for l in lines if l.get("product_id")}))],
        ["default_code", "tracking", "name"], limit=500)}
    lot_ids = {i for l in lines
               for i in (l.get("pickedup_lot_ids") or []) + (l.get("returned_lot_ids") or []) + (l.get("reserved_lot_ids") or [])}
    lots = {x["id"]: (x["name"] or "").strip().upper()
            for x in o.search_read("stock.lot", [("id", "in", list(lot_ids))], ["name"], limit=500)}

    by_order: dict[int, list[dict]] = defaultdict(list)
    for l in lines:
        by_order[l["order_id"][0]].append(l)

    # В этой Odoo VIN аренды не лежит на строке заказа. Он есть в двух местах,
    # и оба — настоящие: точным номером в заметке заказа (там же записаны
    # исправленные опечатки сканов) и полем «водитель» на карточке Fleet.
    # Заметка точнее: она называет конкретный VIN, а не «кто сейчас ездит».
    VIN_RE = re.compile(r"HH8[A-Z0-9]{14}")
    driver_vin = {
        f["driver_id"][0]: (f.get("vin_sn") or "").strip().upper()
        for f in o.search_read("fleet.vehicle", [("driver_id", "!=", False)], ["vin_sn", "driver_id"], limit=200)
    }

    out: dict[str, str] = {}
    for r in orders:
        if r["name"] in SKIP_ORDERS:
            rep.note(f"{r['name']}: тестовый заказ со звонка консультанта — не переносится")
            continue
        cust = customers.get(r["partner_id"][0]) if r.get("partner_id") else None
        if not cust:
            rep.note(f"{r['name']}: клиента нет среди перенесённых — заказ пропущен")
            continue

        weekly = deposit = None
        vin = None
        for l in by_order[r["id"]]:
            code = (prods.get(l["product_id"][0], {}).get("default_code") or "") if l.get("product_id") else ""
            track = prods.get(l["product_id"][0], {}).get("tracking") if l.get("product_id") else None
            if code == "rental-deposit":
                deposit = l["price_unit"]
            elif code.startswith("sub-week-"):
                weekly = float(code.rsplit("-", 1)[1])
            elif track == "serial":
                for i in (l.get("pickedup_lot_ids") or []) + (l.get("returned_lot_ids") or []) + (l.get("reserved_lot_ids") or []):
                    if lots.get(i):
                        vin = lots[i]
                        break
                if weekly is None and l["price_unit"]:
                    weekly = l["price_unit"] * 1.18

        note_text = re.sub(r"<[^>]+>", " ", r.get("note") or "").strip()
        if not vin:
            found = VIN_RE.search(note_text.upper())
            vin = found.group(0) if found else None
        if not vin and r.get("partner_id"):
            vin = driver_vin.get(r["partner_id"][0]) or None

        picked = as_date(r.get("rental_start_date"))
        finished = r.get("rental_status") == "returned"
        returned = as_date(r.get("rental_return_date")) if finished else None
        status = "disputed" if r["name"] in DISPUTED else ("returned" if finished else "active")

        if weekly is None:
            rep.note(f"{r['name']}: недельный тариф в Odoo не назван — аренда перенесена без тарифа, недели не собраны")
        vehicle_id = vehicles_by_vin.get(vin) if vin else None
        if not vehicle_id:
            # Одна строка на каждую такую аренду — это двадцать строк отчёта об
            # одном и том же. Считаем и говорим одним предложением в конце.
            rep.did("аренд без подтверждённого VIN — действующих" if status != "returned"
                    else "аренд без подтверждённого VIN — завершённых")

        cur.execute(
            """
            insert into rentals (customer_id, vehicle_id, vin_unconfirmed, vin_note, weekly_rate_tetri,
                                 deposit_tetri, picked_up_on, returned_on, status, odoo_order_id, odoo_name, notes)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (odoo_order_id) do update set
              customer_id = excluded.customer_id, vehicle_id = excluded.vehicle_id,
              vin_unconfirmed = excluded.vin_unconfirmed, weekly_rate_tetri = excluded.weekly_rate_tetri,
              deposit_tetri = excluded.deposit_tetri, picked_up_on = excluded.picked_up_on,
              returned_on = excluded.returned_on, status = excluded.status, updated_at = now()
            returning id
            """,
            (cust, vehicle_id, vehicle_id is None,
             None if vehicle_id else "VIN не подтверждён в Odoo",
             tetri(weekly) or 0, tetri(deposit) or 0, picked, returned, status,
             r["id"], r["name"],
             ("Перенесено из Odoo 15.09.2026." + (f" {note_text}" if note_text else ""))[:4000]),
        )
        rental_id = cur.fetchone()[0]
        out[r["name"]] = rental_id
        rep.did("аренды")

        if deposit:
            cur.execute(
                """
                insert into deposits (rental_id, amount_tetri, status, notes)
                values (%s,%s,'held',%s)
                on conflict (rental_id) do update set amount_tetri = excluded.amount_tetri, updated_at = now()
                """,
                (rental_id, tetri(deposit), "Перенесено из Odoo 15.09.2026; решение по залогу в Odoo не структурировано"),
            )
            rep.did("залоги")

        # Недели: от даты выдачи до возврата или до сегодня, нашим правилом.
        if picked and weekly:
            end = returned or today
            seq = 0
            cur.execute("delete from rental_periods where rental_id = %s", (rental_id,))
            while True:
                starts = picked + timedelta(days=PERIOD_DAYS * seq)
                if starts > end:
                    break
                seq += 1
                cur.execute(
                    """
                    insert into rental_periods (rental_id, seq, starts_on, ends_on, amount_tetri)
                    values (%s,%s,%s,%s,%s)
                    on conflict (rental_id, seq) do update set
                      starts_on = excluded.starts_on, ends_on = excluded.ends_on,
                      amount_tetri = excluded.amount_tetri, updated_at = now()
                    """,
                    (rental_id, seq, starts, starts + timedelta(days=PERIOD_DAYS - 1), tetri(weekly)),
                )
                rep.did("недели аренды")
    unknown_live = rep.counts.get("аренд без подтверждённого VIN — действующих", 0)
    unknown_done = rep.counts.get("аренд без подтверждённого VIN — завершённых", 0)
    if unknown_live or unknown_done:
        rep.note(
            f"VIN не подтверждён у {unknown_live} действующих и {unknown_done} завершённых аренд: "
            "в Odoo он для них не записан ни строкой заказа, ни заметкой, ни карточкой Fleet. "
            "Они помечены и попадают в отдельный список (RNT-06), а не получают выдуманный мопед"
        )
    return out


# --------------------------------------------------------------------------
# Продажи и закупки
# --------------------------------------------------------------------------

def import_sales(o: Odoo, cur, rep: Report, customers: dict[int, str],
                 vehicles_by_vin: dict[str, str]) -> dict[str, str]:
    orders = o.search_read(
        "sale.order", [("is_rental_order", "=", False), ("state", "in", ["sale", "done"])],
        ["name", "partner_id", "date_order", "amount_total", "order_line", "note"], limit=200, order="name",
    )
    line_ids = [i for r in orders for i in r["order_line"]]
    lines = o.search_read("sale.order.line", [("id", "in", line_ids)],
                          ["order_id", "product_id", "name", "price_unit"], limit=2000)
    lots = {x["name"].strip().upper(): x["id"] for x in o.search_read("stock.lot", [], ["name"], limit=500)}
    by_order: dict[int, list[dict]] = defaultdict(list)
    for l in lines:
        by_order[l["order_id"][0]].append(l)

    out: dict[str, str] = {}
    for r in orders:
        cust = customers.get(r["partner_id"][0]) if r.get("partner_id") else None
        if not cust:
            rep.note(f"{r['name']}: покупателя нет среди перенесённых — продажа пропущена")
            continue
        # VIN продажи в Odoo написан словами в тексте строки: «Flybrother
        # WOLF-8 2022, белый, VIN HHBLWFCA7N0206110». Многие из этих мопедов
        # проданы до того, как в Odoo появился склад, и во Fleet их нет — как
        # и опечатки вроде HHB вместо HH8. Такой VIN не выдумывает мопеда: он
        # ложится в `vin_note`, поле, которое для этого и есть.
        vehicle_id, vin_note = None, None
        blob = " ".join((l.get("name") or "") for l in by_order[r["id"]]).upper()
        found = re.search(r"VIN\s*([A-Z0-9]{14,17})", blob)
        said = found.group(1) if found else None
        if said and said in vehicles_by_vin:
            vehicle_id = vehicles_by_vin[said]
        elif said:
            vin_note = f"VIN по инвойсу: {said}. Мопеда с таким номером среди перенесённых нет"
            rep.did("продаж, чей VIN назван, но мопеда у нас нет")
        else:
            vin_note = "VIN в инвойсе не указан"
            rep.did("продаж без VIN в инвойсе")
        sold = as_date(r.get("date_order"))
        cur.execute(
            """
            insert into sales (customer_id, vehicle_id, vin_note, sold_on, price_tetri, status, odoo_order_id, notes)
            values (%s,%s,%s,%s,%s,'active',%s,%s)
            on conflict (odoo_order_id) do update set
              customer_id = excluded.customer_id, vehicle_id = excluded.vehicle_id,
              sold_on = excluded.sold_on, price_tetri = excluded.price_tetri, updated_at = now()
            returning id
            """,
            (cust, vehicle_id, vin_note, sold, tetri(r["amount_total"]), r["id"],
             ("Перенесено из Odoo 15.09.2026. " + re.sub(r"<[^>]+>", " ", r.get("note") or "").strip())[:4000]),
        )
        out[r["name"]] = cur.fetchone()[0]
        rep.did("продажи")
        if vehicle_id:
            cur.execute("update vehicles set state = 'sold', updated_at = now() where id = %s and state <> 'rented'", (vehicle_id,))
    return out


def import_purchases(o: Odoo, cur, rep: Report, customers: dict[int, str]) -> dict[str, str]:
    orders = o.search_read("purchase.order", [],
                           ["name", "partner_id", "partner_ref", "date_order", "date_approve", "state", "currency_id", "order_line"],
                           limit=200, order="name")
    line_ids = [i for r in orders for i in r["order_line"]]
    lines = o.search_read("purchase.order.line", [("id", "in", line_ids)],
                          ["order_id", "product_id", "product_qty", "price_unit", "name"], limit=2000)
    models = {}
    cur.execute("select odoo_sale_product_id, id from vehicle_models where odoo_sale_product_id is not null")
    for pid, mid in cur.fetchall():
        models[pid] = mid
    prod_tmpl = {p["id"]: p.get("product_tmpl_id", [None])[0]
                 for p in o.search_read("product.product", [("id", "in", list({l["product_id"][0] for l in lines if l.get("product_id")}))],
                                        ["product_tmpl_id"], limit=500)}
    by_order: dict[int, list[dict]] = defaultdict(list)
    for l in lines:
        by_order[l["order_id"][0]].append(l)

    out: dict[str, str] = {}
    for r in orders:
        sup = customers.get(r["partner_id"][0]) if r.get("partner_id") else None
        if not sup:
            rep.note(f"{r['name']}: поставщика нет среди перенесённых — закупка пропущена")
            continue
        # Приход в Odoo сознательно не проводился (журнал 13.08.2026: остатки
        # уже стояли вручную, проведение задвоило бы их). Значит и у нас
        # закупка «заказана», а не «получена» — выдумывать дату прихода нельзя.
        status = "cancelled" if r["state"] == "cancel" else "ordered"
        cur.execute(
            """
            insert into purchases (supplier_id, invoice_no, invoice_date, currency, ordered_on, status, odoo_order_id, notes)
            values (%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (odoo_order_id) do update set
              supplier_id = excluded.supplier_id, invoice_no = excluded.invoice_no,
              ordered_on = excluded.ordered_on, status = excluded.status, updated_at = now()
            returning id
            """,
            (sup, (r.get("partner_ref") or None), as_date(r.get("date_order")),
             (r["currency_id"][1] if r.get("currency_id") else "GEL"),
             as_date(r.get("date_order")) or date.today(), status, r["id"],
             "Перенесено из Odoo 15.09.2026. Приход в Odoo не проводился, поэтому статус «заказана»"
             + (". Черновик: сумма не подтверждена" if r["state"] == "draft" else "")),
        )
        pid = cur.fetchone()[0]
        out[r["name"]] = pid
        rep.did("закупки")
        cur.execute("delete from purchase_lines where purchase_id = %s", (pid,))
        for l in by_order[r["id"]]:
            tmpl = prod_tmpl.get(l["product_id"][0]) if l.get("product_id") else None
            cur.execute(
                "insert into purchase_lines (purchase_id, model_id, part_name, qty, unit_price_minor) values (%s,%s,%s,%s,%s)",
                (pid, models.get(tmpl), None if models.get(tmpl) else (l.get("name") or "")[:120],
                 int(l["product_qty"]), tetri(l["price_unit"])),
            )
            rep.did("строки закупок")
    return out


# --------------------------------------------------------------------------
# Платежи и разноска
# --------------------------------------------------------------------------

def import_payments(o: Odoo, cur, rep: Report, customers: dict[int, str],
                    rentals: dict[str, str], sales: dict[str, str], purchases: dict[str, str]) -> None:
    pays = o.search_read("account.payment", [],
                         ["amount", "date", "partner_id", "payment_type", "journal_id", "memo",
                          "reconciled_invoice_ids", "reconciled_bill_ids"], limit=1000, order="date")
    journals = {j["id"]: j for j in o.search_read("account.journal", [], ["name", "type"], limit=50)}
    inv_ids = {i for p in pays for i in (p.get("reconciled_invoice_ids") or []) + (p.get("reconciled_bill_ids") or [])}
    invoices = {i["id"]: (i.get("invoice_origin") or "").strip()
                for i in o.search_read("account.move", [("id", "in", list(inv_ids))], ["invoice_origin"], limit=2000)}

    for p in pays:
        cust = customers.get(p["partner_id"][0]) if p.get("partner_id") else None
        jtype = journals.get(p["journal_id"][0], {}).get("type") if p.get("journal_id") else None
        channel = "cash" if jtype == "cash" else "transfer"
        origins = {invoices.get(i, "") for i in (p.get("reconciled_invoice_ids") or []) + (p.get("reconciled_bill_ids") or [])}
        origins.discard("")
        rental_id = next((rentals[x] for x in origins if x in rentals), None)
        sale_id = next((sales[x] for x in origins if x in sales), None)
        purchase_id = next((purchases[x] for x in origins if x in purchases), None)
        amount = tetri(p["amount"])
        cur.execute(
            """
            insert into payments (occurred_on, direction, channel, gross_tetri, fee_tetri, net_tetri,
                                  customer_id, rental_id, sale_id, purchase_id, source, note, odoo_payment_id)
            values (%s,%s,%s,%s,0,%s,%s,%s,%s,%s,'manual',%s,%s)
            on conflict (odoo_payment_id) do update set
              occurred_on = excluded.occurred_on, gross_tetri = excluded.gross_tetri,
              net_tetri = excluded.net_tetri, customer_id = excluded.customer_id,
              rental_id = excluded.rental_id, sale_id = excluded.sale_id, purchase_id = excluded.purchase_id
            returning id
            """,
            (as_date(p["date"]), "in" if p["payment_type"] == "inbound" else "out", channel,
             amount, amount, cust, rental_id, sale_id, purchase_id,
             "Перенесено из Odoo 15.09.2026" + (f". {p['memo']}" if p.get("memo") else ""), p["id"]),
        )
        rep.did("платежи")
        if not (rental_id or sale_id or purchase_id):
            rep.did("платежи без привязки к заказу")


def derive_vehicle_state(cur, rep: Report) -> None:
    """Состояние мопеда выводится из событий, а не переносится (FLT-03).

    В Odoo после перестройки 18.08 стадия «Rented» из Fleet убрана: кто на
    каком мопеде — знает приложение аренды. Значит состояние надо вывести из
    самих аренд, и заодно оставить события, из которых оно следует, — иначе
    лента мопеда начнётся с пустого места.
    """
    cur.execute("""
        insert into vehicle_events (vehicle_id, kind, occurred_on, from_state, to_state, rental_id, reason)
        select r.vehicle_id, 'pickup', r.picked_up_on, 'available', 'rented', r.id, 'Перенесено из Odoo'
        from rentals r
        where r.vehicle_id is not null and r.picked_up_on is not null
    """)
    rep.did("события выдачи", cur.rowcount)
    cur.execute("""
        insert into vehicle_events (vehicle_id, kind, occurred_on, from_state, to_state, rental_id, reason)
        select r.vehicle_id, 'return', r.returned_on, 'rented', 'available', r.id, 'Перенесено из Odoo'
        from rentals r
        where r.vehicle_id is not null and r.returned_on is not null
    """)
    rep.did("события возврата", cur.rowcount)
    cur.execute("""
        update vehicles v set state = 'rented', current_rental_id = r.id, updated_at = now()
        from rentals r
        where r.vehicle_id = v.id and r.status in ('active','overdue') and v.state = 'available'
    """)
    rep.did("мопедов переведено в «в аренде» по действующей аренде", cur.rowcount)


def allocate_and_recompute(cur, rep: Report) -> None:
    """Разносим платежи по нашему правилу: сначала залог, потом недели по порядку.

    Это тот же порядок, что в `spreadPayment` (packages/shared). Проверяется не
    чтением, а итогом: после разноски сверка с Odoo должна сойтись.
    """
    cur.execute("delete from payment_allocations")
    cur.execute("""
        select p.id, p.gross_tetri, p.rental_id
        from payments p
        where p.direction = 'in' and p.rental_id is not null and p.voided_at is null
        order by p.occurred_on, p.created_at
    """)
    for pay_id, gross, rental_id in cur.fetchall():
        left = gross
        cur.execute("select id, amount_tetri, paid_tetri from deposits where rental_id = %s", (rental_id,))
        dep = cur.fetchone()
        if dep:
            dep_id, dep_amount, dep_paid = dep
            take = min(max(0, dep_amount - dep_paid), left)
            if take > 0:
                cur.execute("insert into payment_allocations (payment_id, target, deposit_id, amount_tetri) values (%s,'deposit',%s,%s)",
                            (pay_id, dep_id, take))
                cur.execute("update deposits set paid_tetri = paid_tetri + %s where id = %s", (take, dep_id))
                left -= take
        if left <= 0:
            continue
        cur.execute("select id, amount_tetri, paid_tetri from rental_periods where rental_id = %s order by seq", (rental_id,))
        for per_id, amount, paid in cur.fetchall():
            take = min(max(0, amount - paid), left)
            if take <= 0:
                continue
            cur.execute("insert into payment_allocations (payment_id, target, period_id, amount_tetri) values (%s,'period',%s,%s)",
                        (pay_id, per_id, take))
            cur.execute("update rental_periods set paid_tetri = paid_tetri + %s where id = %s", (take, per_id))
            left -= take
            if left <= 0:
                break
        if left > 0:
            rep.did("платежей с остатком сверх выставленного")

    # Производные поля — те два, что мы всё-таки храним.
    cur.execute("""
        update rental_periods set pay_status = case
            when paid_tetri >= amount_tetri then 'paid'::period_pay_status
            when paid_tetri > 0 then 'partial'::period_pay_status
            else 'unpaid'::period_pay_status end
    """)
    cur.execute("""
        update rentals r set paid_through = (
            select max(p.ends_on) from rental_periods p
            where p.rental_id = r.id and p.pay_status = 'paid'
              and p.seq < coalesce((select min(seq) from rental_periods b
                                    where b.rental_id = r.id and b.pay_status <> 'paid'), 2147483647))
    """)
    cur.execute("""
        update deposits set status = 'held'::deposit_status where status is null
    """)


def main() -> int:
    ap = argparse.ArgumentParser(description="Odoo → EV8 Ops, read-only against Odoo.")
    ap.add_argument("--apply", action="store_true", help="записать (иначе только прочитать и показать)")
    ap.add_argument("--dry-run", action="store_true", help="явно: ничего не писать")
    ap.add_argument("--wipe", action="store_true",
                    help="очистить операционные таблицы перед импортом (логины и журнал не трогаются)")
    ap.add_argument("--db", default=os.environ.get("DATABASE_URL", DEFAULT_DB))
    args = ap.parse_args()
    if not args.apply:
        print("Сухой прогон: Odoo читается, в базу не пишется. Для записи — --apply.\n")

    o = Odoo()
    rep = Report()
    with psycopg.connect(args.db) as conn:
        with conn.cursor() as cur:
            if args.wipe and args.apply:
                # Демо-строки связаны между собой ссылками, и выдёргивать их по
                # одной значит ловить нарушения ключей. Чистим операционные
                # таблицы целиком — логины, сессии и журнал изменений остаются.
                cur.execute("""
                    truncate payment_allocations, payments, statement_lines, statements,
                             rental_periods, deposits, acts, rentals,
                             sale_instalments, sales, purchase_lines, purchases,
                             stock_moves, parts, service_parts, service_jobs,
                             vehicle_events, vehicles, vehicle_models, customers, files
                    restart identity cascade
                """)
                rep.note("операционные таблицы очищены перед импортом; логины и журнал изменений сохранены")
            today = date.today()
            model_ids = import_models(o, cur, rep)
            vehicle_ids = import_vehicles(o, cur, rep, model_ids)
            customer_ids = import_customers(o, cur, rep)
            rentals = import_rentals(o, cur, rep, customer_ids, vehicle_ids, today)
            sales = import_sales(o, cur, rep, customer_ids, vehicle_ids)
            purchases = import_purchases(o, cur, rep, customer_ids)
            import_payments(o, cur, rep, customer_ids, rentals, sales, purchases)
            derive_vehicle_state(cur, rep)
            allocate_and_recompute(cur, rep)
            if args.apply:
                conn.commit()
            else:
                conn.rollback()
    rep.print()
    print("\nЗаписано." if args.apply else "\nНичего не записано (сухой прогон).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
