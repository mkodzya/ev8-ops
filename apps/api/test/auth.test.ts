import { describe, expect, it } from 'vitest';
import { HAS_DB, PASSWORD, call, json, login, makeUser } from './helpers.js';

describe.skipIf(!HAS_DB)('sign-in', () => {
  it('health answers without a session', async () => {
    const res = await call(null, 'GET', '/api/health');
    expect(res.statusCode).toBe(200);
    expect(json<{ ok: boolean }>(res).ok).toBe(true);
  });

  it('a wrong password is refused, a right one opens a session that /api/me confirms', async () => {
    const u = await makeUser('manager');
    const bad = await call(null, 'POST', '/api/auth/login', { email: u.email, password: 'nope' });
    expect(bad.statusCode).toBe(401);

    const cookie = await login(u.email, PASSWORD);
    const me = json<{ email: string; role: string; permissions: string[] }>(await call(cookie, 'GET', '/api/me'));
    expect(me.email).toBe(u.email);
    expect(me.role).toBe('manager');
    expect(me.permissions).toContain('rental.create');
    expect(me.permissions).not.toContain('payments.reconcile');
  });

  it('logging out closes the session', async () => {
    const u = await makeUser('director');
    const cookie = await login(u.email);
    expect((await call(cookie, 'POST', '/api/auth/logout')).statusCode).toBe(200);
    expect((await call(cookie, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('a deactivated user is cut off at once', async () => {
    const u = await makeUser('manager');
    const cookie = await login(u.email);
    const { prisma } = await import('../src/lib/db.js');
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    expect((await call(cookie, 'GET', '/api/me')).statusCode).toBe(401);
  });
});

// Demo logins share the laptop's default password: fine on this Mac, never on
// a stand on the server (B1-04). The flag is the one the seed already obeys.
describe('demo logins', () => {
  it('are refused only off a laptop stack, whatever the case of the address', async () => {
    const { demoLoginRefused } = await import('../src/lib/env.js');
    expect(demoLoginRefused('demo.manager@ev8.test', false)).toBe(true);
    expect(demoLoginRefused(' Demo.Director@EV8.test ', false)).toBe(true);
    expect(demoLoginRefused('demo.manager@ev8.test', true)).toBe(false);
    expect(demoLoginRefused('kardu@ev8.ge', false)).toBe(false);
  });
});

describe.skipIf(!HAS_DB)('demo logins on a stand', () => {
  const asStand = async <T>(fn: () => Promise<T>): Promise<T> => {
    const was = process.env.ALLOW_DEV_SECRET;
    delete process.env.ALLOW_DEV_SECRET;
    try {
      return await fn();
    } finally {
      if (was === undefined) delete process.env.ALLOW_DEV_SECRET;
      else process.env.ALLOW_DEV_SECRET = was;
    }
  };

  it('cannot sign in, even with the right password', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { hashPassword } = await import('../src/lib/auth.js');
    const email = `demo.${Date.now()}@ev8.test`;
    await prisma.user.create({ data: { email, name: 'Demo', role: 'manager', passwordHash: hashPassword(PASSWORD) } });
    const res = await asStand(() => call(null, 'POST', '/api/auth/login', { email, password: PASSWORD }));
    expect(res.statusCode).toBe(403);
    expect(json<{ error: string }>(res).error).toBe('demo_login_off');
    expect(res.cookies.find((c) => c.name === 'ev8_session')).toBeUndefined();
  });

  it('cannot be created by the owner', async () => {
    const owner = await login((await makeUser('owner')).email);
    const res = await asStand(() =>
      call(owner, 'POST', '/api/users', { email: `x.${Date.now()}@ev8.test`, name: 'X', role: 'manager', password: 'long-enough-1' }),
    );
    expect(res.statusCode).toBe(403);
    expect(json<{ error: string }>(res).error).toBe('demo_login_off');
  });
});
