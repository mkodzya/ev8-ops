// The tracker on a moped (ADR-0036 §7): read off its sticker by its IMEI and
// the SIM's number, and fixed to one moped at a time. A repair fits one off
// the shelf or a donor; an owner writes one already on the moped from the
// moped's card (addendum 21.10.2026). Both go through here, so both refuse the
// same things in the same words.
import { fleetNumber, readImei, readSimPhone } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { dateFromISO, isoDate } from './dates.js';
import { badRequest, conflict, isUniqueViolation } from './errors.js';
import { str } from './validate.js';

type Tx = Prisma.TransactionClient;
type Body = Record<string, unknown>;

/** The IMEI off the sticker: fifteen digits, the last one checking the rest. */
export function readImeiOf(b: Body): string {
  const imei = readImei(str(b, 'imei', { required: true, max: 40 }));
  if (!imei) throw badRequest('imei_bad', 'An IMEI is fifteen digits off the sticker; the last one checks the rest.', { field: 'imei' });
  return imei;
}

/** The SIM's number, as its digits and a leading «+» if it had one. */
export function readSimOf(b: Body): string {
  const simPhone = readSimPhone(str(b, 'sim', { required: true, max: 40 }));
  if (!simPhone) throw badRequest('sim_bad', 'A SIM number is its digits.', { field: 'sim' });
  return simPhone;
}

/** The IMEI and the SIM of a tracker being fitted or written: both are asked for. */
export function readTracker(b: Body): { imei: string; simPhone: string } {
  return { imei: readImeiOf(b), simPhone: readSimOf(b) };
}

/** An IMEI working on some moped other than the one given — the one place it may be. */
export async function imeiOpenElsewhere(tx: Tx, imei: string, exceptTrackerId: string | null = null) {
  return tx.vehicleTracker.findFirst({
    where: { imei, removedOn: null, ...(exceptTrackerId ? { id: { not: exceptTrackerId } } : {}) },
    select: { id: true, vehicleId: true, installedOn: true, vehicle: { select: { fleetNo: true, vin: true } } },
  });
}

/** «This IMEI is on EV-012 since …»: the refusal names where to take it off. */
export function imeiInUse(elsewhere: { installedOn: Date; vehicle: { fleetNo: number | null; vin: string } } | null) {
  return conflict(
    'tracker_imei_in_use',
    'This IMEI is on another moped; take it off there first.',
    elsewhere ? { vehicle: fleetNumber(elsewhere.vehicle.fleetNo) ?? `···${elsewhere.vehicle.vin.slice(-6)}`, since: isoDate(elsewhere.installedOn) } : undefined,
  );
}

/**
 * A tracker goes onto the moped (ADR-0036). One at a time on a moped, and an
 * IMEI on one moped at a time — the database refuses the second open row of
 * an IMEI whatever this says. Off a donor, the tracker moves with the part:
 * closed on the donor, opened here. Written from the card, there is no
 * repair, no part and no line: the row says where it came from by `source`.
 */
export async function fitTracker(
  tx: Tx,
  input: {
    vehicleId: string;
    /** The repair that fits it; none when an owner writes one already on the moped. */
    jobId: string | null;
    partId: string | null;
    servicePartId: string | null;
    donorVehicleId: string | null;
    imei: string;
    simPhone: string;
    on: string;
    actorId: string;
    /** `card` for a tracker written from the moped's card; empty for a repair's. */
    source?: string | null;
  },
): Promise<void> {
  const onMoped = await tx.vehicleTracker.findFirst({ where: { vehicleId: input.vehicleId, removedOn: null }, select: { imei: true } });
  if (onMoped) throw conflict('tracker_on_vehicle', 'This moped has a tracker; take that one off first.', { imei: `···${onMoped.imei.slice(-4)}` });
  const elsewhere = await imeiOpenElsewhere(tx, input.imei);
  if (elsewhere) {
    if (input.donorVehicleId == null || input.jobId == null || elsewhere.vehicleId !== input.donorVehicleId) throw imeiInUse(elsewhere);
    await tx.vehicleTracker.update({ where: { id: elsewhere.id }, data: { removedOn: dateFromISO(input.on)!, removedJobId: input.jobId, removedById: input.actorId } });
  }
  try {
    await tx.vehicleTracker.create({
      data: {
        vehicleId: input.vehicleId,
        partId: input.partId,
        imei: input.imei,
        simPhone: input.simPhone,
        installedOn: dateFromISO(input.on)!,
        serviceJobId: input.jobId,
        servicePartId: input.servicePartId,
        source: input.source ?? null,
        createdById: input.actorId,
      },
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw imeiInUse(null);
    throw e;
  }
}
