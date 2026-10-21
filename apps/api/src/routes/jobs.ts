import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { todayISO } from '@ev8/shared';
import { reconcileBogNight, syncBogToday } from '../lib/bog.js';
import { env } from '../lib/env.js';
import { scanDrive } from '../lib/driveScan.js';
import { syncKommo } from '../lib/kommo.js';
import { deliverNotices, scanNotices } from '../lib/notices.js';
import { rollPeriods } from '../lib/periods.js';
import { reconcileTbcNight, syncTbcToday } from '../lib/tbc.js';

// The worker is the clock; this is where it knocks.
//
// The nightly roll is a money rule — it opens a week and lets a customer's
// credit pay for it — and money rules have one home. Rather than a second
// copy of them in the worker, the worker calls in here with a shared token.
//
// The Kommo poll knocks here for a different reason: the Kommo token and the
// database both live in this process, and the worker has neither. So do the
// two jobs of each bank read by its API (B11-03), for the bank's keys, and
// the notices to the workshop's Telegram group (ADR-0032 §2), for the bot's.

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

  // Ask Bank of Georgia for the day's operations (every five minutes), and
  // read the full statement up to yesterday (once a night, and on every
  // start of the worker — it does nothing when the night is already read).
  // The outcome is counts, days and one of our own words for a failure: no
  // names, no account, nothing of the bank's answer. With no keys it says
  // `off` and does nothing.
  app.post('/api/jobs/bog-today', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await syncBogToday();
    if (outcome.status === 'failed') app.log.warn(outcome, 'bank of georgia did not answer');
    return outcome;
  });

  app.post('/api/jobs/bog-night', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await reconcileBogNight();
    if (outcome.status === 'failed') app.log.warn(outcome, 'bank of georgia statement did not come');
    return outcome;
  });

  // The rentals folders in Drive, read once a night (ADR-0031). Counts and our
  // own words for a failure; with no key it says `off` and does nothing.
  app.post('/api/jobs/drive-scan', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await scanDrive();
    if (outcome.status === 'failed') app.log.warn(outcome, 'drive did not answer');
    return outcome;
  });

  // TBC the same way (ADR-0026): the day's movements every five minutes, and
  // yesterday read whole and checked against the bank's sums once a night.
  app.post('/api/jobs/tbc-today', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await syncTbcToday();
    if (outcome.status === 'failed') app.log.warn(outcome, 'tbc did not answer');
    return outcome;
  });

  // The notices to the workshop's Telegram group (ADR-0038 §6–7): each goes
  // right after its event; what Telegram did not take is tried here, every
  // minute. The outcome is counts — the token is in the address Telegram is
  // asked at, and nothing of it, or of Telegram's answer, is in here. With no
  // token or group it says `off` and sends nothing.
  app.post('/api/jobs/notices', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await deliverNotices();
    if (outcome.failed > 0) app.log.warn(outcome, 'telegram did not take every notice');
    return outcome;
  });

  // Mopeds due for their maintenance and parts below the minimum are nobody's
  // event: they are found here, by day (the worker asks hourly from morning to
  // evening, Tbilisi time, so the group is not woken at night), each told once.
  app.post('/api/jobs/notices-scan', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const found = await scanNotices();
    const outcome = await deliverNotices();
    if (outcome.failed > 0) app.log.warn(outcome, 'telegram did not take every notice');
    return { ...outcome, maintenance: found.maintenance, stock: found.stock };
  });

  app.post('/api/jobs/tbc-night', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await reconcileTbcNight();
    if (outcome.status === 'failed') app.log.warn(outcome, 'tbc statement did not come');
    else if (outcome.status === 'ok' && outcome.mismatched.length > 0) app.log.warn({ mismatched: outcome.mismatched }, 'tbc movements do not add up to the statement');
    return outcome;
  });
}
