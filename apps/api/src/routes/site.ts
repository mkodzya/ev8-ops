import type { FastifyBaseLogger, FastifyInstance } from 'fastify';
import { currentFuelPrice } from '../lib/fuelPrice.js';
import { HitLimiter, countHit, parseHit, type Hit } from '../lib/siteCounter.js';
import {
  QueueLimiter,
  composeQueueMail,
  parseQueueRequest,
  siteMailConfig,
  smtpSend,
  type SendMail,
} from '../lib/siteQueue.js';

// The public site's door into EV8 Ops: no session, and nothing a person
// could be told apart by is stored. Two routes: a queue request goes to the
// mailbox, and the site's anonymous counter adds one to a tally per day
// (lib/siteCounter.ts, migration 0036). The site reaches them at /api on its
// own host, so there is no CORS here; on the preview that host is
// test.ops.ev8.ge, and on ev8.ge the edge sends /api/site/* to production.

let send: SendMail = smtpSend;
let limiter = new QueueLimiter();
let hits = new HitLimiter();

/** Tests swap the mailer and start each case with a fresh count. */
export function setSiteMailerForTests(fn: SendMail): void {
  send = fn;
  limiter = new QueueLimiter();
  hits = new HitLimiter();
}

/**
 * The counter must never be the reason a page or a request fails: a tally
 * that could not be written is logged and let go.
 */
async function tally(hit: Hit, log: FastifyBaseLogger): Promise<void> {
  try {
    await countHit(hit);
  } catch (err) {
    log.warn({ reason: (err as Error)?.message, metric: hit.metric }, 'site counter not written');
  }
}

export function siteRoutes(app: FastifyInstance): void {
  app.post('/api/site/queue', { config: { scope: 'public' }, bodyLimit: 16 * 1024 }, async (req, reply) => {
    const cfg = siteMailConfig();
    if (!cfg) return reply.code(503).send({ error: 'site_mail_off' });

    const parsed = parseQueueRequest(req.body);
    if (parsed.ok === 'bot') return reply.code(202).send({ ok: true });
    if (!parsed.ok) return reply.code(400).send({ error: 'bad_site_request', field: parsed.field });

    const r = parsed.request;
    if (!limiter.allow(r.phone)) return reply.code(429).send({ error: 'site_too_many' });

    try {
      await send(cfg, composeQueueMail(r, new Date()));
    } catch (err) {
      // The reason only — never the request, which carries a name and a phone.
      req.log.error({ reason: (err as Error)?.message }, 'site queue mail not sent');
      return reply.code(502).send({ error: 'site_mail_failed' });
    }
    // Counted here, after the mail went out: a request in the report is one
    // the mailbox received, whatever the browser thought it sent.
    await tally({ metric: 'request', key: r.lang }, req.log);
    return reply.code(202).send({ ok: true });
  });

  // The site's beacon: { e: 'visit' | 'view' | 'whatsapp' | 'answers', l, p?, a? }.
  // navigator.sendBeacon posts it as text/plain, so a string body is read as JSON too.
  app.post('/api/site/hit', { config: { scope: 'public' }, bodyLimit: 1024 }, async (req, reply) => {
    let body: unknown = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        body = null;
      }
    }
    const hit = parseHit(body);
    if (!hit) return reply.code(400).send({ error: 'bad_site_hit' });
    if (hits.allow()) await tally(hit, req.log);
    return reply.code(204).send();
  });

  // Today's petrol for the calculator's comparison, with the moment it was
  // read. None read yet: 503, and the site keeps the figure it was built with.
  app.get('/api/site/fuel', { config: { scope: 'public' } }, async (_req, reply) => {
    const price = await currentFuelPrice();
    if (!price) return reply.code(503).send({ error: 'fuel_price_unknown' });
    return reply.header('cache-control', 'public, max-age=3600').send(price);
  });
}
