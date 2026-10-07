import type { FastifyInstance } from 'fastify';
import {
  QueueLimiter,
  composeQueueMail,
  parseQueueRequest,
  siteMailConfig,
  smtpSend,
  type SendMail,
} from '../lib/siteQueue.js';

// The public site's door into EV8 Ops: one route, no session, no database.
// The site reaches it at /api on its own host, so there is no CORS here; on
// the preview that host is test.ops.ev8.ge, and the production site needs the
// edge to send its /api/site/* to the production stack.

let send: SendMail = smtpSend;
let limiter = new QueueLimiter();

/** Tests swap the mailer and start each case with a fresh count. */
export function setSiteMailerForTests(fn: SendMail): void {
  send = fn;
  limiter = new QueueLimiter();
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
    return reply.code(202).send({ ok: true });
  });
}
