// Seed.
//
//   tsx src/seed.ts --if-empty     the first owner login, only when there are no users
//   tsx src/seed.ts --demo         + a small, clearly marked DEMO dataset (laptop only)
//
// EV8 Ops has no demo dataset by default (CLAUDE.md: never invent data). The
// demo exists so screens and wizards can be built and tried before the Odoo
// import; every row is marked "DEMO" in its name, VIN and notes, and the
// seed refuses to run it on a stack that does not accept the development
// session secret — which is every server stand.
//
// OWNER_EMAIL / OWNER_NAME / OWNER_PASSWORD come from the environment.
import { DEFAULT_DEPOSIT_TETRI, addDays, periodsThrough, todayISO } from '@ev8/shared';
import { hashPassword } from './lib/auth.js';
import { dateFromISO } from './lib/dates.js';
import { closeDb, prisma } from './lib/db.js';
import { env } from './lib/env.js';

const IF_EMPTY = process.argv.includes('--if-empty');
const DEMO = process.argv.includes('--demo') || process.env.SEED_MODE === 'demo';

async function seedOwner(): Promise<string> {
  const existing = await prisma.user.findFirst({ where: { role: 'owner' }, orderBy: { createdAt: 'asc' } });
  const users = await prisma.user.count();
  if (users > 0) {
    console.log(IF_EMPTY ? 'seed: users exist, nothing to do' : `seed: ${users} user(s) already present, not touching them`);
    return existing?.id ?? (await prisma.user.findFirstOrThrow()).id;
  }
  if (!env.OWNER_PASSWORD) throw new Error('seed: OWNER_PASSWORD is not set. The first owner login needs a password; there is no default.');
  if (env.OWNER_PASSWORD.length < 8) throw new Error('seed: OWNER_PASSWORD is shorter than 8 characters.');
  const owner = await prisma.user.create({
    data: { email: env.OWNER_EMAIL, name: env.OWNER_NAME, passwordHash: hashPassword(env.OWNER_PASSWORD), role: 'owner', locale: env.DEFAULT_LOCALE },
  });
  console.log(`seed: owner login created for ${env.OWNER_EMAIL}`);
  return owner.id;
}

const DEMO_NOTE = 'DEMO DATA — not a real record. Seeded by apps/api/src/seed.ts --demo.';

async function seedDemo(ownerId: string): Promise<void> {
  if (process.env.ALLOW_DEV_SECRET !== 'true') throw new Error('seed: the demo dataset runs only on a laptop stack (ALLOW_DEV_SECRET=true). Never on a stand.');
  if ((await prisma.vehicle.count()) > 0 || (await prisma.customer.count()) > 0) {
    console.log('seed: fleet or customers already present, demo not added');
    return;
  }
  const today = todayISO(new Date(), env.TZ);
  const d = (iso: string) => dateFromISO(iso)!;

  // Two extra logins so role differences can be tried. Same password as the owner.
  for (const [email, name, role] of [
    ['demo.director@ev8.test', 'Demo Director', 'director'],
    ['demo.manager@ev8.test', 'Demo Manager', 'manager'],
  ] as const) {
    await prisma.user.upsert({ where: { email }, update: {}, create: { email, name, passwordHash: hashPassword(env.OWNER_PASSWORD), role } });
  }

  const modelA = await prisma.vehicleModel.create({ data: { brand: 'Demo', name: 'Model A', weeklyRateTetri: 15000, salePriceTetri: 320600, forRent: true, notes: DEMO_NOTE } });
  const modelB = await prisma.vehicleModel.create({ data: { brand: 'Demo', name: 'Model B', weeklyRateTetri: 14000, salePriceTetri: 349500, forRent: true, notes: DEMO_NOTE } });
  const modelS = await prisma.vehicleModel.create({ data: { brand: 'Demo', name: 'Sale only', salePriceTetri: 518800, forRent: false, notes: DEMO_NOTE } });

  const colors = ['თეთრი', 'წითელი', 'შავი', 'მწვანე'];
  const vehicles: { id: string; vin: string }[] = [];
  for (let i = 1; i <= 10; i++) {
    const model = i <= 5 ? modelA : i <= 9 ? modelB : modelS;
    const vin = `DEMO${String(i).padStart(13, '0')}`;
    const v = await prisma.vehicle.create({
      data: { vin, modelId: model.id, color: colors[i % colors.length], year: 2024, arrivedOn: d('2025-03-14'), odometerKm: 100 * i, notes: DEMO_NOTE },
    });
    await prisma.vehicleEvent.create({ data: { vehicleId: v.id, kind: 'arrived', occurredOn: d('2025-03-14'), fromState: null, toState: 'available', actorId: ownerId } });
    vehicles.push({ id: v.id, vin });
  }

  const customers: string[] = [];
  const names = ['ვაჟა დემო', 'გიორგი დემო', 'ნინო დემო', 'დავით დემო', 'თამარ დემო', 'ლუკა დემო'];
  for (let i = 0; i < names.length; i++) {
    const c = await prisma.customer.create({
      data: {
        name: names[i],
        nameKa: names[i],
        nameLat: `Demo Customer ${i + 1}`,
        personalId: `DEMO-${String(i + 1).padStart(8, '0')}`,
        phone: `+995500000${String(i + 1).padStart(3, '0')}`,
        tags: ['demo', i < 4 ? 'rental' : 'buyer'],
        notes: DEMO_NOTE,
      },
    });
    customers.push(c.id);
  }

  // A rental with periods up to today, the first `paidWeeks` of them paid.
  async function rental(opts: { customer: string; vehicle: { id: string; vin: string } | null; rate: number; pickedUpOn: string; paidWeeks: number; returnedOn?: string; status?: 'active' | 'paused' | 'disputed'; vinNote?: string }) {
    const periods = periodsThrough(opts.pickedUpOn, today, opts.returnedOn);
    const paidThrough = opts.paidWeeks > 0 ? periods[Math.min(opts.paidWeeks, periods.length) - 1].endsOn : null;
    const r = await prisma.rental.create({
      data: {
        customerId: opts.customer,
        vehicleId: opts.vehicle?.id ?? null,
        vinUnconfirmed: !opts.vehicle,
        vinNote: opts.vinNote ?? null,
        weeklyRateTetri: opts.rate,
        depositTetri: DEFAULT_DEPOSIT_TETRI,
        pickedUpOn: d(opts.pickedUpOn),
        returnedOn: opts.returnedOn ? d(opts.returnedOn) : null,
        status: opts.returnedOn ? 'returned' : opts.status ?? 'active',
        paidThrough: paidThrough ? d(paidThrough) : null,
        notes: DEMO_NOTE,
        createdById: ownerId,
      },
    });
    for (const p of periods) {
      const paid = p.seq <= opts.paidWeeks;
      await prisma.rentalPeriod.create({
        data: { rentalId: r.id, seq: p.seq, startsOn: d(p.startsOn), endsOn: d(p.endsOn), amountTetri: opts.rate, paidTetri: paid ? opts.rate : 0, payStatus: paid ? 'paid' : 'unpaid' },
      });
    }
    await prisma.deposit.create({
      data: opts.returnedOn
        ? { rentalId: r.id, amountTetri: DEFAULT_DEPOSIT_TETRI, status: 'returned', returnedTetri: DEFAULT_DEPOSIT_TETRI, returnedOn: d(opts.returnedOn), decidedById: ownerId, confirmedById: ownerId }
        : { rentalId: r.id, amountTetri: DEFAULT_DEPOSIT_TETRI, status: 'held' },
    });
    await prisma.act.create({ data: { rentalId: r.id, kind: 'pickup', occurredOn: d(opts.pickedUpOn), odometerKm: 120, condition: DEMO_NOTE, createdById: ownerId } });
    if (opts.vehicle) {
      await prisma.vehicleEvent.create({ data: { vehicleId: opts.vehicle.id, kind: 'pickup', occurredOn: d(opts.pickedUpOn), fromState: 'available', toState: 'rented', rentalId: r.id, actorId: ownerId } });
      if (opts.returnedOn) {
        await prisma.act.create({ data: { rentalId: r.id, kind: 'return', occurredOn: d(opts.returnedOn), odometerKm: 640, condition: DEMO_NOTE, createdById: ownerId } });
        await prisma.vehicleEvent.create({ data: { vehicleId: opts.vehicle.id, kind: 'return', occurredOn: d(opts.returnedOn), fromState: 'rented', toState: 'available', rentalId: r.id, actorId: ownerId } });
      } else {
        await prisma.vehicle.update({ where: { id: opts.vehicle.id }, data: { state: 'rented', currentRentalId: r.id } });
      }
    }
    return r;
  }

  // Dates relative to today so the demo always shows one overdue, one paid up.
  await rental({ customer: customers[0], vehicle: vehicles[0], rate: 15000, pickedUpOn: addDays(today, -58), paidWeeks: 6 }); // overdue
  await rental({ customer: customers[1], vehicle: vehicles[1], rate: 14000, pickedUpOn: addDays(today, -10), paidWeeks: 2 }); // paid through
  await rental({ customer: customers[2], vehicle: vehicles[5], rate: 17000, pickedUpOn: addDays(today, -3), paidWeeks: 1 });
  await rental({ customer: customers[3], vehicle: null, rate: 14000, pickedUpOn: addDays(today, -20), paidWeeks: 3, vinNote: 'DEMO: VIN in the contract is unreadable' });
  await rental({ customer: customers[4], vehicle: vehicles[2], rate: 15000, pickedUpOn: addDays(today, -40), paidWeeks: 3, returnedOn: addDays(today, -19) });
  await rental({ customer: customers[5], vehicle: vehicles[6], rate: 14000, pickedUpOn: addDays(today, -30), paidWeeks: 1, status: 'disputed' });

  // Two in service, one sold, by events.
  for (const v of [vehicles[3], vehicles[7]]) {
    await prisma.vehicleEvent.create({ data: { vehicleId: v.id, kind: 'service_in', occurredOn: addDays(today, -2) === '' ? d(today) : d(addDays(today, -2)), fromState: 'available', toState: 'service', reason: 'DEMO: brake pads', actorId: ownerId } });
    await prisma.vehicle.update({ where: { id: v.id }, data: { state: 'service' } });
  }
  await prisma.vehicleEvent.create({ data: { vehicleId: vehicles[9].id, kind: 'sold', occurredOn: d(addDays(today, -60)), fromState: 'available', toState: 'sold', actorId: ownerId } });
  await prisma.vehicle.update({ where: { id: vehicles[9].id }, data: { state: 'sold' } });

  console.log('seed: DEMO dataset added — 3 models, 10 mopeds, 6 customers, 6 rentals. Every row is marked DEMO.');
}

async function main(): Promise<void> {
  const ownerId = await seedOwner();
  if (DEMO) await seedDemo(ownerId);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
