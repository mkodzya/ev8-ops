import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { todayISO } from '@ev8/shared';
import { probeBogPair, reconcileBogNight, syncBogToday } from '../lib/bog.js';
import { env } from '../lib/env.js';
import { scanDrive } from '../lib/driveScan.js';
import { syncKommo } from '../lib/kommo.js';
import { deliverNotices, scanNotices } from '../lib/notices.js';
import { rollPeriods } from '../lib/periods.js';
import { last4, pairAsked } from '../lib/statements/apiDays.js';
import { probeTbcPair, reconcileTbcNight, syncTbcToday } from '../lib/tbc.js';
import { runTranslations } from '../lib/translations.js';

// The worker is the clock; this is where it knocks.
//
// The nightly roll is a money rule — it opens a week and lets a customer's
// credit pay for it — and money rules have one home. Rather than a second
// copy of them in the worker, the worker calls in here with a shared token.
//
// The Kommo poll knocks here for a different reason: the Kommo token and the
// database both live in this process, and the worker has neither. So do the
// two jobs of each bank read by its API (B11-03), and the question about an
// account a keys script asks before it writes one, for the bank's keys, the
// notices to the workshop's Telegram group (ADR-0032 §2), for the bot's, and
// the translation of typed texts (ADR-0042), for the translator's key.

/** The pairs of account and currency the bank refused while others answered: each by its last four digits and currency only. */
const refusedOf = (o: { status: string; accounts?: { failure: string | null }[] }) => (o.status === 'ok' ? (o.accounts ?? []).filter((a) => a.failure) : []);

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
    else if (refusedOf(outcome).length > 0) app.log.warn({ accounts: refusedOf(outcome) }, 'bank of georgia did not answer about every account');
    return outcome;
  });

  app.post('/api/jobs/bog-night', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await reconcileBogNight();
    if (outcome.status === 'failed') app.log.warn(outcome, 'bank of georgia statement did not come');
    else if (refusedOf(outcome).length > 0) app.log.warn({ accounts: refusedOf(outcome) }, 'bank of georgia statement did not come for every account');
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
    else if (refusedOf(outcome).length > 0) app.log.warn({ accounts: refusedOf(outcome) }, 'tbc did not answer about every account');
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

  // Typed texts about mopeds and repairs, in the reader's language (ADR-0042):
  // every minute the texts written since are listed, and what waits is put to
  // the translator, within the day's cap. The outcome is counts and tokens —
  // no text, nothing of the service's answer, never the key. With no key it
  // says `off`, lists the texts and sends nothing.
  app.post('/api/jobs/translate', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await runTranslations();
    if (outcome.failed > 0) app.log.warn(outcome, 'the translator did not translate every text');
    return outcome;
  });

  // Before a pair of account and currency goes into a stand's env file, the
  // keys script asks the bank about it through here (`deploy/set-bog-keys.sh`
  // and `set-tbc-keys.sh`, `--add-account`), so that the keys never leave this
  // process. The answer is one of our words and a status code — `ok`, the
  // bank's refusal, `no_currency` when it knows the account in lari only — and
  // nothing of the bank's answer; nothing is written. `off` without the bank's
  // keys; `bad_account` for what is not an account of that bank in GEL, USD or EUR.
  app.post<{ Body: { bank?: unknown; account?: unknown; currency?: unknown } }>('/api/jobs/bank-probe', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const asked = req.body ?? {};
    const bank = asked.bank === 'bog' || asked.bank === 'tbc' ? asked.bank : null;
    const pair = bank ? pairAsked(asked.account, asked.currency, bank === 'tbc' ? 'TB' : undefined) : null;
    if (!bank || !pair) return { code: 'bad_account', httpStatus: null };
    const outcome = (bank === 'bog' ? await probeBogPair(pair) : await probeTbcPair(pair)) ?? { code: 'off', httpStatus: null };
    app.log.info({ bank, last4: last4(pair.iban), currency: pair.currency, ...outcome }, 'the bank was asked about an account');
    return outcome;
  });

  app.post('/api/jobs/tbc-night', { config: { scope: 'public' } }, async (req, reply) => {
    if (!workerOnly(req, reply)) return reply;
    const outcome = await reconcileTbcNight();
    if (outcome.status === 'failed') app.log.warn(outcome, 'tbc statement did not come');
    else if (refusedOf(outcome).length > 0) app.log.warn({ accounts: refusedOf(outcome) }, 'tbc statement did not come for every account');
    if (outcome.status === 'ok' && outcome.mismatched.length > 0) app.log.warn({ mismatched: outcome.mismatched }, 'tbc movements do not add up to the statement');
    return outcome;
  });
}
