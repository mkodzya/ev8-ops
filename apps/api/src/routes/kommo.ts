import type { FastifyInstance } from 'fastify';
import { kommoLeadUrl, kommoReconciliation } from '../lib/kommo.js';

// Where Kommo and EV8 Ops disagree about who rents (ADR-0012): the list
// behind the row in "Today". An owner's: it is the owner who decides which of
// the two is right. With the link off it says so and nothing more.

export function kommoRoutes(app: FastifyInstance): void {
  app.get('/api/kommo/reconciliation', { config: { scope: 'users.manage' } }, async () => {
    const r = await kommoReconciliation();
    if (!r) return { on: false };
    return {
      on: true,
      freshness: r.freshness,
      lastOkAt: r.lastOkAt,
      leads: r.leads,
      matched: r.matched,
      rentedThere: r.rentedThere.map((x) => ({ ...x, leadUrl: kommoLeadUrl(r.baseUrl, x.leadId) })),
      rentedHere: r.rentedHere.map((x) => ({ ...x, leadUrl: x.leadId ? kommoLeadUrl(r.baseUrl, x.leadId) : null })),
      wonThere: r.wonThere.map((x) => ({ ...x, leadUrl: kommoLeadUrl(r.baseUrl, x.leadId) })),
    };
  });
}
