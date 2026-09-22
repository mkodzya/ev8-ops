import { describe, expect, it } from 'vitest';
import { HAS_DB, PASSWORD, call, json, login, loginAs, makeUser } from './helpers.js';

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

  it('signing in again on the same device ends the session it carried', async () => {
    const u = await makeUser('manager');
    const first = await login(u.email);
    const again = await call(first, 'POST', '/api/auth/login', { email: u.email, password: PASSWORD });
    expect(again.statusCode).toBe(200);
    expect((await call(first, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('logging out closes the session', async () => {
    const u = await makeUser('manager');
    const cookie = await login(u.email);
    expect((await call(cookie, 'POST', '/api/auth/logout')).statusCode).toBe(200);
    expect((await call(cookie, 'GET', '/api/me')).statusCode).toBe(401);
  });

  /**
   * Crit. 15. Cutting an open session is half the rule; the other half is
   * that the right password stops opening a new one. It held on one line of
   * `auth.ts` and nothing tested it — the tester's own note, round 12. With
   * this the criterion is closed here and does not need Mika and a second
   * device.
   */
  it('a switched-off person cannot sign in again, right password and all (crit. 15)', async () => {
    const owner = await loginAs('owner');
    const u = await makeUser('manager');
    await login(u.email); // works while they are on

    const off = await call(owner, 'PATCH', `/api/users/${u.id}`, { active: false });
    expect(off.statusCode).toBe(200);

    const refused = await call(null, 'POST', '/api/auth/login', { email: u.email, password: PASSWORD });
    expect(refused.statusCode).toBe(401);
    expect(refused.cookies.find((c) => c.name === 'ev8_session')?.value ?? '').toBe('');

    // Their records and their journal stay: switching off is not deleting.
    const { prisma } = await import('../src/lib/db.js');
    expect(await prisma.user.findUnique({ where: { id: u.id } })).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { entityId: u.id, action: 'user.update' } })).toBeGreaterThan(0);

    // And back on, the same password opens a session again.
    await call(owner, 'PATCH', `/api/users/${u.id}`, { active: true });
    expect((await call(null, 'POST', '/api/auth/login', { email: u.email, password: PASSWORD })).statusCode).toBe(200);
  });

  it('a deactivated user is cut off at once', async () => {
    const u = await makeUser('manager');
    const cookie = await login(u.email);
    const { prisma } = await import('../src/lib/db.js');
    await prisma.user.update({ where: { id: u.id }, data: { active: false } });
    expect((await call(cookie, 'GET', '/api/me')).statusCode).toBe(401);
  });
});

// Wave 6 §3.9. The rules that used to live in a Map and in nobody's test.
describe.skipIf(!HAS_DB)('sign-in, the rules around it', () => {
  it('counts failures in the database, so a restart of the API does not forgive them (crit. 22)', async () => {
    const u = await makeUser('manager');
    const { prisma } = await import('../src/lib/db.js');
    for (let i = 0; i < 9; i++) await call(null, 'POST', '/api/auth/login', { email: u.email, password: 'nope' });
    expect(await prisma.loginAttempt.count({ where: { email: u.email } })).toBe(9);

    // What a restart does to the counter: nothing. The rows are the counter,
    // and the module holds no state a new process would start empty.
    const { loginFailures, MAX_ATTEMPTS } = await import('../src/lib/auth.js');
    expect(await loginFailures(u.email)).toBe(9);
    expect(MAX_ATTEMPTS).toBe(10);

    const tenth = await call(null, 'POST', '/api/auth/login', { email: u.email, password: 'nope' });
    expect(tenth.statusCode).toBe(401);
    // The eleventh is refused before the password is looked at — and the
    // right password is refused too, which is the point of a lock-out.
    const locked = await call(null, 'POST', '/api/auth/login', { email: u.email, password: PASSWORD });
    expect(locked.statusCode).toBe(429);
  });

  it('a failed attempt reaches the journal with the address, the IP and the try — never the password (crit. 18)', async () => {
    const u = await makeUser('manager');
    const { prisma } = await import('../src/lib/db.js');
    await call(null, 'POST', '/api/auth/login', { email: u.email, password: 'hunter2' });
    const row = await prisma.auditLog.findFirst({ where: { action: 'auth.login.failed' }, orderBy: { createdAt: 'desc' } });
    expect(row).not.toBeNull();
    const after = row?.after as { email: string; ip: string | null; attempt: number };
    expect(after.email).toBe(u.email);
    expect(after.attempt).toBe(1);
    expect(JSON.stringify(row)).not.toContain('hunter2');
  });

  it('a signing in that works clears what the failures counted', async () => {
    const u = await makeUser('manager');
    const { prisma } = await import('../src/lib/db.js');
    await call(null, 'POST', '/api/auth/login', { email: u.email, password: 'nope' });
    await login(u.email);
    expect(await prisma.loginAttempt.count({ where: { email: u.email } })).toBe(0);
  });

  it('a session untouched for more than a week signs in again (Q30)', async () => {
    const u = await makeUser('manager');
    const cookie = await login(u.email);
    const { prisma } = await import('../src/lib/db.js');
    const { SESSION_IDLE_MS } = await import('../src/lib/auth.js');
    const token = cookie.split('=')[1];
    // Six days: still open. Eight: over, and the row is gone with it.
    await prisma.session.update({ where: { token }, data: { lastSeenAt: new Date(Date.now() - SESSION_IDLE_MS + 24 * 3600_000) } });
    expect((await call(cookie, 'GET', '/api/me')).statusCode).toBe(200);
    await prisma.session.update({ where: { token }, data: { lastSeenAt: new Date(Date.now() - SESSION_IDLE_MS - 24 * 3600_000) } });
    expect((await call(cookie, 'GET', '/api/me')).statusCode).toBe(401);
    expect(await prisma.session.findUnique({ where: { token } })).toBeNull();
  });

  it('an owner closes every login somebody has (crit. 14)', async () => {
    const owner = await loginAs('owner');
    const u = await makeUser('manager');
    const phone = await login(u.email);
    const laptop = await login(u.email);
    const res = await call(owner, 'POST', `/api/users/${u.id}/sessions/close`);
    expect(res.statusCode).toBe(200);
    expect(json<{ closed: number }>(res).closed).toBe(2);
    expect((await call(phone, 'GET', '/api/me')).statusCode).toBe(401);
    expect((await call(laptop, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('the people screen says when each of them last signed in, and on how many devices', async () => {
    const owner = await loginAs('owner');
    const u = await makeUser('manager');
    await login(u.email);
    const rows = json<{ users: { id: string; sessions: number; lastLoginAt: string | null }[] }>(await call(owner, 'GET', '/api/users')).users;
    const mine = rows.find((r) => r.id === u.id);
    expect(mine?.sessions).toBe(1);
    expect(mine?.lastLoginAt).not.toBeNull();
  });

  // QA-W6-14. The column used to read the live sessions, so closing a session
  // took the answer with it: somebody who signed in twice this morning was
  // shown as "не входил".
  it('remembers a sign-in after every session of that person is closed', async () => {
    const owner = await loginAs('owner');
    const u = await makeUser('manager');
    await login(u.email);
    await call(owner, 'POST', `/api/users/${u.id}/sessions/close`);

    const rows = json<{ users: { id: string; sessions: number; lastLoginAt: string | null; lastSeenAt: string | null }[] }>(await call(owner, 'GET', '/api/users')).users;
    const mine = rows.find((r) => r.id === u.id);
    expect(mine?.sessions).toBe(0);
    expect(mine?.lastSeenAt).toBeNull(); // nothing is open
    expect(mine?.lastLoginAt).not.toBeNull(); // but the journal remembers
  });

  it('says nothing rather than "never" about somebody who has not signed in since the journal began', async () => {
    const owner = await loginAs('owner');
    const u = await makeUser('manager');
    const rows = json<{ users: { id: string; lastLoginAt: string | null }[] }>(await call(owner, 'GET', '/api/users')).users;
    expect(rows.find((r) => r.id === u.id)?.lastLoginAt).toBeNull();
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
