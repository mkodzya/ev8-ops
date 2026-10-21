import { randomBytes } from 'node:crypto';
import { PIN_LOCK_MINUTES, PIN_MAX_DIGITS, PIN_MAX_FAILURES, PIN_MIN_DIGITS, PIN_ROLES, type Role } from '@ev8/shared';
import { hashPassword, verifyPassword } from './auth.js';
import { prisma } from './db.js';

// The workshop tablet and the mechanic's PIN (ADR-0033 §5–8).
//
// The tablet carries a token an owner gave it once: the device's id and a
// secret, in an httpOnly cookie. The id finds the row, the secret is checked
// against its scrypt hash the way a password is — a salted hash cannot be
// looked up by value, which is why the token is a pair. Neither the secret
// nor a PIN is ever written anywhere but as a hash, returned, or journaled.

export const DEVICE_COOKIE = 'ev8_device';
/** As long as a browser keeps a cookie at all (400 days); revoking ends it sooner. */
export const DEVICE_COOKIE_MAX_AGE_S = 400 * 24 * 3600;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Device {
  id: string;
  name: string;
}

/** Registers this browser as the workshop's device; the token goes into its cookie and nowhere else. */
export async function registerDevice(name: string, ownerId: string): Promise<{ device: Device; token: string }> {
  const secret = randomBytes(32).toString('hex');
  const row = await prisma.workshopDevice.create({
    data: { name, secretHash: hashPassword(secret), registeredBy: ownerId },
    select: { id: true, name: true },
  });
  return { device: row, token: `${row.id}.${secret}` };
}

/** The device id a token names, before anything is checked — to say "this one" in a list. */
export function deviceIdOf(token: string | undefined): string | null {
  const id = token?.split('.')[0] ?? '';
  return UUID.test(id) ? id : null;
}

/** The registered, not revoked device this token opens, or nothing. */
export async function readDevice(token: string | undefined): Promise<Device | null> {
  if (!token) return null;
  const [id, secret] = token.split('.');
  if (!id || !secret || !UUID.test(id)) return null;
  const row = await prisma.workshopDevice.findUnique({ where: { id }, select: { id: true, name: true, secretHash: true, revokedAt: true } });
  if (!row || row.revokedAt || !verifyPassword(secret, row.secretHash)) return null;
  // When it was last used, for the owner's list; nobody's request waits on it.
  void prisma.workshopDevice.update({ where: { id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  return { id: row.id, name: row.name };
}

export const isPinRole = (role: Role | string): boolean => PIN_ROLES.includes(role as Role);

const PIN_SHAPE = new RegExp(`^\\d{${PIN_MIN_DIGITS},${PIN_MAX_DIGITS}}$`);
export const isPinShaped = (pin: unknown): pin is string => typeof pin === 'string' && PIN_SHAPE.test(pin);

export const hashPin = hashPassword;

/** When a person's PIN sign-in opens again, if it is closed right now. */
export function lockedUntil(user: { pinLockedUntil: Date | null }, now = new Date()): Date | null {
  return user.pinLockedUntil && user.pinLockedUntil > now ? user.pinLockedUntil : null;
}

/**
 * One more wrong PIN. The counter is the person's, in a row, so a restart or
 * another tablet does not forgive it; the fifth closes the PIN sign-in for
 * fifteen minutes and the count starts again after that (ADR-0033 §6).
 */
export async function recordPinFailure(userId: string): Promise<{ failures: number; lockedUntil: Date | null }> {
  const { pinFailed } = await prisma.user.update({ where: { id: userId }, data: { pinFailed: { increment: 1 } }, select: { pinFailed: true } });
  if (pinFailed < PIN_MAX_FAILURES) return { failures: pinFailed, lockedUntil: null };
  const until = new Date(Date.now() + PIN_LOCK_MINUTES * 60_000);
  await prisma.user.update({ where: { id: userId }, data: { pinFailed: 0, pinLockedUntil: until } });
  return { failures: pinFailed, lockedUntil: until };
}

export function verifyPin(pin: string, stored: string | null): boolean {
  return verifyPassword(pin, stored);
}
