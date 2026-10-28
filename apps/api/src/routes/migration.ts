import { todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { oneOf, str } from '../lib/validate.js';
import { moveVehicle, openRentalOf } from '../lib/vehicles.js';

// Settings → Transfer (wave 6 §3.6–3.7).
//
// Everything the move from Odoo left half-said, in one place. The five
// starting states — a rental picked up before the move, a sale on
// instalments, the stock on the shelf, what was owed to a factory — are the
// wizards of waves 3 and 5 and are only linked from here. What this file
// does is the part nobody had a screen for: the deposits, the rentals whose
// VIN never came over, and the mopeds called "in service" with no repair
// behind them. The last list is no longer a part of «До EV8 Ops» since issue
// #18 (B6): it is a block of «Ремонты», read here by its own route, and the
// tab hides once its own two lists are empty (`migrationLeft`).
//
// **The counts are read, never written down here.** The wave's own text says
// "17 deposits" and "2 rentals without a VIN"; the stand says 42 and 26. A
// screen that prints a number from a document rather than from the database
// is the first wrong answer somebody acts on.

const DECISIONS = ['returned_earlier', 'kept_earlier', 'unknown'] as const;

/** From Odoo: the record carries the order it came over as. */
const FROM_ODOO = { odooOrderId: { not: null } } as const;

/**
 * What «До EV8 Ops» still asks of an owner: deposits brought over whose rental
 * has ended with no decision on them, and rentals brought over with no VIN —
 * the rows of its two lists. Nought: the tab is hidden (issue #18, B6).
 */
export async function migrationLeft(): Promise<number> {
  const [deposits, rentalsNoVin] = await Promise.all([
    prisma.deposit.count({ where: { status: 'held', decidedById: null, migrationDecision: null, rental: { ...FROM_ODOO, status: { in: ['returned', 'disputed'] } } } }),
    prisma.rental.count({ where: { vehicleId: null, ...FROM_ODOO } }),
  ]);
  return deposits + rentalsNoVin;
}

export function migrationRoutes(app: FastifyInstance): void {
  app.get('/api/migration', { config: { scope: 'users.manage' } }, async () => {
    const [deposits, rentalsNoVin] = await Promise.all([
      prisma.deposit.findMany({
        where: { status: 'held', decidedById: null, migrationDecision: null, rental: FROM_ODOO },
        include: { rental: { select: { id: true, number: true, status: true, returnedOn: true, customer: { select: { name: true } } } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.rental.findMany({
        where: { vehicleId: null, ...FROM_ODOO },
        select: { id: true, number: true, status: true, pickedUpOn: true, vinNote: true, customer: { select: { name: true } } },
        orderBy: [{ status: 'asc' }, { pickedUpOn: 'desc' }],
      }),
    ]);

    // A deposit on a rental that is still running needs no decision: the
    // moped is out and the money is meant to be held. Only the ones whose
    // rental has ended are asked about (§3.7).
    const due = deposits.filter((d) => d.rental.status === 'returned' || d.rental.status === 'disputed');
    const running = deposits.filter((d) => d.rental.status !== 'returned' && d.rental.status !== 'disputed');
    const sum = (rows: typeof deposits) => rows.reduce((n, d) => n + d.paidTetri, 0);

    return {
      deposits: {
        due: {
          count: due.length,
          amountTetri: sum(due),
          rows: due.map((d) => ({
            id: d.id,
            rentalId: d.rental.id,
            number: d.rental.number,
            who: d.rental.customer.name,
            rentalStatus: d.rental.status,
            endedOn: isoDate(d.rental.returnedOn),
            // Two sums, and they are not the same question. What was
            // received is what is being sorted out; what the contract asked
            // for is what Odoo knows when it knows nothing else. Where they
            // differ the screen says so, because the system cannot tell
            // "нет данных о платеже" from "залог не брали" and must not
            // pretend it can (designer, 22.09, §3.7 and crit. 25а).
            receivedTetri: d.paidTetri,
            contractTetri: d.amountTetri,
          })),
        },
        // Named, not hidden: an owner who reads "42 held" elsewhere has to
        // see where the other ones are.
        running: { count: running.length, amountTetri: sum(running) },
      },
      rentalsWithoutVin: {
        count: rentalsNoVin.length,
        rows: rentalsNoVin.map((r) => ({
          id: r.id,
          number: r.number,
          status: r.status,
          who: r.customer.name,
          pickedUpOn: isoDate(r.pickedUpOn),
          note: r.vinNote,
        })),
      },
    };
  });

  /**
   * Mopeds whose status says «В ремонте» with no repair open behind them
   * (register #23): Odoo left nineteen so, and a status set by hand can leave
   * one more. A block of «Ремонты» since issue #18 (B6; it was a list of
   * «Настройки → До EV8 Ops»), for whoever may move a moped by hand: open the
   * repair, or send the moped back to the yard with a reason.
   */
  app.get('/api/service/without-repair', { config: { scope: 'fleet.state.manual' } }, async () => {
    const rows = await prisma.vehicle.findMany({
      where: { archived: false, state: 'service', serviceJobs: { none: { status: { not: 'done' } } } },
      select: { id: true, vin: true, fleetNo: true, arrivedOn: true, model: { select: { brand: true, name: true } } },
      orderBy: { vin: 'asc' },
    });
    return {
      vehicles: rows.map((v) => ({ id: v.id, vin: v.vin, fleetNo: v.fleetNo, model: v.model ? `${v.model.brand} ${v.model.name}` : null, arrivedOn: isoDate(v.arrivedOn) })),
    };
  });

  /**
   * A batch decision on deposits the transfer brought over (§3.7, crit. 24).
   *
   * Nothing moves: no payment, no till line, no figure on the deposit. The
   * money moved before the move, or nobody knows that it did, and either way
   * it did not move today. What is written is the decision itself, with a
   * reason, and the journal keeps a row per deposit. After this they are out
   * of "held" and out of the queue.
   */
  app.post<{ Body: Record<string, unknown> }>('/api/migration/deposits', { config: { scope: 'deposit.decide' } }, async (req) => {
    const actor = actorOf(req);
    const b = req.body ?? {};
    const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string') : [];
    if (ids.length === 0) throw badRequest('missing_field', 'Choose at least one.', { field: 'ids' });
    const decision = oneOf(b, 'decision', DECISIONS, { required: true })!;
    // Required for every one of them, "kept" included (crit. 25): a figure
    // nobody can explain a year later is worse than an open question.
    const reason = str(b, 'reason', { required: true, max: 500 })!;

    const rows = await prisma.deposit.findMany({
      where: { id: { in: ids }, migrationDecision: null, decidedById: null },
      include: { rental: { select: { id: true, number: true, status: true } } },
    });
    if (rows.length === 0) throw notFound('deposit_not_found', 'Nothing left to decide here.');

    const at = new Date();
    await prisma.$transaction(async (tx) => {
      for (const d of rows) {
        await tx.deposit.update({
          where: { id: d.id },
          data: { migrationDecision: decision, migrationReason: reason, migrationDecidedAt: at, decidedById: actor.id, updatedAt: at },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'deposit.migration.decided',
            entityType: 'rental',
            entityId: d.rental.id,
            before: { heldTetri: d.paidTetri },
            after: { decision, heldTetri: 0 },
            note: reason,
          },
        });
      }
    });
    return { ok: true, decided: rows.length };
  });

  /**
   * A moped «В ремонте» with no repair behind it (register #23): either a
   * repair is opened for it, or it goes back to the yard from the block of
   * «Ремонты», with a reason and an entry in its own feed. (Was
   * `/api/migration/vehicles/:id/back` until issue #18.)
   */
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>('/api/service/without-repair/:id/back', { config: { scope: 'fleet.state.manual' } }, async (req) => {
    const actor = actorOf(req);
    const reason = str(req.body ?? {}, 'reason', { required: true, max: 500 })!;
    const locationId = str(req.body ?? {}, 'locationId');
    const v = await prisma.vehicle.findUnique({ where: { id: req.params.id }, select: { id: true, state: true } });
    if (!v) throw notFound('vehicle_not_found', 'No such moped.');
    // A moped out on a rental still open is the customer's (issue #17): it comes back through that rental.
    if (await openRentalOf(prisma, v.id)) throw conflict('vehicle_rented_move', 'Close the rental first; a rented moped does not move by hand.');
    await prisma.$transaction(async (tx) => {
      await moveVehicle(tx, { vehicleId: v.id, kind: 'manual', toState: 'available', occurredOn: todayISO(), actorId: actor.id, reason });
      if (locationId) await tx.vehicle.update({ where: { id: v.id }, data: { locationId, updatedAt: new Date() } });
    });
    return { ok: true };
  });
}
