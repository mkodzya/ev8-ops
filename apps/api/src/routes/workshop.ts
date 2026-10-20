import { PIN_MAX_FAILURES, PIN_ROLES, type Role } from '@ev8/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { audit } from '../lib/audit.js';
import { SESSION_COOKIE, createSession, destroySession, isSecureRequest, spendVerifyTime } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { str } from '../lib/validate.js';
import {
  DEVICE_COOKIE,
  DEVICE_COOKIE_MAX_AGE_S,
  deviceIdOf,
  isPinShaped,
  lockedUntil,
  readDevice,
  recordPinFailure,
  registerDevice,
  verifyPin,
} from '../lib/workshop.js';
import { me } from './auth.js';

// The workshop tablet (ADR-0033 §5–7). An owner registers the tablet from the
// tablet itself; from then on it shows the mechanics' names, and a name and a
// PIN open a session that reaches the repairs and ends after ten idle
// minutes. Anywhere else everybody signs in with an address and a password.

type Body = Record<string, unknown>;

const deviceOf = (req: FastifyRequest) => readDevice(req.cookies?.[DEVICE_COOKIE]);

function setDeviceCookie(req: FastifyRequest, reply: FastifyReply, token: string) {
  reply.setCookie(DEVICE_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecureRequest(req), maxAge: DEVICE_COOKIE_MAX_AGE_S });
}

export function workshopRoutes(app: FastifyInstance): void {
  /**
   * What the sign-in screen shows on this device: nothing on an ordinary
   * browser; on the workshop tablet its name and the people who may sign in
   * on it with a PIN. Names and roles only — the tablet is not signed in.
   */
  app.get('/api/workshop/tablet', { config: { scope: 'public' } }, async (req) => {
    const device = await deviceOf(req);
    if (!device) return { device: null, people: [] };
    const people = await prisma.user.findMany({
      where: { active: true, role: { in: [...PIN_ROLES] }, pinHash: { not: null } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, role: true, pinLockedUntil: true },
    });
    return {
      device: { name: device.name },
      people: people.map((p) => ({ id: p.id, name: p.name, role: p.role as Role, lockedUntil: lockedUntil(p)?.toISOString() ?? null })),
    };
  });

  /**
   * A name and a PIN, on the registered tablet only. Five wrong PINs close
   * that person's PIN sign-in for fifteen minutes (ADR-0033 §6); the journal
   * says who tried and on which tablet, never what was typed.
   */
  app.post<{ Body: Body }>('/api/auth/pin', { config: { scope: 'public' } }, async (req, reply) => {
    const b = req.body ?? {};
    const device = await deviceOf(req);
    if (!device) throw forbidden('not_a_workshop_device', 'A PIN works only on the registered workshop tablet.');
    const userId = typeof b.userId === 'string' ? b.userId : '';
    const pin = b.pin;
    if (!isPinShaped(pin)) throw badRequest('bad_pin', 'A PIN is 4 to 6 digits.');
    const user = /^[0-9a-f-]{36}$/i.test(userId)
      ? await prisma.user.findUnique({ where: { id: userId }, select: { id: true, name: true, email: true, role: true, locale: true, active: true, pinHash: true, pinLockedUntil: true } })
      : null;
    if (!user || !user.active || !user.pinHash || !PIN_ROLES.includes(user.role as Role)) {
      spendVerifyTime(pin); // a name that is not on the tablet costs what a wrong PIN costs
      return reply.code(401).send({ error: 'invalid_pin' });
    }
    const closed = lockedUntil(user);
    if (closed) return reply.code(429).send({ error: 'pin_locked', until: closed.toISOString() });

    if (!verifyPin(pin, user.pinHash)) {
      const { failures, lockedUntil: until } = await recordPinFailure(user.id);
      await audit({ actorId: user.id, action: 'auth.pin.failed', entityType: 'login', entityId: user.id, after: { device: device.name, attempt: failures, locked: until != null } });
      if (until) return reply.code(429).send({ error: 'pin_locked', until: until.toISOString() });
      return reply.code(401).send({ error: 'invalid_pin', left: Math.max(0, PIN_MAX_FAILURES - failures) });
    }

    await prisma.user.update({ where: { id: user.id }, data: { pinFailed: 0, pinLockedUntil: null } });
    // Whoever was signed in on the tablet before is signed out by this sign-in.
    const previous = req.cookies?.[SESSION_COOKIE];
    if (previous) await destroySession(previous);
    const { token, expiresAt } = await createSession(user.id, { deviceId: device.id });
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecureRequest(req), expires: expiresAt });
    await audit({ actorId: user.id, action: 'auth.login', entityType: 'login', entityId: user.id, after: { via: 'pin', device: device.name } });
    return { me: me(user, 'pin') };
  });

  /** The workshop devices, live and revoked — nothing is deleted (ADR-0033 §5). */
  app.get('/api/workshop/devices', { config: { scope: 'users.manage' } }, async (req) => {
    const here = deviceIdOf(req.cookies?.[DEVICE_COOKIE]);
    const rows = await prisma.workshopDevice.findMany({
      orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { registeredAt: 'desc' }],
      include: {
        registrar: { select: { name: true } },
        revoker: { select: { name: true } },
        _count: { select: { sessions: true } },
      },
    });
    return {
      devices: rows.map((d) => ({
        id: d.id,
        name: d.name,
        registeredAt: d.registeredAt.toISOString(),
        registeredBy: d.registrar.name,
        lastSeenAt: d.lastSeenAt?.toISOString() ?? null,
        revokedAt: d.revokedAt?.toISOString() ?? null,
        revokedBy: d.revoker?.name ?? null,
        /** PIN sessions open on it right now. */
        sessions: d._count.sessions,
        /** The browser asking is this device. */
        here: d.id === here,
      })),
    };
  });

  /** Make the browser the owner is using right now the workshop's tablet. */
  app.post<{ Body: Body }>('/api/workshop/devices', { config: { scope: 'users.manage' } }, async (req, reply) => {
    const actor = actorOf(req);
    const name = str(req.body ?? {}, 'name', { required: true, max: 100 })!;
    if (await deviceOf(req)) throw conflict('device_already_registered', 'This browser is already a workshop device.');
    const { device, token } = await registerDevice(name, actor.id);
    setDeviceCookie(req, reply, token);
    await audit({ actorId: actor.id, action: 'workshop.device.register', entityType: 'workshop_device', entityId: device.id, after: { name } });
    return reply.code(201).send({ id: device.id });
  });

  /** A lost or replaced tablet: its token opens nothing and its PIN sessions end now. */
  app.post<{ Params: { id: string } }>('/api/workshop/devices/:id/revoke', { config: { scope: 'users.manage' } }, async (req, reply) => {
    const actor = actorOf(req);
    const device = await prisma.workshopDevice.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, revokedAt: true } });
    if (!device) throw notFound('device_not_found', 'No such workshop device.');
    if (device.revokedAt) throw conflict('device_revoked', 'This device is already revoked.');
    const closed = await prisma.$transaction(async (tx) => {
      await tx.workshopDevice.update({ where: { id: device.id }, data: { revokedAt: new Date(), revokedBy: actor.id } });
      return (await tx.session.deleteMany({ where: { deviceId: device.id } })).count;
    });
    // Revoked from the tablet itself: it forgets the token as well.
    if (deviceIdOf(req.cookies?.[DEVICE_COOKIE]) === device.id) {
      reply.clearCookie(DEVICE_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure: isSecureRequest(req) });
    }
    await audit({ actorId: actor.id, action: 'workshop.device.revoke', entityType: 'workshop_device', entityId: device.id, after: { name: device.name, sessions: closed } });
    return { ok: true, closed };
  });
}
