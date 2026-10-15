// Integration-test plumbing. These suites need a migrated database:
//   DATABASE_URL=… npm run migrate && npm test
// Without DATABASE_URL every integration suite is skipped and stays green.
// Users are created by the suites themselves (no demo seed exists here).
import type { Role } from '@ev8/shared';
import type { FastifyInstance, InjectOptions } from 'fastify';

export const HAS_DB = Boolean(process.env.DATABASE_URL);

let app: FastifyInstance | null = null;

export async function getApp(): Promise<FastifyInstance> {
  if (!app) {
    const { buildApp } = await import('../src/server.js');
    app = buildApp();
    await app.ready();
  }
  return app;
}

export const PASSWORD = 'test-password-1';

export const uniq = (): string => `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** A fresh user with the given role; the teardown removes it. */
export async function makeUser(role: Role): Promise<{ id: string; email: string }> {
  const { prisma } = await import('../src/lib/db.js');
  const { hashPassword } = await import('../src/lib/auth.js');
  const email = `${role}.${uniq()}@test.ev8`;
  const u = await prisma.user.create({
    data: { email, name: `Test ${role}`, passwordHash: hashPassword(PASSWORD), role },
  });
  return { id: u.id, email };
}

export async function login(email: string, password = PASSWORD): Promise<string> {
  const a = await getApp();
  const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login failed for ${email}: ${res.statusCode} ${res.body}`);
  const cookie = res.cookies.find((c) => c.name === 'ev8_session');
  if (!cookie) throw new Error('no session cookie set on login');
  return `${cookie.name}=${cookie.value}`;
}

export async function loginAs(role: Role): Promise<string> {
  const u = await makeUser(role);
  return login(u.email);
}

export async function call(cookie: string | null, method: InjectOptions['method'], url: string, payload?: unknown) {
  const a = await getApp();
  return a.inject({
    method,
    url,
    payload: payload as InjectOptions['payload'],
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
  });
}

export function json<T = unknown>(res: { body: string }): T {
  return JSON.parse(res.body) as T;
}

/**
 * Money an owner types in by hand: a transfer or a card payment (B11-03).
 * The suites share one database and run side by side, and a bank line
 * another suite left in «Разобрать» can be the same sum within ±3 days — the
 * server then asks whether this is that line's money. A suite that is not
 * about the question answers it as a person would who knows this money is
 * another transfer, and only when asked; `in-bank.test.ts` asks it itself.
 */
export async function byHand(cookie: string, url: string, payload: Record<string, unknown>) {
  const res = await call(cookie, 'POST', url, payload);
  if (res.statusCode !== 409) return res;
  const refusal = json<{ error?: string; lines?: { lineId: string }[] }>(res);
  if (refusal.error !== 'bank_line_exists' || !refusal.lines) return res;
  return call(cookie, 'POST', url, { ...payload, notBankLines: refusal.lines.map((l) => l.lineId) });
}
