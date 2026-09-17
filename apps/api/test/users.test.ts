// The team's logins (spec §3). The owner creates them, the role decides
// what they may do, and a system nobody can administer cannot be reached
// by one click.
import { describe, expect, it } from 'vitest';
import { HAS_DB, PASSWORD, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

describe.skipIf(!HAS_DB)('users', () => {
  it('the owner creates a login and the new person can sign in with the role they were given', async () => {
    const owner = await loginAs('owner');
    const email = `kardu.${uniq()}@test.ev8`;
    const created = await call(owner, 'POST', '/api/users', { email, name: 'Test Director', role: 'director', password: 'let-me-in-1' });
    expect(created.statusCode, created.body).toBe(201);

    const theirs = await login(email, 'let-me-in-1');
    const me = json<{ role: string; permissions: string[] }>(await call(theirs, 'GET', '/api/me'));
    expect(me.role).toBe('director');
    expect(me.permissions).toContain('payments.reconcile');
    expect(me.permissions).not.toContain('users.manage');
  });

  it('refuses a short password and a second login on one email', async () => {
    const owner = await loginAs('owner');
    const email = `twin.${uniq()}@test.ev8`;
    expect((await call(owner, 'POST', '/api/users', { email, name: 'X', role: 'manager', password: 'short' })).statusCode).toBe(400);
    expect((await call(owner, 'POST', '/api/users', { email, name: 'X', role: 'manager', password: 'long-enough-1' })).statusCode).toBe(201);
    const again = await call(owner, 'POST', '/api/users', { email, name: 'Y', role: 'manager', password: 'long-enough-1' });
    expect(again.statusCode).toBe(409);
    expect(json<{ error: string }>(again).error).toBe('duplicate_email');
  });

  it('nobody but an owner sees or changes the list', async () => {
    const director = await loginAs('director');
    expect((await call(director, 'GET', '/api/users')).statusCode).toBe(403);
    expect((await call(director, 'POST', '/api/users', { email: `x.${uniq()}@t.ev8`, name: 'X', role: 'manager', password: 'long-enough-1' })).statusCode).toBe(403);
  });

  it('switching somebody off ends their session at once', async () => {
    const owner = await loginAs('owner');
    const victim = await makeUser('manager');
    const theirs = await login(victim.email);
    expect((await call(theirs, 'GET', '/api/me')).statusCode).toBe(200);
    expect((await call(owner, 'PATCH', `/api/users/${victim.id}`, { active: false })).statusCode).toBe(200);
    expect((await call(theirs, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('the last active owner cannot be demoted or switched off', async () => {
    const { prisma } = await import('../src/lib/db.js');
    // The suites create their own owners, so make this one the only active one.
    const only = await makeUser('owner');
    const cookie = await login(only.email);
    await prisma.user.updateMany({ where: { role: 'owner', id: { not: only.id } }, data: { active: false } });

    const demote = await call(cookie, 'PATCH', `/api/users/${only.id}`, { role: 'manager' });
    expect(demote.statusCode).toBe(409);
    expect(json<{ error: string }>(demote).error).toBe('last_owner');
    expect((await call(cookie, 'PATCH', `/api/users/${only.id}`, { active: false })).statusCode).toBe(409);

    // With a second owner around, the first may step down.
    const second = await makeUser('owner');
    expect((await call(cookie, 'PATCH', `/api/users/${only.id}`, { role: 'manager' })).statusCode).toBe(200);
    await prisma.user.update({ where: { id: second.id }, data: { active: false } });
  });

  it('changing your own password needs the current one, and the owner can reset it without knowing it', async () => {
    const person = await makeUser('manager');
    const theirs = await login(person.email);
    expect((await call(theirs, 'POST', '/api/me/password', { currentPassword: 'wrong', newPassword: 'brand-new-1' })).statusCode).toBe(409);
    expect((await call(theirs, 'POST', '/api/me/password', { currentPassword: PASSWORD, newPassword: 'brand-new-1' })).statusCode).toBe(200);
    await login(person.email, 'brand-new-1');

    const owner = await loginAs('owner');
    expect((await call(owner, 'POST', `/api/users/${person.id}/password`, { password: 'owner-set-it-1' })).statusCode).toBe(200);
    await login(person.email, 'owner-set-it-1');
    // The reset ended the old session too.
    expect((await call(theirs, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('a new password of your own signs out every other device and keeps this one', async () => {
    const person = await makeUser('manager');
    const laptop = await login(person.email);
    const phone = await login(person.email);
    expect((await call(phone, 'POST', '/api/me/password', { currentPassword: PASSWORD, newPassword: 'left-it-on-a-bus-1' })).statusCode).toBe(200);
    expect((await call(phone, 'GET', '/api/me')).statusCode).toBe(200);
    expect((await call(laptop, 'GET', '/api/me')).statusCode).toBe(401);
  });

  it('a role change is journaled with what it was and what it became', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const person = await makeUser('manager');
    expect((await call(owner, 'PATCH', `/api/users/${person.id}`, { role: 'director' })).statusCode).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: person.id, action: 'user.update' } });
    expect(entry.before).toMatchObject({ role: 'manager' });
    expect(entry.after).toMatchObject({ role: 'director' });
  });

  it('no route ever answers with a password hash', async () => {
    const owner = await loginAs('owner');
    const body = (await call(owner, 'GET', '/api/users')).body;
    expect(body).not.toMatch(/passwordHash|password_hash|s2:/);
  });
});
