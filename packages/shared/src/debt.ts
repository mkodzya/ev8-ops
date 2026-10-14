// What a customer owes — one function, one figure on every screen (B7-02,
// wave 2 §3.7). "Today", the rental, the sale, the customer, the search and
// the money form all ask this, so the same customer never owes two amounts.
//
// Owes = rent that is due and unpaid + sale instalments that are due and
//        unpaid + deposit not yet paid in full + repairs charged to the
//        customer and not yet paid.
// Future instalments are not owed yet: they are shown as "ahead" (Q21).
// A deposit we hold is not a debt, and is shown on its own (money.md).
// A sale bought back owes nothing (M8).
// Money paid that nothing has taken yet is the customer's credit, and it
// comes off what is owed before anything is shown.
import { weekDueOn } from './periods.js';
import type { ISODate } from './types.js';
import type { Tetri } from './money.js';

export interface DebtRental {
  id: string;
  number: string;
  /** booked, active, overdue, paused, disputed — a returned or cancelled one owes only its unpaid weeks. */
  open: boolean;
  periods: { startsOn: ISODate; amountTetri: Tetri; paidTetri: Tetri }[];
  /** Days after a week's first day its rent is due: the rental's pay day (ADR-0020). 0 when absent. */
  payOffsetDays?: number;
  deposit: { amountTetri: Tetri; paidTetri: Tetri } | null;
  /** What a return charged beyond the weeks: a key, days of delay, what was kept (wave 3). */
  charges?: { amountTetri: Tetri; paidTetri: Tetri }[];
}

export interface DebtSale {
  id: string;
  number: string;
  status: 'active' | 'cancelled' | 'bought_back';
  instalments: { dueOn: ISODate; amountTetri: Tetri; paidTetri: Tetri }[];
}

export interface DebtRepair {
  id: string;
  number: string;
  /** What the repair came to, less what was kept from the deposit for it. */
  chargedTetri: Tetri;
  paidTetri: Tetri;
}

export interface DebtInput {
  today: ISODate;
  rentals: DebtRental[];
  sales: DebtSale[];
  repairs: DebtRepair[];
  /** Paid in and not yet taken by any week, instalment or repair. */
  unplacedTetri: Tetri;
  /** Deposits we hold for this customer: received − kept − handed back. */
  depositHeldTetri: Tetri;
}

export interface DebtPart {
  kind: 'rent' | 'deposit' | 'charge' | 'sale' | 'service';
  id: string;
  number: string;
  owesTetri: Tetri;
}

export interface Debt {
  /** The one figure: what is owed now, after the customer's own credit. */
  owesTetri: Tetri;
  /** What it is made of, by record. Sums to the gross before credit. */
  parts: DebtPart[];
  /** Instalments not due yet. */
  aheadTetri: Tetri;
  /** Paid beyond what is owed: waits for the next week. */
  creditTetri: Tetri;
  depositHeldTetri: Tetri;
}

const open = (amount: Tetri, paid: Tetri) => Math.max(0, amount - paid);

export function customerDebt(input: DebtInput): Debt {
  const parts: DebtPart[] = [];
  let ahead = 0;

  for (const r of input.rentals) {
    // A week is paid at its start: the week that began today is already due —
    // or on the rental's pay day within the week, from that morning (ADR-0020).
    const rent = r.periods.filter((p) => weekDueOn(p.startsOn, r.payOffsetDays) <= input.today).reduce((n, p) => n + open(p.amountTetri, p.paidTetri), 0);
    if (rent > 0) parts.push({ kind: 'rent', id: r.id, number: r.number, owesTetri: rent });
    // An unpaid deposit is owed while the rental runs; after the return the
    // deposit decision settles it.
    if (r.open && r.deposit) {
      const short = open(r.deposit.amountTetri, r.deposit.paidTetri);
      if (short > 0) parts.push({ kind: 'deposit', id: r.id, number: r.number, owesTetri: short });
    }
    const charged = (r.charges ?? []).reduce((n, c) => n + open(c.amountTetri, c.paidTetri), 0);
    if (charged > 0) parts.push({ kind: 'charge', id: r.id, number: r.number, owesTetri: charged });
  }

  for (const s of input.sales) {
    if (s.status !== 'active') continue;
    let due = 0;
    for (const i of s.instalments) {
      const left = open(i.amountTetri, i.paidTetri);
      if (i.dueOn <= input.today) due += left;
      else ahead += left;
    }
    if (due > 0) parts.push({ kind: 'sale', id: s.id, number: s.number, owesTetri: due });
  }

  for (const j of input.repairs) {
    const left = open(j.chargedTetri, j.paidTetri);
    if (left > 0) parts.push({ kind: 'service', id: j.id, number: j.number, owesTetri: left });
  }

  const gross = parts.reduce((n, p) => n + p.owesTetri, 0);
  return {
    owesTetri: Math.max(0, gross - input.unplacedTetri),
    parts,
    aheadTetri: ahead,
    creditTetri: Math.max(0, input.unplacedTetri - gross),
    depositHeldTetri: input.depositHeldTetri,
  };
}

/** A deposit as the money says: in, kept, handed back — and what is still to hand back. */
export function depositState(d: {
  amountTetri: Tetri;
  paidTetri: Tetri;
  returnedTetri: Tetri;
  withheldTetri: Tetri;
  paidOutTetri: Tetri;
  /**
   * Said about a deposit Odoo brought over (wave 6 §3.7): handed back before
   * the transfer, kept before it, or nobody knows. Any of the three closes
   * it — the company is not holding this money today — and none of them
   * moves a figure, because no money moves today either. What happened is
   * recorded in words, in the journal, not invented as an amount.
   */
  migrationDecision?: string | null;
}): { heldTetri: Tetri; toHandBackTetri: Tetri; shortTetri: Tetri } {
  if (d.migrationDecision) return { heldTetri: 0, toHandBackTetri: 0, shortTetri: 0 };
  return {
    heldTetri: Math.max(0, d.paidTetri - d.withheldTetri - d.paidOutTetri),
    toHandBackTetri: Math.max(0, d.returnedTetri - d.paidOutTetri),
    shortTetri: open(d.amountTetri, d.paidTetri),
  };
}
