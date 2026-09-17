import { ROLES, type Role } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { SESSION_COOKIE, hashPassword, permissionsOf, verifyPassword } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { demoLoginRefused } from '../lib/env.js';
import { badRequest, conflict, forbidden, isUniqueViolation, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { oneOf, str } from '../lib/validate.js';

// The team's logins (spec §3). Rights come from the role, so this screen has
// exactly three decisions: who, which role, and still working here or not.
//
// Passwords never leave this file: they are hashed on the way in, never
// returned, never written to the journal. The owner sets the first one and
// says it to the person; the person changes it on their own page.

const MIN_PASSWORD = 8;

type Body = Record<string, unknown>;

function readPassword(b: Body, field = 'password'): string {
  const pw = str(b, field, { required: true })!;
  if (pw.length < MIN_PASSWORD) throw badRequest('password_too_short', `At least ${MIN_PASSWORD} characters.`, { min: MIN_PASSWORD });
  return pw;
}

export function userRoutes(app: FastifyInstance): void {
  app.get('/api/users', { config: { scope: 'users.manage' } }, async () => {
    const users = await prisma.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return {
      roles: ROLES,
      users: users.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        locale: u.locale,
        active: u.active,
        createdAt: u.createdAt.toISOString(),
      })),
    };
  });

  app.post<{ Body: Body }>('/api/users', { config: { scope: 'users.manage' } }, async (req, reply) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const email = str(b, 'email', { required: true, max: 200 })!.toLowerCase();
    if (demoLoginRefused(email)) throw forbidden('demo_login_off', 'Demo logins are switched off on a stand.');
    const name = str(b, 'name', { required: true, max: 200 })!;
    const role = oneOf(b, 'role', ROLES, { required: true })!;
    const password = readPassword(b);
    try {
      const u = await prisma.user.create({
        data: { email, name, role, passwordHash: hashPassword(password), locale: str(b, 'locale', { max: 5 }) ?? 'ka' },
        select: { id: true },
      });
      await audit({ actorId: actor.id, action: 'user.create', entityType: 'user', entityId: u.id, after: { email, name, role } });
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
    const data: { name?: string; role?: Role; active?: boolean } = {};
    if ('name' in b) data.name = str(b, 'name', { required: true, max: 200 })!;
    if ('role' in b) data.role = oneOf(b, 'role', ROLES, { required: true })!;
    if ('active' in b) data.active = Boolean(b.active);

    // The last working owner cannot be demoted or switched off: a system
    // nobody can administer is not a safe state to leave one click away.
    const losingOwner = before.role === 'owner' && ((data.role && data.role !== 'owner') || data.active === false);
    if (losingOwner) {
      const owners = await prisma.user.count({ where: { role: 'owner', active: true, id: { not: before.id } } });
      if (owners === 0) throw conflict('last_owner', 'This is the last active owner.');
    }
    await prisma.user.update({ where: { id: before.id }, data: { ...data, updatedAt: new Date() } });
    // Switching somebody off cuts their access now, not when their session expires.
    if (data.active === false) await prisma.session.deleteMany({ where: { userId: before.id } });
    await audit({
      actorId: actor.id,
      action: 'user.update',
      entityType: 'user',
      entityId: before.id,
      before: { name: before.name, role: before.role, active: before.active },
      after: data,
    });
    return { ok: true };
  });

  /** The owner sets somebody a new password and tells them what it is. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/users/:id/password', { config: { scope: 'users.manage' } }, async (req) => {
    const actor = actorOf(req);
    const user = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true } });
    if (!user) throw notFound('user_not_found', 'No such user.');
    const password = readPassword(req.body ?? {});
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: hashPassword(password), updatedAt: new Date() } });
    await prisma.session.deleteMany({ where: { userId: user.id } }); // every old session is now stale
    await audit({ actorId: actor.id, action: 'user.password.reset', entityType: 'user', entityId: user.id });
    return { ok: true };
  });

  /** Changing your own password needs the current one, even for the owner. */
  app.post<{ Body: Body }>('/api/me/password', { config: { scope: 'session' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const current = str(b, 'currentPassword', { required: true })!;
    const next = readPassword(b, 'newPassword');
    const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (!verifyPassword(current, me.passwordHash)) throw conflict('wrong_password', 'The current password does not match.');
    await prisma.user.update({ where: { id: me.id }, data: { passwordHash: hashPassword(next), updatedAt: new Date() } });
    // A new password is usually a reaction to a phone left somewhere: every
    // other device signs in again, this one stays (B1-03).
    await prisma.session.deleteMany({ where: { userId: me.id, token: { not: req.cookies?.[SESSION_COOKIE] ?? '' } } });
    await audit({ actorId: actor.id, action: 'user.password.change', entityType: 'user', entityId: me.id });
    return { ok: true, permissions: permissionsOf(me.role as Role) };
  });
}
