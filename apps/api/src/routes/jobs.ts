import type { FastifyInstance } from 'fastify';
import { todayISO } from '@ev8/shared';
import { env } from '../lib/env.js';
import { rollPeriods } from '../lib/periods.js';

// The worker is the clock; this is where it knocks.
//
// The nightly roll is a money rule — it opens a week and lets a customer's
// credit pay for it — and money rules have one home. Rather than a second
// copy of them in the worker, the worker calls in here with a shared token.

export function jobRoutes(app: FastifyInstance): void {
  app.post<{ Body: { asOf?: string } }>('/api/jobs/roll-periods', { config: { scope: 'public' } }, async (req, reply) => {
    const given = req.headers['x-worker-token'];
    if (typeof given !== 'string' || given !== env.WORKER_TOKEN) {
      return reply.code(401).send({ error: 'bad_worker_token' });
    }
    const asOf = typeof req.body?.asOf === 'string' ? req.body.asOf : todayISO(new Date(), env.TZ);
    const result = await rollPeriods(asOf);
    app.log.info({ ...result, asOf }, 'periods rolled');
    return result;
  });
}
