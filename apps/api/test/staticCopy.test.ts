// The static part of a stand carried to another (lib/staticCopy.ts): written
// out by one stand, read in by the other, through the command line as on the
// server. The "other stand" is a second, empty database made for this run and
// dropped after it. Needs a *_test database. Every name here is made up.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STATIC_VERSION, planStatic, readStatic, type StaticRow, type StaticSet } from '../src/lib/staticCopy.js';
import { HAS_DB, uniq } from './helpers.js';

const digits = () => uniq().replace(/\D/g, '');

describe('what bringing static rows to a stand would do', () => {
  const model = (over: Partial<StaticRow> = {}): StaticRow => ({ id: 'm1', brand: 'Test', name: 'One', salePriceTetri: null, weeklyRateTetri: 15000, costTetri: null, forSale: true, forRent: true, photoUrl: null, notes: null, odooSaleProductId: null, odooRentalProductId: null, odooFleetModelId: null, archived: false, ...over });
  const point = (over: Partial<StaticRow> = {}): StaticRow => ({ id: 'l1', name: 'ТЕСТ Точка', kind: 'showroom', note: null, sortOrder: 0, archived: false, ...over });
  const card = (over: Partial<StaticRow> = {}): StaticRow => ({ id: 'c1', name: 'ТЕСТ Клиент', nameKa: null, nameLat: null, personalId: '01001000001', phone: null, email: null, kind: 'person', recordKind: 'client', source: null, tags: [], address: null, notes: null, country: null, contactPerson: null, channel: null, goods: null, bank: null, kommoRef: 'https://ev8mopeds.kommo.com/leads/detail/777', odooPartnerId: null, ...over });
  const moped = (over: Partial<StaticRow> = {}): StaticRow => ({ id: 'v1', vin: 'TESTVIN0000000001', modelId: 'm1', color: null, year: null, arrivedOn: null, pool: 'rent', locationId: 'l1', odometerKm: null, notes: null, costTetri: null, odooFleetId: null, odooLotId: null, archived: false, ...over });
  const set = (over: Partial<Record<'models' | 'locations' | 'customers' | 'vehicles', StaticRow[]>> = {}) => ({ models: [model()], locations: [point()], customers: [card()], vehicles: [moped()], ...over });
  const none = { models: [], locations: [], customers: [], vehicles: [] };
  const verdicts = (p: ReturnType<typeof planStatic>) => p.map((r) => r.verdict);

  it('adds everything to an empty stand, and finds it all there the second time', () => {
    expect(verdicts(planStatic(set(), none, false))).toEqual(['create', 'create', 'create', 'create']);
    expect(verdicts(planStatic(set(), set(), false))).toEqual(['same', 'same', 'same', 'same']);
  });

  it('brings a row that differs up to date — until the stand has rentals, and then leaves it alone', () => {
    const changed = set({ customers: [card({ phone: '+995500000001' })], vehicles: [moped({ pool: 'sale', color: 'black' })] });
    const before = planStatic(changed, set(), false);
    expect(verdicts(before)).toEqual(['same', 'same', 'update', 'update']);
    expect(before[2]!.changed).toEqual(['phone']);
    expect(before[3]!.changed).toEqual(['color', 'pool']);
    expect(verdicts(planStatic(changed, set(), true))).toEqual(['same', 'same', 'kept', 'kept']);
    // A row that is new is added either way.
    expect(verdicts(planStatic(set({ customers: [card(), card({ id: 'c2', personalId: null, kommoRef: null })] }), set(), true))).toEqual(['same', 'same', 'same', 'create', 'same']);
  });

  it('refuses a row the stand already holds under another id', () => {
    const there = { models: [model({ id: 'mX', brand: 'TEST', name: 'one' })], locations: [point({ id: 'lX', name: 'тест точка' })], customers: [card({ id: 'cX' })], vehicles: [moped({ id: 'vX', modelId: 'mX', locationId: 'lX' })] };
    const plan = planStatic(set(), there, false);
    expect(verdicts(plan)).toEqual(['problem', 'problem', 'problem', 'problem']);
    expect(plan.map((p) => p.problem)).toEqual([
      'на этом стенде такая модель уже заведена отдельно',
      'на этом стенде точка с таким названием уже заведена отдельно',
      'на этом стенде уже есть другая карточка с тем же личным номером',
      'на этом стенде мопед с таким VIN уже заведён отдельно',
    ]);
    // The same deal on another card is the same customer too.
    expect(planStatic(set({ customers: [card({ personalId: null, kommoRef: '777' })] }), { ...none, customers: [card({ id: 'cX', personalId: null })] }, false)[2]!.problem).toMatch(/сделкой Kommo/);
  });

  it('refuses a moped whose model or point comes from nowhere', () => {
    expect(planStatic(set({ models: [] }), none, false).at(-1)!.problem).toMatch(/модели нет/);
    expect(planStatic(set({ locations: [] }), none, false).at(-1)!.problem).toMatch(/точки нет/);
    expect(planStatic(set({ models: [], locations: [] }), { ...none, models: [model()], locations: [point()] }, false).at(-1)!.verdict).toBe('create');
  });
});

describe.skipIf(!HAS_DB)('static rows carried from one stand to another', () => {
  const api = fileURLToPath(new URL('..', import.meta.url));
  const urlOf = (name: string) => {
    const u = new URL(process.env.DATABASE_URL!);
    u.pathname = `/${name}`;
    return u.toString();
  };
  // The receiving stand: a database of its own, with the same migrations and nothing else.
  const OTHER = `ev8ops_test_static_${Date.now()}`;
  const owner = `owner.${uniq()}@test.ev8`;
  const manager = `manager.${uniq()}@test.ev8`;
  let admin: pg.Client;
  let other: pg.Pool;
  let ownerId = '';

  const cli = (args: string[], input: string, db = urlOf(OTHER)) =>
    spawnSync('npx', ['tsx', 'src/copyStatic.ts', ...args], { cwd: api, input, encoding: 'utf8', env: { ...process.env, DATABASE_URL: db }, timeout: 120_000, maxBuffer: 256 * 1024 * 1024 });
  const count = async (sql: string, args: unknown[] = []) => Number((await other.query(sql, args)).rows[0].n);

  /** What this run put on the sending stand: one of everything, and the rows that must not travel. */
  const ids = { model: '', point: '', client: '', supplier: '', archived: '', merged: '', free: '', rented: '' };
  const PHONE = `+9955${digits().slice(-8)}`;
  const PERSONAL = digits().slice(-11);
  const ADDRESS = 'ТЕСТ улица Статичная, 3';
  let mine: StaticSet;
  const json = (over: Partial<StaticSet> = {}) => JSON.stringify({ ...mine, ...over });

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE "${OTHER}"`);
    const migrated = spawnSync('node', ['scripts/migrate.mjs'], { cwd: api, encoding: 'utf8', env: { ...process.env, DATABASE_URL: urlOf(OTHER) }, timeout: 120_000 });
    if (migrated.status !== 0) throw new Error(migrated.stdout + migrated.stderr);
    other = new pg.Pool({ connectionString: urlOf(OTHER), max: 2 });
    ownerId = (await other.query(`insert into users (email, name, password_hash, role) values ($1, 'ТЕСТ Владелец', 'x', 'owner') returning id`, [owner])).rows[0].id;
    await other.query(`insert into users (email, name, password_hash, role) values ($1, 'ТЕСТ Менеджер', 'x', 'manager')`, [manager]);

    const { prisma } = await import('../src/lib/db.js');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Static ${uniq()}`, weeklyRateTetri: 15000, salePriceTetri: 320000, forRent: true, notes: 'ТЕСТ модель' } });
    const point = await prisma.location.create({ data: { name: `ТЕСТ Точка ${uniq()}`, kind: 'showroom', sortOrder: 3 } });
    const lead = `7${digits().slice(-9)}`;
    const client = await prisma.customer.create({
      data: { name: `ТЕСТ Клиент ${uniq()}`, nameKa: 'ტესტი', phone: PHONE, personalId: PERSONAL, address: ADDRESS, tags: ['тест'], kommoRef: `https://ev8mopeds.kommo.com/leads/detail/${lead}` },
    });
    const supplier = await prisma.customer.create({ data: { name: `ТЕСТ Поставщик ${uniq()}`, kind: 'company', recordKind: 'supplier', country: 'CN', goods: 'ТЕСТ мопеды' } });
    const archived = await prisma.customer.create({ data: { name: `ТЕСТ Архив ${uniq()}`, archived: true } });
    const merged = await prisma.customer.create({ data: { name: `ТЕСТ Слитый ${uniq()}`, mergedIntoId: client.id } });
    const vin = () => `TESTS${digits().slice(-12).padStart(12, '0')}`;
    const free = await prisma.vehicle.create({ data: { vin: vin(), modelId: model.id, color: 'white', year: 2024, arrivedOn: new Date('2026-03-14T00:00:00Z'), pool: 'rent', locationId: point.id, odometerKm: 120 } });
    // Out with a customer on the sending stand: no park chosen, no point, a rental of its own.
    const rented = await prisma.vehicle.create({ data: { vin: vin(), modelId: model.id, state: 'rented' } });
    Object.assign(ids, { model: model.id, point: point.id, client: client.id, supplier: supplier.id, archived: archived.id, merged: merged.id, free: free.id, rented: rented.id });

    const all = await readStatic();
    mine = {
      ...all,
      models: all.models.filter((r) => r.id === ids.model),
      locations: all.locations.filter((r) => r.id === ids.point),
      customers: all.customers.filter((r) => [ids.client, ids.supplier, ids.archived, ids.merged].includes(r.id)),
      vehicles: all.vehicles.filter((r) => [ids.free, ids.rented].includes(r.id)),
    };
  }, 180_000);

  afterAll(async () => {
    await other?.end();
    await admin?.query(`DROP DATABASE IF EXISTS "${OTHER}" WITH (FORCE)`);
    await admin?.end();
  });

  it('writes out a stand’s static rows: no archived or merged card, no state and no rental of a moped', async () => {
    expect(mine.version).toBe(STATIC_VERSION);
    expect(mine.customers.map((c) => c.id).sort()).toEqual([ids.client, ids.supplier].sort());
    const rented = mine.vehicles.find((v) => v.id === ids.rented)!;
    expect(Object.keys(rented)).not.toContain('state');
    expect(Object.keys(rented)).not.toContain('currentRentalId');
    expect(mine.left.vehicleStates.rented).toBeGreaterThanOrEqual(1);
    expect(mine.left.archivedCustomers).toBeGreaterThanOrEqual(1);
    expect(mine.left.mergedCustomers).toBeGreaterThanOrEqual(1);

    // And from the command line it is JSON and nothing else.
    const out = cli(['export'], '', process.env.DATABASE_URL!);
    expect(out.status, out.stderr).toBe(0);
    const set = JSON.parse(out.stdout) as StaticSet;
    expect(set.version).toBe(STATIC_VERSION);
    expect(set.vehicles.some((v) => v.id === ids.free)).toBe(true);
  }, 120_000);

  it('a check writes nothing, and says what would be written', async () => {
    const res = cli(['import', '--mopeds'], json());
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(res.stdout).toMatch(/проверка, без записи/);
    expect(res.stdout).toMatch(/От имени: ТЕСТ Владелец\./);
    expect(res.stdout).toMatch(/Модели:\s+новых 1, обновить 0, без изменений 0/);
    expect(res.stdout).toMatch(/Карточки:\s+новых 2, .*\(из 2: клиентов и прочих 1, поставщиков 1\)/);
    expect(res.stdout).toMatch(/Мопеды:\s+новых 2/);
    expect(res.stdout).toMatch(/это была проверка; к записи готово: 6\./);
    expect(await count('select (select count(*) from vehicle_models) + (select count(*) from locations) + (select count(*) from customers) + (select count(*) from vehicles) + (select count(*) from audit_log) as n')).toBe(0);
  }, 120_000);

  it('refuses anybody but an owner, a mistyped flag, and a set made by another version', async () => {
    expect(cli(['import', '--commit', '--owner', manager], json()).stdout).toMatch(/не владелец/);
    expect(cli(['import', '--comit'], json()).status).toBe(2);
    const old = cli(['import', '--commit'], JSON.stringify({ ...mine, version: STATIC_VERSION + 1 }));
    expect(old.status).toBe(2);
    expect(old.stdout).toMatch(/другой версией программы/);
    const extra = cli(['import', '--commit'], json({ customers: mine.customers.map((c) => ({ ...c, nickname: 'x' })) }));
    expect(extra.status).toBe(2);
    expect(await count('select count(*) as n from customers')).toBe(0);
  }, 180_000);

  it('a commit puts the same rows there under the same ids: a moped free, in its park and at its point, each row in the journal', async () => {
    const res = cli(['import', '--commit', '--mopeds'], json());
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(res.stdout).toMatch(/Мопеды:\s+добавлено 2/);
    expect(res.stdout).toMatch(/Записано: 6\./);
    // Counts and nothing a person could be found by.
    for (const secret of [PHONE, PERSONAL, ADDRESS, String(mine.vehicles[0]!.vin)]) expect(res.stdout).not.toContain(secret);

    const client = (await other.query('select * from customers where id = $1', [ids.client])).rows[0];
    expect(client).toMatchObject({ name: mine.customers.find((c) => c.id === ids.client)!.name, name_ka: 'ტესტი', phone: PHONE, personal_id: PERSONAL, address: ADDRESS, tags: ['тест'], record_kind: 'client', archived: false });
    expect(client.kommo_ref).toMatch(/leads\/detail\/7\d{9}$/);
    expect((await other.query('select record_kind, country, goods, kind from customers where id = $1', [ids.supplier])).rows[0]).toEqual({ record_kind: 'supplier', country: 'CN', goods: 'ТЕСТ мопеды', kind: 'company' });
    expect((await other.query('select weekly_rate_tetri, sale_price_tetri, for_rent, notes from vehicle_models where id = $1', [ids.model])).rows[0]).toEqual({ weekly_rate_tetri: 15000, sale_price_tetri: 320000, for_rent: true, notes: 'ТЕСТ модель' });
    expect((await other.query('select kind, sort_order, created_by from locations where id = $1', [ids.point])).rows[0]).toEqual({ kind: 'showroom', sort_order: 3, created_by: ownerId });

    const free = (await other.query(`select state, pool, location_id, model_id, color, year, odometer_km, current_rental_id, to_char(arrived_on, 'YYYY-MM-DD') as arrived from vehicles where id = $1`, [ids.free])).rows[0];
    expect(free).toEqual({ state: 'available', pool: 'rent', location_id: ids.point, model_id: ids.model, color: 'white', year: 2024, odometer_km: 120, current_rental_id: null, arrived: '2026-03-14' });
    expect((await other.query('select kind, to_state, to_pool, actor_id from vehicle_events where vehicle_id = $1 order by created_at, kind', [ids.free])).rows).toEqual([
      { kind: 'arrived', to_state: 'available', to_pool: null, actor_id: ownerId },
      { kind: 'to_rent', to_state: 'available', to_pool: 'rent', actor_id: ownerId },
    ]);
    // Rented on the sending stand; here it is a moped nobody has handed over yet.
    expect((await other.query('select state, pool, location_id, current_rental_id from vehicles where id = $1', [ids.rented])).rows[0]).toEqual({ state: 'available', pool: null, location_id: null, current_rental_id: null });
    expect(await count('select count(*) as n from vehicle_events where vehicle_id = $1', [ids.rented])).toBe(1);

    expect((await other.query('select action, count(*)::int as n from audit_log where actor_id = $1 and note = $2 group by action order by action', [ownerId, 'brought over from the test stand'])).rows).toEqual([
      { action: 'customer.create', n: 1 },
      { action: 'location.create', n: 1 },
      { action: 'model.create', n: 1 },
      { action: 'supplier.create', n: 1 },
      { action: 'vehicle.create', n: 2 },
    ]);
    expect(await count('select count(*) as n from rentals')).toBe(0);
  }, 120_000);

  it('a second run finds everything there and writes nothing', async () => {
    const before = await count('select count(*) as n from audit_log');
    const res = cli(['import', '--commit', '--mopeds'], json());
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(res.stdout).toMatch(/Мопеды:\s+новых 0, обновить 0, без изменений 2/);
    expect(res.stdout).toMatch(/На этом стенде уже всё есть\. Ничего не записано\./);
    expect(await count('select count(*) as n from audit_log')).toBe(before);
  }, 120_000);

  it('while the stand has no rentals it follows the sending one: what changed there is brought up to date', async () => {
    const changed = json({
      models: mine.models.map((m) => ({ ...m, weeklyRateTetri: 16000 })),
      customers: mine.customers.map((c) => (c.id === ids.client ? { ...c, phone: '+995500000009' } : c)),
      vehicles: mine.vehicles.map((v) => (v.id === ids.free ? { ...v, color: 'black', pool: 'sale' } : v)),
    });
    const res = cli(['import', '--commit', '--mopeds'], changed);
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(res.stdout).toMatch(/Модели:\s+добавлено 0, обновлено 1/);
    expect(res.stdout).toMatch(/Записано: 3\./);
    expect((await other.query('select weekly_rate_tetri from vehicle_models where id = $1', [ids.model])).rows[0].weekly_rate_tetri).toBe(16000);
    expect((await other.query('select phone from customers where id = $1', [ids.client])).rows[0].phone).toBe('+995500000009');
    expect((await other.query('select color, pool, state from vehicles where id = $1', [ids.free])).rows[0]).toEqual({ color: 'black', pool: 'sale', state: 'available' });
    expect((await other.query(`select kind, from_pool, to_pool from vehicle_events where vehicle_id = $1 and kind = 'to_sale'`, [ids.free])).rows).toEqual([{ kind: 'to_sale', from_pool: 'rent', to_pool: 'sale' }]);
    expect((await other.query(`select before, after from audit_log where action = 'customer.update' and entity_id = $1`, [ids.client])).rows[0]).toEqual({ before: { phone: PHONE }, after: { phone: '+995500000009' } });
  }, 120_000);

  it('one row the stand already holds under another id, and nothing at all is written', async () => {
    const twin: StaticRow = { ...mine.customers.find((c) => c.id === ids.client)!, id: randomUUID(), phone: '+995500000009' };
    const fresh: StaticRow = { ...mine.customers.find((c) => c.id === ids.supplier)!, id: randomUUID(), name: 'ТЕСТ Новый поставщик' };
    const before = await count('select count(*) as n from customers');
    const res = cli(['import', '--commit'], json({ customers: [...mine.customers.map((c) => (c.id === ids.client ? { ...c, phone: '+995500000009' } : c)), twin, fresh] }));
    expect(res.status).toBe(1);
    expect(res.stdout).toMatch(/С ПРОБЛЕМОЙ 1/);
    expect(res.stdout).toContain(`карточки · ${String(twin.name)} — на этом стенде уже есть другая карточка с тем же личным номером`);
    expect(res.stdout).toMatch(/Ничего не записано: пока есть хоть одна проблема/);
    expect(await count('select count(*) as n from customers')).toBe(before);
  }, 120_000);

  it('once the stand has rentals it is being worked on: new rows are added, the ones already there are left as they are', async () => {
    await other.query(`insert into rentals (customer_id, weekly_rate_tetri, vin_unconfirmed, vin_note) values ($1, 15000, true, 'ТЕСТ')`, [ids.client]);
    const fresh: StaticRow = { ...mine.customers.find((c) => c.id === ids.supplier)!, id: randomUUID(), name: 'ТЕСТ Новый поставщик' };
    // No --mopeds this time: models, points and cards only.
    const res = cli(['import', '--commit'], json({ customers: [...mine.customers.map((c) => (c.id === ids.client ? { ...c, name: 'ТЕСТ Другое имя' } : c)), fresh] }));
    expect(res.status, res.stderr + res.stdout).toBe(0);
    expect(res.stdout).toMatch(/Карточки:\s+добавлено 1, обновлено 0, без изменений 1, уже есть и отличаются, не трогаю 1/);
    expect(res.stdout).toMatch(/Мопеды:\s+в этот раз не переносятся \(на тестовом их \d+\); чтобы перенести и их — добавьте --mopeds\./);
    expect(res.stdout).toMatch(/На этом стенде уже есть аренды/);
    expect((await other.query('select name from customers where id = $1', [ids.client])).rows[0].name).not.toBe('ТЕСТ Другое имя');
    expect(await count('select count(*) as n from customers where id = $1', [fresh.id])).toBe(1);
  }, 120_000);
});
