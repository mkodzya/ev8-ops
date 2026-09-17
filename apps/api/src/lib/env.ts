/**
 * The two values this API cannot be trusted with a default for.
 *
 * SESSION_SECRET signs sessions, so whoever knows it can mint a session for
 * anybody, the owner included. WORKER_TOKEN opens the nightly job route, and
 * that route writes money: it opens a rental week and lets a customer's credit
 * pay for it. Both are weak by default on the laptop, and a weak one stops the
 * boot unless the stack says out loud that it is a development one
 * (ALLOW_DEV_SECRET=true in the laptop compose). Same rule as Self Platform.
 */
export const DEV_SECRET = 'dev-secret-change-me';
export const DEV_WORKER_TOKEN = 'dev-worker-token';
export const MIN_SECRET_LENGTH = 32;

/** Pure, so the rule can be tested without booting a server around it. */
function checkSecret(name: string, what: string, devValue: string, given: string, allowDev: boolean): string {
  const weak = given === '' || given === devValue || given.length < MIN_SECRET_LENGTH;
  if (!weak) return given;
  if (allowDev) return given || devValue;
  throw new Error(
    `${name} is missing, is the development default, or is shorter than ` +
      `${MIN_SECRET_LENGTH} characters. ${what}, so this one cannot ` +
      'have a default: anybody who knows it can use it.\n' +
      '  Generate one:  openssl rand -base64 48\n' +
      '  Local stack:   set ALLOW_DEV_SECRET=true to accept the development secret on purpose.',
  );
}

export function checkSessionSecret(given: string, allowDev: boolean): string {
  return checkSecret('SESSION_SECRET', 'Sessions are signed with it', DEV_SECRET, given, allowDev);
}

export function checkWorkerToken(given: string, allowDev: boolean): string {
  return checkSecret('WORKER_TOKEN', 'The nightly job it opens writes rental weeks', DEV_WORKER_TOKEN, given, allowDev);
}

const allowDev = (): boolean => process.env.ALLOW_DEV_SECRET === 'true';

/**
 * A laptop stack — this Mac's working stand or its QA copy — as opposed to a
 * stand on the server. One flag decides everything that is fine on a laptop
 * and never on a stand: the development secret, the demo dataset, the demo
 * logins. Read on every call, so a test can switch it.
 */
export const isDevStack = allowDev;

/** Logins of the demo dataset (seed.ts): nobody real signs in on this domain. */
export const DEMO_EMAIL_DOMAIN = '@ev8.test';

export function demoLoginRefused(email: string, devStack: boolean = isDevStack()): boolean {
  return !devStack && email.trim().toLowerCase().endsWith(DEMO_EMAIL_DOMAIN);
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://ev8ops:ev8ops@localhost:5433/ev8ops',
  SESSION_SECRET: checkSessionSecret(process.env.SESSION_SECRET ?? '', allowDev()),
  API_PORT: parseInt(process.env.API_PORT ?? '8080', 10),
  TZ: process.env.TZ ?? 'Asia/Tbilisi',
  DEFAULT_LOCALE: process.env.DEFAULT_LOCALE ?? 'ka',

  // The first owner login, created by the seed only when the users table is
  // empty. No password default here: the compose files set one for the
  // laptop stack and the server stack must supply its own.
  OWNER_EMAIL: (process.env.OWNER_EMAIL ?? 'mika@selfstudio.se').trim().toLowerCase(),
  OWNER_NAME: process.env.OWNER_NAME ?? 'Mika',
  OWNER_PASSWORD: process.env.OWNER_PASSWORD ?? '',

  // What the worker shows at the door. It is not a user credential: it
  // authorises one job route and nothing else — but that route rolls weeks,
  // so it is held to the same rule as the session secret.
  WORKER_TOKEN: checkWorkerToken(process.env.WORKER_TOKEN ?? '', allowDev()),
};
