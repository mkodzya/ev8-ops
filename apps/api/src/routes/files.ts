import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { seesEveryRepair } from '@ev8/shared';
import { hasPerm, permissionsOf } from '../lib/auth.js';
import { prisma } from '../lib/db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';
import { oneOf, str } from '../lib/validate.js';

// Files: photos on acts, customer documents. Bytes travel as base64 inside
// JSON (as in Self Platform: no multipart dependency, and at a 10 MB ceiling
// the 4/3 inflation is the whole price). The phone downsizes photos before
// sending, so a real upload is a few hundred kilobytes.
//
// Only image and PDF types are stored, and every file goes out with nosniff
// under the type it was stored with — never as HTML or SVG, which would run
// in the app's own origin.

const MAX_BYTES = 10 * 1024 * 1024;
/** The body an upload of the largest file comes in: base64 inside JSON. */
export const BODY_LIMIT = Math.ceil(MAX_BYTES * 1.4);
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const DOC_KINDS = ['id_card', 'driver_licence', 'other'] as const;

type Body = Record<string, unknown>;

/** An upload as every route stores it: an image or a PDF, up to 10 MB, with its name. */
export function readUpload(b: Body): { bytes: Buffer; mime: string; label: string } {
  const mime = str(b, 'mimeType', { required: true })!;
  if (!ALLOWED_MIME.has(mime)) throw badRequest('bad_mime', 'Only JPEG, PNG, WebP and PDF files are stored.', { mimeType: mime });
  const data = b.dataBase64;
  if (typeof data !== 'string' || data === '') throw badRequest('missing_field', 'dataBase64 is required', { field: 'dataBase64' });
  const bytes = Buffer.from(data, 'base64');
  if (bytes.length === 0) throw badRequest('bad_field', 'The file is empty.');
  if (bytes.length > MAX_BYTES) throw badRequest('file_too_big', 'Files up to 10 MB.', { max: MAX_BYTES });
  return { bytes, mime, label: str(b, 'label', { max: 200 }) ?? '' };
}

export function fileRoutes(app: FastifyInstance): void {
  // Photos on a hand-over or return act. Whoever may hand over may attach.
  app.post<{ Params: { id: string }; Body: Body }>(
    '/api/acts/:id/photos',
    { config: { scope: 'rental.create' }, bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      const actor = actorOf(req);
      const act = await prisma.act.findUnique({ where: { id: req.params.id }, select: { id: true, rentalId: true, kind: true, settlement: true } });
      if (!act) throw notFound('act_not_found', 'No such act.');
      const { bytes, mime, label } = readUpload(req.body ?? {});
      if (!mime.startsWith('image/')) throw badRequest('bad_mime', 'Act photos are images.');
      const f = await prisma.storedFile.create({
        data: { kind: 'act_photo', actId: act.id, label, mimeType: mime, sizeBytes: bytes.length, sha256: sha(bytes), bytes: new Uint8Array(bytes), uploadedById: actor.id },
        select: { id: true },
      });
      // Damage in a return act opened a repair: its photos are that repair's photos too (wave 3, crit. 28) —
      // unless its mechanic has been paid for it: a paid repair is not changed (ADR-0037 §5); the act keeps the photo.
      // So do the photos of a moped given back at a swap that went into a repair (ADR-0040).
      const opened = act.kind === 'return' || act.kind === 'swap_out' ? (act.settlement as { serviceJobId?: string | null } | null)?.serviceJobId : null;
      const paid = opened ? await prisma.serviceJob.count({ where: { id: opened, paidInPayoutId: { not: null } } }) : 0;
      const serviceJobId = paid > 0 ? null : opened;
      if (serviceJobId) {
        await prisma.storedFile.create({
          data: { kind: 'service_photo', serviceJobId, label, mimeType: mime, sizeBytes: bytes.length, sha256: sha(bytes), bytes: new Uint8Array(bytes), uploadedById: actor.id },
        });
      }
      await audit({ actorId: actor.id, action: 'act.photo.add', entityType: 'act', entityId: act.id, after: { fileId: f.id, sizeBytes: bytes.length, serviceJobId: serviceJobId ?? undefined } });
      return reply.code(201).send({ id: f.id });
    },
  );

  // Photos of the damage on a repair job (SRV-01). A manager reporting a
  // breakdown brings the photos with it (wave 5 §3.7): the picture is the
  // half of the report words cannot carry.
  app.post<{ Params: { id: string }; Body: Body }>(
    '/api/service/:id/photos',
    { config: { scope: 'service.report' }, bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      const actor = actorOf(req);
      const job = await prisma.serviceJob.findUnique({ where: { id: req.params.id }, select: { id: true, paidInPayoutId: true } });
      if (!job) throw notFound('job_not_found', 'No such repair job.');
      // A paid repair is a record: nothing is added to it (ADR-0037 §5).
      if (job.paidInPayoutId != null) throw conflict('job_paid', 'This repair is paid to its mechanic; it is not changed any more.');
      const { bytes, mime, label } = readUpload(req.body ?? {});
      if (!mime.startsWith('image/')) throw badRequest('bad_mime', 'Repair photos are images.');
      const f = await prisma.storedFile.create({
        data: { kind: 'service_photo', serviceJobId: job.id, label, mimeType: mime, sizeBytes: bytes.length, sha256: sha(bytes), bytes: new Uint8Array(bytes), uploadedById: actor.id },
        select: { id: true },
      });
      await audit({ actorId: actor.id, action: 'service.photo.add', entityType: 'service_job', entityId: job.id, after: { fileId: f.id, sizeBytes: bytes.length } });
      return reply.code(201).send({ id: f.id });
    },
  );

  // Customer documents (CST-03): a manager may attach an ID photo at the
  // counter; opening it later is for the owners only.
  app.post<{ Params: { id: string }; Body: Body }>(
    '/api/customers/:id/documents',
    { config: { scope: 'customer.create' }, bodyLimit: BODY_LIMIT },
    async (req, reply) => {
      const actor = actorOf(req);
      const b = req.body ?? {};
      const c = await prisma.customer.findUnique({ where: { id: req.params.id }, select: { id: true, archived: true } });
      if (!c) throw notFound('customer_not_found', 'No such customer.');
      // A card merged away takes nothing new; it is a record of what was
      // (crit. 33, QA-W5-03). Hiding the button was not enough — a link to
      // the duplicate still reached this.
      if (c.archived) throw conflict('customer_archived', 'This card was merged into another one; add it there.');
      const docKind = oneOf(b, 'docKind', DOC_KINDS) ?? 'other';
      const { bytes, mime, label } = readUpload(b);
      const f = await prisma.storedFile.create({
        data: { kind: 'customer_document', customerId: c.id, docKind, label, mimeType: mime, sizeBytes: bytes.length, sha256: sha(bytes), bytes: new Uint8Array(bytes), uploadedById: actor.id },
        select: { id: true },
      });
      await audit({ actorId: actor.id, action: 'customer.document.add', entityType: 'customer', entityId: c.id, after: { fileId: f.id, docKind, sizeBytes: bytes.length } });
      return reply.code(201).send({ id: f.id });
    },
  );

  // The file itself. Act photos: anyone who sees the fleet. Repair photos:
  // whoever sees that repair — a mechanic, the ones he carries (ADR-0033). Customer
  // documents: the owners, and the access is journaled (spec §8). What a task
  // closed with (ADR-0050): whoever sees the task — whose it is, who set it,
  // an owner who reads everybody's.
  app.get<{ Params: { id: string } }>('/api/files/:id', { config: { scope: 'session' } }, async (req, reply) => {
    const actor = actorOf(req);
    const meta = await prisma.storedFile.findUnique({
      where: { id: req.params.id },
      select: {
        id: true,
        kind: true,
        customerId: true,
        mimeType: true,
        sizeBytes: true,
        label: true,
        archived: true,
        serviceJob: { select: { mechanicId: true } },
        todo: { select: { assigneeId: true, createdById: true } },
      },
    });
    if (!meta || meta.archived) throw notFound('file_not_found', 'No such file.');
    if (meta.kind === 'customer_document') {
      if (!hasPerm(actor, 'customer.documents.view')) throw forbidden('documents_restricted', 'Customer documents are for the owners only.');
      await audit({ actorId: actor.id, action: 'customer.document.open', entityType: 'customer', entityId: meta.customerId, after: { fileId: meta.id } });
    } else if (meta.kind === 'todo_file') {
      const t = meta.todo;
      const sees = t != null && hasPerm(actor, 'todos.own') && (t.assigneeId === actor.id || t.createdById === actor.id || hasPerm(actor, 'todos.assign'));
      if (!sees) throw forbidden('forbidden', 'No access to files.');
    } else if (meta.kind === 'service_photo' && !hasPerm(actor, 'fleet.view')) {
      const sees = hasPerm(actor, 'service.view') && (seesEveryRepair(permissionsOf(actor.role, actor.via)) || meta.serviceJob?.mechanicId === actor.id);
      if (!sees) throw forbidden('forbidden', 'No access to files.');
    } else if (!hasPerm(actor, 'fleet.view')) {
      throw forbidden('forbidden', 'No access to files.');
    }
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: meta.id }, select: { bytes: true } });
    const safeName = (meta.label || meta.id).replace(/[^\w.\-]+/g, '_');
    return reply
      .header('content-type', meta.mimeType)
      .header('content-length', String(meta.sizeBytes))
      .header('x-content-type-options', 'nosniff')
      .header('content-disposition', `inline; filename="${safeName}"`)
      .header('cache-control', 'private, max-age=86400')
      .send(Buffer.from(row.bytes));
  });

  // No delete: archive hides a file, the bytes and the journal stay.
  app.post<{ Params: { id: string }; Body: Body }>('/api/files/:id/archive', { config: { scope: 'deposit.decide' } }, async (req) => {
    const actor = actorOf(req);
    const f = await prisma.storedFile.findUnique({
      where: { id: req.params.id },
      select: { id: true, kind: true, actId: true, customerId: true, serviceJobId: true, todoId: true, serviceJob: { select: { paidInPayoutId: true } } },
    });
    if (!f) throw notFound('file_not_found', 'No such file.');
    // A paid repair is a record: nothing on it is hidden either (ADR-0037 §5).
    if (f.serviceJob?.paidInPayoutId != null) throw conflict('job_paid', 'This repair is paid to its mechanic; it is not changed any more.');
    await prisma.storedFile.update({ where: { id: f.id }, data: { archived: true } });
    // The journal names what the file was on: a repair's photo, its repair.
    const on = f.serviceJobId
      ? { entityType: 'service_job', entityId: f.serviceJobId }
      : f.todoId
        ? { entityType: 'todo', entityId: f.todoId }
        : { entityType: f.kind === 'act_photo' ? 'act' : 'customer', entityId: f.actId ?? f.customerId };
    await audit({ actorId: actor.id, action: 'file.archive', ...on, note: str(req.body ?? {}, 'reason', { max: 1000 }) });
    return { ok: true };
  });
}

export function sha(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}
