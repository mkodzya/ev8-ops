import { localDateTime } from '@ev8/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { audit } from '../lib/audit.js';
import { hasPerm } from '../lib/auth.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { renderContract } from '../lib/pdf/contract.js';
import type { DrawnSignature } from '../lib/pdf/layout.js';
import { contractGaps } from './rentals.js';
import { badRequest } from '../lib/errors.js';
import { renderSaleDoc } from '../lib/pdf/saleDoc.js';
import {
  renderReturnAct,
  type ItemState,
  type WithholdGround,
} from '../lib/pdf/returnAct.js';

// The contract and the return act as PDFs (RNT-08).
//
// A document is rendered once and its bytes are kept: what the customer
// signed has to stay readable after somebody edits a tariff. Re-rendering is
// deliberate — it archives the old copy and says so in the journal — because
// two different papers with one number is how disputes start.
//
// Copying into the customer's Google Drive folder is not here: that needs a
// service account the owner registers (CLAUDE.md rule 3). Until then the
// file lives in the system and is downloaded from it.

type DocKind = 'contract' | 'return_act';

async function loadRental(id: string) {
  const r = await prisma.rental.findUnique({
    where: { id },
    include: {
      customer: true,
      vehicle: { include: { model: true } },
      deposit: true,
      acts: { orderBy: { occurredOn: 'asc' }, include: { _count: { select: { photos: true } } } },
    },
  });
  if (!r) throw notFound('rental_not_found', 'No such rental.');
  return r;
}

type Rental = Awaited<ReturnType<typeof loadRental>>;

function customerOf(r: Rental) {
  return {
    name: r.customer.name,
    personalId: r.customer.personalId,
    phone: r.customer.phone,
    email: r.customer.email,
    address: r.customer.address,
  };
}

function vehicleOf(r: Rental) {
  return r.vehicle
    ? { brand: r.vehicle.model.brand, model: r.vehicle.model.name, vin: r.vehicle.vin, color: r.vehicle.color, fleetNo: r.vehicle.fleetNo }
    : null;
}

async function render(kind: DocKind, r: Rental, signature: DrawnSignature | null = null): Promise<Buffer> {
  const pickup = r.acts.find((a) => a.kind === 'pickup');
  const contractDate = isoDate(r.pickedUpOn) ?? isoDate(r.createdAt)!;
  if (kind === 'contract') {
    return renderContract({
      number: r.number,
      contractDate,
      customer: customerOf(r),
      vehicle: vehicleOf(r),
      vinNote: r.vinNote,
      weeklyRateTetri: r.weeklyRateTetri,
      depositTetri: r.depositTetri,
      buyoutTargetTetri: r.buyoutTargetTetri,
      batteries: r.batteries,
      chargers: r.chargers,
      nightParkingAddress: r.nightParkingAddress,
      pickedUpOn: isoDate(r.pickedUpOn),
      condition: pickup?.condition ?? null,
      odometerKm: pickup?.odometerKm ?? null,
      hasPhotos: (pickup?._count.photos ?? 0) > 0,
      signature,
    });
  }
  // The latest return that stands: one taken back is not the paper (B5-08).
  const ret = [...r.acts].reverse().find((a) => a.kind === 'return' && !(a.settlement as { undone?: boolean } | null)?.undone);
  if (!ret) throw conflict('not_returned', 'The return act exists once the rental is closed.');
  const d = r.deposit;
  const withheld = d?.withheldTetri ?? 0;
  return renderReturnAct({
    number: r.number,
    returnedOn: isoDate(ret.occurredOn)!,
    contractDate,
    customer: customerOf(r),
    vehicle: vehicleOf(r),
    vinNote: r.vinNote,
    odometerAtPickupKm: pickup?.odometerKm ?? null,
    odometerKm: ret.odometerKm,
    items: (ret.items ?? {}) as Record<string, { state: ItemState; note?: string | null }>,
    hasPhotos: ret._count.photos > 0,
    depositTetri: d?.amountTetri ?? r.depositTetri,
    withheldTetri: withheld,
    returnedTetri: d?.returnedTetri ?? 0,
    withheldGrounds: (d?.withheldGrounds ?? []) as WithholdGround[],
    withheldReason: d?.withheldReason ?? null,
    returnedTo: d?.returnedTo ?? null,
    decided: !!d && d.decidedById != null && d.status !== 'held',
    signature,
  });
}

async function loadSale(id: string) {
  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      customer: true,
      vehicle: { include: { model: true } },
      instalments: { orderBy: { seq: 'asc' } },
    },
  });
  if (!sale) throw notFound('sale_not_found', 'No such sale.');
  return sale;
}

type Sale = Awaited<ReturnType<typeof loadSale>>;

/** The sale's paper: the schedule when there is credit, the invoice when there is not. */
async function renderSale(sale: Sale, signature: DrawnSignature | null = null): Promise<Buffer> {
  return renderSaleDoc({
    number: sale.number,
    soldOn: isoDate(sale.soldOn)!,
    customer: {
      name: sale.customer.name,
      personalId: sale.customer.personalId,
      phone: sale.customer.phone,
      email: sale.customer.email,
      address: sale.customer.address,
    },
    vehicle: sale.vehicle ? { brand: sale.vehicle.model.brand, model: sale.vehicle.model.name, vin: sale.vehicle.vin, color: sale.vehicle.color } : null,
    vinNote: sale.vinNote,
    priceTetri: sale.priceTetri,
    extras: sale.extras,
    warrantyUntil: isoDate(sale.warrantyUntil),
    schedule: sale.instalments.map((i) => ({ seq: i.seq, dueOn: isoDate(i.dueOn)!, amountTetri: i.amountTetri, paidTetri: i.paidTetri })),
    instalments: sale.instalments.length > 1,
    signature,
  });
}

export function documentRoutes(app: FastifyInstance): void {
  /**
   * The sale's document (§3.1). It follows the sale until it is signed, and
   * from then on it is what the buyer signed and does not change (B4-06).
   */
  app.get<{ Params: { id: string } }>('/api/sales/:id/contract.pdf', { config: { scope: 'sales.manage' } }, async (req, reply) => {
    const actor = actorOf(req);
    const existing = await prisma.storedFile.findFirst({
      where: { saleId: req.params.id, kind: 'pdf', docKind: 'sale', archived: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, label: true, signedAt: true },
    });
    if (existing?.signedAt) {
      const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: existing.id }, select: { bytes: true } });
      return sendPdf(reply, existing.label, Buffer.from(row.bytes));
    }
    const sale = await loadSale(req.params.id);
    const bytes = await renderSale(sale);
    const label = `${sale.number}-sale.pdf`;
    if (existing) await prisma.storedFile.update({ where: { id: existing.id }, data: { archived: true } });
    await prisma.storedFile.create({
      data: {
        kind: 'pdf',
        docKind: 'sale',
        saleId: sale.id,
        label,
        mimeType: 'application/pdf',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        bytes: new Uint8Array(bytes),
        uploadedById: actor.id,
      },
    });
    return sendPdf(reply, label, bytes);
  });

  for (const [path, kind, scope] of [
    ['contract', 'contract', 'rental.create'],
    ['return-act', 'return_act', 'rental.return'],
  ] as const) {
    app.get<{ Params: { id: string }; Querystring: { fresh?: string } }>(
      `/api/rentals/:id/${path}.pdf`,
      { config: { scope } },
      async (req, reply) => {
        const actor = actorOf(req);
        const fresh = req.query.fresh === '1';
        if (fresh && !hasPerm(actor, 'deposit.decide')) {
          throw conflict('regenerate_forbidden', 'Only an owner replaces a document that was already made.');
        }
        const existing = await prisma.storedFile.findFirst({
          where: { rentalId: req.params.id, kind: 'pdf', docKind: kind, archived: false },
          orderBy: { createdAt: 'desc' },
          select: { id: true, label: true, sizeBytes: true, signedAt: true },
        });
        // A signed copy is what was signed. Until then the document follows
        // the card and is made again each time it is opened (B4-06).
        if (existing && existing.signedAt && !fresh) {
          const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: existing.id }, select: { bytes: true } });
          return sendPdf(reply, existing.label, Buffer.from(row.bytes));
        }
        const rental = await loadRental(req.params.id);
        const bytes = await render(kind, rental);
        if (existing && !existing.signedAt && !fresh) {
          // Not signed yet: the fresh copy is shown and kept, and nothing is journaled for it.
          await prisma.storedFile.update({ where: { id: existing.id }, data: { archived: true } });
          await prisma.storedFile.create({
            data: { kind: 'pdf', docKind: kind, rentalId: rental.id, label: `${rental.number}-${path}.pdf`, mimeType: 'application/pdf', sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: new Uint8Array(bytes), uploadedById: actor.id },
          });
          return sendPdf(reply, `${rental.number}-${path}.pdf`, bytes);
        }
        const label = `${rental.number}-${path}.pdf`;
        if (existing) {
          await prisma.storedFile.update({ where: { id: existing.id }, data: { archived: true } });
        }
        const file = await prisma.storedFile.create({
          data: {
            kind: 'pdf',
            docKind: kind,
            rentalId: rental.id,
            label,
            mimeType: 'application/pdf',
            sizeBytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            bytes: new Uint8Array(bytes),
            uploadedById: actor.id,
          },
          select: { id: true, sha256: true },
        });
        await audit({
          actorId: actor.id,
          action: existing ? 'document.regenerate' : 'document.render',
          entityType: 'rental',
          entityId: rental.id,
          after: { docKind: kind, fileId: file.id, sha256: file.sha256, sizeBytes: bytes.length },
        });
        return sendPdf(reply, label, bytes);
      },
    );
  }
}

/**
 * Signed on the screen (D17): the customer read the document to the end,
 * agreed and drew their signature; it goes into the PDF with the time and who
 * handed the phone over. A contract with a field it needs left empty is not
 * signed (B4-06): the field is named and filled in first. A signed copy does
 * not change; a new version takes a new signature.
 */
export function signRoutes(app: FastifyInstance): void {
  /** The buyer signs the sale on the screen, schedule and all (D17, crit. 9). */
  app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/api/sales/:id/contract/sign',
    { config: { scope: 'sales.manage' }, bodyLimit: 4 * 1024 * 1024 },
    async (req, reply) => {
      const actor = actorOf(req);
      const b = req.body ?? {};
      if (b.agree !== true) throw badRequest('missing_field', 'The buyer agrees to the terms first.', { field: 'agree' });
      const raw = typeof b.signaturePng === 'string' ? b.signaturePng.replace(/^data:image\/png;base64,/, '') : '';
      const png = Buffer.from(raw, 'base64');
      if (png.length < 60 || png.subarray(1, 4).toString('latin1') !== 'PNG') throw badRequest('missing_field', 'Draw the signature.', { field: 'signaturePng' });
      const sale = await loadSale(req.params.id);
      const at = new Date();
      const local = localDateTime(at);
      const bytes = await renderSale(sale, { png, note: `${local.date} ${local.time} · ${actor.name}` });
      await prisma.storedFile.updateMany({ where: { saleId: sale.id, kind: 'pdf', docKind: 'sale', archived: false }, data: { archived: true } });
      const file = await prisma.storedFile.create({
        data: {
          kind: 'pdf',
          docKind: 'sale',
          saleId: sale.id,
          label: `${sale.number}-sale-signed.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          bytes: new Uint8Array(bytes),
          uploadedById: actor.id,
          signedAt: at,
          signedBy: sale.customer.name,
        },
        select: { id: true, sha256: true },
      });
      await audit({ actorId: actor.id, action: 'document.sign', entityType: 'sale', entityId: sale.id, after: { docKind: 'sale', fileId: file.id, sha256: file.sha256, signedBy: sale.customer.name } });
      return reply.code(201).send({ signedAt: at.toISOString() });
    },
  );

  for (const [path, kind, scope] of [
    ['contract', 'contract', 'rental.create'],
    ['return-act', 'return_act', 'rental.return'],
  ] as const) {
    app.post<{ Params: { id: string }; Body: Record<string, unknown> }>(
      `/api/rentals/:id/${path}/sign`,
      { config: { scope }, bodyLimit: 4 * 1024 * 1024 },
      async (req, reply) => {
        const actor = actorOf(req);
        const b = req.body ?? {};
        if (b.agree !== true) throw badRequest('missing_field', 'The customer agrees to the terms first.', { field: 'agree' });
        const raw = typeof b.signaturePng === 'string' ? b.signaturePng.replace(/^data:image\/png;base64,/, '') : '';
        const png = Buffer.from(raw, 'base64');
        if (png.length < 60 || png.subarray(1, 4).toString('latin1') !== 'PNG') throw badRequest('missing_field', 'Draw the signature.', { field: 'signaturePng' });
        const rental = await loadRental(req.params.id);
        if (kind === 'contract') {
          const gaps = contractGaps(rental.customer);
          if (gaps.length > 0) throw conflict('document_gaps', 'The contract has an empty field.', { gaps, field: gaps[0] });
        }
        const at = new Date();
        // Tbilisi time, as the customer read the clock when signing (QA-W3-03).
        const local = localDateTime(at);
        const note = `${local.date} ${local.time} · ${actor.name}`;
        const bytes = await render(kind, rental, { png, note });
        await prisma.storedFile.updateMany({ where: { rentalId: rental.id, kind: 'pdf', docKind: kind, archived: false }, data: { archived: true } });
        const file = await prisma.storedFile.create({
          data: {
            kind: 'pdf',
            docKind: kind,
            rentalId: rental.id,
            label: `${rental.number}-${path}-signed.pdf`,
            mimeType: 'application/pdf',
            sizeBytes: bytes.length,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            bytes: new Uint8Array(bytes),
            uploadedById: actor.id,
            signedAt: at,
            signedBy: rental.customer.name,
          },
          select: { id: true, sha256: true },
        });
        await audit({ actorId: actor.id, action: 'document.sign', entityType: 'rental', entityId: rental.id, after: { docKind: kind, fileId: file.id, sha256: file.sha256, signedBy: rental.customer.name } });
        return reply.code(201).send({ signedAt: at.toISOString() });
      },
    );
  }
}

function sendPdf(reply: FastifyReply, name: string, bytes: Buffer) {
  return reply
    .header('content-type', 'application/pdf')
    .header('content-length', String(bytes.length))
    .header('x-content-type-options', 'nosniff')
    .header('content-disposition', `inline; filename="${name.replace(/[^\w.\-]+/g, '_')}"`)
    .header('cache-control', 'private, no-store')
    .send(bytes);
}
