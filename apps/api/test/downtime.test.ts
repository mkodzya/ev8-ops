// Repair downtime in hours on live rows (stage 6; ADR-0038 §5): the repair,
// the moped's card, the week and utilisation. The suites share one database,
// so the period figures are read before and after this file's repairs and the
// difference is what is checked. Mopeds and repairs are invented.
import { addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

type Hours = { minutes: number; waitMinutes: number; running?: boolean };
type Period = { minutes: number; waitMinutes: number; counted: number; unknown: number };

const today = () => todayISO(new Date(), 'Asia/Tbilisi');
const T = (day: string, time: string) => new Date(`${day}T${time}:00+04:00`);

async function moped() {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Downtime ${uniq()}` } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTDT${uniq().replace(/\D/g, '').slice(-11).padStart(11, '0')}`, modelId: model.id } });
  return { prisma, vehicle };
}

/**
 * Three days ago, 23:30 Tbilisi, to 01:30 the next night, ten minutes of it
 * waiting; a repair from before stage 2 with no minute of opening; and one
 * called off by mistake, which never stood.
 */
async function repairs() {
  const { prisma, vehicle } = await moped();
  const day = addDays(today(), -3);
  const next = addDays(day, 1);
  const night = await prisma.serviceJob.create({
    data: {
      vehicleId: vehicle.id, reason: 'ТЕСТ night', status: 'done', payer: 'company',
      openedOn: new Date(`${day}T00:00:00Z`), openedAt: T(day, '23:30'), approvedAt: T(day, '23:40'),
      closedOn: new Date(`${next}T00:00:00Z`), closedAt: T(next, '01:30'),
    },
  });
  const old = await prisma.serviceJob.create({
    data: { vehicleId: vehicle.id, reason: 'ТЕСТ old', status: 'done', payer: 'company', openedOn: new Date(`${day}T00:00:00Z`), openedAt: null, closedOn: new Date(`${next}T00:00:00Z`) },
  });
  const mistake = await prisma.serviceJob.create({
    data: {
      vehicleId: vehicle.id, reason: 'ТЕСТ mistake', status: 'cancelled', payer: 'company',
      openedOn: new Date(`${day}T00:00:00Z`), openedAt: T(day, '10:00'), closedOn: new Date(`${day}T00:00:00Z`), closedAt: T(day, '18:00'),
    },
  });
  return { vehicle, day, next, night, old, mistake };
}

const minus = (a: Period, b: Period): Period => ({ minutes: a.minutes - b.minutes, waitMinutes: a.waitMinutes - b.waitMinutes, counted: a.counted - b.counted, unknown: a.unknown - b.unknown });

describe.skipIf(!HAS_DB)('repair downtime in hours (stage 6)', () => {
  it('a repair says how long the moped stood in it and how long it waited — and «not known» where it cannot', async () => {
    const owner = await loginAs('owner');
    const { night, old } = await repairs();
    const seen = async (id: string) => json<{ job: { downtime: Hours | null } }>(await call(owner, 'GET', `/api/service/${id}`)).job.downtime;
    expect(await seen(night.id)).toEqual({ minutes: 120, waitMinutes: 10, running: false });
    expect(await seen(old.id)).toBeNull();
    // Not money, not hidden: a manager reads it too.
    const manager = await loginAs('manager');
    expect(json<{ job: { downtime: Hours | null } }>(await call(manager, 'GET', `/api/service/${night.id}`)).job.downtime?.minutes).toBe(120);
  });

  it('the moped’s card: each repair’s hours, and the last 30 days with the unknown one apart', async () => {
    const owner = await loginAs('owner');
    const { vehicle, night, old, mistake } = await repairs();
    const card = json<{ serviceJobs: { id: string; downtime: Hours | null }[]; downtime30: Period }>(await call(owner, 'GET', `/api/fleet/${vehicle.id}`));
    const of = (id: string) => card.serviceJobs.find((j) => j.id === id)?.downtime;
    expect(of(night.id)).toEqual({ minutes: 120, waitMinutes: 10, running: false });
    expect(of(old.id)).toBeNull();
    // Shown on the repair itself; left out of the sums.
    expect(of(mistake.id)).toEqual({ minutes: 480, waitMinutes: 0, running: false });
    expect(card.downtime30).toEqual({ minutes: 120, waitMinutes: 10, counted: 1, unknown: 1 });
  });

  it('the week and utilisation carry the hours of their Tbilisi days', async () => {
    const owner = await loginAs('owner');
    const day = addDays(today(), -3);
    const q = (from: string, to: string) => `?from=${from}&to=${to}`;
    const week = async (from: string, to: string) => json<{ fleet: { repairs: Period } }>(await call(owner, 'GET', `/api/reports/week${q(from, to)}`)).fleet.repairs;
    const util = async (from: string, to: string) => json<{ repairs: Period }>(await call(owner, 'GET', `/api/reports/utilisation${q(from, to)}`)).repairs;
    const both = addDays(day, 1);
    const before = { week: await week(day, both), first: await week(day, day), util: await util(day, both) };
    await repairs();
    expect(minus(await week(day, both), before.week)).toEqual({ minutes: 120, waitMinutes: 10, counted: 1, unknown: 1 });
    // Cut at Tbilisi midnight: half an hour of it falls on the first day.
    expect(minus(await week(day, day), before.first)).toEqual({ minutes: 30, waitMinutes: 10, counted: 1, unknown: 1 });
    expect(minus(await util(day, both), before.util)).toEqual({ minutes: 120, waitMinutes: 10, counted: 1, unknown: 1 });
  });
});
