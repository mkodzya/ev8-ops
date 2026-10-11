import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { todayISO } from '@ev8/shared';
import { env } from '../lib/env.js';
import { refreshFuelPrice } from '../lib/fuelPrice.js';
import { syncKommo } from '../lib/kommo.js';
import { rollPeriods } from '../lib/periods.js';

// The worker is the clock; this is where it knocks.
//
// The nightly roll is a money rule — it opens a week and lets a customer's
// credit pay for it — and money rules have one home. Rather than a second
// copy of them in the worker, the worker calls in here with a shared token.
//
// The Kommo poll knocks here for a different reason: the Kommo token and the
// database both live in this process, and the worker has neither.

function workerOnly(req: FastifyRequest, reply: FastifyReply): boolean {
  const given = req.headers['x-worker-token'];
  if (typeof given === 'string' && given === env.WORKER_TOKEN) return true;
  void reply.code(401).send({ error: 'bad_worker_token' });
  return false;
}

export function jobRoutes(app: FastifyInstance): void {
  app.post<{ Body: { asOf?: string } }>('/api/jobs/roll-periods', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const asOf = typeof req.body?.asOf === 'string' ? req.body.asOf : todayISO(new Date(), env.TZ);
    const result = await rollPeriods(asOf);
    app.log.info({ ...result, asOf }, 'periods rolled');
    return result;
  });

  // Ask Kommo who is renting and keep the answer (ADR-0012). The outcome is
  // counts and one of our own words for a failure — no names, nothing of
  // Kommo's answer — so it is safe in the worker's log and in a terminal.
  // With no token it says `off` and does nothing.
  app.post('/api/jobs/kommo-sync', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await syncKommo();
    if (outcome.status === 'failed') app.log.warn(outcome, 'kommo did not answer');
    return outcome;
  });

  // The price of petrol for ev8.ge's calculator, once a day (lib/fuelPrice.ts).
  // A failed reading keeps yesterday's price and says why in the log.
  app.post('/api/jobs/fuel-price', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await refreshFuelPrice();
    if (outcome.status === 'failed') app.log.warn(outcome, 'fuel price not read');
    return outcome;
  });
}
