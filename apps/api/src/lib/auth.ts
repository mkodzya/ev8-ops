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
// Login rate limit — in memory, per email.
// ---------------------------------------------------------------------------

const attempts = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

export function loginAllowed(email: string): boolean {
  const rec = attempts.get(email);
  if (!rec || rec.resetAt < Date.now()) return true;
  return rec.count < MAX_ATTEMPTS;
}

export function recordLoginFailure(email: string): void {
  const now = Date.now();
  const rec = attempts.get(email);
  if (!rec || rec.resetAt < now) attempts.set(email, { count: 1, resetAt: now + WINDOW_MS });
  else rec.count++;
}

export function clearLoginFailures(email: string): void {
  attempts.delete(email);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const SESSION_COOKIE = 'ev8_session';
const SESSION_TTL_MS = 30 * 24 * 3600_000;

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
