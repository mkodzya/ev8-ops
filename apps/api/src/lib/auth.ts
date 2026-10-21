import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { PIN_IDLE_MINUTES, PIN_SESSION_PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '@ev8/shared';
import { prisma } from './db.js';

// ---------------------------------------------------------------------------
// Passwords — scrypt, no native dependencies.
// ---------------------------------------------------------------------------

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `s2:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored) return false; // a mechanic who signs in only with a PIN has no password (0055)
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
/**
 * A PIN session on the shared workshop tablet ends after ten idle minutes
 * (ADR-0033 §7); the browser counts touches and signs out on time, this is
 * the server's own limit for a tablet left on the bench. A working day is
 * the outer one.
 */
export const PIN_SESSION_IDLE_MS = PIN_IDLE_MINUTES * 60_000;
export const PIN_SESSION_TTL_MS = 12 * 3600_000;

export type SignInKind = 'password' | 'pin';

export interface Actor {
  id: string;
  /** Empty for a mechanic who signs in only with a PIN (0055). */
  email: string | null;
  name: string;
  role: Role;
  locale: string;
  /** How this session began: a PIN on the workshop tablet reaches the repairs only. */
  via: SignInKind;
  deviceId: string | null;
}

export async function createSession(
  userId: string,
  pin?: { deviceId: string },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + (pin ? PIN_SESSION_TTL_MS : SESSION_TTL_MS));
  await prisma.session.create({
    data: { token, userId, expiresAt, kind: pin ? 'pin' : 'password', deviceId: pin?.deviceId ?? null },
  });
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
  const idle = session.kind === 'pin' ? PIN_SESSION_IDLE_MS : SESSION_IDLE_MS;
  if (Date.now() - session.lastSeenAt.getTime() > idle) {
    await prisma.session.deleteMany({ where: { token } });
    return null;
  }
  const u = session.user;
  if (!u.active) return null; // deactivation cuts access at once

  // A heartbeat at most once a minute; not awaited, nobody's request waits on it.
  if (Date.now() - session.lastSeenAt.getTime() > 60_000) {
    void prisma.session.update({ where: { token }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    locale: u.locale,
    via: session.kind,
    deviceId: session.deviceId,
  };
}

/**
 * What this person may do in this session: their role's rights, and on the
 * workshop tablet only the repair ones (ADR-0033 §7) — so the guard, the
 * fields an answer leaves out and the menu all ask the same question.
 */
export function permissionsOf(role: Role, via: SignInKind = 'password'): readonly Permission[] {
  const mine = ROLE_PERMISSIONS[role];
  return via === 'pin' ? mine.filter((p) => PIN_SESSION_PERMISSIONS.includes(p)) : mine;
}

export function hasPerm(actor: Actor, perm: Permission): boolean {
  return permissionsOf(actor.role, actor.via).includes(perm);
}

/**
 * Is this request on a connection a Secure cookie can survive? Behind a
 * TLS-terminating proxy the hop we see is plain http, so x-forwarded-proto is
 * asked first. Plain http://localhost is left alone on purpose: browsers
 * refuse to store a Secure cookie there.
 */
export function isSecureRequest(req: { protocol?: string; headers: Record<string, unknown> }): boolean {
  if (process.env.NODE_ENV === 'production') return true;
  const forwarded = req.headers['x-forwarded-proto'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof first === 'string' && first.split(',')[0].trim() === 'https') return true;
  return req.protocol === 'https';
}
