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
