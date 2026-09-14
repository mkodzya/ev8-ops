/**
 * The one value this API cannot be trusted with a default for.
 *
 * Sessions are signed with SESSION_SECRET, so whoever knows it can mint a
 * session for anybody, the owner included. A weak secret stops the boot
 * unless the stack says out loud that it is a development one
 * (ALLOW_DEV_SECRET=true in the laptop compose). Same rule as Self Platform.
 */
export const DEV_SECRET = 'dev-secret-change-me';
export const MIN_SECRET_LENGTH = 32;

/** Pure, so the rule can be tested without booting a server around it. */
export function checkSessionSecret(given: string, allowDev: boolean): string {
  const weak = given === '' || given === DEV_SECRET || given.length < MIN_SECRET_LENGTH;
  if (!weak) return given;
  if (allowDev) return given || DEV_SECRET;
  throw new Error(
    'SESSION_SECRET is missing, is the development default, or is shorter than ' +
      `${MIN_SECRET_LENGTH} characters. Sessions are signed with it, so this one cannot ` +
      'have a default: anybody who knows it can mint a session for anybody.\n' +
      '  Generate one:  openssl rand -base64 48\n' +
      '  Local stack:   set ALLOW_DEV_SECRET=true to accept the development secret on purpose.',
  );
}

function sessionSecret(): string {
  return checkSessionSecret(process.env.SESSION_SECRET ?? '', process.env.ALLOW_DEV_SECRET === 'true');
}

export const env = {
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://ev8ops:ev8ops@localhost:5433/ev8ops',
  SESSION_SECRET: sessionSecret(),
  API_PORT: parseInt(process.env.API_PORT ?? '8080', 10),
  TZ: process.env.TZ ?? 'Asia/Tbilisi',
  DEFAULT_LOCALE: process.env.DEFAULT_LOCALE ?? 'ka',

  // The first owner login, created by the seed only when the users table is
  // empty. No password default here: the compose files set one for the
  // laptop stack and the server stack must supply its own.
  OWNER_EMAIL: (process.env.OWNER_EMAIL ?? 'mika@selfstudio.se').trim().toLowerCase(),
  OWNER_NAME: process.env.OWNER_NAME ?? 'Mika',
  OWNER_PASSWORD: process.env.OWNER_PASSWORD ?? '',
};
