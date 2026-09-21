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
import { DEFAULT_DEPOSIT_TETRI, addDays, instalmentSchedule, landedCosts, periodsThrough, todayISO } from '@ev8/shared';
import { recordPayment } from './lib/payments.js';
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

  // One extra login so the manager's view can be tried. Same password as the owner.
  for (const [email, name, role] of [['demo.manager@ev8.test', 'Demo Manager', 'manager']] as const) {
    await prisma.user.upsert({ where: { email }, update: {}, create: { email, name, passwordHash: hashPassword(env.OWNER_PASSWORD), role } });
  }

  const modelA = await prisma.vehicleModel.create({ data: { brand: 'Demo', name: 'Model A', weeklyRateTetri: 15000, salePriceTetri: 320600, forRent: true, notes: DEMO_NOTE } });
  const modelB = await prisma.vehicleModel.create({ data: { brand: 'Demo', name: 'Model B', weeklyRateTetri: 14000, salePriceTetri: 349500, forRent: true, notes: DEMO_NOTE } });
  const modelS = await prisma.vehicleModel.create({ data: { brand: 'Demo', name: 'Sale only', salePriceTetri: 518800, forRent: false, notes: DEMO_NOTE } });

  // Russian for the display values so a demo stand is quick to read (Mika,
  // 14.09.2026). Georgian still gets exercised: the interface itself is
  // Georgian in `ka`, and every demo customer keeps a Georgian spelling in
  // nameKa, which is the real shape of a customer card here.
  const colors = ['белый', 'красный', 'чёрный', 'зелёный'];
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
  const names = [
    { ru: 'Вахтанг Демо', ka: 'ვახტანგ დემო', lat: 'Vakhtang Demo' },
    { ru: 'Георгий Демо', ka: 'გიორგი დემო', lat: 'Giorgi Demo' },
    { ru: 'Нино Демо', ka: 'ნინო დემო', lat: 'Nino Demo' },
    { ru: 'Давид Демо', ka: 'დავით დემო', lat: 'Davit Demo' },
    { ru: 'Тамара Демо', ka: 'თამარ დემო', lat: 'Tamar Demo' },
    { ru: 'Лука Демо', ka: 'ლუკა დემო', lat: 'Luka Demo' },
  ];
  for (let i = 0; i < names.length; i++) {
    const c = await prisma.customer.create({
      data: {
        name: names[i].ru,
        nameKa: names[i].ka,
        nameLat: names[i].lat,
        personalId: `DEMO-${String(i + 1).padStart(8, '0')}`,
        phone: `+995500000${String(i + 1).padStart(3, '0')}`,
        address: `DEMO: Тбилиси, Ваке, Демо улица ${i + 1}`,
        tags: ['demo', i < 4 ? 'rental' : 'buyer'],
        notes: DEMO_NOTE,
      },
    });
    customers.push(c.id);
  }

  // A rental with periods up to today, the first `paidWeeks` of them paid —
  // paid by real payment rows, not by writing the answer into the periods.
  // The demo is here to try the machinery, so the machinery does the work:
  // the first payment is 320 by card (180 deposit + 140 week), the shape a
  // new renter's first payment really has.
  async function rental(opts: { customer: string; vehicle: { id: string; vin: string } | null; rate: number; pickedUpOn: string; paidWeeks: number; returnedOn?: string; status?: 'active' | 'paused' | 'disputed'; vinNote?: string }) {
    const periods = periodsThrough(opts.pickedUpOn, today, opts.returnedOn);
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
        nightParkingAddress: 'DEMO: Тбилиси, Ваке, Демо улица 1, двор',
        batteries: 2,
        chargers: 2,
        notes: DEMO_NOTE,
        createdById: ownerId,
      },
    });
    for (const p of periods) {
      await prisma.rentalPeriod.create({
        data: { rentalId: r.id, seq: p.seq, startsOn: d(p.startsOn), endsOn: d(p.endsOn), amountTetri: opts.rate },
      });
    }
    await prisma.deposit.create({
      data: opts.returnedOn
        ? { rentalId: r.id, amountTetri: DEFAULT_DEPOSIT_TETRI, status: 'returned', returnedTetri: DEFAULT_DEPOSIT_TETRI, returnedOn: d(opts.returnedOn), decidedById: ownerId, confirmedById: ownerId }
        : { rentalId: r.id, amountTetri: DEFAULT_DEPOSIT_TETRI, status: 'held' },
    });
    // The first payment covers the deposit and week one, by card; the rest
    // arrive weekly by transfer.
    for (let week = 1; week <= Math.min(opts.paidWeeks, periods.length); week++) {
      const first = week === 1;
      await recordPayment({
        actorId: ownerId,
        occurredOn: periods[week - 1].startsOn,
        channel: first ? 'acquiring' : 'transfer',
        grossTetri: first ? DEFAULT_DEPOSIT_TETRI + opts.rate : opts.rate,
        feeTetri: first ? Math.round((DEFAULT_DEPOSIT_TETRI + opts.rate) * 0.015) : 0,
        customerId: opts.customer,
        rentalId: r.id,
        bankText: first ? 'DEMO Wallet/domestic MC cards' : 'DEMO transfer',
        note: DEMO_NOTE,
        source: 'manual',
      });
    }
    await prisma.act.create({ data: { rentalId: r.id, kind: 'pickup', occurredOn: d(opts.pickedUpOn), odometerKm: 120, condition: DEMO_NOTE, createdById: ownerId } });
    if (opts.vehicle) {
      await prisma.vehicleEvent.create({ data: { vehicleId: opts.vehicle.id, kind: 'pickup', occurredOn: d(opts.pickedUpOn), fromState: 'available', toState: 'rented', rentalId: r.id, actorId: ownerId } });
      if (opts.returnedOn) {
        await prisma.act.create({
          data: {
            rentalId: r.id,
            kind: 'return',
            occurredOn: d(opts.returnedOn),
            odometerKm: 640,
            condition: DEMO_NOTE,
            items: { moped: { state: 'ok' }, key: { state: 'ok' }, battery_1: { state: 'ok' }, battery_2: { state: 'ok' }, charger_1: { state: 'ok' }, charger_2: { state: 'ok' } },
            createdById: ownerId,
          },
        });
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

  // Two in service, through repair jobs rather than a bare event — the
  // screen and the moped's history then say the same thing.
  const repairs: { vehicle: { id: string }; reason: string; labour: number; parts: [string, number, number][] }[] = [
    { vehicle: vehicles[3], reason: 'DEMO: тормозные колодки', labour: 3000, parts: [['DEMO Колодки', 2, 1750]] },
    { vehicle: vehicles[7], reason: 'DEMO: не держит зарядку', labour: 5000, parts: [['DEMO Зарядное 60V 5A', 1, 4154]] },
  ];
  for (const r of repairs) {
    const job = await prisma.serviceJob.create({
      data: {
        vehicleId: r.vehicle.id,
        reason: r.reason,
        openedOn: d(addDays(today, -2)),
        labourTetri: r.labour,
        notes: DEMO_NOTE,
        movedVehicle: true,
        createdById: ownerId,
      },
    });
    for (const [name, qty, price] of r.parts) {
      await prisma.servicePart.create({ data: { jobId: job.id, name, qty, unitPriceTetri: price } });
    }
    await prisma.vehicleEvent.create({
      data: { vehicleId: r.vehicle.id, kind: 'service_in', occurredOn: d(addDays(today, -2)), fromState: 'available', toState: 'service', reason: r.reason, actorId: ownerId },
    });
    await prisma.vehicle.update({ where: { id: r.vehicle.id }, data: { state: 'service' } });
  }
  for (const [v, when] of [
    [vehicles[9], addDays(today, -60)],
    [vehicles[8], addDays(today, -200)],
  ] as const) {
    await prisma.vehicleEvent.create({
      data: { vehicleId: v.id, kind: 'sold', occurredOn: d(when), fromState: 'available', toState: 'sold', actorId: ownerId },
    });
  }

  // Two sales: one settled on the day, one on a schedule that has fallen
  // behind — the shape the company actually has on its books.
  const outright = await prisma.sale.create({
    data: {
      customerId: customers[4],
      vehicleId: vehicles[9].id,
      soldOn: d(addDays(today, -60)),
      priceTetri: 320600,
      extras: 'DEMO: вторая батарея',
      warrantyUntil: d(addDays(today, 305)),
      notes: DEMO_NOTE,
      createdById: ownerId,
    },
  });
  await prisma.saleInstalment.create({
    data: { saleId: outright.id, seq: 1, dueOn: d(addDays(today, -60)), amountTetri: 320600 },
  });
  await recordPayment({
    actorId: ownerId,
    occurredOn: addDays(today, -60),
    channel: 'transfer',
    grossTetri: 320600,
    feeTetri: 0,
    customerId: customers[4],
    rentalId: null,
    saleId: outright.id,
    bankText: 'DEMO transfer',
    note: DEMO_NOTE,
    source: 'manual',
  });

  const onPlan = await prisma.sale.create({
    data: {
      customerId: customers[5],
      vehicleId: vehicles[8].id,
      soldOn: d(addDays(today, -200)),
      priceTetri: 360000,
      warrantyUntil: d(addDays(today, 165)),
      notes: DEMO_NOTE,
      createdById: ownerId,
    },
  });
  for (const line of instalmentSchedule({ soldOn: addDays(today, -200), priceTetri: 360000, downPaymentTetri: 90000, months: 9 })) {
    await prisma.saleInstalment.create({
      data: { saleId: onPlan.id, seq: line.seq, dueOn: d(line.dueOn), amountTetri: line.amountTetri },
    });
  }
  // Only the down payment ever arrived, so the rest shows as behind.
  await recordPayment({
    actorId: ownerId,
    occurredOn: addDays(today, -200),
    channel: 'transfer',
    grossTetri: 90000,
    feeTetri: 0,
    customerId: customers[5],
    rentalId: null,
    saleId: onPlan.id,
    bankText: 'DEMO transfer',
    note: DEMO_NOTE,
    source: 'manual',
  });
  for (const v of [vehicles[8], vehicles[9]]) {
    await prisma.vehicle.update({ where: { id: v.id }, data: { state: 'sold' } });
  }

  // A shipment, so the purchase screen has the real shape to show: an
  // invoice in CNY, two payments in GEL, logistics split over the units,
  // and every VIN carrying what it cost to land.
  const factory = await prisma.customer.create({
    data: { name: 'DEMO Zhejiang Factory', kind: 'company', recordKind: 'supplier', notes: DEMO_NOTE },
  });
  const order = await prisma.purchase.create({
    data: {
      supplierId: factory.id,
      invoiceNo: 'DEMO-0012024',
      invoiceDate: d('2024-07-10'),
      currency: 'CNY',
      orderedOn: d('2024-07-10'),
      extrasTetri: 10 * 23834,
      extrasNote: 'DEMO: логистика и растаможка, импортный НДС вычтен как возвращённый',
      notes: DEMO_NOTE,
      createdById: ownerId,
    },
  });
  const orderLines = [
    { model: modelA, qty: 5, unitPriceMinor: 342550 },
    { model: modelB, qty: 4, unitPriceMinor: 448140 },
    { model: modelS, qty: 1, unitPriceMinor: 508360 },
  ];
  const createdLines: { id: string; qty: number; unitPriceMinor: number; modelId: string }[] = [];
  for (const l of orderLines) {
    const created = await prisma.purchaseLine.create({
      data: { purchaseId: order.id, modelId: l.model.id, qty: l.qty, unitPriceMinor: l.unitPriceMinor },
    });
    createdLines.push({ id: created.id, qty: l.qty, unitPriceMinor: l.unitPriceMinor, modelId: l.model.id });
  }
  const paidTetri = 1_500_000;
  const invoiceMinor = createdLines.reduce((n, l) => n + l.qty * l.unitPriceMinor, 0);
  for (const [when, amount] of [
    ['2024-10-07', 450000],
    ['2024-12-10', 1_050_000],
  ] as const) {
    await prisma.payment.create({
      data: {
        occurredOn: d(when),
        direction: 'out',
        channel: 'transfer',
        grossTetri: amount,
        feeTetri: 0,
        netTetri: amount,
        customerId: factory.id,
        purchaseId: order.id,
        kind: 'supplier',
        note: DEMO_NOTE,
        createdById: ownerId,
      },
    });
  }
  // The ten mopeds above came from this shipment; give them their cost.
  const costs = new Map(
    landedCosts({
      lines: createdLines.map((l) => ({ id: l.id, qty: l.qty, unitPriceMinor: l.unitPriceMinor, isVehicle: true })),
      // The shipment was paid in full: what it cost is what left the bank.
      basisTetri: paidTetri,
      extrasTetri: 10 * 23834,
    }).map((c) => [c.lineId, c]),
  );
  for (const l of createdLines) {
    const unit = costs.get(l.id)!.unitCostTetri;
    await prisma.vehicle.updateMany({
      where: { modelId: l.modelId, purchaseId: null },
      data: { costTetri: unit, purchaseId: order.id },
    });
    await prisma.vehicleModel.update({ where: { id: l.modelId }, data: { costTetri: unit } });
  }
  await prisma.purchase.update({ where: { id: order.id }, data: { status: 'received', receivedOn: d('2025-03-14') } });

  // A shelf with a few parts on it, so the warehouse screen has the shape:
  // something received, something used on a repair, and one part below the
  // level somebody set.
  const shelf = [
    { name: 'DEMO Тормозные колодки', nameKa: 'DEMO სამუხრუჭე ხუნდები', sku: 'DEMO-BRK-01', minQty: 10, salePriceTetri: 4500, received: 24, unitCostTetri: 1850 },
    { name: 'DEMO Камера 10"', nameKa: 'DEMO კამერა 10"', sku: 'DEMO-TUB-10', minQty: 8, salePriceTetri: 3500, received: 30, unitCostTetri: 1200 },
    { name: 'DEMO Зарядное устройство 60V', nameKa: 'DEMO დამტენი 60V', sku: 'DEMO-CHG-60', minQty: 4, salePriceTetri: 28000, received: 6, unitCostTetri: 19500 },
    { name: 'DEMO Зеркало левое', nameKa: 'DEMO მარცხენა სარკე', sku: 'DEMO-MIR-L', minQty: 6, salePriceTetri: 2500, received: 3, unitCostTetri: 900 },
  ];
  for (const item of shelf) {
    const created = await prisma.part.create({
      data: {
        name: item.name,
        nameKa: item.nameKa,
        sku: item.sku,
        minQty: item.minQty,
        salePriceTetri: item.salePriceTetri,
        notes: DEMO_NOTE,
        createdById: ownerId,
      },
    });
    await prisma.stockMove.create({
      data: {
        partId: created.id,
        kind: 'receipt',
        qty: item.received,
        unitCostTetri: item.unitCostTetri,
        occurredOn: d('2025-03-14'),
        reason: DEMO_NOTE,
        createdById: ownerId,
      },
    });
  }
  // The two demo repairs took pads and a tube off the shelf.
  const pads = await prisma.part.findFirstOrThrow({ where: { sku: 'DEMO-BRK-01' } });
  const tube = await prisma.part.findFirstOrThrow({ where: { sku: 'DEMO-TUB-10' } });
  for (const [part, qty, on] of [
    [pads, 2, '2026-08-20'],
    [tube, 1, '2026-09-02'],
  ] as const) {
    await prisma.stockMove.create({
      data: { partId: part.id, kind: 'issue', qty: -qty, occurredOn: d(on), reason: DEMO_NOTE, createdById: ownerId },
    });
  }

  console.log('seed: DEMO dataset added — 3 models, 10 mopeds, 6 customers, 6 rentals, 2 repairs, 2 sales, 1 shipment, 4 parts on the shelf. Every row is marked DEMO.');
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
