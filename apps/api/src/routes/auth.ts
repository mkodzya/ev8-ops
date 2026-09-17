import type { FastifyInstance } from 'fastify';
import {
  SESSION_COOKIE,
  clearLoginFailures,
  createSession,
  destroySession,
  loginAllowed,
  permissionsOf,
  recordLoginFailure,
  verifyPassword,
} from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { demoLoginRefused, env } from '../lib/env.js';
import { actorOf } from '../lib/guard.js';
import type { Role } from '@ev8/shared';

/**
 * Is this request on a connection a Secure cookie can survive? Behind a
 * TLS-terminating proxy the hop we see is plain http, so x-forwarded-proto is
 * asked first. Plain http://localhost is left alone on purpose: browsers
 * refuse to store a Secure cookie there.
 */
function isSecureRequest(req: { protocol?: string; headers: Record<string, unknown> }): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  const forwarded = req.headers['x-forwarded-proto'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === 'string' && first.split(',')[0].trim() === 'https') return true;
  return req.protocol === 'https';
}

function me(user: { id: string; name: string; email: string; role: string; locale: string }) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    permissions: permissionsOf(user.role as Role),
    locale: user.locale,
    orgTz: env.TZ,
  };
}

export function authRoutes(app: FastifyInstance): void {
  app.get('/api/health', { config: { scope: 'public' } }, async () => ({ ok: true, service: 'ev8-ops-api' }));

  app.post<{ Body: { email?: string; password?: string } }>(
    '/api/auth/login',
    { config: { scope: 'public' } },
    async (req, reply) => {
      const email = (req.body?.email ?? '').trim().toLowerCase();
      const password = req.body?.password ?? '';
      if (!email || !password) return reply.code(400).send({ error: 'missing_credentials' });
      if (!loginAllowed(email)) return reply.code(429).send({ error: 'too_many_attempts' });
      // The demo dataset's logins share the laptop's default password. On a
      // stand on the server they must not open anything (B1-04).
      if (demoLoginRefused(email)) return reply.code(403).send({ error: 'demo_login_off' });
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
        recordLoginFailure(email);
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      clearLoginFailures(email);
      // A phone that signed out without a connection forgot its session but
      // could not tell the server (QA-1-01). Whatever session this device still
      // carries ends here, before the new one replaces its cookie.
      const previous = req.cookies?.[SESSION_COOKIE];
      if (previous) await destroySession(previous);
      const { token, expiresAt } = await createSession(user.id);
      reply.setCookie(SESSION_COOKIE, token, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: isSecureRequest(req),
        expires: expiresAt,
      });
      return { me: me(user) };
    },
  );

  app.post('/api/auth/logout', { config: { scope: 'session' } }, async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecureRequest(req) });
    return { ok: true };
  });

  app.get('/api/me', { config: { scope: 'session' } }, async (req) => me(actorOf(req)));

  // The interface language is a per-person preference; stored so a phone
  // and a laptop agree, and so a new device does not start in the wrong one.
  app.patch<{ Body: { locale?: string } }>('/api/me/locale', { config: { scope: 'session' } }, async (req, reply) => {
    const locale = req.body?.locale;
    if (locale !== 'ka' && locale !== 'ru' && locale !== 'en') return reply.code(400).send({ error: 'bad_locale' });
    const actor = actorOf(req);
    await prisma.user.update({ where: { id: actor.id }, data: { locale } });
    return { ok: true, locale };
  });
}
