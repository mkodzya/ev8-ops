import { contractSignedOf, contractState, rentDueOn, todayISO } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { dayOf, isoDate } from '../lib/dates.js';
import { debtsOf, rentalDueToday } from '../lib/debt.js';
import { UNDO_RETURN_MS } from '../lib/rentals.js';
import { driveOfRental } from '../lib/driveScan.js';
import { payOffsetOf, rentStateOf } from '../lib/rentState.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { notFound } from '../lib/errors.js';

// Rentals, read side (overdue and due-today as signals — ADR-0017, which
// replaces RNT-03; RNT-06 the no-VIN list).

export function rentalRoutes(app: FastifyInstance): void {
  app.get('/api/rentals', { config: { scope: 'fleet.view' } }, async () => {
    const today = todayISO(new Date(), env.TZ);
    const rentals = await prisma.rental.findMany({
      orderBy: [{ status: 'asc' }, { pickedUpOn: 'desc' }],
      include: {
        // The phone too: "Whose return?" finds a renter by the digits of it (wave 1 §3.2).
        customer: { select: { id: true, name: true, nameKa: true, nameLat: true, phone: true } },
        vehicle: { select: { id: true, vin: true, fleetNo: true, model: { select: { brand: true, name: true } } } },
        deposit: { select: { amountTetri: true, status: true, paidTetri: true } },
        _count: { select: { periods: true } },
        // Signed on the screen or not: the "Не подписан" filter (wave 3 §3.2).
        documents: { where: { kind: 'pdf', archived: false, docKind: 'contract', signedAt: { not: null } }, select: { id: true } },
      },
    });
    // A rental's debt is its part of its customer's one figure: its unpaid weeks and deposit.
    // Asked for the same day the statuses below are read for: one clock for one answer.
    const debts = await debtsOf(rentals.map((r) => r.customerId), today);
    const debtOfRental = (customerId: string, rentalId: string) =>
      (debts.get(customerId)?.parts ?? []).filter((p) => p.id === rentalId && (p.kind === 'rent' || p.kind === 'deposit' || p.kind === 'charge')).reduce((n, p) => n + p.owesTetri, 0);
    return {
      today,
      rentals: rentals.map((r) => {
        const pickedUpOn = isoDate(r.pickedUpOn);
        const paidThrough = isoDate(r.paidThrough);
        // What it is called today and how many days it is late: the one function every route asks.
        const { status, overdueDays } = rentStateOf(r, today);
        return {
          id: r.id,
          number: r.number,
          odooName: r.odooName,
          status,
          customer: r.customer,
          vehicle: r.vehicle ? { id: r.vehicle.id, vin: r.vehicle.vin, fleetNo: r.vehicle.fleetNo, model: `${r.vehicle.model.brand} ${r.vehicle.model.name}` } : null,
          vinUnconfirmed: r.vinUnconfirmed,
          vinNote: r.vinNote,
          weeklyRateTetri: r.weeklyRateTetri,
          depositTetri: r.depositTetri,
          deposit: r.deposit,
          pickedUpOn,
          expectedReturnOn: isoDate(r.expectedReturnOn),
          returnedOn: isoDate(r.returnedOn),
          paidThrough,
          overdueDays,
          debtTetri: debtOfRental(r.customerId, r.id),
          // Of that debt: awaited today and not late. The figure is ink only when the two are equal (ADR-0017).
          dueTodayTetri: rentalDueToday(debts.get(r.customerId), r.id),
          periods: r._count.periods,
          buyoutTargetTetri: r.buyoutTargetTetri,
          buyoutPerPaymentTetri: r.buyoutPerPaymentTetri,
          // Null: not asked. A rental brought over keeps its contract from before
          // EV8 Ops, so it is neither signed here nor waiting to be (Mika, 08.10.2026).
          // True: signed on the screen, or marked signed in Signify (ADR-0039) —
          // the same rule "Today" asks, so the chip and the row agree.
          contractSigned: contractSignedOf(
            contractState({ signedHere: r.documents.length > 0, signedElsewhereAt: r.contractSignedElsewhereAt, transferredAt: r.transferredAt, returned: r.status === 'returned' }),
          ),
        };
      }),
    };
  });

  app.get<{ Params: { id: string } }>('/api/rentals/:id', { config: { scope: 'fleet.view' } }, async (req) => {
    const r = await prisma.rental.findUnique({
      where: { id: req.params.id },
      include: {
        customer: true,
        vehicle: { include: { model: true } },
        deposit: {
          include: {
            withholdings: { where: { voidedAt: null }, orderBy: { createdAt: 'asc' }, include: { serviceJob: { select: { number: true } } } },
            payouts: { where: { voidedAt: null }, select: { grossTetri: true } },
          },
        },
        charges: { where: { voidedAt: null }, orderBy: { createdAt: 'asc' }, include: { allocations: { where: { payment: { voidedAt: null } }, select: { amountTetri: true } } } },
        documents: { where: { kind: 'pdf', archived: false }, select: { docKind: true, signedAt: true, signedBy: true, createdAt: true } },
        contractSignedElsewhereBy: { select: { name: true } },
        periods: { orderBy: { seq: 'asc' } },
        payments: { where: { voidedAt: null }, orderBy: { occurredOn: 'asc' }, select: { id: true, occurredOn: true, channel: true, grossTetri: true, feeTetri: true } },
        acts: { orderBy: { occurredOn: 'asc' }, include: { photos: { where: { archived: false }, select: { id: true, label: true, sizeBytes: true }, orderBy: { createdAt: 'asc' } } } },
      },
    });
    if (!r) throw notFound('rental_not_found', 'No such rental.');
    // One timeline of everything that happened to this rental (ux №7): money,
    // acts, documents, and the journal's own entries — WhatsApp, statuses,
    // changes of terms, a return taken back.
    const log = await prisma.auditLog.findMany({
      where: { entityType: 'rental', entityId: r.id },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { name: true } } },
    });
    const feed = [
      ...r.payments.map((p) => ({ at: isoDate(p.occurredOn)!, kind: 'payment' as const, by: null as string | null, text: p.channel, amountTetri: p.grossTetri, note: null as string | null })),
      ...r.acts.map((a) => ({ at: isoDate(a.occurredOn)!, kind: 'act' as const, by: null, text: a.kind, amountTetri: null, note: a.condition })),
      ...r.documents.filter((d) => d.signedAt).map((d) => ({ at: dayOf(d.signedAt)!, kind: 'document' as const, by: d.signedBy, text: d.docKind ?? '', amountTetri: null, note: null })),
      ...log.map((l) => ({ at: dayOf(l.createdAt)!, kind: 'log' as const, by: l.actor?.name ?? null, text: l.action, amountTetri: null, note: l.note })),
    ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    const today = todayISO(new Date(), env.TZ);
    const pickedUpOn = isoDate(r.pickedUpOn);
    const paidThrough = isoDate(r.paidThrough);
    // This rental's part of its customer's one debt figure (B7-02): weeks and an unpaid deposit (QA-W2-01).
    const debt = (await debtsOf([r.customerId], today)).get(r.customerId);
    const debtTetri = (debt?.parts ?? []).filter((p) => p.id === r.id && (p.kind === 'rent' || p.kind === 'deposit' || p.kind === 'charge')).reduce((n, p) => n + p.owesTetri, 0);
    return {
      rental: {
        id: r.id,
        number: r.number,
        debtTetri,
        dueTodayTetri: rentalDueToday(debt, r.id),
        odooName: r.odooName,
        status: rentStateOf(r, today).status,
        storedStatus: r.status,
        customer: { id: r.customer.id, name: r.customer.name, phone: r.customer.phone },
        vehicle: r.vehicle ? { id: r.vehicle.id, vin: r.vehicle.vin, fleetNo: r.vehicle.fleetNo, model: `${r.vehicle.model.brand} ${r.vehicle.model.name}` } : null,
        vinUnconfirmed: r.vinUnconfirmed,
        vinNote: r.vinNote,
        weeklyRateTetri: r.weeklyRateTetri,
        depositTetri: r.depositTetri,
        pickedUpOn,
        expectedReturnOn: isoDate(r.expectedReturnOn),
        returnedOn: isoDate(r.returnedOn),
        paidThrough,
        // The weekday its rent is due on (ISO 1–7); null — the pickup's weekday (ADR-0022).
        payWeekday: r.payWeekday,
        payOffsetDays: payOffsetOf(r),
        // The day the next rent is due, for a running rental: the WhatsApp text names it.
        dueOn: pickedUpOn && (r.status === 'active' || r.status === 'overdue') ? rentDueOn(paidThrough, pickedUpOn, payOffsetOf(r)) : null,
        buyoutTargetTetri: r.buyoutTargetTetri,
        buyoutPerPaymentTetri: r.buyoutPerPaymentTetri,
        nightParkingAddress: r.nightParkingAddress,
        kommoRef: r.kommoRef,
        batteries: r.batteries,
        chargers: r.chargers,
        notes: r.notes,
        transferredAt: r.transferredAt?.toISOString() ?? null,
        debtOverrideReason: r.debtOverrideReason,
        // A return may be taken back by an owner within a day of the act (B5-08).
        undoReturnUntil: returnUndoUntil(r.acts),
        // The renter's folder and contract in Drive, as last read (ADR-0031); null — none found.
        drive: await driveOfRental(r.id),
      },
      // What the return charged beyond the weeks, and what is still open (§3.7, B5-08).
      charges: r.charges.map((c) => ({ id: c.id, kind: c.kind, amountTetri: c.amountTetri, note: c.note, paidTetri: c.allocations.reduce((n, a) => n + a.amountTetri, 0) })),
      // The contract and the return act: signed or not, and what the contract lacks (D17, B4-06).
      // The contract may also be marked signed in Signify, by whom and when (ADR-0039).
      documents: {
        contract: {
          ...docState(r.documents, 'contract', contractGaps(r.customer)),
          signedElsewhere: r.contractSignedElsewhereAt
            ? { at: r.contractSignedElsewhereAt.toISOString(), by: r.contractSignedElsewhereBy?.name ?? null, note: r.contractSignedElsewhereNote }
            : null,
        },
        returnAct: r.acts.some((a) => a.kind === 'return') ? docState(r.documents, 'return_act', []) : null,
      },
      deposit: r.deposit
        ? {
            amountTetri: r.deposit.amountTetri,
            paidTetri: r.deposit.paidTetri,
            status: r.deposit.status,
            returnedTetri: r.deposit.returnedTetri,
            withheldTetri: r.deposit.withheldTetri,
            withheldReason: r.deposit.withheldReason,
            withheldGrounds: r.deposit.withheldGrounds,
            returnedTo: r.deposit.returnedTo,
            returnedOn: isoDate(r.deposit.returnedOn),
            decided: r.deposit.decidedById != null && r.deposit.status !== 'held',
            paidOutTetri: r.deposit.paidOutBeforeTetri + r.deposit.payouts.reduce((n, p) => n + p.grossTetri, 0),
            // Kept, line by line: a repair's and a return's (B5-04).
            withholdings: r.deposit.withholdings.map((w) => ({ source: w.source, amountTetri: w.amountTetri, number: w.serviceJob?.number ?? r.number, reason: w.reason })),
          }
        : null,
      periods: r.periods.map((p) => ({
        seq: p.seq,
        startsOn: isoDate(p.startsOn),
        endsOn: isoDate(p.endsOn),
        amountTetri: p.amountTetri,
        paidTetri: p.paidTetri,
        payStatus: p.payStatus,
        discountTetri: p.discountTetri,
        discountReason: p.discountReason,
        paidBeforeTransfer: p.paidBeforeTransfer,
      })),
      payments: r.payments.map((p) => ({
        id: p.id,
        occurredOn: isoDate(p.occurredOn),
        channel: p.channel,
        grossTetri: p.grossTetri,
        feeTetri: p.feeTetri,
      })),
      feed,
      acts: r.acts.map((a) => ({
        id: a.id,
        kind: a.kind,
        occurredOn: isoDate(a.occurredOn),
        odometerKm: a.odometerKm,
        condition: a.condition,
        items: a.items,
        photos: a.photos.map((p) => ({ id: p.id, label: p.label, sizeBytes: p.sizeBytes })),
        pdfUrl: a.pdfUrl,
      })),
    };
  });
}

/** What the contract needs from the card before it can be signed (B4-06): named, so it can be filled in on the spot. */
export function contractGaps(c: { personalId: string | null; name: string; phone: string | null }): string[] {
  const gaps: string[] = [];
  if (!c.personalId?.trim()) gaps.push('personalId');
  if (!c.phone?.trim()) gaps.push('phone');
  return gaps;
}

/**
 * A document's signature as the card shows it. Two copies may stand side by
 * side unarchived; the signed one speaks — the latest of them — and only then
 * the latest copy, as the list counts "signed" by any signed copy (ADR-0039).
 */
function docState(files: { docKind: string | null; signedAt: Date | null; signedBy: string | null; createdAt: Date }[], kind: string, gaps: string[]) {
  const mine = files.filter((x) => x.docKind === kind).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const f = mine.find((x) => x.signedAt != null) ?? mine[0];
  return { signedAt: f?.signedAt?.toISOString() ?? null, signedBy: f?.signedBy ?? null, gaps };
}

function returnUndoUntil(acts: { kind: string; createdAt: Date; settlement: unknown }[]): string | null {
  const last = acts.filter((a) => a.kind === 'return').sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!last || (last.settlement as { undone?: boolean } | null)?.undone) return null;
  const until = last.createdAt.getTime() + UNDO_RETURN_MS;
  return until > Date.now() ? new Date(until).toISOString() : null;
}
