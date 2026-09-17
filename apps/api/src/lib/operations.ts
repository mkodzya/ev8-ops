import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from './db.js';

/**
 * Operation keys (build plan Р5, spec B2-01).
 *
 * A form takes a key when it opens and sends it as `Idempotency-Key` with
 * every attempt to save. The first attempt claims the key before the handler
 * runs; a successful answer is kept, and a repeat of the same request gets
 * that answer back without running the handler again. That is what makes a
 * double tap, or a retry after the phone lost the connection on the way back,
 * write one rental and not two.
 *
 * - Only a 2xx answer is kept. A refusal (4xx) or a fault (5xx) releases the
 *   key, so the person can fix the form and try again with it.
 * - A second request while the first is still running gets 409
 *   `operation_in_progress`; the form is still showing "saving".
 * - A claim nobody finished in two minutes (the process died mid-write) is
 *   stale and may be claimed again.
 * - The same key on a different route is a bug in a form, not a retry: 409.
 * - Requests without the header behave exactly as before.
 */

const HEADER = 'idempotency-key';
const WRITES = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
const KEY = /^[A-Za-z0-9_-]{8,128}$/;
const STALE_MS = 2 * 60_000;

declare module 'fastify' {
  interface FastifyRequest {
    operationKey: string | null;
  }
}

async function claim(userId: string, key: string, route: string): Promise<boolean> {
  const inserted = await prisma.$executeRaw`
    INSERT INTO operation_keys (user_id, key, route) VALUES (${userId}::uuid, ${key}, ${route})
    ON CONFLICT DO NOTHING`;
  return inserted === 1;
}

export function installOperationKeys(app: FastifyInstance): void {
  app.decorateRequest('operationKey', null);

  // After the guard's onRequest: the actor is known, and a refused request
  // never claims a key.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (!WRITES.has(req.method) || !req.actor) return;
    const raw = req.headers[HEADER];
    if (raw === undefined) return;
    const key = Array.isArray(raw) ? raw[0] : raw;
    if (!key || !KEY.test(key)) return reply.code(400).send({ error: 'bad_operation_key' });
    const userId = req.actor.id;
    const route = `${req.method} ${req.url}`;

    if (await claim(userId, key, route)) {
      req.operationKey = key;
      // A week of keys is plenty; older ones are swept on the way, unawaited.
      void prisma.operationKey.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 24 * 3600_000) } } }).catch(() => {});
      return;
    }

    const row = await prisma.operationKey.findUnique({ where: { userId_key: { userId, key } } });
    if (!row) {
      // Released between our insert and our read: the first attempt failed
      // and let go. This one may have it.
      if (await claim(userId, key, route)) {
        req.operationKey = key;
        return;
      }
      return reply.code(409).send({ error: 'operation_in_progress' });
    }
    if (row.route !== route) return reply.code(409).send({ error: 'operation_key_reused' });
    if (row.statusCode != null) {
      return reply.code(row.statusCode).header('idempotent-replay', 'true').type('application/json; charset=utf-8').send(row.body ?? '{}');
    }
    if (Date.now() - row.createdAt.getTime() > STALE_MS) {
      await prisma.operationKey.deleteMany({ where: { userId, key, statusCode: null } });
      if (await claim(userId, key, route)) {
        req.operationKey = key;
        return;
      }
    }
    return reply.code(409).send({ error: 'operation_in_progress' });
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const key = req.operationKey;
    if (!key || !req.actor) return payload;
    const userId = req.actor.id;
    if (reply.statusCode >= 200 && reply.statusCode < 300 && (typeof payload === 'string' || payload == null)) {
      await prisma.operationKey.update({
        where: { userId_key: { userId, key } },
        data: { statusCode: reply.statusCode, body: typeof payload === 'string' ? payload : null },
      });
    } else {
      await prisma.operationKey.deleteMany({ where: { userId, key, statusCode: null } });
    }
    return payload;
  });
}
