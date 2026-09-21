import { depositState } from '@ev8/shared';
import { isoDate } from './dates.js';
import { prisma } from './db.js';

// Deposits (wave 2 §3.6): what we hold, what we decided to give back and have
// not yet, what was never paid in full. "Held" is what was received, less what
// was kept and what went back (Q16); what the contracts asked for is a quiet line.

const OPEN = ['booked', 'active', 'overdue', 'paused', 'disputed'];

/**
 * Every deposit, as the money says (wave 2 §3.6, Q16). "Held" is what was
 * received, less what was kept and what was handed back — not what the
 * contracts asked for, which stands beside it as `contractTetri`.
 *
 * The week's report reads this same function for its "залоги на руках" line,
 * so the figure on "Деньги → Залоги" and the figure in the week are one
 * figure. (`docs/metrics.md` M-04 still describes the older rule — the sum
 * of the deposit *charged* on open rentals. The code has followed the wave-2
 * rule since 18.09; the text is what is out of date.)
 */
export async function depositsOverview() {
    const deposits = await prisma.deposit.findMany({
      include: {
        rental: { select: { id: true, number: true, status: true, returnedOn: true, customer: { select: { id: true, name: true, nameKa: true, nameLat: true } } } },
        payouts: { where: { voidedAt: null }, select: { grossTetri: true } },
        withholdings: { where: { voidedAt: null }, orderBy: { createdAt: 'asc' }, include: { serviceJob: { select: { number: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const rows = deposits.map((d) => {
      const paidOut = d.paidOutBeforeTetri + d.payouts.reduce((n, p) => n + p.grossTetri, 0);
      const st = depositState({ amountTetri: d.amountTetri, paidTetri: d.paidTetri, returnedTetri: d.returnedTetri, withheldTetri: d.withheldTetri, paidOutTetri: paidOut });
      const open = OPEN.includes(d.rental.status);
      // Back with the moped, and nobody has said what happens to the deposit (wave 3 §3.5).
      const undecided = d.rental.status === 'returned' && d.status === 'held' && !d.decidedById && st.heldTetri > 0;
      const segment = undecided ? 'undecided' : st.toHandBackTetri > 0 ? 'to_hand_back' : open && st.shortTetri > 0 ? 'short' : st.heldTetri > 0 ? 'held' : 'closed';
      return {
        rentalId: d.rental.id,
        number: d.rental.number,
        rentalStatus: d.rental.status,
        customer: d.rental.customer,
        returnedOn: isoDate(d.rental.returnedOn),
        status: d.status,
        amountTetri: d.amountTetri,
        paidTetri: d.paidTetri,
        withheldTetri: d.withheldTetri,
        returnedTetri: d.returnedTetri,
        returnedTo: d.returnedTo,
        paidOutTetri: paidOut,
        ...st,
        segment,
        // What was kept, line by line: a repair's and a return's (B5-04).
        withholdings: d.withholdings.map((w) => ({ source: w.source, amountTetri: w.amountTetri, number: w.serviceJob?.number ?? d.rental.number, reason: w.reason, grounds: w.grounds })),
        // Still being decided: the rental runs, or it came back and nobody has said what happens to the deposit.
        live: open || d.status === 'held',
      };
    });
    // Both totals over one set of rentals (designer's answer 2 to wave 2 round 1),
    // so "held" and "asked for" can stand side by side.
    const live = rows.filter((r) => r.live);
    return {
      totals: {
        heldTetri: live.reduce((n, r) => n + r.heldTetri, 0),
        contractTetri: live.reduce((n, r) => n + r.amountTetri, 0),
        toHandBackTetri: rows.reduce((n, r) => n + r.toHandBackTetri, 0),
        rentals: live.length,
      },
      deposits: rows,
    };
}
