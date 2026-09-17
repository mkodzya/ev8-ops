// One card per person (CST-02).
//
// The same personal number or the same phone is the same human being. Odoo
// ended up with the same renter twice because nothing stopped it, and the two
// cards then disagreed about what was owed.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

describe.skipIf(!HAS_DB)('a second card for the same person', () => {
  it('is refused, and the refusal names the card that already exists', async () => {
    const owner = await loginAs('owner');
    const phone = `+99550${uniq().replace(/\D/g, '').slice(-7).padStart(7, '0')}`;
    const personalId = `PID${uniq()}`;

    const first = await call(owner, 'POST', '/api/customers', { name: 'Twin One', phone, personalId });
    expect(first.statusCode).toBe(201);
    const { id } = json<{ id: string }>(first);

    const second = await call(owner, 'POST', '/api/customers', { name: 'Twin Two', phone });
    expect(second.statusCode).toBe(409);
    const body = json<{ error: string; existing: { id: string; name: string } }>(second);
    expect(body.error).toBe('duplicate_customer');
    expect(body.existing.id).toBe(id);
  });

  it('is offered before anybody fills in the rest of the form', async () => {
    const owner = await loginAs('owner');
    const phone = `+99551${uniq().replace(/\D/g, '').slice(-7).padStart(7, '0')}`;
    await call(owner, 'POST', '/api/customers', { name: 'Lookup Target', phone });

    const found = json<{ existing: { name: string } | null }>(
      await call(owner, 'GET', `/api/customers/lookup?phone=${encodeURIComponent(phone)}`),
    );
    expect(found.existing?.name).toBe('Lookup Target');

    const nobody = json<{ existing: unknown }>(await call(owner, 'GET', '/api/customers/lookup?phone=%2B995000000000'));
    expect(nobody.existing).toBeNull();
  });

  it('asks nothing of an empty query', async () => {
    const owner = await loginAs('owner');
    const empty = json<{ existing: unknown }>(await call(owner, 'GET', '/api/customers/lookup'));
    expect(empty.existing).toBeNull();
  });
});

// The customers list shows what each person owes and how many rentals they
// had (wave 1 §3.6). The debt is the rentals list's own figure summed — one
// rule for "owed", read in two places.
describe.skipIf(!HAS_DB)('the customers list', () => {
  it('owes what their rentals owe, counts their rentals, and a new card owes nothing', async () => {
    const owner = await loginAs('owner');
    const phone = `+99552${uniq().replace(/\D/g, '').slice(-7).padStart(7, '0')}`;
    const created = json<{ id: string }>(await call(owner, 'POST', '/api/customers', { name: 'List Newcomer', phone }));

    const { customers } = json<{ customers: { id: string; rentals: number; debtTetri: number; buyer: boolean }[] }>(
      await call(owner, 'GET', '/api/customers'),
    );
    const { rentals } = json<{ rentals: { customer: { id: string }; debtTetri: number }[] }>(await call(owner, 'GET', '/api/rentals'));

    const newcomer = customers.find((c) => c.id === created.id);
    expect(newcomer).toMatchObject({ rentals: 0, debtTetri: 0, buyer: false });

    for (const c of customers) {
      const theirs = rentals.filter((r) => r.customer.id === c.id);
      expect(c.rentals).toBe(theirs.length);
      expect(c.debtTetri).toBe(theirs.reduce((n, r) => n + r.debtTetri, 0));
    }
  });
});
