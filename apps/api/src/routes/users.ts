import { ROLES, type Role } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { SESSION_COOKIE, hashPassword, permissionsOf, verifyPassword } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { demoLoginRefused } from '../lib/env.js';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { oneOf, str, tetri } from '../lib/validate.js';
import { hashPin, isPinRole, isPinShaped, lockedUntil } from '../lib/workshop.js';

// The team's logins (spec §3). Rights come from the role, so this screen has
// exactly three decisions: who, which role, and still working here or not —
// and for a mechanic, the PIN for the workshop tablet and the rate for an
// hour of norm (ADR-0033).
//
// Passwords and PINs never leave this file: they are hashed on the way in,
// never returned, never written to the journal. The owner sets the first one
// and says it to the person; the person changes a password on their own page.
// A mechanic who signs in only on the workshop tablet needs no address and no
// password; everybody else signs in with both (migration 0055).

const MIN_PASSWORD = 8;

type Body = Record<string, unknown>;

function readPassword(b: Body, field = 'password'): string {
  const pw = str(b, field, { required: true })!;
  if (pw.length < MIN_PASSWORD) throw badRequest('password_too_short', `At least ${MIN_PASSWORD} characters.`, { min: MIN_PASSWORD });
  return pw;
}

function readEmail(b: Body, required: boolean): string | null {
  const email = str(b, 'email', { required, max: 200 })?.toLowerCase() ?? null;
  if (email && demoLoginRefused(email)) throw forbidden('demo_login_off', 'Demo logins are switched off on a stand.');
  return email;
}

/** A mechanic's rate for an hour of norm; empty is the company's (0055). */
function readRate(b: Body): number | null {
  return tetri(b, 'labourRateTetri', { min: 1 });
}

/** The PIN sessions of this person end — a new PIN, no PIN, another role. */
const closePinSessions = (userId: string) => prisma.session.deleteMany({ where: { userId, kind: 'pin' } });

export function userRoutes(app: FastifyInstance): void {
  app.get('/api/users', { config: { scope: 'users.manage' } }, async () => {
    const users = await prisma.user.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
      // On how many devices this person is signed in right now: the number
      // "Закрыть все входы" is decided by (§3.4).
      include: { sessions: { select: { lastSeenAt: true } } },
    });
    // When each of them last signed in. Live sessions cannot answer this:
    // closing a session takes its history with it, and the column then says
    // "не входил" about somebody who signed in twice this morning
    // (QA-W6-14). The journal remembers; where it does not — because the
    // sign-in predates the journal — the answer is "нет данных", not "нет".
    const logins = await prisma.auditLog.groupBy({
      by: ['actorId'],
      where: { action: 'auth.login', actorId: { in: users.map((u) => u.id) } },
      _max: { createdAt: true },
    });
    const lastLogin = new Map(logins.map((r) => [r.actorId, r._max.createdAt]));
    // A mechanic who rents a moped: the card his rent is written to (0066).
    const renters = await prisma.customer.findMany({
      where: { id: { in: users.map((u) => u.customerId).filter((id): id is string => id != null) } },
      select: { id: true, name: true },
    });
    const renter = new Map(renters.map((c) => [c.id, c]));
    return {
      roles: ROLES,
      users: users.map((u) => {
        const live = u.sessions.reduce<Date | null>((last, s) => (!last || s.lastSeenAt > last ? s.lastSeenAt : last), null);
        const signedIn = lastLogin.get(u.id) ?? null;
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role,
          locale: u.locale,
          active: u.active,
          /** Whether a PIN is set — the PIN itself never leaves the server. */
          hasPin: u.pinHash != null,
          pinLockedUntil: lockedUntil(u)?.toISOString() ?? null,
          labourRateTetri: u.labourRateTetri,
          /** His card as a customer when he rents a moped; his payouts pay that rent first (0066). */
          customer: u.customerId ? (renter.get(u.customerId) ?? null) : null,
          sessions: u.sessions.length,
          /** The last sign-in the journal knows of; null means nothing is known. */
          lastLoginAt: signedIn?.toISOString() ?? null,
          /** The last request of a session still open, for "сейчас на N устройствах". */
          lastSeenAt: live?.toISOString() ?? null,
          createdAt: u.createdAt.toISOString(),
        };
      }),
    };
  });

  app.post<{ Body: Body }>('/api/users', { config: { scope: 'users.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const role = oneOf(b, 'role', ROLES, { required: true })!;
    // A mechanic may be somebody who only ever signs in on the tablet; an
    // address, when given, comes with a password like everybody's.
    const email = readEmail(b, !isPinRole(role));
    const name = str(b, 'name', { required: true, max: 200 })!;
    const password = email ? readPassword(b) : null;
    const labourRateTetri = isPinRole(role) ? readRate(b) : null;
    try {
      const u = await prisma.user.create({
        data: { email, name, role, passwordHash: password ? hashPassword(password) : null, labourRateTetri, locale: str(b, 'locale', { max: 5 }) ?? 'ka' },
        select: { id: true },
      });
      await audit({ actorId: actor.id, action: 'user.create', entityType: 'user', entityId: u.id, after: { email, name, role, labourRateTetri } });
      return reply.code(201).send({ id: u.id });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_email', 'Somebody already signs in with that email.');
      throw e;
    }
  });

  app.patch<{ Params: { id: string }; Body: Body }>('/api/users/:id', { config: { scope: 'users.manage' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const before = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!before) throw notFound('user_not_found', 'No such user.');
    const data: { name?: string; role?: Role; active?: boolean; labourRateTetri?: number | null; customerId?: string | null; pinHash?: null; pinFailed?: number; pinLockedUntil?: null } = {};
    if ('name' in b) data.name = str(b, 'name', { required: true, max: 200 })!;
    if ('role' in b) data.role = oneOf(b, 'role', ROLES, { required: true })!;
    if ('active' in b) data.active = Boolean(b.active);
    if ('labourRateTetri' in b) data.labourRateTetri = readRate(b);
    // A mechanic who rents a moped: his card as a customer (0066). Empty unlinks it.
    if ('customerId' in b) {
      const id = str(b, 'customerId');
      if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw badRequest('bad_field', 'customerId is an id.', { field: 'customerId' });
      if (id && !(await prisma.customer.findUnique({ where: { id }, select: { id: true } }))) throw notFound('customer_not_found', 'No such customer.');
      data.customerId = id;
    }
    const role = data.role ?? (before.role as Role);
    // Somebody without an address signs in only with a PIN, which only a
    // mechanic has: give them an address and a password before another role.
    if (!before.email && !isPinRole(role)) throw conflict('email_required', 'This role signs in with an address and a password.');
    // Out of the workshop, the PIN and the rate go with the role.
    const leavesWorkshop = isPinRole(before.role) && !isPinRole(role);
    if (leavesWorkshop) Object.assign(data, { pinHash: null, pinFailed: 0, pinLockedUntil: null, labourRateTetri: null, customerId: null });
    else if (!isPinRole(role) && data.labourRateTetri != null) throw conflict('rate_for_mechanics', 'A rate for an hour of norm is a mechanic\'s.');
    // Rent paid by work is a mechanic's too: nobody else has payouts (0066).
    else if (!isPinRole(role) && data.customerId != null) throw conflict('renter_for_mechanics', 'Only a mechanic\'s payouts can pay a rent.');

    // The last working owner cannot be demoted or switched off: a system
    // nobody can administer is not a safe state to leave one click away.
    const losingOwner = before.role === 'owner' && ((data.role && data.role !== 'owner') || data.active === false);
    if (losingOwner) {
      const owners = await prisma.user.count({ where: { role: 'owner', active: true, id: { not: before.id } } });
      if (owners === 0) throw conflict('last_owner', 'This is the last active owner.');
    }
    try {
      await prisma.user.update({ where: { id: before.id }, data: { ...data, updatedAt: new Date() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('customer_taken', 'That customer is already another person\'s card.');
      throw e;
    }
    // Switching somebody off cuts their access now, not when their session expires.
    if (data.active === false) await prisma.session.deleteMany({ where: { userId: before.id } });
    // Out of the workshop, the tablet's sessions end with the PIN.
    else if (leavesWorkshop) await closePinSessions(before.id);
    const { pinHash: _cleared, ...shown } = data;
    await audit({
      actorId: actor.id,
      action: 'user.update',
      entityType: 'user',
      entityId: before.id,
      before: { name: before.name, role: before.role, active: before.active, labourRateTetri: before.labourRateTetri, customerId: before.customerId },
      after: leavesWorkshop ? { ...shown, pin: 'cleared' } : shown,
    });
    return { ok: true };
  });

  /**
   * The owner sets somebody a new password and tells them what it is. A
   * mechanic who had only a PIN gets an address with it — the chief mechanic
   * who will now also sign in from a phone.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/users/:id/password', { config: { scope: 'users.manage' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true } });
    if (!user) throw notFound('user_not_found', 'No such user.');
    const email = user.email ? null : readEmail(b, true);
    const password = readPassword(b);
    try {
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password), ...(email ? { email } : {}), updatedAt: new Date() } });
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict('duplicate_email', 'Somebody already signs in with that email.');
      throw e;
    }
    await prisma.session.deleteMany({ where: { userId: user.id, kind: 'password' } }); // every old sign-in by password is now stale
    await audit({ actorId: actor.id, action: 'user.password.reset', entityType: 'user', entityId: user.id, after: email ? { email } : undefined });
    return { ok: true };
  });

  /**
   * The PIN for the workshop tablet (ADR-0033 §6): the owner sets it and says
   * it to the mechanic. A new PIN opens a closed sign-in at once and ends the
   * PIN sessions the old one opened.
   */
  app.post<{ Params: { id: string }; Body: Body }>('/api/users/:id/pin', { config: { scope: 'users.manage' } }, async (req) => {
    const actor = actorOf(req);
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, role: true, pinHash: true } });
    if (!user) throw notFound('user_not_found', 'No such user.');
    if (!isPinRole(user.role)) throw conflict('pin_for_mechanics', 'A PIN is for a mechanic or a chief mechanic.');
    const pin = (req.body ?? {}).pin;
    if (!isPinShaped(pin)) throw badRequest('bad_pin', 'A PIN is 4 to 6 digits.');
    await prisma.user.update({ where: { id: user.id }, data: { pinHash: hashPin(pin), pinFailed: 0, pinLockedUntil: null, updatedAt: new Date() } });
    await closePinSessions(user.id);
    await audit({ actorId: actor.id, action: user.pinHash ? 'user.pin.reset' : 'user.pin.set', entityType: 'user', entityId: user.id });
    return { ok: true };
  });

  /** No PIN: this person no longer signs in on the tablet. */
  app.delete<{ Params: { id: string } }>('/api/users/:id/pin', { config: { scope: 'users.manage' } }, async (req) => {
    const actor = actorOf(req);
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, pinHash: true } });
    if (!user) throw notFound('user_not_found', 'No such user.');
    if (!user.pinHash) return { ok: true };
    await prisma.user.update({ where: { id: user.id }, data: { pinHash: null, pinFailed: 0, pinLockedUntil: null, updatedAt: new Date() } });
    await closePinSessions(user.id);
    await audit({ actorId: actor.id, action: 'user.pin.clear', entityType: 'user', entityId: user.id });
    return { ok: true };
  });

  /**
   * Every device this person is signed in on signs in again (§3.4). The
   * answer to a phone left in a taxi: the password is still theirs, but the
   * sessions it opened are over — including, deliberately, their own if an
   * owner does this to themselves.
   */
  app.post<{ Params: { id: string } }>('/api/users/:id/sessions/close', { config: { scope: 'users.manage' } }, async (req) => {
    const actor = actorOf(req);
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, name: true } });
    if (!user) throw notFound('user_not_found', 'No such user.');
    const { count } = await prisma.session.deleteMany({ where: { userId: user.id } });
    await audit({ actorId: actor.id, action: 'user.sessions.closed', entityType: 'user', entityId: user.id, after: { sessions: count } });
    return { ok: true, closed: count };
  });

  /** Changing your own password needs the current one, even for the owner. */
  app.post<{ Body: Body }>('/api/me/password', { config: { scope: 'session' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const current = str(b, 'currentPassword', { required: true })!;
    const next = readPassword(b, 'newPassword');
    // On the workshop tablet the session is for repairs, not for one's account (ADR-0033 §7).
    if (actor.via === 'pin') throw forbidden('not_on_workshop_tablet', 'A password is changed when signed in with it, not on the workshop tablet.');
    const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!me.passwordHash) throw conflict('no_password', 'Somebody who signs in with a PIN has no password to change.');
    if (!verifyPassword(current, me.passwordHash)) throw conflict('wrong_password', 'The current password does not match.');
    await prisma.user.update({ where: { id: me.id }, data: { passwordHash: hashPassword(next), updatedAt: new Date() } });
    // A new password is usually a reaction to a phone left somewhere: every
    // other device signs in again, this one stays (B1-03).
    await prisma.session.deleteMany({ where: { userId: me.id, token: { not: req.cookies?.[SESSION_COOKIE] ?? '' } } });
    await audit({ actorId: actor.id, action: 'user.password.change', entityType: 'user', entityId: me.id });
    return { ok: true, permissions: permissionsOf(me.role as Role) };
  });
}
