// Operation keys (build plan Р5, spec B2-01): one tap, one record.
import { describe, expect, it } from 'vitest';
import { HAS_DB, getApp, json, loginAs, uniq } from './helpers.js';

async function post(cookie: string, url: string, payload: unknown, key?: string) {
  const app = await getApp();
  return app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: { cookie, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) },
  });
}

const partsNamed = async (name: string) => {
  const { prisma } = await import('../src/lib/db.js');
  return prisma.part.count({ where: { name } });
};

describe.skipIf(!HAS_DB)('a write sent twice with the same key', () => {
  it('writes once and answers the repeat with the first answer', async () => {
    const owner = await loginAs('owner');
    const name = `Key probe ${uniq()}`;
    const key = `k-${uniq()}`;
    const first = await post(owner, '/api/parts', { name }, key);
    expect(first.statusCode, first.body).toBe(201);
    const again = await post(owner, '/api/parts', { name }, key);
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replay']).toBe('true');
    expect(json<{ id: string }>(again).id).toBe(json<{ id: string }>(first).id);
    expect(await partsNamed(name)).toBe(1);
  });

  it('a double tap arriving together still writes once', async () => {
    const owner = await loginAs('owner');
    const name = `Double tap ${uniq()}`;
    const key = `k-${uniq()}`;
    const [a, b] = await Promise.all([post(owner, '/api/parts', { name }, key), post(owner, '/api/parts', { name }, key)]);
    expect([a.statusCode, b.statusCode].sort()).toEqual(expect.arrayContaining([201]));
    for (const r of [a, b]) {
      if (r.statusCode === 409) expect(json<{ error: string }>(r).error).toBe('operation_in_progress');
      else expect(r.statusCode).toBe(201);
    }
    expect(await partsNamed(name)).toBe(1);
  });

  it('a refusal lets go of the key, so the corrected form saves with it', async () => {
    const owner = await loginAs('owner');
    const taken = `Taken ${uniq()}`;
    expect((await post(owner, '/api/parts', { name: taken })).statusCode).toBe(201);
    const key = `k-${uniq()}`;
    const refused = await post(owner, '/api/parts', { name: taken }, key);
    expect(refused.statusCode).toBe(409);
    const fresh = `Fresh ${uniq()}`;
    const saved = await post(owner, '/api/parts', { name: fresh }, key);
    expect(saved.statusCode, saved.body).toBe(201);
    expect(await partsNamed(fresh)).toBe(1);
  });

  it('refuses the same key on another route, and a key that is not a key', async () => {
    const owner = await loginAs('owner');
    const key = `k-${uniq()}`;
    expect((await post(owner, '/api/parts', { name: `Route ${uniq()}` }, key)).statusCode).toBe(201);
    const other = await post(owner, '/api/locations', { name: `Point ${uniq()}` }, key);
    expect(other.statusCode).toBe(409);
    expect(json<{ error: string }>(other).error).toBe('operation_key_reused');
    const bad = await post(owner, '/api/parts', { name: `Bad ${uniq()}` }, 'no');
    expect(bad.statusCode).toBe(400);
    expect(json<{ error: string }>(bad).error).toBe('bad_operation_key');
  });

  it('is one person\'s key: somebody else may use the same string', async () => {
    const one = await loginAs('owner');
    const two = await loginAs('owner');
    const key = `k-${uniq()}`;
    const a = `Mine ${uniq()}`;
    const b = `Theirs ${uniq()}`;
    expect((await post(one, '/api/parts', { name: a }, key)).statusCode).toBe(201);
    expect((await post(two, '/api/parts', { name: b }, key)).statusCode).toBe(201);
    expect(await partsNamed(b)).toBe(1);
  });

  it('without a key nothing changes: two sends are two writes', async () => {
    const owner = await loginAs('owner');
    const point = `Twice ${uniq()}`;
    expect((await post(owner, '/api/locations', { name: point })).statusCode).toBe(201);
    expect((await post(owner, '/api/locations', { name: `${point} 2` })).statusCode).toBe(201);
  });
});
