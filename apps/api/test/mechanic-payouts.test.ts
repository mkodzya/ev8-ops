// Paying the mechanic (stage 5 of docs/spec/mechanic-in-erp-plan.md;
// ADR-0037). What a repair cost now carries its mechanic's approved work on
// the company's own repairs, rounded once per repair, in every place that sums
// a repair; a paid repair is not changed any more, and the database will not
// let a repair or a receipt be paid in somebody else's payout. «К оплате»,
// «Оплачено», a payout voided and a mechanic's balance are asked of the routes
// below; the first suites write a payout straight into the database to test
// what the database itself refuses. Mopeds, people, parts and photos are
// invented test values.
import { isoWeekday, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, makeUser, uniq } from './helpers.js';

/** A photo as the tablet sends it; the server checks the type and that there are bytes. */
const PHOTO = { mimeType: 'image/jpeg', dataBase64: Buffer.from(`test photo ${uniq()}`).toString('base64') };

async function freeVehicle() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Payout ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({
    data: { vin: `TESTY${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id },
  });
  return { prisma, vehicle };
}

/** A person of a role, signed in with a password, with their id. */
async function person(role: 'mechanic' | 'chief_mechanic' | 'owner' | 'manager') {
  const u = await makeUser(role);
  return { id: u.id, cookie: await login(u.email) };
}

/** A work of the test's own, so no test changes the bot's book that others read. */
async function ownWork(owner: string, minutes = 30) {
  const { importWorkBook } = await import('../src/lib/workBook.js');
  await importWorkBook();
  const res = await call(owner, 'POST', '/api/work-book/works', { category: 'OT', nameRu: `Тестовая работа ${uniq()}`, normMin: minutes });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string; code: string; normSec: number }>(res);
}

/** A point to leave the moped at when the repair closes. */
async function point(): Promise<string> {
  const { prisma } = await import('../src/lib/db.js');
  const row = await prisma.location.findFirst({ where: { archived: false }, select: { id: true } });
  return (row ?? (await prisma.location.create({ data: { name: `ТЕСТ point ${uniq()}` }, select: { id: true } }))).id;
}

function opening(vehicleId: string, works: unknown[]) {
  return { vehicleId, reasonKind: 'wear', reason: 'rear brake squeals', odometerKm: 5230, odometerPhoto: PHOTO, photos: [PHOTO], works };
}

interface Job {
  status: string;
  totalTetri: number | null;
  worksCostTetri: number | null;
  payState: string;
  paid: { payoutId: string; paidOn: string; markedBy: { id: string; name: string } } | null;
  works: { id: string; freeText: string | null; state: string; amountTetri: number | null }[];
  parts: { id: string; kind: string; paidTetri: number | null; reimburseTo: { id: string } | null; reimbursed: boolean }[];
}

async function jobOf(cookie: string, id: string): Promise<Job> {
  const res = await call(cookie, 'GET', `/api/service/${id}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<{ job: Job }>(res).job;
}

/** What «Экономика» says the company spent on this moped's repairs, and what it charged. */
async function economicsOf(owner: string, vehicleId: string) {
  const res = await call(owner, 'GET', `/api/fleet/${vehicleId}/economics`);
  expect(res.statusCode, res.body).toBe(200);
  const { economics } = json<{ economics: { serviceCompanyTetri: number; serviceChargedTetri: number } }>(res);
  return { company: economics.serviceCompanyTetri, charged: economics.serviceChargedTetri };
}

/** The repair's total as the moped's card lists it. */
async function cardTotalOf(owner: string, vehicleId: string, jobId: string) {
  const res = await call(owner, 'GET', `/api/fleet/${vehicleId}`);
  expect(res.statusCode, res.body).toBe(200);
  return json<{ serviceJobs: { id: string; totalTetri: number | null }[] }>(res).serviceJobs.find((j) => j.id === jobId)?.totalTetri;
}

/** A mechanic's repair of a book work, approved by the chief mechanic: in work. */
async function repairInWork(mech: string, chief: string, vehicleId: string, works: unknown[]) {
  const opened = await call(mech, 'POST', '/api/service/workshop', opening(vehicleId, works));
  expect(opened.statusCode, opened.body).toBe(201);
  const { id } = json<{ id: string }>(opened);
  const ok = await call(chief, 'POST', `/api/service/${id}/approve`);
  expect(ok.statusCode, ok.body).toBe(200);
  return id;
}

describe.skipIf(!HAS_DB)('what a repair cost', () => {
  it('the company’s repair carries its mechanic’s approved work by the norm; waiting, refused and unnormed work adds nothing', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const w = await ownWork(owner.cookie, 30); // 30 min at 50 ₾ = 25.00 ₾

    const opened = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ workTypeId: w.id }]));
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);
    // Waiting for approval, the work is not the company's yet.
    expect(await jobOf(owner.cookie, id)).toMatchObject({ status: 'draft', totalTetri: 0, worksCostTetri: 0, payState: 'waiting', paid: null });

    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);
    expect(await jobOf(owner.cookie, id)).toMatchObject({ status: 'open', totalTetri: 2500, worksCostTetri: 2500, payState: 'open' });
    expect(await economicsOf(owner.cookie, vehicle.id)).toEqual({ company: 2500, charged: 0 });
    expect(await cardTotalOf(owner.cookie, vehicle.id, id)).toBe(2500);

    // A work found later waits on its own and is not counted; refused, it never is.
    const more = await call(mech.cookie, 'POST', `/api/service/${id}/works`, { works: [{ workTypeId: w.id }] });
    expect(more.statusCode, more.body).toBe(201);
    expect(await jobOf(owner.cookie, id)).toMatchObject({ status: 'draft', totalTetri: 2500, worksCostTetri: 2500, payState: 'waiting' });
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/reject`, { reason: 'ТЕСТ not needed' })).statusCode).toBe(200);
    expect(await jobOf(owner.cookie, id)).toMatchObject({ status: 'open', totalTetri: 2500 });

    // A work in words, approved without a norm, is not money until it has one.
    expect((await call(mech.cookie, 'POST', `/api/service/${id}/works`, { works: [{ freeText: 'ТЕСТ straighten the mirror' }] })).statusCode).toBe(201);
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);
    let job = await jobOf(owner.cookie, id);
    expect(job).toMatchObject({ status: 'open', totalTetri: 2500, worksCostTetri: 2500 });
    const words = job.works.find((l) => l.freeText != null)!;
    expect(words).toMatchObject({ state: 'approved', amountTetri: null });

    // Closed by the owner: what it came to is the owner's to read, with the work in it.
    const closed = await call(owner.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point(), photos: [PHOTO] });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(json(closed)).toEqual({ ok: true, totalTetri: 2500, withheldTetri: 0 });
    expect((await jobOf(owner.cookie, id)).payState).toBe('unnormed');

    // The norm given after closing: 30 + 10 minutes, rounded once for the repair.
    const norm = await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${words.id}`, { normMin: 10 });
    expect(norm.statusCode, norm.body).toBe(200);
    job = await jobOf(owner.cookie, id);
    expect(job).toMatchObject({ status: 'done', totalTetri: 3333, worksCostTetri: 3333, payState: 'payable' });
    expect(await economicsOf(owner.cookie, vehicle.id)).toEqual({ company: 3333, charged: 0 });
    expect(await cardTotalOf(owner.cookie, vehicle.id, id)).toBe(3333);

    // The mechanic reads his work on the lines, not what the repair cost the company.
    expect(await jobOf(mech.cookie, id)).toMatchObject({ totalTetri: null, worksCostTetri: null, payState: 'payable' });
  });

  it('the customer’s repair is charged what the owner typed and the parts, never the mechanic’s work', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await person('owner');
    const mech = await person('mechanic');
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Customer ${uniq()}` } });
    const job = await prisma.serviceJob.create({
      data: {
        vehicleId: vehicle.id,
        reason: 'ТЕСТ broken by the renter',
        openedOn: new Date('2026-10-19T00:00:00Z'),
        status: 'open',
        payer: 'customer',
        customerId: customer.id,
        labourTetri: 4000,
        mechanicId: mech.id,
        createdById: owner.id,
        approvedById: owner.id,
        approvedAt: new Date(),
      },
    });
    await prisma.serviceWork.create({
      data: { jobId: job.id, freeText: 'ТЕСТ new fork', qty: 1, normSec: 3600, rateTetri: 5000, mechanicId: mech.id, createdById: mech.id, approvedById: owner.id, approvedAt: new Date() },
    });
    const seen = await jobOf(owner.cookie, job.id);
    expect(seen).toMatchObject({ totalTetri: 4000, worksCostTetri: 0, payState: 'open' });
    expect(seen.works[0]).toMatchObject({ state: 'approved', amountTetri: 5000 });
    expect(await economicsOf(owner.cookie, vehicle.id)).toEqual({ company: 0, charged: 4000 });
    expect(await cardTotalOf(owner.cookie, vehicle.id, job.id)).toBe(4000);
    await call(owner.cookie, 'POST', `/api/service/${job.id}/cancel`, { reason: 'ТЕСТ done' });
  });

  it('a repair called off cost no work', async () => {
    const { vehicle } = await freeVehicle();
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const w = await ownWork(owner.cookie, 30);
    const id = await repairInWork(mech.cookie, chief.cookie, vehicle.id, [{ workTypeId: w.id }]);
    expect((await jobOf(owner.cookie, id)).totalTetri).toBe(2500);
    expect((await call(owner.cookie, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ opened by mistake' })).statusCode).toBe(200);
    const job = await jobOf(owner.cookie, id);
    // Its approved line stays approved — what was written stays — and costs nothing.
    expect(job).toMatchObject({ status: 'cancelled', totalTetri: 0, worksCostTetri: 0, payState: 'cancelled' });
    expect(job.works[0]!.state).toBe('approved');
    expect(await economicsOf(owner.cookie, vehicle.id)).toEqual({ company: 0, charged: 0 });
    expect(await cardTotalOf(owner.cookie, vehicle.id, id)).toBe(0);
  });
});

describe.skipIf(!HAS_DB)('a paid repair (ADR-0037 §1, §5)', () => {
  it('says who marked it paid, and nothing on it changes any more', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    // A work in words, approved without a norm.
    const opened = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ freeText: 'ТЕСТ replace the throttle cable' }]));
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);
    // A part the mechanic bought, approved; and one the chief mechanic bought for this repair — his own money back.
    const mine = await call(mech.cookie, 'POST', `/api/service/${id}/parts`, { kind: 'bought', name: 'ТЕСТ cable from the shop', qty: 1, paidTetri: '18,00', receiptPhoto: PHOTO });
    expect(mine.statusCode, mine.body).toBe(201);
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);
    const his = await call(chief.cookie, 'POST', `/api/service/${id}/parts`, { kind: 'bought', name: 'ТЕСТ clamp', qty: 1, paidTetri: '4,50', receiptPhoto: PHOTO });
    expect(his.statusCode, his.body).toBe(201);
    const closed = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point(), photos: [PHOTO] });
    expect(closed.statusCode, closed.body).toBe(200);

    let job = await jobOf(owner.cookie, id);
    expect(job.payState).toBe('unnormed');
    const line = job.works[0]!;
    // Closed but not paid, the norm may still be given.
    expect((await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${line.id}`, { normMin: 20 })).statusCode).toBe(200);
    job = await jobOf(owner.cookie, id);
    expect(job).toMatchObject({ payState: 'payable', worksCostTetri: 1667, paid: null });
    const mechPart = job.parts.find((p) => p.reimburseTo?.id === mech.id)!;
    const chiefPart = job.parts.find((p) => p.reimburseTo?.id === chief.id)!;
    expect([mechPart.reimbursed, chiefPart.reimbursed]).toEqual([false, false]);

    // Paid: the repair and the mechanic's receipt to him, the chief's receipt to the chief.
    const payout = await prisma.mechanicPayout.create({
      data: { mechanicId: mech.id, paidOn: new Date('2026-10-20T00:00:00Z'), labourTetri: 1667, reimburseTetri: 1800, markedById: owner.id },
    });
    const chiefPayout = await prisma.mechanicPayout.create({
      data: { mechanicId: chief.id, paidOn: new Date('2026-10-20T00:00:00Z'), labourTetri: 0, reimburseTetri: 450, markedById: owner.id },
    });
    await prisma.serviceJob.update({ where: { id }, data: { paidInPayoutId: payout.id } });
    await prisma.servicePart.update({ where: { id: mechPart.id }, data: { paidInPayoutId: payout.id } });
    await prisma.servicePart.update({ where: { id: chiefPart.id }, data: { paidInPayoutId: chiefPayout.id } });

    job = await jobOf(owner.cookie, id);
    expect(job).toMatchObject({ status: 'done', payState: 'paid', paid: { payoutId: payout.id, paidOn: '2026-10-20', markedBy: { id: owner.id } } });
    expect(job.parts.every((p) => p.reimbursed)).toBe(true);
    // The mechanic sees his repair paid too.
    expect((await jobOf(mech.cookie, id)).paid?.payoutId).toBe(payout.id);

    // Nothing on it changes any more: the norm, the photos, the lines.
    const renorm = await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${line.id}`, { normMin: 25 });
    expect(renorm.statusCode).toBe(409);
    expect(json<{ error: string }>(renorm).error).toBe('job_paid');
    expect((await prisma.serviceWork.findUniqueOrThrow({ where: { id: line.id } })).normSec).toBe(1200);
    const photo = await call(owner.cookie, 'POST', `/api/service/${id}/photos`, PHOTO);
    expect(photo.statusCode).toBe(409);
    expect(json<{ error: string }>(photo).error).toBe('job_paid');
    const part = await call(owner.cookie, 'POST', `/api/service/${id}/parts`, { kind: 'bought', name: 'ТЕСТ late receipt', qty: 1, paidTetri: '1,00', receiptPhoto: PHOTO });
    expect(part.statusCode).toBe(409);
    expect(json<{ error: string }>(part).error).toBe('job_paid');
  });

  it('the database pays a closed repair only in its own mechanic’s payout, and a receipt only to whoever paid it', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await person('owner');
    const mech = await person('mechanic');
    const other = await person('mechanic');
    const chief = await person('chief_mechanic');
    const w = await ownWork(owner.cookie, 30);
    const id = await repairInWork(mech.cookie, chief.cookie, vehicle.id, [{ workTypeId: w.id }]);
    const his = await call(chief.cookie, 'POST', `/api/service/${id}/parts`, { kind: 'bought', name: 'ТЕСТ bolt', qty: 1, paidTetri: '2,00', receiptPhoto: PHOTO });
    expect(his.statusCode, his.body).toBe(201);
    const bought = await prisma.servicePart.findFirstOrThrow({ where: { jobId: id, kind: 'bought' } });
    expect(bought.reimburseToId).toBe(chief.id);

    const paidOn = new Date('2026-10-20T00:00:00Z');
    const payout = await prisma.mechanicPayout.create({ data: { mechanicId: mech.id, paidOn, labourTetri: 2500, reimburseTetri: 0, markedById: owner.id } });
    const othersPayout = await prisma.mechanicPayout.create({ data: { mechanicId: other.id, paidOn, labourTetri: 0, reimburseTetri: 0, markedById: owner.id } });

    // In work, it is not paid.
    await expect(prisma.serviceJob.update({ where: { id }, data: { paidInPayoutId: payout.id } })).rejects.toThrow();
    const closed = await call(mech.cookie, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point(), photos: [PHOTO] });
    expect(closed.statusCode, closed.body).toBe(200);
    // Closed, it is not paid in another mechanic's payout …
    await expect(prisma.serviceJob.update({ where: { id }, data: { paidInPayoutId: othersPayout.id } })).rejects.toThrow();
    // … nor is the chief's receipt paid in the mechanic's.
    await expect(prisma.servicePart.update({ where: { id: bought.id }, data: { paidInPayoutId: payout.id } })).rejects.toThrow();
    // A line off the shelf is nobody's money to pay back.
    const shelf = await prisma.servicePart.create({ data: { jobId: id, name: 'ТЕСТ washer', qty: 1, unitPriceTetri: 100 } });
    await expect(prisma.servicePart.update({ where: { id: shelf.id }, data: { paidInPayoutId: payout.id } })).rejects.toThrow();
    // Its own mechanic's payout pays it; once paid it stays closed.
    await prisma.serviceJob.update({ where: { id }, data: { paidInPayoutId: payout.id } });
    await expect(prisma.serviceJob.update({ where: { id }, data: { status: 'open', closedOn: null } })).rejects.toThrow();
    // A payout voided says by whom and why — not one without the other.
    await expect(prisma.mechanicPayout.update({ where: { id: othersPayout.id }, data: { voidedAt: new Date(), voidedById: owner.id, voidReason: '  ' } })).rejects.toThrow();
    await expect(prisma.mechanicPayout.update({ where: { id: othersPayout.id }, data: { voidedAt: new Date() } })).rejects.toThrow();
    await prisma.mechanicPayout.update({ where: { id: othersPayout.id }, data: { voidedAt: new Date(), voidedById: owner.id, voidReason: 'ТЕСТ marked by mistake' } });
  });

  it('a return act’s photo is not copied onto a repair that is paid; the act keeps it', async () => {
    const { prisma, vehicle } = await freeVehicle();
    const owner = await person('owner');
    const mech = await person('mechanic');
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ Renter ${uniq()}` } });
    const rental = await prisma.rental.create({ data: { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, status: 'returned' } });
    const payout = await prisma.mechanicPayout.create({ data: { mechanicId: mech.id, paidOn: new Date('2026-10-20T00:00:00Z'), labourTetri: 0, reimburseTetri: 0, markedById: owner.id } });
    const job = await prisma.serviceJob.create({
      data: {
        vehicleId: vehicle.id,
        rentalId: rental.id,
        reason: 'ТЕСТ scratched panel',
        openedOn: new Date('2026-10-10T00:00:00Z'),
        closedOn: new Date('2026-10-12T00:00:00Z'),
        status: 'done',
        mechanicId: mech.id,
        paidInPayoutId: payout.id,
      },
    });
    const act = await prisma.act.create({ data: { rentalId: rental.id, kind: 'return', occurredOn: new Date('2026-10-10T00:00:00Z'), settlement: { serviceJobId: job.id } } });
    const res = await call(owner.cookie, 'POST', `/api/acts/${act.id}/photos`, { ...PHOTO, label: 'panel' });
    expect(res.statusCode, res.body).toBe(201);
    expect(await prisma.storedFile.count({ where: { actId: act.id } })).toBe(1);
    expect(await prisma.storedFile.count({ where: { serviceJobId: job.id } })).toBe(0);
    // A returned rental made by hand is no other suite's business: it goes now, its act with it.
    await prisma.storedFile.deleteMany({ where: { actId: act.id } });
    await prisma.serviceJob.delete({ where: { id: job.id } });
    await prisma.rental.delete({ where: { id: rental.id } });
  });
});

// «К оплате» and «Оплачено» (ADR-0037 §2–§5): the stage's «Сдан» points.

interface DueJob {
  id: string;
  number: string;
  vehicle: { id: string; number: string | null };
  closedOn: string | null;
  seconds: number;
  workTetri: number;
  works: { code: string | null; freeText: string | null; qty: number }[];
  receipts: { id: string; name: string; paidTetri: number }[];
  totalTetri: number;
}

interface Due {
  id: string;
  name: string;
  role: string;
  rateTetri: number;
  jobs: DueJob[];
  otherReceipts: { id: string; jobId: string; jobNumber: string; paidTetri: number }[];
  seconds: number;
  workTetri: number;
  reimburseTetri: number;
  totalTetri: number;
  jobIds: string[];
  partIds: string[];
  rent: { customerId: string; rentalId: string; number: string; owedTetri: number; offsetTetri: number; cashTetri: number } | null;
}

interface Payout {
  id: string;
  mechanic: { id: string; name: string };
  paidOn: string;
  labourTetri: number;
  reimburseTetri: number;
  totalTetri: number;
  offsetTetri: number;
  cashTetri: number;
  jobs: { id: string; number: string }[];
  receiptsCount: number;
  markedBy: { id: string; name: string };
  markedAt: string;
  voided: { at: string; by: { id: string; name: string } | null; reason: string } | null;
}

interface Payouts {
  mechanics: Due[];
  held: { id: string; number: string; mechanic: { id: string; name: string }; state: string; amountTetri: number }[];
  payouts: Payout[];
  totalTetri: number;
}

async function payoutsScreen(owner: string): Promise<Payouts> {
  const res = await call(owner, 'GET', '/api/service/payouts');
  expect(res.statusCode, res.body).toBe(200);
  return json<Payouts>(res);
}

/** What one mechanic is owed on the screen; other suites' mechanics share the database. */
async function dueOf(owner: string, mechanicId: string): Promise<Due | undefined> {
  return (await payoutsScreen(owner)).mechanics.find((m) => m.id === mechanicId);
}

/** «Оплачено» for exactly what the screen showed. */
const markOf = (m: Due) => ({ mechanicId: m.id, jobIds: m.jobIds, partIds: m.partIds, totalTetri: m.totalTetri, offsetTetri: m.rent?.offsetTetri ?? 0 });

async function pay(owner: string, m: Due): Promise<Payout> {
  const res = await call(owner, 'POST', '/api/service/payouts', markOf(m));
  expect(res.statusCode, res.body).toBe(201);
  return json<{ payout: Payout }>(res).payout;
}

async function closeRepair(mech: string, id: string) {
  const res = await call(mech, 'POST', `/api/service/${id}/close`, { odometerKm: 5300, locationId: await point(), photos: [PHOTO] });
  expect(res.statusCode, res.body).toBe(200);
}

/** A mechanic's repair opened, approved by the chief and closed by the mechanic. */
async function closedRepair(mech: string, chief: string, works: unknown[]): Promise<string> {
  const { vehicle } = await freeVehicle();
  const id = await repairInWork(mech, chief, vehicle.id, works);
  await closeRepair(mech, id);
  return id;
}

/** A part the person bought for the repair, by the receipt. */
async function boughtPart(cookie: string, jobId: string, paidTetri: string): Promise<string> {
  const res = await call(cookie, 'POST', `/api/service/${jobId}/parts`, { kind: 'bought', name: `ТЕСТ part ${uniq()}`, qty: 1, paidTetri, receiptPhoto: PHOTO });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string }>(res).id;
}

/** Repairs left open or waiting are called off, so they do not crowd the owners' «Сегодня». */
async function settle(owner: string, ...ids: string[]) {
  for (const id of ids) await call(owner, 'POST', `/api/service/${id}/cancel`, { reason: 'ТЕСТ cleanup' });
}

const errorOf = (res: { body: string }) => json<{ error: string }>(res).error;

describe.skipIf(!HAS_DB)('«К оплате» (ADR-0037 §2)', () => {
  it('a repair closed with a work not from the book and no norm waits as «без нормы»; with the norm it is payable', async () => {
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const { vehicle } = await freeVehicle();
    const opened = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vehicle.id, [{ freeText: 'ТЕСТ straighten the footboard' }]));
    expect(opened.statusCode, opened.body).toBe(201);
    const { id } = json<{ id: string }>(opened);
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);
    await closeRepair(mech.cookie, id);

    let screen = await payoutsScreen(owner.cookie);
    expect(screen.mechanics.find((m) => m.id === mech.id)).toBeUndefined();
    expect(screen.held.find((h) => h.id === id)).toMatchObject({ state: 'unnormed', mechanic: { id: mech.id }, amountTetri: 0 });

    const line = (await jobOf(owner.cookie, id)).works[0]!;
    expect((await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${line.id}`, { normMin: 20 })).statusCode).toBe(200);
    screen = await payoutsScreen(owner.cookie);
    expect(screen.held.find((h) => h.id === id)).toBeUndefined();
    const due = screen.mechanics.find((m) => m.id === mech.id)!;
    expect(due).toMatchObject({ role: 'mechanic', rateTetri: 5000, seconds: 1200, workTetri: 1667, reimburseTetri: 0, totalTetri: 1667, jobIds: [id], partIds: [] });
    expect(due.jobs[0]).toMatchObject({ id, seconds: 1200, workTetri: 1667, totalTetri: 1667, receipts: [], works: [{ code: null, freeText: 'ТЕСТ straighten the footboard', qty: 1 }] });
    expect(due.jobs[0]!.vehicle.id).toBe(vehicle.id);
    expect(due.jobs[0]!.closedOn).toBe(todayISO(new Date(), (await import('../src/lib/env.js')).env.TZ));
  });

  it('the bot’s control: seven repairs, 282.5 min at 50 ₾, are 235.42 ₾ — and a receipt of 18.00 on top', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    // The bot's history: 30, 20, 20, 2.5 × 3, 60, 30 and 15 + 20 + 20 + 40 + 20 minutes.
    const w: Record<string, string> = {};
    for (const m of ['30', '20', '2,5', '60', '15', '40']) w[m] = (await ownWork(owner.cookie, m as unknown as number)).id;
    const plans = [
      [{ workTypeId: w['30'] }],
      [{ workTypeId: w['20'] }],
      [{ workTypeId: w['20'] }],
      [{ workTypeId: w['2,5'], qty: 3 }],
      [{ workTypeId: w['60'] }],
      [{ workTypeId: w['30'] }],
      [{ workTypeId: w['15'] }, { workTypeId: w['20'] }, { workTypeId: w['20'] }, { workTypeId: w['40'] }, { workTypeId: w['20'] }],
    ];
    const ids: string[] = [];
    let receipt = '';
    for (const [i, works] of plans.entries()) {
      const { vehicle } = await freeVehicle();
      const id = await repairInWork(mech.cookie, chief.cookie, vehicle.id, works);
      if (i === 4) {
        // A brake cable he bought himself, approved by the chief.
        receipt = await boughtPart(mech.cookie, id, '18,00');
        expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);
      }
      await closeRepair(mech.cookie, id);
      ids.push(id);
    }

    const due = (await dueOf(owner.cookie, mech.id))!;
    expect(due.jobIds).toEqual(ids);
    expect(due.jobs.map((j) => j.workTetri)).toEqual([2500, 1667, 1667, 625, 5000, 2500, 9583]);
    expect(due).toMatchObject({ seconds: 282.5 * 60, workTetri: 23542, reimburseTetri: 1800, totalTetri: 25342, partIds: [receipt], otherReceipts: [] });
    expect(due.jobs[4]).toMatchObject({ workTetri: 5000, totalTetri: 6800, receipts: [{ id: receipt, paidTetri: 1800 }] });
    expect(due.jobs[3]!.works).toEqual([{ code: expect.stringMatching(/^OT-/), freeText: null, qty: 3 }]);
    // The lines of the screen add up to its total exactly.
    expect(due.jobs.reduce((n, j) => n + j.totalTetri, 0)).toBe(due.totalTetri);

    const payout = await pay(owner.cookie, due);
    expect(payout).toMatchObject({ mechanic: { id: mech.id }, labourTetri: 23542, reimburseTetri: 1800, totalTetri: 25342, receiptsCount: 1, markedBy: { id: owner.id }, voided: null });
    expect(payout.jobs.map((j) => j.id).sort()).toEqual([...ids].sort());
    expect(payout.paidOn).toBe(todayISO(new Date(), (await import('../src/lib/env.js')).env.TZ));
    const row = await prisma.mechanicPayout.findUniqueOrThrow({ where: { id: payout.id } });
    expect([row.labourTetri, row.reimburseTetri, row.markedById]).toEqual([23542, 1800, owner.id]);
    expect(await prisma.serviceJob.count({ where: { id: { in: ids }, paidInPayoutId: payout.id, status: 'done' } })).toBe(7);
    expect((await prisma.servicePart.findUniqueOrThrow({ where: { id: receipt } })).paidInPayoutId).toBe(payout.id);
    // A mark, not money: no payment row and no expense is written (ADR-0037 §3).
    expect(await prisma.payment.count({ where: { serviceJobId: { in: ids } } })).toBe(0);
    // Each repair says it was paid; the mechanic's line says for what.
    expect(await prisma.auditLog.count({ where: { action: 'service.paid', entityId: { in: ids } } })).toBe(7);
    const line = await prisma.auditLog.findFirstOrThrow({ where: { action: 'mechanic.payout', entityType: 'user', entityId: mech.id } });
    expect(line.after).toMatchObject({ payoutId: payout.id, labourTetri: 23542, reimburseTetri: 1800, receipts: 1 });
    expect(await dueOf(owner.cookie, mech.id)).toBeUndefined();
  });

  it('refused lines, a refused repair, waiting and open repairs are not paid; the chief’s receipt goes to the chief', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const w30 = await ownWork(owner.cookie, 30);
    const w20 = await ownWork(owner.cookie, 20);

    // A: a work found later and refused; a part he bought, refused; one the chief bought — approved as he writes it.
    const { vehicle } = await freeVehicle();
    const a = await repairInWork(mech.cookie, chief.cookie, vehicle.id, [{ workTypeId: w30.id }]);
    expect((await call(mech.cookie, 'POST', `/api/service/${a}/works`, { works: [{ workTypeId: w20.id }] })).statusCode).toBe(201);
    const refusedPart = await boughtPart(mech.cookie, a, '3,00');
    expect((await call(chief.cookie, 'POST', `/api/service/${a}/reject`, { reason: 'ТЕСТ not needed' })).statusCode).toBe(200);
    const chiefs = await boughtPart(chief.cookie, a, '4,50');
    await closeRepair(mech.cookie, a);

    // B: refused whole; C: waiting for approval; D: in work.
    const vb = await freeVehicle();
    const b = json<{ id: string }>(await call(mech.cookie, 'POST', '/api/service/workshop', opening(vb.vehicle.id, [{ workTypeId: w30.id }]))).id;
    expect((await call(chief.cookie, 'POST', `/api/service/${b}/reject`, { reason: 'ТЕСТ not a repair' })).statusCode).toBe(200);
    const vc = await freeVehicle();
    const c = json<{ id: string }>(await call(mech.cookie, 'POST', '/api/service/workshop', opening(vc.vehicle.id, [{ workTypeId: w30.id }]))).id;
    const vd = await freeVehicle();
    const d = await repairInWork(mech.cookie, chief.cookie, vd.vehicle.id, [{ workTypeId: w20.id }]);

    const screen = await payoutsScreen(owner.cookie);
    const due = screen.mechanics.find((m) => m.id === mech.id)!;
    expect(due).toMatchObject({ jobIds: [a], partIds: [], workTetri: 2500, reimburseTetri: 0, totalTetri: 2500, otherReceipts: [] });
    expect(due.jobs[0]!.receipts).toEqual([]);
    const chiefDue = screen.mechanics.find((m) => m.id === chief.id)!;
    expect(chiefDue).toMatchObject({ role: 'chief_mechanic', jobs: [], jobIds: [], partIds: [chiefs], workTetri: 0, reimburseTetri: 450, totalTetri: 450 });
    expect(chiefDue.otherReceipts).toMatchObject([{ id: chiefs, jobId: a, paidTetri: 450 }]);
    const held = screen.held.filter((h) => [a, b, c, d].includes(h.id));
    expect(held.map((h) => [h.id, h.state, h.amountTetri])).toEqual([
      [c, 'waiting', 2500],
      [d, 'open', 1667],
    ]);

    // Paid: the mechanic his work, the chief his receipt — each in his own payout.
    const paid = await pay(owner.cookie, due);
    expect(paid).toMatchObject({ labourTetri: 2500, reimburseTetri: 0, receiptsCount: 0 });
    expect((await prisma.servicePart.findUniqueOrThrow({ where: { id: chiefs } })).paidInPayoutId).toBeNull();
    // The repair is paid; the chief's receipt in it is still his to be paid back.
    const again = (await dueOf(owner.cookie, chief.id))!;
    expect(again).toMatchObject({ partIds: [chiefs], totalTetri: 450 });
    const back = await pay(owner.cookie, again);
    expect(back).toMatchObject({ mechanic: { id: chief.id }, labourTetri: 0, reimburseTetri: 450, jobs: [], receiptsCount: 1 });
    const parts = await prisma.servicePart.findMany({ where: { id: { in: [chiefs, refusedPart] } }, select: { id: true, paidInPayoutId: true } });
    expect(Object.fromEntries(parts.map((p) => [p.id, p.paidInPayoutId]))).toEqual({ [chiefs]: back.id, [refusedPart]: null });
    const jobs = await prisma.serviceJob.findMany({ where: { id: { in: [a, b, c, d] } }, select: { id: true, paidInPayoutId: true } });
    expect(Object.fromEntries(jobs.map((j) => [j.id, j.paidInPayoutId]))).toEqual({ [a]: paid.id, [b]: null, [c]: null, [d]: null });
    await settle(owner.cookie, c, d);
  });

  it('a receipt approved in a repair the owner calls off is still paid back; its work is not, nor a refused repair’s receipt', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const w = await ownWork(owner.cookie, 30);
    const { vehicle } = await freeVehicle();
    const called = await repairInWork(mech.cookie, chief.cookie, vehicle.id, [{ workTypeId: w.id }]);
    const receipt = await boughtPart(mech.cookie, called, '25,00');
    expect((await call(chief.cookie, 'POST', `/api/service/${called}/approve`)).statusCode).toBe(200);
    const vr = await freeVehicle();
    const refused = await repairInWork(mech.cookie, chief.cookie, vr.vehicle.id, [{ workTypeId: w.id }]);
    const refusedReceipt = await boughtPart(mech.cookie, refused, '7,00');
    expect((await call(chief.cookie, 'POST', `/api/service/${refused}/approve`)).statusCode).toBe(200);
    await settle(owner.cookie, called, refused);
    // A repair is refused whole only before its first approval, when nothing on it is approved yet;
    // written so by hand, it stands for the rule that a refused repair pays nothing.
    await prisma.serviceJob.update({ where: { id: refused }, data: { rejectedById: chief.id, rejectedAt: new Date(), rejectReason: 'ТЕСТ not a repair' } });

    // The part he bought stays in the moped (ADR-0036), so the money he laid out is his.
    const due = (await dueOf(owner.cookie, mech.id))!;
    expect(due).toMatchObject({ jobs: [], jobIds: [], partIds: [receipt], workTetri: 0, reimburseTetri: 2500, totalTetri: 2500 });
    expect(due.otherReceipts).toMatchObject([{ id: receipt, jobId: called, paidTetri: 2500 }]);
    const payout = await pay(owner.cookie, due);
    expect(payout).toMatchObject({ labourTetri: 0, reimburseTetri: 2500, jobs: [], receiptsCount: 1 });
    expect((await prisma.servicePart.findUniqueOrThrow({ where: { id: receipt } })).paidInPayoutId).toBe(payout.id);
    expect((await prisma.servicePart.findUniqueOrThrow({ where: { id: refusedReceipt } })).paidInPayoutId).toBeNull();
    expect(await prisma.serviceJob.count({ where: { id: { in: [called, refused] }, paidInPayoutId: { not: null } } })).toBe(0);
    expect(await dueOf(owner.cookie, mech.id)).toBeUndefined();
  });
});

describe.skipIf(!HAS_DB)('«Оплачено» (ADR-0037 §4)', () => {
  it('pays a repair once: a second mark is refused, and two marks at once write one payout', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const chief = await person('chief_mechanic');
    const w = await ownWork(owner.cookie, 30);

    const mech = await person('mechanic');
    const one = await closedRepair(mech.cookie, chief.cookie, [{ workTypeId: w.id }]);
    const due = (await dueOf(owner.cookie, mech.id))!;
    expect(due.jobIds).toEqual([one]);
    await pay(owner.cookie, due);
    const twice = await call(owner.cookie, 'POST', '/api/service/payouts', markOf(due));
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice)).toBe('nothing_to_pay');
    expect(await prisma.mechanicPayout.count({ where: { mechanicId: mech.id } })).toBe(1);

    // Two owners' taps at the same moment.
    const other = await person('mechanic');
    const jobs = [await closedRepair(other.cookie, chief.cookie, [{ workTypeId: w.id }]), await closedRepair(other.cookie, chief.cookie, [{ workTypeId: w.id }])];
    const both = (await dueOf(owner.cookie, other.id))!;
    expect(both).toMatchObject({ jobIds: jobs, totalTetri: 5000 });
    const answers = await Promise.all([call(owner.cookie, 'POST', '/api/service/payouts', markOf(both)), call(owner.cookie, 'POST', '/api/service/payouts', markOf(both))]);
    expect(answers.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const loser = answers.find((r) => r.statusCode === 409)!;
    expect(['nothing_to_pay', 'already_paid', 'payout_changed']).toContain(errorOf(loser));
    const rows = await prisma.mechanicPayout.findMany({ where: { mechanicId: other.id } });
    expect(rows.map((r) => [r.labourTetri, r.reimburseTetri])).toEqual([[5000, 0]]);
    expect(await prisma.serviceJob.count({ where: { id: { in: jobs }, paidInPayoutId: rows[0]!.id } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: 'service.paid', entityId: { in: jobs } } })).toBe(2);
  });

  it('pays only what the owner saw: a repair closed in between, or another total, refuses the mark and writes nothing', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const w = await ownWork(owner.cookie, 30);
    const first = await closedRepair(mech.cookie, chief.cookie, [{ workTypeId: w.id }]);
    const seen = (await dueOf(owner.cookie, mech.id))!;
    expect(seen.jobIds).toEqual([first]);

    const second = await closedRepair(mech.cookie, chief.cookie, [{ workTypeId: w.id }]);
    const stale = await call(owner.cookie, 'POST', '/api/service/payouts', markOf(seen));
    expect(stale.statusCode).toBe(409);
    const body = json<{ error: string; mechanic: Due }>(stale);
    expect(body.error).toBe('payout_changed');
    expect(body.mechanic).toMatchObject({ id: mech.id, jobIds: [first, second], totalTetri: 5000 });
    expect(await prisma.mechanicPayout.count({ where: { mechanicId: mech.id } })).toBe(0);
    expect(await prisma.serviceJob.count({ where: { id: { in: [first, second] }, paidInPayoutId: { not: null } } })).toBe(0);

    // The same repairs and another sum are not what was seen either.
    const wrongSum = await call(owner.cookie, 'POST', '/api/service/payouts', { ...markOf(body.mechanic), totalTetri: 4999 });
    expect(wrongSum.statusCode).toBe(409);
    expect(errorOf(wrongSum)).toBe('payout_changed');
    // Fewer repairs than are owed is not a payout of them either.
    const part = await call(owner.cookie, 'POST', '/api/service/payouts', { ...markOf(body.mechanic), jobIds: [first], totalTetri: 2500 });
    expect(part.statusCode).toBe(409);
    expect(await prisma.mechanicPayout.count({ where: { mechanicId: mech.id } })).toBe(0);

    // Read again, it pays.
    expect(await pay(owner.cookie, body.mechanic)).toMatchObject({ labourTetri: 5000, totalTetri: 5000 });
  });

  it('a payout voided with its reason lets its repairs be changed and paid again; voided twice is refused', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const { vehicle } = await freeVehicle();
    const id = await repairInWork(mech.cookie, chief.cookie, vehicle.id, [{ freeText: 'ТЕСТ tighten the stem' }]);
    const receipt = await boughtPart(mech.cookie, id, '6,00');
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);
    await closeRepair(mech.cookie, id);
    const line = (await jobOf(owner.cookie, id)).works[0]!;
    expect((await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${line.id}`, { normMin: 20 })).statusCode).toBe(200);
    const payout = await pay(owner.cookie, (await dueOf(owner.cookie, mech.id))!);
    expect(payout).toMatchObject({ labourTetri: 1667, reimburseTetri: 600 });

    // No reason, no voiding; an unknown payout is not found.
    for (const body of [{}, { reason: '   ' }]) {
      const res = await call(owner.cookie, 'POST', `/api/service/payouts/${payout.id}/void`, body);
      expect(res.statusCode).toBe(400);
      expect(errorOf(res)).toBe('missing_field');
    }
    const unknown = await call(owner.cookie, 'POST', '/api/service/payouts/00000000-0000-4000-8000-000000000000/void', { reason: 'ТЕСТ no such' });
    expect(unknown.statusCode).toBe(404);
    expect(errorOf(unknown)).toBe('payout_not_found');
    expect((await prisma.mechanicPayout.findUniqueOrThrow({ where: { id: payout.id } })).voidedAt).toBeNull();

    const voided = await call(owner.cookie, 'POST', `/api/service/payouts/${payout.id}/void`, { reason: 'ТЕСТ marked the wrong week' });
    expect(voided.statusCode, voided.body).toBe(200);
    const v = json<{ payout: Payout }>(voided).payout;
    expect(v.voided).toMatchObject({ by: { id: owner.id }, reason: 'ТЕСТ marked the wrong week' });
    // The payout still says which repairs it had been.
    expect(v.jobs.map((j) => j.id)).toEqual([id]);
    expect(v.receiptsCount).toBe(1);
    expect(await prisma.serviceJob.count({ where: { id, paidInPayoutId: null } })).toBe(1);
    expect((await prisma.servicePart.findUniqueOrThrow({ where: { id: receipt } })).paidInPayoutId).toBeNull();
    const listed = (await payoutsScreen(owner.cookie)).payouts.find((p) => p.id === payout.id)!;
    expect(listed).toMatchObject({ voided: { reason: 'ТЕСТ marked the wrong week' }, jobs: [{ id }], receiptsCount: 1 });
    expect(await prisma.auditLog.count({ where: { action: 'service.unpaid', entityId: id } })).toBe(1);
    const journal = await prisma.auditLog.findFirstOrThrow({ where: { action: 'mechanic.payout.void', entityId: mech.id } });
    expect(journal.after).toMatchObject({ payoutId: payout.id, reason: 'ТЕСТ marked the wrong week', receipts: 1 });

    // Owed again, and changed again until it is paid.
    expect((await dueOf(owner.cookie, mech.id))!.jobIds).toEqual([id]);
    expect((await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${line.id}`, { normMin: 25 })).statusCode).toBe(200);
    const due = (await dueOf(owner.cookie, mech.id))!;
    expect(due).toMatchObject({ workTetri: 2083, reimburseTetri: 600, totalTetri: 2683, partIds: [receipt] });
    const repaid = await pay(owner.cookie, due);
    expect(repaid.id).not.toBe(payout.id);
    expect((await jobOf(owner.cookie, id)).paid?.payoutId).toBe(repaid.id);

    const twice = await call(owner.cookie, 'POST', `/api/service/payouts/${payout.id}/void`, { reason: 'ТЕСТ again' });
    expect(twice.statusCode).toBe(409);
    expect(errorOf(twice)).toBe('payout_voided');
  });

  it('a repair paid through «Оплачено» refuses a norm, a photo and hiding one', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const { vehicle } = await freeVehicle();
    const id = await repairInWork(mech.cookie, chief.cookie, vehicle.id, [{ freeText: 'ТЕСТ adjust the chain' }]);
    await closeRepair(mech.cookie, id);
    const line = (await jobOf(owner.cookie, id)).works[0]!;
    expect((await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${line.id}`, { normMin: 15 })).statusCode).toBe(200);
    // Not paid yet, a photo may still be hidden; the journal says on which repair.
    const shots = await prisma.storedFile.findMany({ where: { serviceJobId: id, kind: 'service_photo' }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    expect(shots.length).toBeGreaterThanOrEqual(2);
    const hidden = await call(owner.cookie, 'POST', `/api/files/${shots[0]!.id}/archive`, { reason: 'ТЕСТ blurry' });
    expect(hidden.statusCode, hidden.body).toBe(200);
    expect(await prisma.auditLog.findFirstOrThrow({ where: { action: 'file.archive', entityId: id }, select: { entityType: true, note: true } })).toEqual({ entityType: 'service_job', note: 'ТЕСТ blurry' });
    const payout = await pay(owner.cookie, (await dueOf(owner.cookie, mech.id))!);
    expect(await jobOf(owner.cookie, id)).toMatchObject({ status: 'done', payState: 'paid', paid: { payoutId: payout.id } });

    const norm = await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${line.id}`, { normMin: 30 });
    expect(norm.statusCode).toBe(409);
    expect(errorOf(norm)).toBe('job_paid');
    const photo = await call(owner.cookie, 'POST', `/api/service/${id}/photos`, PHOTO);
    expect(photo.statusCode).toBe(409);
    expect(errorOf(photo)).toBe('job_paid');
    const late = await call(owner.cookie, 'POST', `/api/files/${shots[1]!.id}/archive`, { reason: 'ТЕСТ blurry too' });
    expect(late.statusCode).toBe(409);
    expect(errorOf(late)).toBe('job_paid');
    expect((await prisma.storedFile.findUniqueOrThrow({ where: { id: shots[1]!.id }, select: { archived: true } })).archived).toBe(false);
  });

  it('a norm given at the moment of «Оплачено» never leaves a paid repair at another sum than its payout', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    // Long enough for the request started inside to reach the lock the transaction holds.
    const pause = () => new Promise((r) => setTimeout(r, 300));

    // The mark first, held open: the chief's norm waits for it, then finds the repair paid.
    const { vehicle } = await freeVehicle();
    const one = await repairInWork(mech.cookie, chief.cookie, vehicle.id, [{ freeText: 'ТЕСТ align the handlebar' }]);
    await closeRepair(mech.cookie, one);
    const line = (await jobOf(owner.cookie, one)).works[0]!;
    expect((await call(chief.cookie, 'PATCH', `/api/service/${one}/works/${line.id}`, { normMin: 20 })).statusCode).toBe(200);
    let norm: ReturnType<typeof call> | undefined;
    const payout = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM service_jobs WHERE id = ${one}::uuid FOR UPDATE`;
      const p = await tx.mechanicPayout.create({ data: { mechanicId: mech.id, paidOn: new Date('2026-10-20T00:00:00Z'), labourTetri: 1667, reimburseTetri: 0, markedById: owner.id } });
      await tx.serviceJob.update({ where: { id: one }, data: { paidInPayoutId: p.id } });
      norm = call(chief.cookie, 'PATCH', `/api/service/${one}/works/${line.id}`, { normMin: 25 });
      await pause();
      return p;
    });
    const late = await norm!;
    expect(late.statusCode, late.body).toBe(409);
    expect(errorOf(late)).toBe('job_paid');
    expect((await prisma.serviceWork.findUniqueOrThrow({ where: { id: line.id } })).normSec).toBe(1200);
    expect(await jobOf(owner.cookie, one)).toMatchObject({ worksCostTetri: 1667, paid: { payoutId: payout.id } });

    // The norm first, held open: the mark waits for it, then finds the sum is not what the owner saw.
    const vt = await freeVehicle();
    const two = await repairInWork(mech.cookie, chief.cookie, vt.vehicle.id, [{ freeText: 'ТЕСТ grease the stand' }]);
    await closeRepair(mech.cookie, two);
    const line2 = (await jobOf(owner.cookie, two)).works[0]!;
    expect((await call(chief.cookie, 'PATCH', `/api/service/${two}/works/${line2.id}`, { normMin: 20 })).statusCode).toBe(200);
    const seen = (await dueOf(owner.cookie, mech.id))!;
    expect(seen).toMatchObject({ jobIds: [two], totalTetri: 1667 });
    let mark: ReturnType<typeof call> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT 1 FROM service_jobs WHERE id = ${two}::uuid FOR UPDATE`;
      await tx.serviceWork.update({ where: { id: line2.id }, data: { normSec: 1500 } });
      mark = call(owner.cookie, 'POST', '/api/service/payouts', markOf(seen));
      await pause();
    });
    const stale = await mark!;
    expect(stale.statusCode, stale.body).toBe(409);
    expect(errorOf(stale)).toBe('payout_changed');
    expect(json<{ mechanic: Due }>(stale).mechanic).toMatchObject({ jobIds: [two], workTetri: 2083 });
    expect(await prisma.mechanicPayout.count({ where: { mechanicId: mech.id } })).toBe(1);
    expect(await prisma.serviceJob.count({ where: { id: two, paidInPayoutId: null } })).toBe(1);
  });
});

/** A cookie header from what the answer set, joined to what the browser already had. */
function withCookies(res: { cookies: { name: string; value: string }[] }, ...had: (string | null)[]): string {
  return [...had.filter(Boolean), ...res.cookies.map((c) => `${c.name}=${c.value}`)].join('; ');
}

/** The chief mechanic signed in with a PIN on a workshop tablet the owner registered (ADR-0033 §7). */
async function chiefOnTablet(owner: string): Promise<{ id: string; cookie: string }> {
  const tablet = await call(owner, 'POST', '/api/workshop/devices', { name: `Tablet ${uniq()}` });
  expect(tablet.statusCode, tablet.body).toBe(201);
  const device = withCookies(tablet).split('; ').find((c) => c.startsWith('ev8_device='))!;
  const made = await call(owner, 'POST', '/api/users', { name: `Test chief_mechanic ${uniq()}`, role: 'chief_mechanic' });
  expect(made.statusCode, made.body).toBe(201);
  const { id } = json<{ id: string }>(made);
  expect((await call(owner, 'POST', `/api/users/${id}/pin`, { pin: '4826' })).statusCode).toBe(200);
  const signed = await call(device, 'POST', '/api/auth/pin', { userId: id, pin: '4826' });
  expect(signed.statusCode, signed.body).toBe(200);
  return { id, cookie: withCookies(signed, device) };
}

interface Bucket {
  jobs: { id: string; number: string; amountTetri: number }[];
  tetri: number;
}

interface Balance {
  mechanic: { id: string; rateTetri: number };
  payable: Due;
  waiting: Bucket;
  open: Bucket;
  unnormed: Bucket;
  payouts: Payout[];
}

async function balanceOf(cookie: string): Promise<Balance> {
  const res = await call(cookie, 'GET', '/api/service/balance');
  expect(res.statusCode, res.body).toBe(200);
  return json<Balance>(res);
}

describe.skipIf(!HAS_DB)('who marks a payout, and whose balance (ADR-0037; ADR-0033 §7)', () => {
  it('only an owner at a password session reads «К оплате», marks and voids', async () => {
    const owner = await person('owner');
    const someone = '00000000-0000-4000-8000-000000000000';
    const tablet = await chiefOnTablet(owner.cookie);
    const people = [(await person('mechanic')).cookie, (await person('chief_mechanic')).cookie, (await person('manager')).cookie, tablet.cookie];
    for (const cookie of people) {
      for (const [method, url, body] of [
        ['GET', '/api/service/payouts', undefined],
        ['POST', '/api/service/payouts', { mechanicId: someone, jobIds: [], partIds: [], totalTetri: 0 }],
        ['POST', `/api/service/payouts/${someone}/void`, { reason: 'ТЕСТ' }],
      ] as const) {
        const res = await call(cookie, method, url, body);
        expect(res.statusCode, `${method} ${url}`).toBe(403);
        expect(json<{ permission: string }>(res).permission).toBe('service.payout');
      }
    }
    // The tablet reads its own balance; repairs are what it is for.
    const own = await call(tablet.cookie, 'GET', '/api/service/balance');
    expect(own.statusCode, own.body).toBe(200);
    expect(json<{ mechanic: { id: string } }>(own).mechanic.id).toBe(tablet.id);
  });

  it('a mechanic’s balance is his own repairs and money only; an owner’s is empty', async () => {
    const owner = await person('owner');
    const mech = await person('mechanic');
    const other = await person('mechanic');
    const chief = await person('chief_mechanic');
    const w30 = await ownWork(owner.cookie, 30);
    const w20 = await ownWork(owner.cookie, 20);

    const payable = await closedRepair(mech.cookie, chief.cookie, [{ workTypeId: w30.id }]);
    const { vehicle } = await freeVehicle();
    const unnormed = await repairInWork(mech.cookie, chief.cookie, vehicle.id, [{ freeText: 'ТЕСТ reseat the seat lock' }]);
    await closeRepair(mech.cookie, unnormed);
    const vw = await freeVehicle();
    const waitingRes = await call(mech.cookie, 'POST', '/api/service/workshop', opening(vw.vehicle.id, [{ workTypeId: w30.id }]));
    expect(waitingRes.statusCode, waitingRes.body).toBe(201);
    const waiting = json<{ id: string }>(waitingRes).id;
    const vo = await freeVehicle();
    const open = await repairInWork(mech.cookie, chief.cookie, vo.vehicle.id, [{ workTypeId: w20.id }]);
    await boughtPart(mech.cookie, open, '2,50');
    expect((await call(chief.cookie, 'POST', `/api/service/${open}/approve`)).statusCode).toBe(200);
    const others = await closedRepair(other.cookie, chief.cookie, [{ workTypeId: w20.id }]);
    const paidBefore = await pay(owner.cookie, (await dueOf(owner.cookie, other.id))!);

    const mine = await balanceOf(mech.cookie);
    expect(mine.mechanic).toEqual({ id: mech.id, name: 'Test mechanic', rateTetri: 5000 });
    expect(mine.payable).toMatchObject({ id: mech.id, jobIds: [payable], workTetri: 2500, totalTetri: 2500 });
    expect(mine.waiting).toEqual({ jobs: [{ id: waiting, number: expect.any(String), amountTetri: 2500 }], tetri: 2500 });
    // In work: his work and the part he paid for.
    expect(mine.open).toEqual({ jobs: [{ id: open, number: expect.any(String), amountTetri: 1917 }], tetri: 1917 });
    // Without a norm, its work is nothing yet.
    expect(mine.unnormed).toEqual({ jobs: [{ id: unnormed, number: expect.any(String), amountTetri: 0 }], tetri: 0 });
    expect(mine.payouts).toEqual([]);
    expect(JSON.stringify(mine)).not.toContain(others);

    const theirs = await balanceOf(other.cookie);
    expect(theirs.payable).toMatchObject({ jobs: [], totalTetri: 0, jobIds: [], partIds: [] });
    expect(theirs.payouts.map((p) => p.id)).toEqual([paidBefore.id]);
    expect(theirs.payouts[0]).toMatchObject({ labourTetri: 1667, jobs: [{ id: others }], markedBy: { id: owner.id } });
    for (const id of [payable, unnormed, waiting, open]) expect(JSON.stringify(theirs)).not.toContain(id);

    const owners = await balanceOf(owner.cookie);
    expect(owners).toMatchObject({
      mechanic: { id: owner.id },
      payable: { jobs: [], otherReceipts: [], totalTetri: 0 },
      waiting: { jobs: [], tetri: 0 },
      open: { jobs: [], tetri: 0 },
      unnormed: { jobs: [], tetri: 0 },
      payouts: [],
    });
    await settle(owner.cookie, waiting, open);
  });

  it('a chief mechanic’s balance shows what he paid in another mechanic’s repair wherever that repair stands', async () => {
    const owner = await person('owner');
    const mech = await person('mechanic');
    const chief = await person('chief_mechanic');
    const { vehicle } = await freeVehicle();
    const id = await repairInWork(mech.cookie, chief.cookie, vehicle.id, [{ freeText: 'ТЕСТ true the front wheel' }]);
    // Bought by the chief for the mechanic's repair in work: approved as he writes it, his own money back.
    const part = await boughtPart(chief.cookie, id, '4,50');
    const his = { id, number: expect.any(String), amountTetri: 450 };
    const none = { jobs: [], tetri: 0 };
    let b = await balanceOf(chief.cookie);
    expect([b.waiting, b.open, b.unnormed]).toEqual([none, { jobs: [his], tetri: 450 }, none]);

    // A work found later: the repair waits, and his money with it.
    expect((await call(mech.cookie, 'POST', `/api/service/${id}/works`, { works: [{ freeText: 'ТЕСТ a new spoke' }] })).statusCode).toBe(201);
    b = await balanceOf(chief.cookie);
    expect([b.waiting, b.open, b.unnormed]).toEqual([{ jobs: [his], tetri: 450 }, none, none]);

    // Approved without norms and closed: it waits for a norm, and says how much is held there.
    expect((await call(chief.cookie, 'POST', `/api/service/${id}/approve`)).statusCode).toBe(200);
    await closeRepair(mech.cookie, id);
    b = await balanceOf(chief.cookie);
    expect([b.waiting, b.open, b.unnormed]).toEqual([none, none, { jobs: [his], tetri: 450 }]);
    expect(b.payable.partIds).toEqual([]);
    // The repair's own mechanic sees it there too, his work at no norm yet worth nothing.
    expect((await balanceOf(mech.cookie)).unnormed).toEqual({ jobs: [{ id, number: expect.any(String), amountTetri: 0 }], tetri: 0 });

    // Normed, it is owed: his receipt is in «payable» and nowhere else.
    for (const l of (await jobOf(owner.cookie, id)).works) {
      expect((await call(chief.cookie, 'PATCH', `/api/service/${id}/works/${l.id}`, { normMin: 10 })).statusCode).toBe(200);
    }
    b = await balanceOf(chief.cookie);
    expect([b.waiting, b.open, b.unnormed]).toEqual([none, none, none]);
    expect(b.payable).toMatchObject({ partIds: [part], reimburseTetri: 450, otherReceipts: [{ id: part, jobId: id, paidTetri: 450 }] });
  });
});

describe.skipIf(!HAS_DB)('a mechanic who rents a moped (director, 22.10.2026; 0066)', () => {
  it('the payout pays his rent first, never more than it owes; voided, the rent is owed again', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const chief = await person('chief_mechanic');
    const mech = await person('mechanic');
    const w = await ownWork(owner.cookie, 30);
    // His own card, invented, and a moped handed over to it today: the deposit and the first week are owed.
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ механик-арендатор ${uniq()}` } });
    const { vehicle } = await freeVehicle();
    const made = await call(owner.cookie, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: todayISO(new Date(), 'Asia/Tbilisi') });
    expect(made.statusCode, made.body).toBe(201);
    const rentalId = json<{ id: string }>(made).id;
    const linked = await call(owner.cookie, 'PATCH', `/api/users/${mech.id}`, { customerId: customer.id });
    expect(linked.statusCode, linked.body).toBe(200);

    await closedRepair(mech.cookie, chief.cookie, [{ workTypeId: w.id }]);
    const due = (await dueOf(owner.cookie, mech.id))!;
    expect(due.rent).toMatchObject({ customerId: customer.id, rentalId });
    const rent = due.rent!;
    expect(rent.owedTetri).toBeGreaterThan(0);
    expect(rent.offsetTetri).toBe(Math.min(due.totalTetri, rent.owedTetri));
    expect(rent.cashTetri).toBe(due.totalTetri - rent.offsetTetri);

    // A screen that did not show the rent does not mark.
    const blind = await call(owner.cookie, 'POST', '/api/service/payouts', { ...markOf(due), offsetTetri: 0 });
    expect(blind.statusCode).toBe(409);
    expect(errorOf(blind)).toBe('payout_changed');

    const payout = await pay(owner.cookie, due);
    expect(payout).toMatchObject({ totalTetri: due.totalTetri, offsetTetri: rent.offsetTetri, cashTetri: rent.cashTetri });
    const row = await prisma.mechanicPayout.findUniqueOrThrow({ where: { id: payout.id } });
    const paid = await prisma.payment.findUniqueOrThrow({ where: { id: row.offsetPaymentId! }, include: { allocations: true } });
    expect(paid).toMatchObject({ channel: 'offset', kind: 'rent', rentalId, customerId: customer.id, grossTetri: rent.offsetTetri, voidedAt: null });
    expect(paid.allocations.reduce((n, a) => n + a.amountTetri, 0)).toBe(rent.offsetTetri);
    // Nothing waits for a bank line or a till: it is in neither.
    expect(paid.statementLineId).toBeNull();
    // It pays the first week, oldest first, and never the deposit (ADR-0043).
    const firstWeek = () => prisma.rentalPeriod.findFirstOrThrow({ where: { rentalId }, orderBy: { seq: 'asc' }, select: { paidTetri: true } });
    expect((await firstWeek()).paidTetri).toBe(rent.offsetTetri);
    expect(paid.allocations.every((a) => a.target === 'period')).toBe(true);
    expect((await prisma.deposit.findUnique({ where: { rentalId }, select: { paidTetri: true } }))?.paidTetri ?? 0).toBe(0);
    // «Платежи» finds it under «Зачёт работ», and counts no money in for it.
    const listed = await call(owner.cookie, 'GET', `/api/payments?rentalId=${rentalId}&channel=offset`);
    expect(listed.statusCode, listed.body).toBe(200);
    const list = json<{ totals: { inTetri: number }; payments: { id: string; channel: string }[] }>(listed);
    expect(list.payments.map((p) => p.id)).toEqual([paid.id]);
    expect(list.totals.inTetri).toBe(0);
    // Its own page offers no «Аннулировать»: the payout is what is voided.
    const card = json<{ canVoid: boolean }>(await call(owner.cookie, 'GET', `/api/payments/${paid.id}`));
    expect(card.canVoid).toBe(false);

    // Voided alone from «Платежи», it is refused: the payout still says it.
    const alone = await call(owner.cookie, 'POST', `/api/payments/${paid.id}/void`, { reason: 'ТЕСТ alone' });
    expect(alone.statusCode).toBe(409);
    expect(errorOf(alone)).toBe('offset_of_payout');

    // The payout voided takes it with it, and the rent is owed again.
    const voided = await call(owner.cookie, 'POST', `/api/service/payouts/${payout.id}/void`, { reason: 'ТЕСТ wrong mark' });
    expect(voided.statusCode, voided.body).toBe(200);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paid.id } })).voidedAt).not.toBeNull();
    expect(await prisma.paymentAllocation.count({ where: { paymentId: paid.id } })).toBe(0);
    expect((await firstWeek()).paidTetri).toBe(0);
    expect((await dueOf(owner.cookie, mech.id))?.rent).toMatchObject({ rentalId, owedTetri: rent.owedTetri });
  });

  it('only a mechanic’s payouts pay a rent, and one card is one person’s', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const manager = await person('manager');
    const mech = await person('mechanic');
    const other = await person('mechanic');
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ карточка ${uniq()}` } });
    const notMechanic = await call(owner.cookie, 'PATCH', `/api/users/${manager.id}`, { customerId: customer.id });
    expect(notMechanic.statusCode).toBe(409);
    expect(errorOf(notMechanic)).toBe('renter_for_mechanics');
    expect((await call(owner.cookie, 'PATCH', `/api/users/${mech.id}`, { customerId: customer.id })).statusCode).toBe(200);
    const taken = await call(owner.cookie, 'PATCH', `/api/users/${other.id}`, { customerId: customer.id });
    expect(taken.statusCode).toBe(409);
    expect(errorOf(taken)).toBe('customer_taken');
    // The journal says the link by the card's name, ids being hidden there.
    const setLine = await prisma.auditLog.findFirstOrThrow({ where: { entityId: mech.id, action: 'user.update' }, orderBy: { createdAt: 'desc' } });
    expect(setLine.before).toMatchObject({ renter: null });
    expect(setLine.after).toMatchObject({ renter: customer.name });
    // Unlinked, the card is free again.
    expect((await call(owner.cookie, 'PATCH', `/api/users/${mech.id}`, { customerId: null })).statusCode).toBe(200);
    const offLine = await prisma.auditLog.findFirstOrThrow({ where: { entityId: mech.id, action: 'user.update' }, orderBy: { createdAt: 'desc' } });
    expect(offLine.before).toMatchObject({ renter: customer.name });
    expect(offLine.after).toMatchObject({ renter: null });
    expect((await call(owner.cookie, 'PATCH', `/api/users/${other.id}`, { customerId: customer.id })).statusCode).toBe(200);
  });

  it('a week is put work on from its pay day, as the customer’s debt counts it (ADR-0022)', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const chief = await person('chief_mechanic');
    const mech = await person('mechanic');
    const w = await ownWork(owner.cookie, 30);
    const customer = await prisma.customer.create({ data: { name: `ТЕСТ механик с днём оплаты ${uniq()}` } });
    const { vehicle } = await freeVehicle();
    const today = todayISO(new Date(), 'Asia/Tbilisi');
    const made = await call(owner.cookie, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, pickedUpOn: today });
    expect(made.statusCode, made.body).toBe(201);
    const rentalId = json<{ id: string }>(made).id;
    // Its rent is due three days into each week: the week that began today is not owed yet.
    await prisma.rental.update({ where: { id: rentalId }, data: { payWeekday: ((isoWeekday(today) + 2) % 7) + 1 } });
    expect((await call(owner.cookie, 'PATCH', `/api/users/${mech.id}`, { customerId: customer.id })).statusCode).toBe(200);
    await closedRepair(mech.cookie, chief.cookie, [{ workTypeId: w.id }]);
    expect((await dueOf(owner.cookie, mech.id))?.rent).toBeNull();
    // Due on its first day again, the week is owed, and the payout pays it.
    await prisma.rental.update({ where: { id: rentalId }, data: { payWeekday: null } });
    expect((await dueOf(owner.cookie, mech.id))?.rent).toMatchObject({ rentalId, owedTetri: 15000 });
  });

  it('two cards merged into one keep the mechanic’s link; two linked cards are not merged', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await person('owner');
    const mech = await person('mechanic');
    const other = await person('mechanic');
    const kept = await prisma.customer.create({ data: { name: `ТЕСТ остаётся ${uniq()}` } });
    const dropped = await prisma.customer.create({ data: { name: `ТЕСТ дубль ${uniq()}` } });
    expect((await call(owner.cookie, 'PATCH', `/api/users/${mech.id}`, { customerId: dropped.id })).statusCode).toBe(200);
    const merged = await call(owner.cookie, 'POST', `/api/customers/${kept.id}/merge`, { fromId: dropped.id, reason: 'ТЕСТ one person' });
    expect(merged.statusCode, merged.body).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: mech.id }, select: { customerId: true } })).customerId).toBe(kept.id);

    // A third card linked to another mechanic does not fold into his.
    const third = await prisma.customer.create({ data: { name: `ТЕСТ третья ${uniq()}` } });
    expect((await call(owner.cookie, 'PATCH', `/api/users/${other.id}`, { customerId: third.id })).statusCode).toBe(200);
    const refused = await call(owner.cookie, 'POST', `/api/customers/${kept.id}/merge`, { fromId: third.id, reason: 'ТЕСТ two people' });
    expect(refused.statusCode).toBe(409);
    expect(errorOf(refused)).toBe('merge_two_renters');
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: third.id }, select: { archived: true } })).archived).toBe(false);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id }, select: { customerId: true } })).customerId).toBe(third.id);
  });
});
