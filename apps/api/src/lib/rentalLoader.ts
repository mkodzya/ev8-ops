import { canPickUp, formatGel, isISODate, kommoLeadId, periodsThrough, todayISO, type ISODate, type VehicleState } from '@ev8/shared';
import type { Actor } from './auth.js';
import { prisma } from './db.js';
import { debtsOf } from './debt.js';
import { env } from './env.js';
import { ApiError } from './errors.js';
import { pickUp, type PickupInput } from './rentals.js';

// Running rentals brought over from a list (Mika, 08.10.2026). The rentals
// that were already out when EV8 Ops began are a state on a date, known from
// the director's answers; typing each into the wizard is a chance to mistype
// it. So a list is checked whole, and then every row goes through `pickUp`
// with `transfer` — the function the hand-over wizard calls — so the weeks,
// the deposit, the moped's events, the park and the journal come out exactly
// as from the wizard.
//
//   · The customer is resolved, never typed: the one card whose Kommo field
//     names the row's deal. The moped is the one with the row's VIN.
//   · Everything is checked before anything is written; one problem anywhere
//     and nothing is written. The rows are written in one transaction, so a
//     refusal half-way leaves nothing behind either.
//   · A row whose rental is already here is skipped, so a list that grew can
//     be run again.
//
// The report is for the owner, in Russian, and is the only output: no file,
// no phone, no personal number, no address.

/** What a row of the list carries. Money in tetri; dates as YYYY-MM-DD. */
const FIELDS = [
  'label',
  'kommoLead',
  'vin',
  'pickedUpOn',
  'weeklyRateTetri',
  'depositTetri',
  'depositReceivedTetri',
  'paidThrough',
  'nightParkingAddress',
  'batteries',
  'chargers',
  'note',
] as const;

/** The same limits the wizard's route sets (routes/handover.ts). */
const MAX_ADDRESS = 300;
const MAX_NOTE = 4000;

export type RowVerdict = 'ready' | 'written' | 'exists' | 'problem' | 'failed';

export interface RowReport {
  label: string;
  /** The last characters of the VIN: enough to tell the mopeds of a list apart. */
  vinTail: string | null;
  /** The customer's name as the stand has it. */
  customerName: string | null;
  verdict: RowVerdict;
  /** Written now, or found here already. */
  rentalNumber: string | null;
  problems: string[];
  /** What a ready row says: the facts that will be, or were, written. */
  facts: string | null;
}

export interface LoadReport {
  mode: 'check' | 'commit';
  today: ISODate;
  ownerName: string | null;
  /** The run did not start: the list could not be read, or the owner is not one. */
  refused: string | null;
  rows: RowReport[];
  written: number;
}

interface Row {
  report: RowReport;
  lead: string | null;
  vin: string | null;
  pickedUpOn: ISODate | null;
  weeklyRateTetri: number | null;
  depositTetri: number | null;
  depositReceivedTetri: number | null;
  paidThrough: ISODate | null;
  address: string | null;
  batteries: number | null;
  chargers: number | null;
  note: string | null;
  customerId: string | null;
  vehicleId: string | null;
}

const ruDate = (d: ISODate): string => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
const gel = (tetri: number): string => formatGel(tetri, { decimals: false });
const whole = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/**
 * What broke, without what was in the row: a database error can quote the
 * values it was given, and those are an address and a note. The first line
 * names the failure; the rest is where the values are.
 */
export function brief(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return (text.split('\n').find((l) => l.trim()) ?? 'неизвестная ошибка').trim().slice(0, 200);
}

const STATE_RU: Record<VehicleState, string> = { available: 'свободен', rented: 'в аренде', service: 'в ремонте', out: 'выбыл', sold: 'продан' };

/** One element of the list as written, with what is wrong with its shape. */
function readRow(raw: unknown, index: number): Row {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  const label = o && typeof o.label === 'string' && o.label.trim() ? o.label.trim().slice(0, 40) : `строка ${index + 1}`;
  const problems: string[] = [];
  const row: Row = {
    report: { label, vinTail: null, customerName: null, verdict: 'problem', rentalNumber: null, problems, facts: null },
    lead: null,
    vin: null,
    pickedUpOn: null,
    weeklyRateTetri: null,
    depositTetri: null,
    depositReceivedTetri: null,
    paidThrough: null,
    address: null,
    batteries: null,
    chargers: null,
    note: null,
    customerId: null,
    vehicleId: null,
  };
  if (!o) {
    problems.push('это не запись с полями');
    return row;
  }
  // A mistyped name must not pass for an empty value: "paidTrough" would read
  // as "nothing paid" and hand the customer a debt of every week.
  for (const k of Object.keys(o)) if (!(FIELDS as readonly string[]).includes(k)) problems.push(`незнакомое поле ${k}`);
  for (const k of FIELDS) if (!(k in o)) problems.push(`нет поля ${k}`);

  if ('label' in o && !(typeof o.label === 'string' && o.label.trim())) problems.push('label — метка строки, например «№2»');

  if ('kommoLead' in o) {
    row.lead = typeof o.kommoLead === 'string' || whole(o.kommoLead) ? kommoLeadId(String(o.kommoLead)) : null;
    if (!row.lead) problems.push('kommoLead — не номер сделки Kommo');
  }
  if ('vin' in o) {
    row.vin = typeof o.vin === 'string' && o.vin.trim() ? o.vin.trim().toUpperCase() : null;
    if (!row.vin) problems.push('vin — пусто');
    else row.report.vinTail = `…${row.vin.slice(-6)}`;
  }
  if ('pickedUpOn' in o) {
    row.pickedUpOn = typeof o.pickedUpOn === 'string' && isISODate(o.pickedUpOn) ? o.pickedUpOn : null;
    if (!row.pickedUpOn) problems.push('pickedUpOn — дата выдачи вида ГГГГ-ММ-ДД');
  }
  if ('weeklyRateTetri' in o) {
    row.weeklyRateTetri = whole(o.weeklyRateTetri) && o.weeklyRateTetri > 0 ? o.weeklyRateTetri : null;
    if (row.weeklyRateTetri == null) problems.push('weeklyRateTetri — ставка в тетри, целое число больше нуля (150 ₾ — это 15000)');
  }
  if ('depositTetri' in o) {
    row.depositTetri = whole(o.depositTetri) && o.depositTetri >= 0 ? o.depositTetri : null;
    if (row.depositTetri == null) problems.push('depositTetri — залог в тетри, целое число (180 ₾ — это 18000)');
  }
  if ('depositReceivedTetri' in o) {
    row.depositReceivedTetri = whole(o.depositReceivedTetri) && o.depositReceivedTetri >= 0 ? o.depositReceivedTetri : null;
    if (row.depositReceivedTetri == null) problems.push('depositReceivedTetri — сколько залога получено, в тетри, целое число');
  }
  if ('paidThrough' in o && o.paidThrough !== null) {
    row.paidThrough = typeof o.paidThrough === 'string' && isISODate(o.paidThrough) ? o.paidThrough : null;
    if (!row.paidThrough) problems.push('paidThrough — дата вида ГГГГ-ММ-ДД, или null, если не оплачено ничего');
  }
  if ('nightParkingAddress' in o) {
    if (typeof o.nightParkingAddress !== 'string' || !o.nightParkingAddress.trim()) problems.push('нет адреса ночной парковки (§5 договора)');
    else if (o.nightParkingAddress.trim().length > MAX_ADDRESS) problems.push(`адрес ночной парковки длиннее ${MAX_ADDRESS} знаков`);
    else row.address = o.nightParkingAddress.trim();
  }
  for (const k of ['batteries', 'chargers'] as const) {
    if (!(k in o) || o[k] === null) continue;
    if (whole(o[k]) && (o[k] as number) >= 0) row[k] = o[k] as number;
    else problems.push(`${k} — целое число, или null, если не известно`);
  }
  if ('note' in o && o.note !== null) {
    if (typeof o.note !== 'string') problems.push('note — текст или null');
    else if (o.note.trim().length > MAX_NOTE) problems.push(`заметка длиннее ${MAX_NOTE} знаков`);
    // Mika, 07.10.2026: the word does not appear in the data's notes.
    else if (/odoo/i.test(o.note)) problems.push('в заметке есть слово «Odoo» — в данные оно не пишется');
    else row.note = o.note.trim() || null;
  }
  return row;
}

/** The list as text → its rows, or why it cannot be read at all. */
function readList(text: string): { rows: Row[]; refused: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], refused: text.trim() ? 'Список не читается: это не JSON.' : 'Список пуст: на вход ничего не пришло.' };
  }
  if (!Array.isArray(parsed)) return { rows: [], refused: 'Список не читается: ждём перечень аренд в квадратных скобках.' };
  if (parsed.length === 0) return { rows: [], refused: 'В списке нет ни одной аренды.' };
  return { rows: parsed.map(readRow), refused: null };
}

/** The same value in two rows: each of them says which other row has it. */
function markTwins(rows: Row[], key: (r: Row) => string | null, what: string): void {
  const seen = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    if (k) seen.set(k, [...(seen.get(k) ?? []), r]);
  }
  for (const twins of seen.values()) {
    if (twins.length < 2) continue;
    for (const r of twins) {
      const others = twins.filter((t) => t !== r).map((t) => t.report.label);
      r.report.problems.push(`${what} повторяется в списке: ещё в «${others.join('», «')}»`);
    }
  }
}

/** Why "paid through" is not the last day of a week of this rental. */
function paidThroughProblem(pickedUpOn: ISODate, paidThrough: ISODate, today: ISODate): string | null {
  const weeks = periodsThrough(pickedUpOn, today);
  if (weeks.some((p) => p.endsOn === paidThrough)) return null;
  const last = weeks[weeks.length - 1]!;
  if (paidThrough > last.endsOn) return `«оплачено по» ${ruDate(paidThrough)} — дальше текущей недели, она кончается ${ruDate(last.endsOn)}`;
  if (paidThrough < weeks[0]!.endsOn) return `«оплачено по» ${ruDate(paidThrough)} — раньше конца первой недели (${ruDate(weeks[0]!.endsOn)}); если не оплачено ничего, там null`;
  const week = weeks.find((p) => p.startsOn <= paidThrough && paidThrough <= p.endsOn)!;
  const before = weeks[week.seq - 2]!;
  return `«оплачено по» ${ruDate(paidThrough)} — не последний день недели, считая от выдачи; рядом недели кончаются ${ruDate(before.endsOn)} и ${ruDate(week.endsOn)}`;
}

/** What a ready row brings: said back so the owner reads it before it is written. */
function factsOf(r: Row, today: ISODate): string {
  const weeks = periodsThrough(r.pickedUpOn!, today);
  const unpaid = weeks.filter((p) => !r.paidThrough || p.endsOn > r.paidThrough).length;
  return [
    `выдан ${ruDate(r.pickedUpOn!)}`,
    `${gel(r.weeklyRateTetri!)} в неделю`,
    r.paidThrough ? `оплачено по ${ruDate(r.paidThrough)}` : 'не оплачено ничего',
    `залог ${gel(r.depositReceivedTetri!)} из ${gel(r.depositTetri!)}`,
    unpaid > 0 ? `неоплаченных недель на сегодня: ${unpaid} (${gel(unpaid * r.weeklyRateTetri!)})` : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function pickupOf(r: Row, actor: Actor, today: ISODate): PickupInput {
  return {
    actor,
    today,
    customerId: r.customerId,
    newCustomer: null,
    vehicleId: r.vehicleId,
    vinNote: null,
    // A moped of the sale park is refused by the check: moving it is an owner's decision, made in the wizard.
    moveFromSale: false,
    weeklyRateTetri: r.weeklyRateTetri!,
    depositTetri: r.depositTetri!,
    pickedUpOn: r.pickedUpOn!,
    expectedReturnOn: null,
    odometerKm: null,
    odometerReason: null,
    condition: null,
    notes: r.note,
    buyoutTargetTetri: null,
    buyoutPerPaymentTetri: null,
    nightParkingAddress: r.address,
    batteries: r.batteries,
    chargers: r.chargers,
    payment: null,
    transfer: { paidThrough: r.paidThrough, depositReceivedTetri: r.depositReceivedTetri! },
    debtOverrideReason: null,
    strict: true,
  };
}

type OwnerRow = { id: string; email: string; name: string; locale: string };

/**
 * Nobody was named: the stand's one owner, if it has one. The env file's
 * OWNER_EMAIL is no answer — it only seeds the first login of an empty
 * database, and on the test stand it holds a placeholder (08.10.2026).
 */
export function soleOwner<T extends { email: string }>(owners: readonly T[]): { owner: T | null; refused: string | null } {
  if (owners.length === 1) return { owner: owners[0]!, refused: null };
  if (owners.length === 0) return { owner: null, refused: 'На стенде нет ни одного действующего владельца: писать не от чьего имени.' };
  return { owner: null, refused: `На стенде несколько владельцев: ${owners.map((o) => o.email).join(', ')}. Назовите, от чьего имени писать: добавьте к команде --owner и e-mail.` };
}

/** The owner the rentals are written in the name of, or why there is none: the one named by e-mail, else the stand's only one. */
export async function ownerBy(email: string | null): Promise<{ actor: Actor | null; refused: string | null }> {
  const actorOf = (u: OwnerRow): Actor => ({ id: u.id, email: u.email, name: u.name, role: 'owner', locale: u.locale });
  const address = (email ?? '').trim().toLowerCase();
  if (!address) {
    const { owner, refused } = soleOwner(await prisma.user.findMany({ where: { role: 'owner', active: true }, orderBy: { createdAt: 'asc' } }));
    return { actor: owner ? actorOf(owner) : null, refused };
  }
  const u = await prisma.user.findUnique({ where: { email: address } });
  if (!u) return { actor: null, refused: `Учётки ${address} на стенде нет.` };
  if (!u.active) return { actor: null, refused: `Учётка ${address} отключена.` };
  if (u.role !== 'owner') return { actor: null, refused: `${address} — не владелец. Действующие аренды переносит только владелец.` };
  return { actor: actorOf(u), refused: null };
}

export interface LoadInput {
  /** The list as it arrived: JSON, an array of rows. */
  text: string;
  /** In whose name the rentals are written. Null: the stand's only owner. */
  ownerEmail: string | null;
  /** Write. Without it the list is only checked. */
  commit: boolean;
  today?: ISODate;
}

export async function loadRentals(input: LoadInput): Promise<LoadReport> {
  const today = input.today ?? todayISO(new Date(), env.TZ);
  const report: LoadReport = { mode: input.commit ? 'commit' : 'check', today, ownerName: null, refused: null, rows: [], written: 0 };

  const owner = await ownerBy(input.ownerEmail);
  if (!owner.actor) return { ...report, refused: owner.refused };
  report.ownerName = owner.actor.name;

  const list = readList(input.text);
  if (list.refused) return { ...report, refused: list.refused };
  const rows = list.rows;
  report.rows = rows.map((r) => r.report);

  markTwins(rows, (r) => r.vin, 'VIN');
  markTwins(rows, (r) => r.lead, 'сделка Kommo');
  markTwins(rows, (r) => r.report.label, 'метка');

  // Who and what: the card that names the deal, the moped with the VIN.
  const cards = await prisma.customer.findMany({
    where: { kommoRef: { not: null }, archived: false, mergedIntoId: null },
    select: { id: true, name: true, kommoRef: true },
    orderBy: { createdAt: 'asc' },
  });
  const cardsOf = new Map<string, { id: string; name: string }[]>();
  for (const c of cards) {
    const lead = kommoLeadId(c.kommoRef);
    if (lead) cardsOf.set(lead, [...(cardsOf.get(lead) ?? []), { id: c.id, name: c.name }]);
  }
  const vins = rows.map((r) => r.vin).filter((v): v is string => !!v);
  const mopeds = new Map((await prisma.vehicle.findMany({ where: { vin: { in: vins } }, select: { id: true, vin: true, state: true, pool: true, archived: true } })).map((v) => [v.vin, v]));

  const fresh: Row[] = [];
  for (const r of rows) {
    const problems = r.report.problems;
    const found = r.lead ? (cardsOf.get(r.lead) ?? []) : [];
    if (r.lead && found.length === 0) problems.push(`карточки клиента со сделкой Kommo ${r.lead} на стенде нет`);
    if (found.length > 1) problems.push(`на сделку Kommo ${r.lead} ссылается больше одной карточки: ${found.map((c) => c.name).join(', ')}`);
    const customer = found.length === 1 ? found[0]! : null;
    if (customer) {
      r.customerId = customer.id;
      r.report.customerName = customer.name;
    }
    const moped = r.vin ? (mopeds.get(r.vin) ?? null) : null;
    if (r.vin && !moped) problems.push('мопеда с таким VIN на стенде нет');
    if (moped) r.vehicleId = moped.id;
    if (!customer || !moped) continue;

    // Already here: this customer on this moped, not returned. Nothing of the
    // row is written, so nothing more of it is checked.
    const here = await prisma.rental.findFirst({
      where: { customerId: customer.id, vehicleId: moped.id, status: { not: 'returned' } },
      orderBy: { createdAt: 'asc' },
      select: { number: true },
    });
    if (here) {
      r.report.rentalNumber = here.number;
      if (problems.length === 0) r.report.verdict = 'exists';
      continue;
    }

    if (moped.archived) problems.push('мопед в архиве');
    else if (!canPickUp(moped.state as VehicleState)) problems.push(`мопед сейчас не свободен: ${STATE_RU[moped.state as VehicleState] ?? moped.state}`);
    // Out of the sale park only by an owner's decision, and that is asked in the wizard (Q9).
    if (moped.pool === 'sale') problems.push('мопед стоит в парке продажи; в аренду его переводит владелец в мастере выдачи');
    if (r.pickedUpOn && r.pickedUpOn >= today) problems.push(`дата выдачи ${ruDate(r.pickedUpOn)} — не раньше сегодняшнего дня; переносится аренда, начатая до сегодня`);
    else if (r.pickedUpOn && r.paidThrough) {
      const wrong = paidThroughProblem(r.pickedUpOn, r.paidThrough, today);
      if (wrong) problems.push(wrong);
    }
    if (r.depositTetri != null && r.depositReceivedTetri != null && r.depositReceivedTetri > r.depositTetri) problems.push('получено залога больше, чем сам залог');
    fresh.push(r);
  }

  // A customer who owes gets a moped from an owner with a reason — in the wizard, not from a list (В2).
  const debts = await debtsOf(fresh.map((r) => r.customerId!));
  for (const r of fresh) {
    const owes = debts.get(r.customerId!)?.owesTetri ?? 0;
    if (owes > 0) r.report.problems.push(`за клиентом числится долг ${gel(owes)}; такую аренду владелец заводит в мастере выдачи, с причиной`);
    if (r.report.problems.length === 0) {
      r.report.verdict = 'ready';
      r.report.facts = factsOf(r, today);
    }
  }

  const ready = fresh.filter((r) => r.report.verdict === 'ready');
  if (!input.commit || ready.length === 0 || rows.some((r) => r.report.verdict === 'problem')) return report;

  // All of them or none: `pickUp` writes inside this transaction.
  let at: Row | null = null;
  const numbers = new Map<Row, string>();
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const r of ready) {
          at = r;
          numbers.set(r, (await pickUp(pickupOf(r, owner.actor!, today), tx)).number);
        }
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  } catch (e) {
    const failedAt = at as Row | null;
    if (failedAt) {
      failedAt.report.verdict = 'failed';
      failedAt.report.problems.push(e instanceof ApiError ? `стенд не принял строку: ${e.message} (${e.code})` : `запись не прошла: ${brief(e)}`);
    } else {
      report.refused = `Запись не началась: ${brief(e)}`;
    }
    return report;
  }
  for (const r of ready) {
    r.report.verdict = 'written';
    r.report.rentalNumber = numbers.get(r)!;
  }
  report.written = ready.length;
  return report;
}

/** 0 — as asked; 1 — the list has problems, nothing written; 2 — the run did not start; 3 — the write was refused, nothing written. */
export function exitCodeOf(report: LoadReport): number {
  if (report.refused) return 2;
  if (report.rows.some((r) => r.verdict === 'failed')) return 3;
  return report.rows.some((r) => r.verdict === 'problem') ? 1 : 0;
}

export function formatLoadReport(report: LoadReport): string {
  const out: string[] = [];
  const mode = report.mode === 'commit' ? 'запись' : 'проверка, без записи';
  out.push(`Перенос действующих аренд — ${mode}. Сегодня ${ruDate(report.today)}.`);
  if (report.refused) {
    out.push(report.refused, 'Ничего не записано.');
    return out.join('\n');
  }
  if (report.ownerName) out.push(`От имени: ${report.ownerName}.`);
  out.push('');

  const width = Math.max(...report.rows.map((r) => r.label.length));
  const count = (v: RowVerdict) => report.rows.filter((r) => r.verdict === v).length;
  for (const r of report.rows) {
    const head = `${r.label.padEnd(width)}  ${r.vinTail ?? '…'}  ${r.customerName ?? '—'}`;
    if (r.verdict === 'written') out.push(`${head} — записана: ${r.rentalNumber} (${r.facts})`);
    else if (r.verdict === 'ready') out.push(`${head} — готова: ${r.facts}`);
    else if (r.verdict === 'exists') out.push(`${head} — уже есть: ${r.rentalNumber}`);
    else out.push(`${head} — ${r.verdict === 'failed' ? 'ОТКАЗ' : 'ПРОБЛЕМА'}: ${r.problems.join('; ')}`);
  }
  out.push('');

  const problems = count('problem');
  const failed = count('failed');
  const ready = count('ready');
  out.push(
    `Итого строк: ${report.rows.length}. ` +
      [report.written ? `записано — ${report.written}` : null, ready ? `готовы — ${ready}` : null, `уже есть — ${count('exists')}`, `с проблемой — ${problems + failed}`].filter(Boolean).join(', ') +
      '.',
  );
  if (failed) out.push('Стенд отказал при записи. Не записано ничего: строки пишутся все вместе или никак.');
  else if (problems) out.push('Ничего не записано: пока в списке есть хоть одна проблема, не пишется ни одна строка.');
  else if (report.mode === 'commit') out.push(report.written ? `Записано аренд: ${report.written}.` : 'Все аренды из списка уже на стенде. Ничего не записано.');
  else out.push(ready ? `Список в порядке. Ничего не записано — это была проверка; к записи готово: ${ready}.` : 'Все аренды из списка уже на стенде. Записывать нечего.');
  return out.join('\n');
}
