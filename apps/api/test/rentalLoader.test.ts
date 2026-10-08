// Running rentals brought over from a list (lib/rentalLoader.ts): checked
// whole, written all together through the wizard's own `pickUp`, and safe to
// run twice. Needs a *_test database. Every name here is made up.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { exitCodeOf, formatLoadReport, loadRentals, type LoadReport } from '../src/lib/rentalLoader.js';
import { HAS_DB, call, loginAs, makeUser, uniq } from './helpers.js';

const today = () => todayISO();
const digits = () => uniq().replace(/\D/g, '');

interface Pair {
  customer: { id: string; name: string; phone: string; personalId: string };
  vehicle: { id: string; vin: string };
  lead: string;
}

/** A customer card that names a Kommo deal, and a free moped. */
async function pair(opts: { pool?: 'rent' | 'sale' | null } = {}): Promise<Pair> {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Loader ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTL${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, pool: opts.pool === undefined ? 'rent' : opts.pool } });
  const lead = `7${digits().slice(-9)}`;
  const phone = `+9955${digits().slice(-8)}`;
  const personalId = digits().slice(-11);
  const customer = await prisma.customer.create({
    data: { name: `ТЕСТ Перенос ${uniq()}`, phone, personalId, kommoRef: `https://ev8mopeds.kommo.com/leads/detail/${lead}` },
  });
  return { customer: { id: customer.id, name: customer.name, phone, personalId }, vehicle: { id: vehicle.id, vin: vehicle.vin }, lead };
}

const ADDRESS = 'ТЕСТ улица Ночная, 7';

/** A row as the list writes it: handed over 30 days ago, four weeks of five paid, deposit received. */
function row(p: Pair, label: string, over: Record<string, unknown> = {}) {
  const pickedUpOn = addDays(today(), -30);
  return {
    label,
    kommoLead: p.lead,
    vin: p.vehicle.vin,
    pickedUpOn,
    weeklyRateTetri: 15000,
    depositTetri: 18000,
    depositReceivedTetri: 18000,
    paidThrough: addDays(pickedUpOn, 27),
    nightParkingAddress: ADDRESS,
    batteries: null,
    chargers: null,
    note: 'ТЕСТ Перенесена как состояние на дату.',
    ...over,
  };
}

const run = (rows: unknown, ownerEmail: string, commit: boolean) => loadRentals({ text: JSON.stringify(rows), ownerEmail, commit });

async function rentalsOf(...pairs: Pair[]) {
  const { prisma } = await import('../src/lib/db.js');
  return prisma.rental.findMany({
    where: { customerId: { in: pairs.map((p) => p.customer.id) } },
    include: { periods: { orderBy: { seq: 'asc' } }, deposit: true, vehicle: true },
    orderBy: { createdAt: 'asc' },
  });
}

/** Nothing of these pairs was written: no rental, the mopeds free, no journal entry by this owner. */
async function expectUntouched(ownerId: string, ...pairs: Pair[]) {
  const { prisma } = await import('../src/lib/db.js');
  expect(await rentalsOf(...pairs)).toHaveLength(0);
  const mopeds = await prisma.vehicle.findMany({ where: { id: { in: pairs.map((p) => p.vehicle.id) } } });
  expect(mopeds.every((m) => m.state === 'available' && m.currentRentalId === null)).toBe(true);
  expect(await prisma.auditLog.count({ where: { actorId: ownerId } })).toBe(0);
}

const verdicts = (r: LoadReport) => r.rows.map((x) => x.verdict);

describe.skipIf(!HAS_DB)('rentals brought over from a list', () => {
  it('a check writes nothing, and says what would be written', async () => {
    const owner = await makeUser('owner');
    const [a, b] = [await pair(), await pair()];
    const report = await run([row(a, '№1'), row(b, '№2')], owner.email, false);

    expect(report).toMatchObject({ mode: 'check', refused: null, written: 0 });
    expect(verdicts(report)).toEqual(['ready', 'ready']);
    expect(report.rows[0]).toMatchObject({ label: '№1', customerName: a.customer.name, vinTail: `…${a.vehicle.vin.slice(-6)}`, rentalNumber: null });
    expect(exitCodeOf(report)).toBe(0);
    await expectUntouched(owner.id, a, b);
  });

  it('a commit writes each rental as the wizard would: weeks paid before the transfer, deposit received, moped rented and in the rent park, the journal entry', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await makeUser('owner');
    // One moped nobody has given a park yet, as the stand's fleet arrived.
    const [a, b] = [await pair({ pool: null }), await pair()];
    const pickedUpOn = addDays(today(), -30);
    const report = await run([row(a, '№1'), row(b, '№2', { paidThrough: null, depositReceivedTetri: 0, batteries: 2, chargers: 2, note: null })], owner.email, true);

    expect(report).toMatchObject({ mode: 'commit', refused: null, written: 2 });
    expect(verdicts(report)).toEqual(['written', 'written']);
    expect(exitCodeOf(report)).toBe(0);

    const [ra, rb] = await rentalsOf(a, b);
    expect(report.rows.map((r) => r.rentalNumber)).toEqual([ra!.number, rb!.number]);

    // №1: five weeks by today, four of them paid before the transfer; deposit in full.
    expect(ra).toMatchObject({ status: 'active', weeklyRateTetri: 15000, depositTetri: 18000, nightParkingAddress: ADDRESS, batteries: null, chargers: null, transferredById: owner.id, createdById: owner.id });
    expect(ra!.notes).toBe('ТЕСТ Перенесена как состояние на дату.');
    expect(ra!.pickedUpOn?.toISOString().slice(0, 10)).toBe(pickedUpOn);
    expect(ra!.transferredAt).toBeTruthy();
    expect(ra!.periods).toHaveLength(5);
    expect(ra!.periods.map((p) => p.paidBeforeTransfer)).toEqual([true, true, true, true, false]);
    expect(ra!.periods.map((p) => p.paidTetri)).toEqual([15000, 15000, 15000, 15000, 0]);
    expect(ra!.paidThrough?.toISOString().slice(0, 10)).toBe(addDays(pickedUpOn, 27));
    expect(ra!.deposit).toMatchObject({ amountTetri: 18000, receivedBeforeTransferTetri: 18000, paidTetri: 18000, status: 'held' });
    expect(ra!.vehicle).toMatchObject({ state: 'rented', pool: 'rent', currentRentalId: ra!.id });

    // №2: nothing paid, nothing of the deposit received, the kit as the contract says.
    expect(rb).toMatchObject({ batteries: 2, chargers: 2, notes: null, paidThrough: null });
    expect(rb!.periods.every((p) => !p.paidBeforeTransfer && p.paidTetri === 0)).toBe(true);
    expect(rb!.deposit).toMatchObject({ receivedBeforeTransferTetri: 0, paidTetri: 0 });

    for (const r of [ra!, rb!]) {
      const entries = await prisma.auditLog.findMany({ where: { entityId: r.id, action: 'rental.transfer' } });
      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorId).toBe(owner.id);
      expect(await prisma.act.count({ where: { rentalId: r.id, kind: 'pickup' } })).toBe(1);
      expect(await prisma.vehicleEvent.count({ where: { rentalId: r.id, kind: 'pickup' } })).toBe(1);
      // Brought over, not paid here: no money entered the till with it.
      expect(await prisma.payment.count({ where: { rentalId: r.id } })).toBe(0);
    }
    // The moped with no park was moved into the rent park, and the journal of the moped says so.
    expect(await prisma.vehicleEvent.count({ where: { vehicleId: a.vehicle.id, kind: 'to_rent' } })).toBe(1);
  });

  it('a second run skips what is already here, and a list that grew writes only the new rows', async () => {
    const owner = await makeUser('owner');
    const [a, b, c] = [await pair(), await pair(), await pair()];
    const first = await run([row(a, '№1'), row(b, '№2')], owner.email, true);
    expect(first.written).toBe(2);

    const again = await run([row(a, '№1'), row(b, '№2')], owner.email, true);
    expect(verdicts(again)).toEqual(['exists', 'exists']);
    expect(again.written).toBe(0);
    expect(again.rows.map((r) => r.rentalNumber)).toEqual(first.rows.map((r) => r.rentalNumber));
    expect(exitCodeOf(again)).toBe(0);
    expect(await rentalsOf(a, b)).toHaveLength(2);

    const grown = await run([row(a, '№1'), row(b, '№2'), row(c, '№3')], owner.email, true);
    expect(verdicts(grown)).toEqual(['exists', 'exists', 'written']);
    expect(grown.written).toBe(1);
    expect(await rentalsOf(a, b, c)).toHaveLength(3);
  });

  const BAD: [string, (p: Pair) => Record<string, unknown>, RegExp][] = [
    ['an unknown VIN', () => ({ vin: 'TESTLNOSUCHMOPED00' }), /мопеда с таким VIN на стенде нет/],
    ['a paid-through that is not the last day of a week', (p) => ({ paidThrough: addDays(row(p, '').pickedUpOn, 10) }), /не последний день недели/],
    ['a paid-through beyond the current week', (p) => ({ paidThrough: addDays(row(p, '').pickedUpOn, 41) }), /дальше текущей недели/],
    ['no night parking address', () => ({ nightParkingAddress: '  ' }), /нет адреса ночной парковки/],
    ['a deal no card names', () => ({ kommoLead: '1' }), /карточки клиента со сделкой Kommo 1 на стенде нет/],
    ['a hand-over dated today', () => ({ pickedUpOn: today(), paidThrough: null }), /не раньше сегодняшнего дня/],
    ['more deposit received than the deposit', () => ({ depositReceivedTetri: 18001 }), /получено залога больше/],
    ['a rate written as text', () => ({ weeklyRateTetri: '150' }), /weeklyRateTetri/],
    ['a mistyped field name', () => ({ paidTrough: null }), /незнакомое поле paidTrough/],
    ['the word the notes do not carry', () => ({ note: 'ТЕСТ из Odoo' }), /Odoo/],
  ];

  it.each(BAD)('one bad row — %s — and nothing at all is written', async (_name, over, says) => {
    const owner = await makeUser('owner');
    const [good, bad] = [await pair(), await pair()];
    const report = await run([row(good, '№1'), row(bad, '№2', over(bad))], owner.email, true);

    expect(verdicts(report)).toEqual(['ready', 'problem']);
    expect(report.rows[1]!.problems.join('; ')).toMatch(says);
    expect(report.written).toBe(0);
    expect(exitCodeOf(report)).toBe(1);
    expect(formatLoadReport(report)).toMatch(/Ничего не записано/);
    await expectUntouched(owner.id, good, bad);
  });

  it('a row with a field left out is a problem, not an empty value', async () => {
    const owner = await makeUser('owner');
    const p = await pair();
    const { paidThrough: _omitted, ...short } = row(p, '№1');
    const report = await run([short], owner.email, true);
    expect(report.rows[0]!.problems).toContain('нет поля paidThrough');
    await expectUntouched(owner.id, p);
  });

  it('refuses what the wizard leaves to an owner’s decision: a moped of the sale park, a busy moped, a customer who owes', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await makeUser('owner');
    const [inSale, busy, owes, spare] = [await pair({ pool: 'sale' }), await pair(), await pair(), await pair()];
    await prisma.vehicle.update({ where: { id: busy.vehicle.id }, data: { state: 'service' } });
    // A rental of three unpaid weeks on another moped, entered by somebody else.
    const res = await call(await loginAs('owner'), 'POST', '/api/rentals', { customerId: owes.customer.id, vehicleId: spare.vehicle.id, weeklyRateTetri: 15000, pickedUpOn: addDays(today(), -21) });
    expect(res.statusCode, res.body).toBe(201);

    const report = await run([row(inSale, '№1'), row(busy, '№2'), row(owes, '№3')], owner.email, true);
    expect(verdicts(report)).toEqual(['problem', 'problem', 'problem']);
    expect(report.rows[0]!.problems.join()).toMatch(/в парке продажи/);
    expect(report.rows[1]!.problems.join()).toMatch(/не свободен: в ремонте/);
    expect(report.rows[2]!.problems.join()).toMatch(/числится долг/);
    await expectUntouched(owner.id, inSale);
    expect(await rentalsOf(busy)).toHaveLength(0);
    expect(await rentalsOf(owes)).toHaveLength(1);
  });

  it('refuses a deal two cards name, and a VIN or a deal written twice in the list', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await makeUser('owner');
    const [a, b, c] = [await pair(), await pair(), await pair()];
    const twin = await prisma.customer.create({ data: { name: `ТЕСТ Двойник ${uniq()}`, kommoRef: a.lead } });

    const twoCards = await run([row(a, '№1')], owner.email, true);
    expect(twoCards.rows[0]!.problems.join()).toMatch(/больше одной карточки/);
    // A card that was merged away or archived does not count: the deal has one card again.
    await prisma.customer.update({ where: { id: twin.id }, data: { archived: true } });
    expect(verdicts(await run([row(a, '№1')], owner.email, false))).toEqual(['ready']);

    const twice = await run([row(b, '№2'), row(c, '№3', { vin: b.vehicle.vin }), row(c, '№4', { kommoLead: b.lead })], owner.email, true);
    expect(verdicts(twice)).toEqual(['problem', 'problem', 'problem']);
    expect(twice.rows[0]!.problems.join()).toMatch(/VIN повторяется в списке: ещё в «№3».*сделка Kommo повторяется в списке: ещё в «№4»/);
    await expectUntouched(owner.id, a, b, c);
  });

  it('writes all the rows or none: a refusal half-way leaves nothing behind', async () => {
    const owner = await makeUser('owner');
    const [a, b] = [await pair(), await pair()];
    // Passes every check of the list and is refused by the database: more batteries than a column can count.
    const report = await run([row(a, '№1'), row(b, '№2', { batteries: 3_000_000_000 })], owner.email, true);

    expect(verdicts(report)).toEqual(['ready', 'failed']);
    expect(report.written).toBe(0);
    expect(exitCodeOf(report)).toBe(3);
    const text = formatLoadReport(report);
    expect(text).toMatch(/ОТКАЗ/);
    expect(text).toMatch(/Не записано ничего/);
    expect(text).not.toContain(ADDRESS);
    await expectUntouched(owner.id, a, b);
  });

  it('is refused for anybody but an owner, in either mode', async () => {
    const manager = await makeUser('manager');
    const p = await pair();
    for (const commit of [false, true]) {
      const report = await run([row(p, '№1')], manager.email, commit);
      expect(report.refused).toMatch(/не владелец/);
      expect(report.rows).toHaveLength(0);
      expect(exitCodeOf(report)).toBe(2);
    }
    expect((await run([row(p, '№1')], `nobody.${uniq()}@test.ev8`, true)).refused).toMatch(/на стенде нет/);
    expect((await run([row(p, '№1')], '', true)).refused).toMatch(/e-mail владельца/);
    await expectUntouched(manager.id, p);
  });

  it('refuses a list it cannot read', async () => {
    const owner = await makeUser('owner');
    const load = (text: string) => loadRentals({ text, ownerEmail: owner.email, commit: true });
    expect((await load('')).refused).toMatch(/пуст/);
    expect((await load('{ not json')).refused).toMatch(/не JSON/);
    expect((await load('{"rentals": []}')).refused).toMatch(/перечень/);
    expect((await load('[]')).refused).toMatch(/ни одной аренды/);
    expect((await load('["№1"]')).rows[0]!.problems).toContain('это не запись с полями');
  });

  it('reports the label, the end of the VIN and the customer’s name — and no phone, personal number, address or note', async () => {
    const owner = await makeUser('owner');
    const [a, b] = [await pair(), await pair()];
    const rows = [row(a, '№1'), row(b, '№2', { paidThrough: null, depositReceivedTetri: 0 })];
    const check = formatLoadReport(await run(rows, owner.email, false));
    const written = await run(rows, owner.email, true);
    const commit = formatLoadReport(written);
    const again = formatLoadReport(await run(rows, owner.email, true));

    expect(check).toMatch(/проверка, без записи/);
    expect(check).toContain(`№1  …${a.vehicle.vin.slice(-6)}  ${a.customer.name} — готова: `);
    expect(check).toMatch(/оплачено по \d\d\.\d\d\.\d{4}, залог 180\s₾ из 180\s₾, неоплаченных недель на сегодня: 1 \(150\s₾\)/);
    expect(check).toMatch(/не оплачено ничего, залог 0\s₾ из 180\s₾, неоплаченных недель на сегодня: 5 \(750\s₾\)/);
    expect(check).toMatch(/Итого строк: 2\. готовы — 2, уже есть — 0, с проблемой — 0\./);
    expect(check).toMatch(/Ничего не записано — это была проверка; к записи готово: 2\./);
    expect(commit).toContain(`${a.customer.name} — записана: ${written.rows[0]!.rentalNumber} (`);
    expect(commit).toMatch(/Записано аренд: 2\./);
    expect(again).toContain(`${b.customer.name} — уже есть: ${written.rows[1]!.rentalNumber}`);
    expect(again).toMatch(/Все аренды из списка уже на стенде\. Ничего не записано\./);

    for (const text of [check, commit, again]) {
      for (const p of [a, b]) {
        for (const secret of [p.customer.phone, p.customer.personalId, p.vehicle.vin, p.lead]) expect(text).not.toContain(secret);
      }
      expect(text).not.toContain(ADDRESS);
      expect(text).not.toContain('Перенесена как состояние');
    }
  });

  it('runs from the command line: the list on standard input, check by default, --commit to write', async () => {
    const owner = await makeUser('owner');
    const p = await pair();
    const cli = (args: string[], input: string) =>
      spawnSync('npx', ['tsx', 'src/loadRentals.ts', ...args], { cwd: fileURLToPath(new URL('..', import.meta.url)), input, encoding: 'utf8', env: process.env, timeout: 60_000 });
    const list = JSON.stringify([row(p, '№1')]);

    const check = cli(['--owner', owner.email], list);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toMatch(/проверка, без записи/);
    expect(check.stdout).toContain(`${p.customer.name} — готова: `);
    await expectUntouched(owner.id, p);

    // A mistyped flag is refused, not read as a check; nor is a bad list written.
    expect(cli(['--owner', owner.email, '--comit'], list).status).toBe(2);
    expect(cli(['--owner', owner.email, '--commit'], JSON.stringify([row(p, '№1', { nightParkingAddress: '' })])).status).toBe(1);
    await expectUntouched(owner.id, p);

    const commit = cli(['--owner', owner.email, '--commit'], list);
    expect(commit.status, commit.stderr).toBe(0);
    expect(commit.stdout).toMatch(/Записано аренд: 1\./);
    expect(await rentalsOf(p)).toHaveLength(1);
  }, 120_000);
});
