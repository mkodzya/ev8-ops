// One bank line, a week carried over as paid and a fine (Mika, 15.10.2026,
// «А»; ADR-0023). A transfer of 350: 150 is the week the carry-over already
// marked paid, 200 is a fine. Split so, the week stays paid as it was, the
// fine is paid, nothing becomes the customer's credit and nothing pays the
// next week twice; taken back, everything is as it was.
//
// Every name, account and sum here is invented for the test.
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const ACCOUNT = 'GE00BG0000000000000001'; // invented
const HEADER = [
  ',,,"angariSis mflobeli: TEST",,,,',
  `,,,"angariSis #:${ACCOUNT}GEL",,,,`,
  '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
].join('\n');
const dmy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
const row = (day: string, credit: string, text: string, doc: string) => `"${dmy(day)}","${doc}","GE00TB0000000000000002","","${credit}","1","${credit}","${text}"`;
const digits = () => uniq().replace(/\D/g, '');

interface Card {
  rental: { paidThrough: string | null; debtTetri: number };
  periods: { seq: number; paidTetri: number; amountTetri: number; paidBeforeTransfer: boolean }[];
  charges: { id: string; kind: string; amountTetri: number; note: string | null; paidTetri: number }[];
}
interface Targets {
  charges: { id: string; openTetri: number }[];
  carriedWeeks: { id: string; seq: number; amountTetri: number }[];
}

/**
 * A rental brought over three weeks into its life with two weeks paid, and
 * a Bank of Georgia line of each given sum dated in its second week, waiting
 * in the queue.
 */
async function carriedWithLines(amounts: string[]) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Carried ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTC${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
  const tag = `t${digits().slice(-9)}`;
  const customer = await prisma.customer.create({ data: { name: `Test Carried ${tag}` } });
  const owner = await loginAs('owner');
  const pickedUpOn = addDays(todayISO(), -20);
  const res = await call(owner, 'POST', '/api/pickups', {
    customerId: customer.id,
    vehicleId: vehicle.id,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    pickedUpOn,
    nightParkingAddress: 'Test street 1',
    batteries: 2,
    chargers: 2,
    transfer: { paidThrough: addDays(pickedUpOn, 13), depositReceivedTetri: 18000 },
  });
  expect(res.statusCode, res.body).toBe(201);
  const rentalId = json<{ id: string }>(res).id;
  const lineDay = addDays(pickedUpOn, 8);
  const text = [HEADER, ...amounts.map((a, i) => row(lineDay, a, `tankhis gadaritskhva; Details: qira ${tag} ${i}`, `9${digits().slice(-5)}${i}`))].join('\n');
  expect((await call(owner, 'POST', '/api/statements', { fileName: `carried-${tag}.csv`, text })).statusCode).toBe(201);
  const queue = json<{ lines: { id: string; raw: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
  const lineIds = amounts.map((_, i) => queue.lines.find((l) => l.raw.includes(`${tag} ${i}`))!.id);
  expect(lineIds.every(Boolean)).toBe(true);
  const card = async () => json<Card>(await call(owner, 'GET', `/api/rentals/${rentalId}`));
  const targets = async () => json<Targets>(await call(owner, 'GET', `/api/customers/${customer.id}/money-targets`));
  return { prisma, owner, rentalId, customerId: customer.id, pickedUpOn, lineIds, card, targets };
}

describe.skipIf(!HAS_DB)('a fine on a running rental', () => {
  it('an owner charges it with a reason; it joins the debt; one nobody paid can be taken back', async () => {
    const f = await carriedWithLines(['350.00']);
    const before = (await f.card()).rental.debtTetri;
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', `/api/rentals/${f.rentalId}/fines`, { amountTetri: '200', reason: 'damage' })).statusCode).toBe(403);
    const noReason = await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/fines`, { amountTetri: '200' });
    expect(json<{ error: string }>(noReason).error).toBe('missing_field');

    const made = await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/fines`, { amountTetri: '200', reason: 'damage to the moped' });
    expect(made.statusCode, made.body).toBe(201);
    const c = await f.card();
    expect(c.charges).toEqual([expect.objectContaining({ kind: 'fine', amountTetri: 20000, note: 'damage to the moped', paidTetri: 0 })]);
    expect(c.rental.debtTetri).toBe(before + 20000);
    expect(await f.prisma.auditLog.count({ where: { action: 'rental.charge.add', entityId: f.rentalId } })).toBe(1);

    const fineId = c.charges[0]!.id;
    expect(json<{ error: string }>(await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/fines/${fineId}/void`, {})).error).toBe('missing_field');
    expect((await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/fines/${fineId}/void`, { reason: 'charged by mistake' })).statusCode).toBe(200);
    const after = await f.card();
    expect(after.charges).toHaveLength(0);
    expect(after.rental.debtTetri).toBe(before);
  });
});

describe.skipIf(!HAS_DB)('a bank line split onto a carried week and a fine', () => {
  it('150 is the carried week’s money, 200 pays the fine: nothing paid twice, nothing left over, and taken back it is all as before', async () => {
    const f = await carriedWithLines(['350.00', '150.00']);
    const [lineId, otherLineId] = f.lineIds as [string, string];
    expect((await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/fines`, { amountTetri: '200', reason: 'damage' })).statusCode).toBe(201);
    const start = await f.card();
    const t0 = await f.targets();
    const week = t0.carriedWeeks.find((w) => w.seq === 2)!;
    expect(week).toMatchObject({ amountTetri: 15000 });
    const fine = t0.charges[0]!;
    expect(fine.openTetri).toBe(20000);

    // A carried week is paid by exactly its price; a fine by no more than it owes.
    const wrongWeek = await call(f.owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ carriedPeriodId: week.id, grossTetri: 10000 }, { chargeId: fine.id, grossTetri: 25000 }] });
    expect(json<{ error: string }>(wrongWeek).error).toBe('split_carried_week');
    const overFine = await call(f.owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ rentalId: f.rentalId, grossTetri: 10000 }, { chargeId: fine.id, grossTetri: 25000 }] });
    expect(json<{ error: string }>(overFine).error).toBe('split_over_charge');

    const res = await call(f.owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ carriedPeriodId: week.id, grossTetri: 15000 }, { chargeId: fine.id, grossTetri: 20000 }] });
    expect(res.statusCode, res.body).toBe(200);
    const ids = json<{ ids: string[] }>(res).ids;

    const c = await f.card();
    expect(c.rental.paidThrough).toBe(start.rental.paidThrough); // the week was paid already; the next is not
    expect(c.rental.debtTetri).toBe(start.rental.debtTetri - 20000); // only the fine went
    expect(c.charges[0]).toMatchObject({ kind: 'fine', paidTetri: 20000 });
    expect(c.periods.find((p) => p.seq === 2)).toMatchObject({ paidTetri: 15000, paidBeforeTransfer: true });
    expect(c.periods.find((p) => p.seq === 3)).toMatchObject({ paidTetri: 0 });
    // Every tetri of both payments is placed: none is the customer's credit for the night to spend.
    for (const id of ids) {
      const p = await f.prisma.payment.findUniqueOrThrow({ where: { id }, include: { allocations: true } });
      expect(p.allocations.reduce((n, a) => n + a.amountTetri, 0)).toBe(p.grossTetri);
    }
    const t1 = await f.targets();
    expect(t1.carriedWeeks.some((w) => w.id === week.id)).toBe(false);
    expect(t1.charges).toHaveLength(0);
    expect((await f.prisma.rentalPeriod.findUniqueOrThrow({ where: { id: week.id } })).carriedPaymentId).toBe(ids[0]);

    // One week, one bank payment.
    expect((await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/fines`, { amountTetri: '50', reason: 'dirty moped' })).statusCode).toBe(201);
    const fine2 = (await f.targets()).charges[0]!;
    const twice = await call(f.owner, 'POST', `/api/statement-lines/${otherLineId}/split`, { parts: [{ carriedPeriodId: week.id, grossTetri: 10000 }, { chargeId: fine2.id, grossTetri: 5000 }] });
    expect(json<{ error: string }>(twice).error).toBe('week_has_bank_money');
    // A fine with money on it is not taken back.
    expect(json<{ error: string }>(await call(f.owner, 'POST', `/api/rentals/${f.rentalId}/fines/${fine.id}/void`, { reason: 'x' })).error).toBe('fine_paid');

    // Taken back: both parts go, the week is carried as before — still paid — and the fine is open again.
    expect((await call(f.owner, 'POST', `/api/payments/${ids[0]}/undo`, {})).statusCode).toBe(200);
    const undone = await f.card();
    expect(undone.rental.paidThrough).toBe(start.rental.paidThrough);
    expect(undone.periods.find((p) => p.seq === 2)).toMatchObject({ paidTetri: 15000, paidBeforeTransfer: true });
    expect(undone.charges.find((x) => x.id === fine.id)).toMatchObject({ paidTetri: 0 });
    expect((await f.prisma.rentalPeriod.findUniqueOrThrow({ where: { id: week.id } })).carriedPaymentId).toBeNull();
    const queue = json<{ lines: { id: string }[] }>(await call(f.owner, 'GET', '/api/statement-lines'));
    expect(queue.lines.some((l) => l.id === lineId)).toBe(true);
    expect((await f.targets()).carriedWeeks.some((w) => w.id === week.id)).toBe(true);
  });
});
