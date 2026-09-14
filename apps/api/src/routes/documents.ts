import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { audit } from '../lib/audit.js';
import { hasPerm } from '../lib/auth.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { renderContract } from '../lib/pdf/contract.js';
import {
  renderReturnAct,
  type ItemState,
  type ReturnItem,
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
    ? { brand: r.vehicle.model.brand, model: r.vehicle.model.name, vin: r.vehicle.vin, color: r.vehicle.color }
    : null;
}

async function render(kind: DocKind, r: Rental): Promise<Buffer> {
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
      hasPhotos: (pickup?._count.photos ?? 0) > 0,
    });
  }
  const ret = r.acts.find((a) => a.kind === 'return');
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
    items: (ret.items ?? {}) as Partial<Record<ReturnItem, { state: ItemState; note?: string | null }>>,
    hasPhotos: ret._count.photos > 0,
    depositTetri: d?.amountTetri ?? r.depositTetri,
    withheldTetri: withheld,
    returnedTetri: d?.returnedTetri ?? 0,
    withheldGrounds: (d?.withheldGrounds ?? []) as WithholdGround[],
    withheldReason: d?.withheldReason ?? null,
    returnedTo: d?.returnedTo ?? null,
  });
}

export function documentRoutes(app: FastifyInstance): void {
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
          throw conflict('regenerate_forbidden', 'Only the director or the owner replaces a document that was already made.');
        }
        const existing = await prisma.storedFile.findFirst({
          where: { rentalId: req.params.id, kind: 'pdf', docKind: kind, archived: false },
          orderBy: { createdAt: 'desc' },
          select: { id: true, label: true, sizeBytes: true },
        });
        if (existing && !fresh) {
          const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: existing.id }, select: { bytes: true } });
          return sendPdf(reply, existing.label, Buffer.from(row.bytes));
        }
        const rental = await loadRental(req.params.id);
        const bytes = await render(kind, rental);
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

function sendPdf(reply: FastifyReply, name: string, bytes: Buffer) {
  return reply
    .header('content-type', 'application/pdf')
    .header('content-length', String(bytes.length))
    .header('x-content-type-options', 'nosniff')
    .header('content-disposition', `inline; filename="${name.replace(/[^\w.\-]+/g, '_')}"`)
    .header('cache-control', 'private, no-store')
    .send(bytes);
}
