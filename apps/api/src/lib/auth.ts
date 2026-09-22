import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { ROLE_PERMISSIONS, type Permission, type Role } from '@ev8/shared';
import { prisma } from './db.js';

// ---------------------------------------------------------------------------
// Passwords — scrypt, no native dependencies.
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `s2:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(':');
  if (scheme !== 's2' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

// ---------------------------------------------------------------------------
// Login rate limit — counted in rows, per email (wave 6 §3.9, crit. 22).
//
// It used to be a Map: a restart of the API forgave every attempt, so ten
// tries were ten tries *per restart* and the limit protected nothing that
// mattered. Rows survive a restart. The IP is kept beside the address
// because the journal has to answer "from where" (§3.8); the password is
// never written, here or anywhere.
// ---------------------------------------------------------------------------

const WINDOW_MS = 15 * 60_000;
export const MAX_ATTEMPTS = 10;

const since = () => new Date(Date.now() - WINDOW_MS);

/** How many failures this address has collected in the window. */
export async function loginFailures(email: string): Promise<number> {
  return prisma.loginAttempt.count({ where: { email, createdAt: { gte: since() } } });
}

export async function loginAllowed(email: string): Promise<boolean> {
  return (await loginFailures(email)) < MAX_ATTEMPTS;
}

/** Writes the attempt and answers which one it was — the journal says "3rd try". */
export async function recordLoginFailure(email: string, ip: string | null): Promise<number> {
  await prisma.loginAttempt.create({ data: { email, ip } });
  return loginFailures(email);
}

export async function clearLoginFailures(email: string): Promise<void> {
  await prisma.loginAttempt.deleteMany({ where: { email } });
}

/**
 * A password check to run when the address does not exist, so that answering
 * "no such person" costs what answering "wrong password" costs
 * (`practices.md` §4). Hashed once at startup from a value nobody types.
 */
const DECOY_HASH = hashPassword(randomBytes(32).toString('hex'));

export function spendVerifyTime(password: string): void {
  verifyPassword(password, DECOY_HASH);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'ev8_session';
/** How long a sign-in lasts, and how long it survives without use (Q30, §3.9). */
export const SESSION_TTL_MS = 30 * 24 * 3600_000;
export const SESSION_IDLE_MS = 7 * 24 * 3600_000;

export interface Actor {
  id: string;
  email: string;
  name: string;
  role: Role;
  locale: string;
}

export async function createSession(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({ data: { token, userId, expiresAt } });
  return { token, expiresAt };
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { token } });
}

export async function loadActor(token: string | undefined): Promise<Actor | null> {
  if (!token) return null;
  const session = await prisma.session.findUnique({ where: { token }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  // A phone left in a drawer for a week signs in again (Q30). The thirty days
  // are the outer limit; this is the one that usually ends a session.
  if (Date.now() - session.lastSeenAt.getTime() > SESSION_IDLE_MS) {
    await prisma.session.deleteMany({ where: { token } });
    return null;
  }
  const u = session.user;
  if (!u.active) return null; // deactivation cuts access at once

  // A heartbeat at most once a minute; not awaited, nobody's request waits on it.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    void prisma.session.update({ where: { token }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role, locale: u.locale };
}

export function hasPerm(actor: Actor, perm: Permission): boolean {
  return ROLE_PERMISSIONS[actor.role].includes(perm);
}

export function permissionsOf(role: Role): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
