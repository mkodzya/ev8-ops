// A wrong address is "no such record", never "something broke" (B1-02).
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs } from './helpers.js';

describe.skipIf(!HAS_DB)('a record address that is not an id', () => {
  it.each(['/api/sales/new', '/api/rentals/new', '/api/fleet/not-a-uuid', '/api/customers/123', '/api/purchases/x', '/api/service/new', '/api/parts/new', '/api/models/new'])(
    '%s answers 404 not_found',
    async (url) => {
      const owner = await loginAs('owner');
      const res = await call(owner, 'GET', url);
      expect(res.statusCode, res.body).toBe(404);
      expect(json<{ error: string }>(res).error).toMatch(/not_found$/);
    },
  );

  it('still says which record is missing when the id is well-formed', async () => {
    const owner = await loginAs('owner');
    const res = await call(owner, 'GET', '/api/sales/00000000-0000-0000-0000-000000000000');
    expect(res.statusCode).toBe(404);
    expect(json<{ error: string }>(res).error).toBe('sale_not_found');
  });
});
