import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import {
  SESSION_COOKIE,
  clearLoginFailures,
  createSession,
  destroySession,
  isSecureRequest,
  loginAllowed,
  permissionsOf,
  recordLoginFailure,
  spendVerifyTime,
  verifyPassword,
  type SignInKind,
} from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { demoLoginRefused, env } from '../lib/env.js';
import { actorOf } from '../lib/guard.js';
import { PIN_IDLE_MINUTES, type Role } from '@ev8/shared';

/**
 * Who is signed in, and what this session may do. A PIN session on the
 * workshop tablet says so: its permissions are the repair ones only, and the
 * screen signs out after the idle minutes given here (ADR-0033 §7).
 */
export function me(
  user: { id: string; name: string; email: string | null; role: string; locale: string },
  via: SignInKind = 'password',
) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    permissions: permissionsOf(user.role as Role, via),
    locale: user.locale,
    orgTz: env.TZ,
    via,
    idleMinutes: via === 'pin' ? PIN_IDLE_MINUTES : null,
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
      const ip = req.ip ?? null;
      if (!email || !password) return reply.code(400).send({ error: 'missing_credentials' });
      if (!(await loginAllowed(email))) return reply.code(429).send({ error: 'too_many_attempts' });
      // The demo dataset's logins share the laptop's default password. On a
      // stand on the server they must not open anything (B1-04).
      if (demoLoginRefused(email)) return reply.code(403).send({ error: 'demo_login_off' });
      const user = await prisma.user.findUnique({ where: { email } });
      // An address nobody has must cost the same as a wrong password, or the
      // difference in timing answers "does this person work here"
      // (`practices.md` §4).
      if (!user) spendVerifyTime(password);
      if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
        const attempt = await recordLoginFailure(email, ip);
        // The journal says who tried, from where, and which try it was —
        // never what they typed (§3.8, crit. 18).
        await audit({
          actorId: user?.id ?? null,
          action: 'auth.login.failed',
          entityType: 'login',
          entityId: user?.id ?? null,
          after: { email, ip, attempt },
        });
        return reply.code(401).send({ error: 'invalid_credentials' });
      }
      await clearLoginFailures(email);
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
      await audit({ actorId: user.id, action: 'auth.login', entityType: 'login', entityId: user.id, after: { email, ip } });
      return { me: me(user) };
    },
  );

  app.post('/api/auth/logout', { config: { scope: 'session' } }, async (req, reply) => {
    const token = req.cookies?.[SESSION_COOKIE];
    if (token) await destroySession(token);
    await audit({ actorId: actorOf(req).id, action: 'auth.logout', entityType: 'login', entityId: actorOf(req).id });
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecureRequest(req) });
    return { ok: true };
  });

  app.get('/api/me', { config: { scope: 'session' } }, async (req) => me(actorOf(req), actorOf(req).via));

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
