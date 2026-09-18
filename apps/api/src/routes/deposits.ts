import { depositState } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';

// Deposits (wave 2 §3.6): what we hold, what we decided to give back and have
// not yet, what was never paid in full. "Held" is what was received, less what
// was kept and what went back (Q16); what the contracts asked for is a quiet line.

const OPEN = ['booked', 'active', 'overdue', 'paused', 'disputed'];

export function depositRoutes(app: FastifyInstance): void {
  app.get('/api/deposits', { config: { scope: 'payments.view' } }, async () => {
    const deposits = await prisma.deposit.findMany({
      include: {
        rental: { select: { id: true, number: true, status: true, returnedOn: true, customer: { select: { id: true, name: true, nameKa: true, nameLat: true } } } },
        payouts: { where: { voidedAt: null }, select: { grossTetri: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    const rows = deposits.map((d) => {
      const paidOut = d.paidOutBeforeTetri + d.payouts.reduce((n, p) => n + p.grossTetri, 0);
      const st = depositState({ amountTetri: d.amountTetri, paidTetri: d.paidTetri, returnedTetri: d.returnedTetri, withheldTetri: d.withheldTetri, paidOutTetri: paidOut });
      const open = OPEN.includes(d.rental.status);
      const segment = st.toHandBackTetri > 0 ? 'to_hand_back' : open && st.shortTetri > 0 ? 'short' : st.heldTetri > 0 ? 'held' : 'closed';
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
      };
    });
    return {
      totals: {
        heldTetri: rows.reduce((n, r) => n + r.heldTetri, 0),
        contractTetri: rows.filter((r) => OPEN.includes(r.rentalStatus)).reduce((n, r) => n + r.amountTetri, 0),
        toHandBackTetri: rows.reduce((n, r) => n + r.toHandBackTetri, 0),
      },
      deposits: rows,
    };
  });
}
