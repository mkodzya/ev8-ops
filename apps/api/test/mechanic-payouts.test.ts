// Paying the mechanic (stage 5 of docs/spec/mechanic-in-erp-plan.md;
// ADR-0037). What a repair cost now carries its mechanic's approved work on
// the company's own repairs, rounded once per repair, in every place that sums
// a repair; a paid repair is not changed any more, and the database will not
// let a repair or a receipt be paid in somebody else's payout. Mopeds, people,
// parts and photos are invented test values; a payout is written straight into
// the database here — the routes that mark one come with the «К оплате» screen.
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
async function person(role: 'mechanic' | 'chief_mechanic' | 'owner') {
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
