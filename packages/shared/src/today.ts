// The queue of "Today" (wave 4 §3.1): what a person has to do now, in the
// order they should do it. One function, because three places read it — the
// screen, the badge on the bottom bar, and the "Today" group on a laptop. A
// badge that counts something the screen does not list is worse than none.
import type { ISODate } from './types.js';
import type { Tetri } from './money.js';

// "till" is a manager's last group (§3.1): their own cash, handed over at the
// end of the day. An owner has no such group — a till handed to them is a
// decision, and it stands in "decide".
export const TASK_GROUPS = ['decide', 'returns', 'overdue', 'awaiting', 'money', 'instalments', 'service', 'purchases', 'decisions', 'fill', 'till'] as const;
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
  | 'order_parts'
  | 'open_purchase'
  | 'set_pool'
  | 'sign'
  | 'set_vin'
  | 'set_point';

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
}

export interface QueueRental {
  id: string;
  number: string;
  customer: { id: string; name: string; phone: string | null };
  vin: string | null;
  pickedUpOn: ISODate | null;
  expectedReturnOn: ISODate | null;
  paidThrough: ISODate | null;
  status: string;
  debtTetri: Tetri;
  /** Nothing paid at all: waiting for the first payment, not overdue (Q7). */
  awaitingPayment: boolean;
  depositUndecided: boolean;
  vinUnconfirmed: boolean;
  /** Handed over more than a day ago and the contract is still unsigned (D17). */
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
  purchases: { id: string; number: string; who: string; note: string }[];
  vehiclesWithoutPool: number;
  vehiclesWithoutPoint: number;
}

export interface TaskGroupRows {
  group: TaskGroup;
  rows: TaskRow[];
  /** Everything in the group, not only the three the screen shows. */
  total: number;
  totalTetri: Tetri;
}

const SHOWN = 3;

const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * The whole queue, group by group, in the order the day is worked through.
 * A manager's queue is the same rules with the owners' groups left out
 * (wave 4 §3.1); a group with nothing in it does not appear at all.
 */
export function dayQueue(input: QueueInput): TaskGroupRows[] {
  const rows: TaskRow[] = [];
  const open = input.rentals.filter((r) => r.status !== 'returned');

  // 1. Decide — an owner's: a till handed over today, a deposit a manager's
  // return left. The till comes first: it is money on somebody's hands right
  // now, while deposits can wait a day, and a group shows three rows — with a
  // pile of old deposits the till would never be seen (QA-W4-12).
  if (input.owner) {
    for (const t of input.tills) {
      rows.push({ id: `till:${t.id}`, group: 'decide', action: 'accept_till', who: t.who, number: null, vin: null, days: null, amountTetri: t.amountTetri, href: '/money/cash', phone: null, note: null });
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
      });
    }
  }

  // 2. Returns — planned for today, or the planned day has passed.
  for (const r of open) {
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
    });
  }

  // 3. Overdue — longest first; the sum is what the weeks owe (B7-02).
  const overdue = open
    .filter((r) => r.status === 'overdue' && r.debtTetri > 0)
    .map((r) => ({ r, days: r.paidThrough ? daysBetween(r.paidThrough, input.today) : r.pickedUpOn ? daysBetween(r.pickedUpOn, input.today) : 0 }))
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
    });
  }

  // 4. Waiting for the first payment — handed over, nothing paid yet (Q7).
  for (const r of open.filter((x) => x.awaitingPayment)) {
    rows.push({
      id: `awaiting:${r.id}`,
      group: 'awaiting',
      action: input.owner ? 'take_money' : 'take_cash',
      who: r.customer.name,
      number: r.number,
      vin: r.vin,
      days: null,
      amountTetri: r.debtTetri,
      href: `/rentals/${r.id}`,
      phone: r.customer.phone,
      note: null,
    });
  }

  // 5. Money — an owner's: lines to sort, statements nobody has uploaded.
  if (input.owner) {
    if (input.unmatchedLines > 0) {
      rows.push({ id: 'sort', group: 'money', action: 'sort', who: null, number: null, vin: null, days: null, amountTetri: null, href: '/money/sort', phone: null, note: String(input.unmatchedLines) });
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

  // Parts that have run low: one line, and the order it turns into (B8-05).
  if (input.owner && input.lowParts.count > 0) {
    rows.push({ id: 'low-parts', group: 'service', action: 'order_parts', who: null, number: null, vin: null, days: null, amountTetri: null, href: '/service/stock?f=low', phone: null, note: input.lowParts.note });
  }

  if (input.owner) {
    for (const p of input.purchases) {
      rows.push({ id: `purchase:${p.id}`, group: 'purchases', action: 'open_purchase', who: p.who, number: p.number, vin: null, days: null, amountTetri: null, href: `/purchases/${p.id}`, phone: null, note: p.note });
    }
    // 9. Decisions — mopeds nobody has put in a park yet (register #14).
    if (input.vehiclesWithoutPool > 0) {
      rows.push({ id: 'pool', group: 'decisions', action: 'set_pool', who: null, number: null, vin: null, days: null, amountTetri: null, href: '/fleet?f=nopool', phone: null, note: String(input.vehiclesWithoutPool) });
    }
  }

  // 10. Fill in — an unsigned contract, a rental without a VIN, a moped without a point.
  for (const r of open.filter((x) => x.contractUnsigned)) {
    rows.push({ id: `sign:${r.id}`, group: 'fill', action: 'sign', who: r.customer.name, number: r.number, vin: r.vin, days: null, amountTetri: null, href: `/rentals/${r.id}`, phone: r.customer.phone, note: null });
  }
  for (const r of open.filter((x) => x.vinUnconfirmed)) {
    rows.push({ id: `vin:${r.id}`, group: 'fill', action: 'set_vin', who: r.customer.name, number: r.number, vin: null, days: null, amountTetri: null, href: `/rentals/${r.id}`, phone: r.customer.phone, note: null });
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

  return TASK_GROUPS.map((group) => {
    const all = rows.filter((r) => r.group === group);
    return { group, rows: all.slice(0, SHOWN), total: all.length, totalTetri: all.reduce((n, r) => n + (r.amountTetri ?? 0), 0) };
  }).filter((g) => g.total > 0);
}

/** The badge: how many things are waiting, not how many kinds (U11). */
export function queueCount(groups: TaskGroupRows[]): number {
  return groups.reduce((n, g) => n + g.total, 0);
}
