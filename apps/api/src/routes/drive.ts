import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { download, driveConfig } from '../lib/drive.js';
import { folderName, pdfText, readContractParty } from '../lib/driveDocs.js';
import { driveReconciliation, scanDrive } from '../lib/driveScan.js';
import { notFound } from '../lib/errors.js';
import { actorOf } from '../lib/guard.js';

// The rentals folders in Drive beside the rentals here (ADR-0031): an owner's
// screen, and a button that reads Drive now instead of waiting for the night.

export function driveRoutes(app: FastifyInstance): void {
  app.get('/api/drive/reconciliation', { config: { scope: 'users.manage' } }, async () => driveReconciliation());

  app.post('/api/drive/scan', { config: { scope: 'users.manage' } }, async () => {
    const outcome = await scanDrive();
    if (outcome.status === 'failed') app.log.warn(outcome, 'drive did not answer');
    return outcome;
  });

  /**
   * What the hand-over wizard is filled with for a renter's folder that has no
   * rental here (Mika, 19.10.2026: «почему я не могу создать эти аренды»):
   * read from the contract in the folder there and then — the renter's name,
   * personal number and phone are not kept in the copy of Drive — and the
   * card and the moped here that it names. A folder with a scan only gives its
   * name and day. Who asked is journalled; what was read is not.
   */
  app.get<{ Params: { id: string } }>('/api/drive/folders/:id/prefill', { config: { scope: 'users.manage' } }, async (req) => {
    const folder = await prisma.driveFolder.findUnique({
      where: { id: req.params.id },
      include: { files: { where: { kind: 'contract' }, orderBy: [{ contractOn: 'desc' }, { modifiedAt: 'desc' }], take: 1 } },
    });
    if (!folder) throw notFound('drive_folder_not_found', 'No such folder in the copy of Drive.');
    const fromName = folderName(folder.name);
    const cfg = driveConfig();
    const contract = folder.files[0];
    const party = cfg && contract ? readContractParty(await pdfText(new Uint8Array(await download(cfg, contract.id)))) : null;
    const vin = party?.vin ?? contract?.vin ?? null;
    const vehicle = vin ? await prisma.vehicle.findUnique({ where: { vin }, select: { id: true, state: true, vin: true } }) : null;
    // A card already here for this person: by the personal number, or else by the phone's digits.
    const digits = (party?.phone ?? '').replace(/\D/g, '').slice(-9);
    const card =
      (party?.personalId ? await prisma.customer.findFirst({ where: { personalId: party.personalId, archived: false }, select: { id: true, name: true } }) : null) ??
      (digits.length === 9 ? await prisma.customer.findFirst({ where: { phone: { endsWith: digits }, archived: false }, select: { id: true, name: true } }) : null);
    await audit({ actorId: actorOf(req).id, action: 'drive.prefill', entityType: 'drive_folder', entityId: folder.id });
    return {
      folder: { id: folder.id, name: folder.name, url: folder.webUrl },
      fromContract: party != null,
      name: party?.name ?? fromName.person,
      personalId: party?.personalId ?? null,
      phone: party?.phone ?? null,
      address: party?.address ?? null,
      pickedUpOn: party?.signedOn ?? isoDate(contract?.contractOn ?? null) ?? fromName.datedOn,
      rateTetri: party?.rateTetri ?? null,
      depositTetri: party?.depositTetri ?? null,
      vehicle: vehicle ? { id: vehicle.id, vin: vehicle.vin, available: vehicle.state === 'available' } : vin ? { id: null, vin, available: false } : null,
      customer: card,
    };
  });
}
