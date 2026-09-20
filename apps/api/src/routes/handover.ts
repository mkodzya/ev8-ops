import { DEFAULT_DEPOSIT_TETRI, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { env } from '../lib/env.js';
import { badRequest, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { decideDeposit, pickUp, returnPreview, returnRental, setRentalStatus, undoReturn, type DepositDecision, type NewCustomer, type PickupInput } from '../lib/rentals.js';
import { WITHHOLD_GROUNDS } from '../lib/pdf/returnAct.js';
import { date, int, oneOf, str, strList, tetri } from '../lib/validate.js';

// Hand-over and return, as the wave 3 wizards send them (wave 3 §3.1, §3.4–§3.7).

type Body = Record<string, unknown>;
/** A hand-over carries the ID card picture: one operation, one body (B2-01). */
const PICKUP_BODY_LIMIT = 16 * 1024 * 1024;
const PHOTO_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

function photo(b: unknown): { bytes: Buffer; mime: string } | null {
  if (!b || typeof b !== 'object') return null;
  const o = b as Record<string, unknown>;
  const mime = typeof o.mimeType === 'string' ? o.mimeType : '';
  const data = typeof o.dataBase64 === 'string' ? o.dataBase64 : '';
  if (!data) return null;
  if (!PHOTO_MIME.has(mime)) throw badRequest('bad_mime', 'The ID card is a picture: JPEG, PNG or WebP.', { field: 'idPhoto' });
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length > 10 * 1024 * 1024) throw badRequest('file_too_big', 'Files up to 10 MB.', { field: 'idPhoto' });
  return { bytes, mime };
}

function pickupInput(req: { body: Body }, actor: PickupInput['actor'], strict: boolean): PickupInput {
  const b = req.body ?? {};
  const today = todayISO(new Date(), env.TZ);
  const nc = b.newCustomer && typeof b.newCustomer === 'object' ? (b.newCustomer as Body) : null;
  const newCustomer: NewCustomer | null = nc
    ? {
        name: str(nc, 'name', { max: 200 }) ?? '',
        phone: str(nc, 'phone', { max: 40 }) ?? '',
        personalId: str(nc, 'personalId', { max: 40 }) ?? '',
        nameKa: str(nc, 'nameKa', { max: 200 }),
        nameLat: str(nc, 'nameLat', { max: 200 }),
        idPhoto: photo(nc.idPhoto),
        licencePhoto: photo(nc.licencePhoto),
      }
    : null;
  const pay = b.payment && typeof b.payment === 'object' ? (b.payment as Body) : null;
  const tr = b.transfer && typeof b.transfer === 'object' ? (b.transfer as Body) : null;
  const vehicleId = str(b, 'vehicleId');
  const vinNote = str(b, 'vinNote', { max: 200 });
  if (!vehicleId && !vinNote) throw badRequest('vin_or_note', 'Pick a moped from the fleet, or say why the VIN is not confirmed.', { field: 'vehicleId' });
  return {
    actor,
    today,
    customerId: newCustomer ? null : str(b, 'customerId'),
    newCustomer,
    vehicleId,
    vinNote,
    moveFromSale: b.moveFromSale === true,
    weeklyRateTetri: tetri(b, 'weeklyRateTetri', { required: true, min: 0 })!,
    depositTetri: tetri(b, 'depositTetri', { min: 0 }) ?? DEFAULT_DEPOSIT_TETRI,
    pickedUpOn: date(b, 'pickedUpOn') ?? today,
    expectedReturnOn: date(b, 'expectedReturnOn'),
    odometerKm: int(b, 'odometerKm', { min: 0 }),
    odometerReason: str(b, 'odometerReason', { max: 500 }),
    condition: str(b, 'condition', { max: 4000 }),
    notes: str(b, 'notes', { max: 4000 }),
    buyoutTargetTetri: tetri(b, 'buyoutTargetTetri', { min: 1 }),
    buyoutPerPaymentTetri: tetri(b, 'buyoutPerPaymentTetri', { min: 1 }),
    nightParkingAddress: str(b, 'nightParkingAddress', { max: 300 }),
    batteries: int(b, 'batteries', { min: 0 }),
    chargers: int(b, 'chargers', { min: 0 }),
    payment: !pay
      ? null
      : pay.later === true
        ? { later: true }
        : { later: false, channel: oneOf(pay, 'channel', ['cash', 'acquiring', 'transfer'] as const, { required: true })!, amountTetri: tetri(pay, 'amountTetri', { required: true, min: 1 })! },
    transfer: tr ? { paidThrough: date(tr, 'paidThrough'), depositReceivedTetri: tetri(tr, 'depositReceivedTetri', { min: 0 }) ?? 0 } : null,
    debtOverrideReason: str(b, 'debtOverrideReason', { max: 1000 }),
    strict,
  };
}

function decisionOf(b: unknown): DepositDecision | null {
  if (!b || typeof b !== 'object') return null;
  const d = b as Body;
  const action = oneOf(d, 'action', ['return_all', 'withhold'] as const, { required: true })!;
  const grounds = strList(d, 'grounds');
  for (const g of grounds) if (!(WITHHOLD_GROUNDS as readonly string[]).includes(g)) throw badRequest('bad_field', `Unknown ground ${g}`, { field: 'grounds' });
  return {
    action,
    withheldTetri: action === 'withhold' ? tetri(d, 'withheldTetri', { required: true, min: 1 })! : 0,
    grounds,
    reason: str(d, 'reason', { max: 1000 }),
    returnedTo: str(d, 'returnedTo', { max: 200 }),
    returnedToReason: str(d, 'returnedToReason', { max: 500 }),
  };
}

const ITEM_KEY = /^(moped|key|battery_\d{1,2}|charger_\d{1,2})$/;

function itemsOf(b: Body): Record<string, { state: 'ok' | 'damaged' | 'missing'; note: string | null }> {
  const raw = b.items && typeof b.items === 'object' ? (b.items as Record<string, unknown>) : {};
  const out: Record<string, { state: 'ok' | 'damaged' | 'missing'; note: string | null }> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (!ITEM_KEY.test(k) || !v || typeof v !== 'object') continue;
    const item = v as Body;
    out[k] = { state: oneOf(item, 'state', ['ok', 'damaged', 'missing'] as const) ?? 'ok', note: str(item, 'note', { max: 500 }) };
  }
  return out;
}

export function handoverRoutes(app: FastifyInstance): void {
  /** The hand-over wizard's one operation (wave 3 §3.1, step 6). */
  app.post<{ Body: Body }>('/api/pickups', { config: { scope: 'rental.create' }, bodyLimit: PICKUP_BODY_LIMIT }, async (req, reply) => {
    return reply.code(201).send(await pickUp(pickupInput(req, actorOf(req), true)));
  });

  /** The earlier entry point, for what still posts to it: no payment step, fewer required fields. */
  app.post<{ Body: Body }>('/api/rentals', { config: { scope: 'rental.create' }, bodyLimit: PICKUP_BODY_LIMIT }, async (req, reply) => {
    return reply.code(201).send(await pickUp(pickupInput(req, actorOf(req), false)));
  });

  /** What the return comes to, before it is written (§3.4 step 2). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/return/preview', { config: { scope: 'rental.return' } }, async (req) => {
    const b = req.body ?? {};
    return returnPreview({
      rentalId: req.params.id,
      returnedOn: date(b, 'returnedOn') ?? todayISO(new Date(), env.TZ),
      keyMissing: b.keyMissing === true,
      lateChoice: oneOf(b, 'lateChoice', ['week', 'late'] as const),
    });
  });

  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/return', { config: { scope: 'rental.return' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const today = todayISO(new Date(), env.TZ);
    return returnRental({
      actor,
      today,
      rentalId: req.params.id,
      returnedOn: date(b, 'returnedOn') ?? today,
      odometerKm: int(b, 'odometerKm', { min: 0 }),
      condition: str(b, 'condition', { max: 4000 }),
      items: itemsOf(b),
      toService: b.toService === true,
      locationId: str(b, 'locationId'),
      lateChoice: oneOf(b, 'lateChoice', ['week', 'late'] as const),
      decision: decisionOf(b.deposit ?? b.decision),
    });
  });

  /** "Решить": a deposit a manager's return left waiting (§3.5). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/deposit/decide', { config: { scope: 'deposit.decide' } }, async (req) => {
    const decision = decisionOf(req.body ?? {});
    if (!decision) throw badRequest('missing_field', 'action is required', { field: 'action' });
    await decideDeposit({ actor: actorOf(req), rentalId: req.params.id, decision, today: todayISO(new Date(), env.TZ) });
    return { ok: true };
  });

  /** "Отменить возврат": an owner, within a day, with a reason (§3.7, B5-08). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/return/undo', { config: { scope: 'deposit.decide' } }, async (req) => {
    await undoReturn({ actor: actorOf(req), rentalId: req.params.id, reason: str(req.body ?? {}, 'reason', { max: 1000 }) ?? '', today: todayISO(new Date(), env.TZ) });
    return { ok: true };
  });

  /** A message sent by hand from WhatsApp: the rental's feed says it happened (wave 4 §3.2, В6). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/whatsapp', { config: { scope: 'fleet.view' } }, async (req) => {
    const b = req.body ?? {};
    const actor = actorOf(req);
    const template = oneOf(b, 'template', ['overdue', 'tomorrow'] as const, { required: true })!;
    const lang = oneOf(b, 'lang', ['ka', 'ru', 'en'] as const, { required: true })!;
    const r = await prisma.rental.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    await audit({ actorId: actor.id, action: 'rental.whatsapp', entityType: 'rental', entityId: r.id, after: { template, lang } });
    return { ok: true };
  });

  /** Pause · Disputed · Running again — an owner, with a reason (§3.7, Q11). */
  app.post<{ Params: { id: string }; Body: Body }>('/api/rentals/:id/status', { config: { scope: 'deposit.decide' } }, async (req) => {
    const b = req.body ?? {};
    await setRentalStatus({
      actor: actorOf(req),
      rentalId: req.params.id,
      status: oneOf(b, 'status', ['active', 'paused', 'disputed'] as const, { required: true })!,
      reason: str(b, 'reason', { max: 1000 }) ?? '',
      today: todayISO(new Date(), env.TZ),
    });
    return { ok: true };
  });
}
