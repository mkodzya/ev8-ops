import { todayISO } from '@ev8/shared';
import { prisma } from './db.js';
import { debtsOf } from './debt.js';
import { env } from './env.js';
import { rentStateOf } from './rentState.js';

// Which rentals are behind, and by how much (M-02, M-03). One scan, read by
// "Today" and by the week's report.
//
// It lives here because the book counts arrears **by rental**, not by unpaid
// week: on the stand the weeks add up to 149 rows and 20 789,89 ₾ while the
// rentals add up to 26 and 20 549,62 ₾, and the second pair is the answer
// Kardu and Mika read out. Two screens quoting two different figures for one
// question is a defect, not a rounding — so there is one function, and both
// ask it (wave 6 §3.1, crit. 1в).

export interface OverdueRental {
  id: string;
  number: string;
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null; phone: string | null };
  days: number;
  debtTetri: number;
}

export interface RentalsNow {
  /** The week began today, the hand-over day included: a task, not a debt (ADR-0017). */
  dueToday: { id: string; number: string; customer: string }[];
  /** Behind on the rent — late from the day after the due day — deepest first. */
  overdue: OverdueRental[];
  /** Running and not behind, the due-today ones included. */
  active: number;
  withoutVin: number;
}

export async function rentalsNow(): Promise<RentalsNow> {
  const today = todayISO(new Date(), env.TZ);
  const rentals = await prisma.rental.findMany({
    where: { status: { in: ['active', 'overdue'] } },
    select: {
      id: true,
      number: true,
      status: true,
      pickedUpOn: true,
      paidThrough: true,
      payWeekday: true,
      weekShiftDays: true,
      vinUnconfirmed: true,
      customer: { select: { id: true, name: true, nameKa: true, nameLat: true, phone: true } },
    },
  });

  const out: RentalsNow = { dueToday: [], overdue: [], active: 0, withoutVin: 0 };
  for (const r of rentals) {
    // The same answer the list, the card and "Today" give (ADR-0017).
    const { status, overdueDays: days } = rentStateOf(r, today);
    if (status === 'due_today') {
      out.dueToday.push({ id: r.id, number: r.number, customer: r.customer.name });
      out.active++;
    } else if (status === 'overdue') {
      out.overdue.push({
        id: r.id,
        number: r.number,
        customer: r.customer,
        days,
        debtTetri: 0,
      });
    } else out.active++;
    if (r.vinUnconfirmed) out.withoutVin++;
  }

  // The same figure as everywhere else (B7-02), not a second sum over the weeks.
  const debts = await debtsOf(out.overdue.map((o) => o.customer.id), today);
  for (const o of out.overdue) {
    o.debtTetri = (debts.get(o.customer.id)?.parts ?? []).filter((p) => p.id === o.id).reduce((n, p) => n + p.owesTetri, 0);
  }
  out.overdue.sort((a, b) => b.days - a.days || b.debtTetri - a.debtTetri);
  return out;
}

/** Arrears as one pair of figures: how many rentals, and how much (crit. 1в). */
export async function overdueTotals(): Promise<{ rentals: number; tetri: number }> {
  const { overdue } = await rentalsNow();
  return { rentals: overdue.length, tetri: overdue.reduce((n, o) => n + o.debtTetri, 0) };
}
