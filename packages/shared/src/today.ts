// The queue of "Today" (wave 4 §3.1): what a person has to do now, in the
// order they should do it. One function, because three places read it — the
// screen, the badge on the bottom bar, and the "Today" group on a laptop. A
// badge that counts something the screen does not list is worse than none.
import type { ISODate, RentalStatus } from './types.js';
import type { Tetri } from './money.js';
import { waOffered } from './due.js';
import { overdueDays } from './periods.js';
import { driveReturnWhy } from './drive-returns.js';

// "till" is a manager's last group (§3.1): their own cash, handed over at the
// end of the day. An owner has no such group — a till handed to them is a
// decision, and it stands in "decide".
// "intake" — what Kommo has won and nobody has entered here yet (ADR-0015),
// and a contract in Drive with no rental here (ADR-0034): it stands right
// after the rentals' own groups, because it is a rental or a sale waiting to
// be one.
// "due_today" — the rentals whose week began today (ADR-0017): right after
// the overdue ones, a calm group with the same actions.
// "maintenance" — mopeds whose planned maintenance is near or past (ADR-0038):
// right after the repairs, a group of its own, every moped in it shown.
// «Решения» — the mopeds nobody put in a park, Kommo against the rentals —
// stood beside «Решить» under a near-twin name; since issue #18 (B5) its rows
// are «Дозаполнить»'s, the group of what is not filled in yet.
export const TASK_GROUPS = ['decide', 'returns', 'overdue', 'due_today', 'intake', 'money', 'instalments', 'service', 'maintenance', 'purchases', 'fill', 'till'] as const;
export type TaskGroup = (typeof TASK_GROUPS)[number];

/** What the row's button does; the screen turns it into words and a link. */
export type TaskAction =
  | 'decide_deposit'
  | 'accept_till'
  | 'hand_over_till'
  | 'return'
  | 'take_money'
  | 'take_cash'
  | 'sort'
  | 'upload_statement'
  | 'take_instalment'
  | 'open_service'
  | 'open_report'
  | 'open_maintenance'
  | 'order_parts'
  | 'open_purchase'
  | 'set_pool'
  | 'sign'
  | 'set_vin'
  | 'set_point'
  | 'sort_odoo_deposits'
  | 'reconcile_kommo'
  | 'hand_over_from_kommo'
  | 'sell_from_kommo'
  | 'hand_over_from_drive'
  | 'close_from_drive';

export interface TaskRow {
  /** Stable across reloads: the record it is about plus what it asks for. */
  id: string;
  group: TaskGroup;
  action: TaskAction;
  /** Whose it is: a customer, a manager, a supplier — or nobody. */
  who: string | null;
  /** R-00491, SV-00029, PO-00115 — what to look for. */
  number: string | null;
  /** The last four of a VIN, when a moped is in it. */
  vin: string | null;
  /** Days that make it urgent: overdue, late for the return, in repair. */
  days: number | null;
  amountTetri: Tetri | null;
  href: string;
  phone: string | null;
  /** Extra words the screen already knows how to say (kind of document, bank). */
  note: string | null;
  /**
   * On a row of group `due_today`: how much of `amountTetri` is awaited today.
   * The screen paints the sum red when `amountTetri` is above it.
   */
  dueTodayTetri?: Tetri;
  /**
   * False on a row about a rental that has no ready WhatsApp message today
   * (`waOffered` — one handed over today and not paid yet): the screen draws
   * no WhatsApp button on it, in whichever group the row stands. Absent on
   * every other row.
   */
  whatsapp?: false;
}

export interface QueueRental {
  id: string;
  number: string;
  customer: { id: string; name: string; phone: string | null };
  vin: string | null;
  pickedUpOn: ISODate | null;
  expectedReturnOn: ISODate | null;
  paidThrough: ISODate | null;
  /** Days after a week's first day its rent is due — the rental's pay day (ADR-0022). */
  payOffsetDays: number;
  /** The status as shown — `effectiveRentalStatus`, never the stored one. */
  status: RentalStatus;
  debtTetri: Tetri;
  /** Of debtTetri: awaited today, not late (shared `dueTodayOf`). */
  dueTodayTetri: Tetri;
  depositUndecided: boolean;
  vinUnconfirmed: boolean;
  /**
   * Handed over more than a day ago and the contract is still unsigned (D17):
   * `asksForSignature` of `contractState`. Never a rental brought over (until
   * a swap draws its contract here, ADR-0040), nor one marked signed in
   * Signify (ADR-0039). After a swap the day counts from the swap.
   */
  contractUnsigned: boolean;
}

export interface QueueInput {
  today: ISODate;
  /** An owner sees deposits, the week's money, purchases and pool decisions; a manager does not. */
  owner: boolean;
  rentals: QueueRental[];
  tills: { id: string; who: string; amountTetri: Tetri }[];
  /** For a manager: what is in their own till and not handed over yet. */
  myTillTetri: Tetri;
  unmatchedLines: number;
  staleBanks: { bank: string; days: number }[];
  instalments: { id: string; saleId: string; number: string; who: string; phone: string | null; days: number; amountTetri: Tetri }[];
  service: { open: number; longerThanWeek: number; longestDays: number };
  /** Breakdowns a manager reported and nobody has picked up yet (wave 5 §3.10). */
  reports: { id: string; number: string; vin: string | null; who: string | null; note: string; photos: number }[];
  /** Parts below the level somebody set: one row, and "В заказ" on it (B8-05). */
  lowParts: { count: number; note: string };
  /**
   * Mopeds whose planned maintenance is less than the threshold away or past
   * (ADR-0038), most urgent first; absent where nobody asked. Every moped is a
   * row — the owners and the managers both see them.
   */
  maintenance?: { vehicleId: string; number: string | null; model: string; vin: string; dueKm: number; currentKm: number; leftKm: number }[];
  purchases: { id: string; number: string; who: string; note: string }[];
  /**
   * The mopeds under the chips the two rows open, «Не назначен» (`nopool`)
   * and «Не указана» (`nopoint`) — counted by `fleetChipOf`, the list's own
   * rule (Mika, answer «А», 22.10.2026): idle ones only, and one with neither
   * park nor point is a park to decide before it is a point to set.
   */
  vehiclesWithoutPool: number;
  vehiclesWithoutPoint: number;
  /**
   * Deposits Odoo brought over with no decision in them (wave 6 §3.7). They
   * are one row, not forty-two: the answer to the tester's question of wave
   * 3, where a pile of old deposits buried the till that was handed over
   * this morning.
   */
  odooDeposits: { count: number; amountTetri: Tetri };
  /**
   * Where Kommo and EV8 Ops disagree about who rents (ADR-0012), as one row.
   * Null when the link is off or has not been asked yet — then there is
   * nothing to say. `silent` is a row of its own kind: Kommo has stopped
   * answering, and an owner who is not told reads "no row" as "all agree".
   */
  kommo: { rentedThere: number; rentedHere: number; silent: boolean; lastOkAt: string | null } | null;
  /**
   * Deals Kommo has won that nothing here answers to yet (ADR-0015): a deal
   * in the rented stage with no rental, a sale closed as won with no sale.
   * Each is a task of its own, for whoever hands the moped over — a manager
   * sees them too. `customerId` is the card the hand-over starts from.
   */
  kommoDeals: { leadId: string; kind: 'rent' | 'sale'; who: string; customerId: string | null; phone: string | null }[];
  /**
   * Drive beside the rentals here (ADR-0034), an owner's: a contract of the
   * last two weeks with no rental here, and a return Drive has — its act's
   * day and the deposit paid back by it — while the rental here still runs.
   */
  drive?: {
    /** With a deal in Kommo for the same person: its link, the card it found, the phone (ADR-0034). */
    contracts: { folderId: string; who: string; datedOn: ISODate | null; leadId?: string; customerId?: string | null; phone?: string | null }[];
    /**
     * `act`: a return act is in the folder, dated or not; false — only the
     * folder was moved among the finished. An act with no date is still an act
     * (issue #19): the row said «папка в Drive — в завершённых» of one.
     */
    returns: { rentalId: string; returnedOn: ISODate | null; paidBackTetri: Tetri | null; act: boolean }[];
  };
}

export interface TaskGroupRows {
  group: TaskGroup;
  rows: TaskRow[];
  /** Everything in the group, not only the three the screen shows. */
  total: number;
  /**
   * The money of every row of the group — `total` rows, not the ones left
   * over, so the line under the group says «Все 12 · …» (an invented example)
   * of the same 12 the list it opens adds up to (QA of #15, 25.10.2026;
   * `queueMore`). Null for a manager:
   * the overdue of all the renters together is an owner's figure (Mika's «да»
   * of 25.10.2026, ADR-0048 addendum); each row keeps its own sum.
   */
  totalTetri: Tetri | null;
}

const SHOWN = 3;
/**
 * Deals from Kommo are shown one by one: each is somebody waiting, and there is no list to open them in.
 * So are the mopeds due for maintenance (ADR-0038): the group is the list.
 */
const SHOWN_INTAKE = 20;

/** The list the Kommo row opens. It is in no menu: with the link off there is nothing on it. */
export const KOMMO_PATH = '/settings/kommo';

const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The whole queue, group by group, in the order the day is worked through.
 * A manager's queue is the same rules with the owners' groups left out
 * (wave 4 §3.1); a group with nothing in it does not appear at all.
 */
export function dayQueue(input: QueueInput): TaskGroupRows[] {
  const rows: TaskRow[] = [];
  const open = input.rentals.filter((r) => r.status !== 'returned');
  // A rental is one customer in several groups — a return, a week to take, a
  // contract to sign. Each of its rows says when there is no message to send.
  const wa = (r: QueueRental): { whatsapp?: false } => (waOffered(r.status, r.pickedUpOn, input.today) ? {} : { whatsapp: false });

  // 1. Decide — an owner's: a till handed over today, a deposit a manager's
  // return left. The till comes first: it is money on somebody's hands right
  // now, while deposits can wait a day, and a group shows three rows — with a
  // pile of old deposits the till would never be seen (QA-W4-12).
  if (input.owner) {
    for (const t of input.tills) {
      rows.push({ id: `till:${t.id}`, group: 'decide', action: 'accept_till', who: t.who, number: null, vin: null, days: null, amountTetri: t.amountTetri, href: '/money/cash', phone: null, note: null });
    }
    // One row for everything the transfer left undecided, before the
    // deposits that this week's returns left (§3.7).
    if (input.odooDeposits.count > 0) {
      rows.push({
        id: 'deposit:odoo',
        group: 'decide',
        action: 'sort_odoo_deposits',
        who: null,
        number: null,
        vin: null,
        days: input.odooDeposits.count,
        amountTetri: input.odooDeposits.amountTetri,
        href: '/settings/migration',
        phone: null,
        note: null,
      });
    }
    for (const r of input.rentals.filter((x) => x.depositUndecided)) {
      rows.push({
        id: `deposit:${r.id}`,
        group: 'decide',
        action: 'decide_deposit',
        who: r.customer.name,
        number: r.number,
        vin: r.vin,
        days: null,
        amountTetri: null,
        href: `/rentals/${r.id}?decide=1`,
        phone: r.customer.phone,
        note: null,
        ...wa(r),
      });
    }
  }

  // 2. Returns — Drive's first: the moped is back by the act there, and here
  // the rental still runs (ADR-0034). The return opens on the act's day; its
  // planned-day row would say the same thing twice.
  const driveBack = new Map((input.owner ? (input.drive?.returns ?? []) : []).map((d) => [d.rentalId, d]));
  for (const r of open) {
    const d = driveBack.get(r.id);
    if (!d) continue;
    const on = d.returnedOn && d.returnedOn <= input.today ? `?on=${d.returnedOn}` : '';
    rows.push({
      id: `drive_return:${r.id}`,
      group: 'returns',
      action: 'close_from_drive',
      who: r.customer.name,
      number: r.number,
      vin: r.vin,
      days: null,
      amountTetri: null,
      href: `/rentals/${r.id}/return${on}`,
      phone: r.customer.phone,
      // The act's day, what it paid back, and what made the row: an act — dated or not — or the folder moved (issue #19).
      note: `${d.returnedOn ?? ''}|${d.paidBackTetri ?? ''}|${driveReturnWhy(d.act ? { returnedOn: d.returnedOn } : null)}`,
      ...wa(r),
    });
  }

  // Then those planned for today, or whose planned day has passed.
  for (const r of open) {
    if (driveBack.has(r.id)) continue;
    if (!r.expectedReturnOn || r.expectedReturnOn > input.today) continue;
    const late = daysBetween(r.expectedReturnOn, input.today);
    rows.push({
      id: `return:${r.id}`,
      group: 'returns',
      action: 'return',
      who: r.customer.name,
      number: r.number,
      vin: r.vin,
      days: late,
      amountTetri: null,
      href: `/rentals/${r.id}/return`,
      phone: r.customer.phone,
      note: null,
      ...wa(r),
    });
  }

  // 3. Overdue — longest first; the sum is what the weeks owe (B7-02). The
  // days are the product's one count, from the due day (ADR-0017).
  const overdue = open
    .filter((r) => r.status === 'overdue' && r.debtTetri > 0)
    .map((r) => ({ r, days: r.pickedUpOn ? overdueDays(r.paidThrough, r.pickedUpOn, input.today, r.payOffsetDays) : 0 }))
    .sort((a, b) => b.days - a.days || b.r.debtTetri - a.r.debtTetri);
  for (const { r, days } of overdue) {
    rows.push({
      id: `overdue:${r.id}`,
      group: 'overdue',
      action: input.owner ? 'take_money' : 'take_cash',
      who: r.customer.name,
      number: r.number,
      vin: r.vin,
      days,
      amountTetri: r.debtTetri,
      href: `/rentals/${r.id}`,
      phone: r.customer.phone,
      note: null,
      ...wa(r),
    });
  }

  // 4. Due today — the week began today and nothing older is unpaid: a calm
  // group with the same actions, so the morning call is not lost (ADR-0017).
  // By rental number: on the due day nobody is "longest".
  const byNumber = (a: QueueRental, b: QueueRental) => (a.number < b.number ? -1 : a.number > b.number ? 1 : 0);
  for (const r of open.filter((x) => x.status === 'due_today' && x.debtTetri > 0).sort(byNumber)) {
    rows.push({
      id: `due_today:${r.id}`,
      group: 'due_today',
      action: input.owner ? 'take_money' : 'take_cash',
      who: r.customer.name,
      number: r.number,
      vin: r.vin,
      days: null,
      amountTetri: r.debtTetri,
      dueTodayTetri: r.dueTodayTetri,
      href: `/rentals/${r.id}`,
      phone: r.customer.phone,
      // The one fact that sets a hand-over day apart: the screen says "handed over today".
      note: r.pickedUpOn === input.today ? 'handed_today' : null,
      ...wa(r),
    });
  }

  // 5. Money — an owner's: lines to sort, statements nobody has uploaded.
  if (input.owner) {
    if (input.unmatchedLines > 0) {
      rows.push({ id: 'sort', group: 'money', action: 'sort', who: null, number: null, vin: null, days: null, amountTetri: null, href: '/sort', phone: null, note: String(input.unmatchedLines) });
    }
    for (const b of input.staleBanks) {
      rows.push({ id: `bank:${b.bank}`, group: 'money', action: 'upload_statement', who: null, number: null, vin: null, days: b.days, amountTetri: null, href: '/money/statements', phone: null, note: b.bank });
    }
    for (const i of input.instalments) {
      rows.push({ id: `instalment:${i.id}`, group: 'instalments', action: 'take_instalment', who: i.who, number: i.number, vin: null, days: i.days, amountTetri: i.amountTetri, href: `/sales/${i.saleId}`, phone: i.phone, note: null });
    }
  }

  // 7. Service — a breakdown somebody reported comes first: it is the one
  // line here that nobody has looked at yet (wave 5 §3.10).
  if (input.owner) {
    for (const r of input.reports) {
      rows.push({
        id: `report:${r.id}`,
        group: 'service',
        action: 'open_report',
        who: r.who,
        number: r.number,
        vin: r.vin,
        days: null,
        amountTetri: null,
        href: `/service/${r.id}`,
        phone: null,
        note: r.note,
      });
    }
  }
  if (input.service.open > 0) {
    rows.push({
      id: 'service',
      group: 'service',
      action: 'open_service',
      who: null,
      number: null,
      vin: null,
      days: input.service.longestDays,
      amountTetri: null,
      href: '/service',
      phone: null,
      note: `${input.service.open}/${input.service.longerThanWeek}`,
    });
  }

  // 7a. Planned maintenance (ADR-0038): a row per moped, the overdue first —
  // the list comes sorted by what is left. The note carries the mark, the
  // mileage and what is left, for the screen to say in its own words.
  for (const m of input.maintenance ?? []) {
    rows.push({
      id: `maintenance:${m.vehicleId}`,
      group: 'maintenance',
      action: 'open_maintenance',
      who: m.model,
      number: m.number,
      vin: m.vin,
      days: null,
      amountTetri: null,
      href: `/fleet/${m.vehicleId}`,
      phone: null,
      note: `${m.dueKm}|${m.currentKm}|${m.leftKm}`,
    });
  }

  // Parts that have run low: one line, and the order it turns into (B8-05).
  if (input.owner && input.lowParts.count > 0) {
    // The note carries the count and then the worst offenders, so the screen
    // can say "5 parts below their level · Controller: −1 · Pads: 4 of 10".
    rows.push({
      id: 'low-parts',
      group: 'service',
      action: 'order_parts',
      who: null,
      number: null,
      vin: null,
      days: null,
      amountTetri: null,
      // The chip on the shelf is `short`; `low` matched nothing and the list
      // opened on «Все» with the part to find by eye (QA-W5-16).
      href: '/stock?f=short',
      phone: null,
      note: `${input.lowParts.count}|${input.lowParts.note}`,
    });
  }

  if (input.owner) {
    for (const p of input.purchases) {
      rows.push({ id: `purchase:${p.id}`, group: 'purchases', action: 'open_purchase', who: p.who, number: p.number, vin: null, days: null, amountTetri: null, href: `/purchases/${p.id}`, phone: null, note: p.note });
    }
    // 9. Fill in — mopeds nobody has put in a park yet (register #14); a
    // group of their own, «Решения», until issue #18 (B5).
    if (input.vehiclesWithoutPool > 0) {
      rows.push({ id: 'pool', group: 'fill', action: 'set_pool', who: null, number: null, vin: null, days: null, amountTetri: null, href: '/fleet?f=nopool', phone: null, note: String(input.vehiclesWithoutPool) });
    }
    // Rented here and not in Kommo: one row for all of it, like the deposits
    // above. The other half — rented there and not here — is the "intake"
    // group, a task each (ADR-0015). The note carries the count, whether
    // Kommo still answers, and the time of its last answer.
    const k = input.kommo;
    if (k && (k.rentedHere > 0 || k.silent)) {
      rows.push({
        id: 'kommo',
        group: 'fill',
        action: 'reconcile_kommo',
        who: null,
        number: null,
        vin: null,
        days: null,
        amountTetri: null,
        href: KOMMO_PATH,
        phone: null,
        note: `${k.rentedHere}|${k.silent ? 'silent' : 'ok'}|${k.lastOkAt ?? ''}`,
      });
    }
  }

  // What Kommo has won and nobody has entered: the hand-over or the sale,
  // started from the customer's card and carrying the deal's link.
  for (const d of input.kommoDeals) {
    const query = [d.customerId ? `customer=${d.customerId}` : null, `lead=${d.leadId}`].filter(Boolean).join('&');
    rows.push({
      id: `kommo-${d.kind}:${d.leadId}`,
      group: 'intake',
      action: d.kind === 'sale' ? 'sell_from_kommo' : 'hand_over_from_kommo',
      who: d.who,
      number: null,
      vin: null,
      days: null,
      amountTetri: null,
      href: `${d.kind === 'sale' ? '/sales/new' : '/rentals/new'}?${query}`,
      phone: d.phone,
      note: d.leadId,
    });
  }

  // A contract in Drive with no rental here (ADR-0034): the hand-over, filled in from it.
  if (input.owner) {
    for (const c of input.drive?.contracts ?? []) {
      const query = [`drive=${encodeURIComponent(c.folderId)}`, c.leadId ? `lead=${c.leadId}` : null, c.customerId ? `customer=${c.customerId}` : null].filter(Boolean).join('&');
      rows.push({
        id: `drive_contract:${c.folderId}`,
        group: 'intake',
        action: 'hand_over_from_drive',
        who: c.who,
        number: null,
        vin: null,
        days: null,
        amountTetri: null,
        href: `/rentals/new?${query}`,
        phone: c.phone ?? null,
        note: c.datedOn,
      });
    }
  }

  // 10. Fill in — an unsigned contract, a rental without a VIN, a moped without a point.
  for (const r of open.filter((x) => x.contractUnsigned)) {
    rows.push({ id: `sign:${r.id}`, group: 'fill', action: 'sign', who: r.customer.name, number: r.number, vin: r.vin, days: null, amountTetri: null, href: `/rentals/${r.id}`, phone: r.customer.phone, note: null, ...wa(r) });
  }
  for (const r of open.filter((x) => x.vinUnconfirmed)) {
    rows.push({ id: `vin:${r.id}`, group: 'fill', action: 'set_vin', who: r.customer.name, number: r.number, vin: null, days: null, amountTetri: null, href: `/rentals/${r.id}`, phone: r.customer.phone, note: null, ...wa(r) });
  }
  if (input.vehiclesWithoutPoint > 0) {
    rows.push({ id: 'point', group: 'fill', action: 'set_point', who: null, number: null, vin: null, days: null, amountTetri: null, href: '/fleet?f=nopoint', phone: null, note: String(input.vehiclesWithoutPoint) });
  }

  // A manager's own till: their own last group, "Касса", and only when there is
  // money in it. A manager has no "decide" — §3.1 and criterion 10 say so, and
  // the group's name has to be true of every row in it (QA-W4-11).
  if (!input.owner && input.myTillTetri > 0) {
    rows.push({ id: 'my-till', group: 'till', action: 'hand_over_till', who: null, number: null, vin: null, days: null, amountTetri: input.myTillTetri, href: '/money/cash', phone: null, note: null });
  }

  // A group's sum is many customers' money together — an owner's figure; a
  // manager's queue carries each row's own and no sum of them (ADR-0048,
  // addendum of 25.10.2026). The till is his own and is one row: no sum is lost.
  return TASK_GROUPS.map((group) => {
    const all = rows.filter((r) => r.group === group);
    const totalTetri = input.owner ? all.reduce((n, r) => n + (r.amountTetri ?? 0), 0) : null;
    return { group, rows: all.slice(0, group === 'intake' || group === 'maintenance' ? SHOWN_INTAKE : SHOWN), total: all.length, totalTetri };
  }).filter((g) => g.total > 0);
}

/** The badge: how many things are waiting, not how many kinds (U11). */
export function queueCount(groups: TaskGroupRows[]): number {
  return groups.reduce((n, g) => n + g.total, 0);
}

/**
 * The line under a group longer than the rows it shows: its number and its
 * sum say one set (QA of #15, 25.10.2026). With a sum — an owner's group with
 * money in it — every row of the group and their money together, the set the
 * list it opens adds up to: `all`, «Все 12 · …» (an invented example). Without
 * one — a manager's group, which carries none (ADR-0048, addendum of
 * 25.10.2026), or a group with no money — the rows left under the ones shown:
 * `left`, «Ещё 9». Null when the group shows all it has.
 */
export type QueueMore = { kind: 'all'; count: number; tetri: Tetri } | { kind: 'left'; count: number };

export function queueMore(g: TaskGroupRows): QueueMore | null {
  if (g.total <= g.rows.length) return null;
  if (g.totalTetri !== null && g.totalTetri > 0) return { kind: 'all', count: g.total, tetri: g.totalTetri };
  return { kind: 'left', count: g.total - g.rows.length };
}
