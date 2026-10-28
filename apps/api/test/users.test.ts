// The team's logins (spec §3). The owner creates them, the role decides
// what they may do, and a system nobody can administer cannot be reached
// by one click.
import { describe, expect, it } from 'vitest';
import { HAS_DB, PASSWORD, call, json, login, loginAs, makeUser, uniq } from './helpers.js';

describe.skipIf(!HAS_DB)('users', () => {
  it('the owner creates a login and the new person can sign in with the role they were given', async () => {
    const owner = await loginAs('owner');
    const email = `kardu.${uniq()}@test.ev8`;
    const created = await call(owner, 'POST', '/api/users', { email, name: 'Test Manager', role: 'manager', password: 'let-me-in-1' });
    expect(created.statusCode, created.body).toBe(201);

    const theirs = await login(email, 'let-me-in-1');
    const me = json<{ role: string; permissions: string[] }>(await call(theirs, 'GET', '/api/me'));
    expect(me.role).toBe('manager');
    expect(me.permissions).toContain('cash.record');
    expect(me.permissions).not.toContain('payments.reconcile');
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
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', '/api/users')).statusCode).toBe(403);
    expect((await call(manager, 'POST', '/api/users', { email: `x.${uniq()}@t.ev8`, name: 'X', role: 'manager', password: 'long-enough-1' })).statusCode).toBe(403);
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
    expect((await call(owner, 'PATCH', `/api/users/${person.id}`, { role: 'owner' })).statusCode).toBe(200);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { entityId: person.id, action: 'user.update' } });
    expect(entry.before).toMatchObject({ role: 'manager' });
    expect(entry.after).toMatchObject({ role: 'owner' });
  });

  it('no route ever answers with a password hash', async () => {
    const owner = await loginAs('owner');
    const body = (await call(owner, 'GET', '/api/users')).body;
    expect(body).not.toMatch(/passwordHash|password_hash|s2:/);
  });
});

// GitHub issue #17, item 5 (ADR-0049): a login nobody ever signed in with and
// to which nothing is recorded is deleted, and its email is free again;
// everybody else is only switched off. Every name and address here is made up.
describe.skipIf(!HAS_DB)('deleting a login nobody used (issue #17)', () => {
  type Row = { id: string; email: string | null; deletable: boolean };
  const list = async (owner: string) => json<{ users: Row[] }>(await call(owner, 'GET', '/api/users')).users;
  const err = (res: { body: string }) => json<{ error: string; what?: string[] }>(res);

  it('the owner deletes a login made with a typo, the journal keeps whose, and the email can be used again', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const email = `typo.${uniq()}@test.ev8`;
    const made = await call(owner, 'POST', '/api/users', { email, name: 'Test Typo', role: 'manager', password: 'long-enough-1' });
    expect(made.statusCode, made.body).toBe(201);
    const { id } = json<{ id: string }>(made);
    expect((await list(owner)).find((u) => u.id === id)?.deletable).toBe(true);

    const res = await call(owner, 'DELETE', `/api/users/${id}`);
    expect(res.statusCode, res.body).toBe(200);
    expect(await prisma.user.findUnique({ where: { id } })).toBeNull();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: 'user.delete', entityId: id } });
    expect(log.before).toMatchObject({ name: 'Test Typo', email, role: 'manager' });
    expect(log.actorId).not.toBeNull();

    // The address is free: a new login with it is not a duplicate.
    expect((await call(owner, 'POST', '/api/users', { email, name: 'Test Again', role: 'manager', password: 'long-enough-1' })).statusCode).toBe(201);
    expect((await call(owner, 'DELETE', `/api/users/${id}`)).statusCode).toBe(404);
  });

  it('somebody who signed in is only switched off — the owner too, about themselves', async () => {
    const owner = await loginAs('owner');
    const used = await makeUser('manager');
    await login(used.email);
    expect((await list(owner)).find((u) => u.id === used.id)?.deletable).toBe(false);
    expect(err(await call(owner, 'DELETE', `/api/users/${used.id}`)).error).toBe('user_signed_in');
    const me = json<{ id: string }>(await call(owner, 'GET', '/api/me'));
    expect(err(await call(owner, 'DELETE', `/api/users/${me.id}`)).error).toBe('user_signed_in');
  });

  it('somebody to whom anything is recorded is only switched off, whichever table records it', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    // A point written down by them: a relation the schema names.
    const author = await makeUser('manager');
    await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}`, createdById: author.id } });
    expect((await list(owner)).find((u) => u.id === author.id)?.deletable).toBe(false);
    expect(err(await call(owner, 'DELETE', `/api/users/${author.id}`))).toMatchObject({ error: 'user_has_records', what: ['locations'] });
    // A category made by them: a column with a foreign key and no relation in the schema — the database refuses it.
    const other = await makeUser('manager');
    await prisma.expenseCategory.create({ data: { nameRu: `ТЕСТ категория ${uniq()}`, createdById: other.id } });
    expect(err(await call(owner, 'DELETE', `/api/users/${other.id}`)).error).toBe('user_has_records');
    expect(await prisma.user.findUnique({ where: { id: other.id } })).not.toBeNull();
  });

  it('only an owner deletes', async () => {
    const manager = await loginAs('manager');
    const nobody = await makeUser('manager');
    expect((await call(manager, 'DELETE', `/api/users/${nobody.id}`)).statusCode).toBe(403);
  });

  it('no foreign key to a person deletes or empties what it points from — only sessions and operation keys go with them', async () => {
    const { prisma } = await import('../src/lib/db.js');
    // A table added tomorrow with ON DELETE SET NULL or CASCADE would let a
    // deletion wipe what is recorded to a person; this names it.
    const rows = await prisma.$queryRaw<{ tbl: string; action: string }[]>`
      SELECT c.conrelid::regclass::text AS tbl, c.confdeltype::text AS action
      FROM pg_constraint c
      WHERE c.contype = 'f' AND c.confrelid = 'users'::regclass AND c.confdeltype NOT IN ('a', 'r')`;
    expect(rows.map((r) => `${r.tbl}:${r.action}`).sort()).toEqual(['operation_keys:c', 'sessions:c']);
  });
});
