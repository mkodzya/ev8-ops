import { addDays, effectiveRentalStatus, todayISO, type RentalStatus } from '@ev8/shared';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { DriveError, FOLDER, download, driveConfig, listFolder, type DriveConfig, type DriveFailure, type DriveItem } from './drive.js';
import { fileDate, fileKind, folderName, kindOfText, matchFolders, pdfText, readContract, readReturnAct, sameVin, sharedWords, type FolderToMatch, type RentalToMatch } from './driveDocs.js';
import { env } from './env.js';
import { payOffsetOf } from './rentState.js';

// Reading the rentals folders in Drive, and laying them beside the rentals
// here (ADR-0031). Read only: nothing is written to Drive, moved or deleted.

export type DriveOutcome =
  | { status: 'off' }
  | { status: 'busy' }
  | { status: 'failed'; failure: DriveFailure | 'no_sections'; httpStatus: number | null; stage: 'token' | 'api' | null }
  | { status: 'ok'; folders: number; files: number; read: number; matched: number };

type Section = 'active' | 'finished';

/** The two folders inside the shared one, by the names the company gave them: «Aktiuri_Qiraoba», «Dasrulebuli_Qiraoba_…». */
export function sectionOf(name: string): Section | null {
  if (/aktiur|active/i.test(name)) return 'active';
  if (/dasrulebul|finished|returned/i.test(name)) return 'finished';
  return null;
}

let running = false;

/** The renters' folders of a section: dated folders, also one level down (the finished ones are filed by month). */
async function renterFolders(cfg: DriveConfig, section: DriveItem, fetchFn: typeof fetch): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  for (const item of await listFolder(cfg, section.id, fetchFn)) {
    if (item.mimeType !== FOLDER) continue;
    if (folderName(item.name).datedOn) out.push(item);
    else for (const inner of await listFolder(cfg, item.id, fetchFn)) if (inner.mimeType === FOLDER && folderName(inner.name).datedOn) out.push(inner);
  }
  return out;
}

/** A renter's documents: in the folder, and in the folders inside it (Signify's exports come in one). */
async function documentsOf(cfg: DriveConfig, folder: DriveItem, fetchFn: typeof fetch): Promise<DriveItem[]> {
  const out: DriveItem[] = [];
  for (const item of await listFolder(cfg, folder.id, fetchFn)) {
    if (item.mimeType === FOLDER) out.push(...(await listFolder(cfg, item.id, fetchFn)).filter((x) => x.mimeType !== FOLDER));
    else out.push(item);
  }
  return out;
}

/**
 * Read Drive once: every renter's folder and its documents; the text of
 * Signify's contracts and return acts not read before (or changed since);
 * then which rental each folder is. The outcome is counts and one of our own
 * words for a failure — no names — so it is safe in a log.
 */
export async function scanDrive(fetchFn: typeof fetch = fetch): Promise<DriveOutcome> {
  const cfg = driveConfig();
  if (!cfg) return { status: 'off' };
  if (running) return { status: 'busy' };
  running = true;
  const started = new Date();
  await prisma.driveSync.upsert({ where: { id: 1 }, create: { id: 1, lastTryAt: started }, update: { lastTryAt: started } });
  try {
    const top = await listFolder(cfg, cfg.root, fetchFn);
    const sections = top.flatMap((f) => {
      const section = f.mimeType === FOLDER ? sectionOf(f.name) : null;
      return section ? [{ item: f, section }] : [];
    });
    if (sections.length === 0) {
      await prisma.driveSync.update({ where: { id: 1 }, data: { failure: 'no_sections' } });
      return { status: 'failed', failure: 'no_sections', httpStatus: null, stage: null };
    }

    let folders = 0;
    let files = 0;
    let read = 0;
    for (const { item: sectionItem, section } of sections) {
      for (const f of await renterFolders(cfg, sectionItem, fetchFn)) {
        folders++;
        const datedOn = folderName(f.name).datedOn;
        await prisma.driveFolder.upsert({
          where: { id: f.id },
          create: { id: f.id, name: f.name, section, webUrl: f.webViewLink, datedOn: dateFromISO(datedOn), seenAt: started },
          update: { name: f.name, section, webUrl: f.webViewLink, datedOn: dateFromISO(datedOn), seenAt: started },
        });
        for (const doc of await documentsOf(cfg, f, fetchFn)) {
          const byName = fileKind(doc.name, doc.mimeType);
          if (byName === 'skip') continue;
          files++;
          const modifiedAt = new Date(doc.modifiedTime);
          const known = await prisma.driveFile.findUnique({ where: { id: doc.id }, select: { readModifiedAt: true } });
          await prisma.driveFile.upsert({
            where: { id: doc.id },
            create: { id: doc.id, folderId: f.id, name: doc.name, kind: byName, modifiedAt, webUrl: doc.webViewLink, datedOn: dateFromISO(fileDate(doc.name)), seenAt: started },
            // What a document is and what it says are what was read off it: a later read of the list keeps them.
            update: { folderId: f.id, name: doc.name, modifiedAt, webUrl: doc.webViewLink, seenAt: started },
          });
          if (known?.readModifiedAt?.getTime() === modifiedAt.getTime()) continue;
          // Every PDF is read once (and again when it changes): a contract named
          // in English — «Rental agreement — …» (19.10.2026) — is Signify's too,
          // and its text says so. A scan of paper has no text and stays a scan.
          // One that will not read is marked read, not asked for every night.
          let kind: 'contract' | 'return_act' | 'scan' = byName;
          let facts: Record<string, unknown> = {};
          try {
            const text = await pdfText(new Uint8Array(await download(cfg, doc.id, fetchFn)));
            kind = kindOfText(text) ?? byName;
            if (kind === 'return_act') {
              const a = readReturnAct(text);
              facts = {
                datedOn: dateFromISO(a.returnedOn ?? fileDate(doc.name)),
                contractOn: dateFromISO(a.contractOn),
                vin: a.vin,
                depositTetri: a.depositTetri,
                withheldTetri: a.withheldTetri,
                paidBackTetri: a.paidBackTetri,
              };
            } else if (kind === 'contract') {
              const c = readContract(text);
              facts = { contractOn: dateFromISO(c.signedOn), vin: c.vin };
            }
          } catch (err) {
            if (err instanceof DriveError) throw err;
          }
          await prisma.driveFile.update({ where: { id: doc.id }, data: { ...facts, kind, readModifiedAt: modifiedAt } });
          read++;
        }
      }
    }
    // What is no longer in Drive is no longer here.
    await prisma.driveFile.deleteMany({ where: { seenAt: { lt: started } } });
    await prisma.driveFolder.deleteMany({ where: { seenAt: { lt: started } } });

    const matched = await matchDrive();
    await prisma.driveSync.update({ where: { id: 1 }, data: { lastOkAt: new Date(), failure: null, folders, files } });
    return { status: 'ok', folders, files, read, matched };
  } catch (err) {
    const e = err instanceof DriveError ? err : new DriveError('network');
    await prisma.driveSync.update({ where: { id: 1 }, data: { failure: e.failure } });
    return { status: 'failed', failure: e.failure, httpStatus: e.httpStatus, stage: e.stage };
  } finally {
    running = false;
  }
}

/** Which rental each folder is: the running rentals' folders among themselves, the finished ones among themselves. Returns how many folders found theirs. */
export async function matchDrive(): Promise<number> {
  const [rows, rentals] = await Promise.all([
    prisma.driveFolder.findMany({ select: { id: true, name: true, section: true, datedOn: true, files: { select: { vin: true } } } }),
    prisma.rental.findMany({
      select: {
        id: true,
        pickedUpOn: true,
        vehicle: { select: { vin: true } },
        // The mopeds a swap took out of it: its folder's papers may name them (ADR-0040).
        acts: { where: { kind: 'swap_out' }, select: { vehicle: { select: { vin: true } } } },
        customer: { select: { name: true, nameKa: true, nameLat: true } },
      },
    }),
  ]);
  const toMatch: RentalToMatch[] = rentals.map((r) => ({
    id: r.id,
    pickedUpOn: isoDate(r.pickedUpOn),
    vin: r.vehicle?.vin ?? null,
    formerVins: r.acts.flatMap((a) => (a.vehicle ? [a.vehicle.vin] : [])),
    names: [r.customer.nameLat, r.customer.name, r.customer.nameKa],
  }));
  const pool = (section: Section): FolderToMatch[] =>
    rows
      .filter((f) => f.section === section)
      .map((f) => ({ id: f.id, datedOn: isoDate(f.datedOn), person: folderName(f.name).person, vins: f.files.map((x) => x.vin).filter((v): v is string => !!v) }));
  const found = new Map([...matchFolders(pool('active'), toMatch), ...matchFolders(pool('finished'), toMatch, { nameAlone: false })]);
  await prisma.driveFolder.updateMany({ data: { rentalId: null, matchedBy: null } });
  for (const [folderId, m] of found) await prisma.driveFolder.update({ where: { id: folderId }, data: { rentalId: m.rentalId, matchedBy: m.by } });
  return found.size;
}

const RUNNING = ['active', 'overdue', 'paused', 'disputed'] as const;

/** A return act is a rental's only when it is not dated before the pickup: an older act is an older rental's (ADR-0034). */
export function actAfterPickup(actOn: string | null, pickedUpOn: string | null): boolean {
  return !actOn || !pickedUpOn || actOn >= pickedUpOn;
}

/**
 * A return act that names a moped this rental gave back at a swap is that
 * moped's paper — the old contract closed («старый договор закрыть») — and
 * not the end of the rental, which runs on with another moped (ADR-0040).
 * The moped it has now is never "swapped away", even if it was once.
 */
export function actOfSwappedMoped(actVin: string | null, rental: { vin: string | null; swappedVins: readonly string[] }): boolean {
  if (!actVin || sameVin(actVin, rental.vin)) return false;
  return rental.swappedVins.some((v) => sameVin(actVin, v));
}

/** How long a contract in Drive with no rental here is asked about on "Today": older ones are mostly finished rentals whose folder was not moved. */
export const DRIVE_NEW_DAYS = 14;

/**
 * Drive beside the rentals here: a return Drive has and the rental here does
 * not; a renter's folder with no rental here; a running rental with no folder.
 */
export async function driveReconciliation() {
  const on = driveConfig() !== null;
  const sync = await prisma.driveSync.findUnique({ where: { id: 1 } });
  const today = todayISO(new Date(), env.TZ);
  const folders = await prisma.driveFolder.findMany({
    orderBy: [{ datedOn: 'desc' }, { name: 'asc' }],
    include: {
      files: { orderBy: [{ datedOn: 'desc' }, { modifiedAt: 'desc' }] },
      rental: {
        select: {
          id: true,
          number: true,
          status: true,
          paidThrough: true,
          pickedUpOn: true,
          payWeekday: true,
          weekShiftDays: true,
          returnedOn: true,
          customer: { select: { id: true, name: true } },
          vehicle: { select: { vin: true } },
          acts: { where: { kind: 'swap_out' }, select: { vehicle: { select: { vin: true } } } },
        },
      },
    },
  });
  const rentals = await prisma.rental.findMany({
    where: { status: { in: [...RUNNING] } },
    orderBy: { number: 'asc' },
    select: { id: true, number: true, pickedUpOn: true, customer: { select: { id: true, name: true } }, vehicle: { select: { vin: true } } },
  });
  const withFolder = new Set(folders.map((f) => f.rentalId).filter(Boolean));
  const statusOf = (r: NonNullable<(typeof folders)[number]['rental']>) =>
    effectiveRentalStatus(r.status as RentalStatus, isoDate(r.paidThrough), isoDate(r.pickedUpOn), today, payOffsetOf(r));
  // The mopeds a swap took out of the folder's rental, beside the one it has (ADR-0040).
  const swapsOf = (f: (typeof folders)[number]) =>
    f.rental ? { vin: f.rental.vehicle?.vin ?? null, swappedVins: f.rental.acts.flatMap((a) => (a.vehicle ? [a.vehicle.vin] : [])) } : null;
  const swappedAct = (f: (typeof folders)[number], vin: string | null) => {
    const s = swapsOf(f);
    return !!s && actOfSwappedMoped(vin, s);
  };
  // The folder's return act — the rental's own, not one dated before its
  // pickup, nor the closing paper of a moped a swap took out of it.
  const act = (f: (typeof folders)[number]) =>
    f.files.find((x) => x.kind === 'return_act' && actAfterPickup(isoDate(x.datedOn), isoDate(f.rental?.pickedUpOn ?? null)) && !swappedAct(f, x.vin)) ?? null;
  // A finished folder whose every return act is a swapped moped's holds the
  // old contract, closed: the rental itself runs on.
  const onlySwapped = (f: (typeof folders)[number]) => {
    const acts = f.files.filter((x) => x.kind === 'return_act');
    return acts.length > 0 && acts.every((x) => swappedAct(f, x.vin));
  };
  // The moped came back by Drive: the folder was moved among the finished ones,
  // or the return act is in it already while it still stands among the running
  // (ADR-0034). One rental, one row: the one with an act first.
  const back = folders
    .filter((f) => f.rental && statusOf(f.rental) !== 'returned' && ((f.section === 'finished' && !onlySwapped(f)) || act(f) != null))
    .sort((a, b) => Number(act(b) != null) - Number(act(a) != null))
    .filter((f, i, all) => all.findIndex((x) => x.rentalId === f.rentalId) === i);
  const contract = (f: (typeof folders)[number]) => f.files.find((x) => x.kind === 'contract') ?? f.files.find((x) => x.kind === 'scan') ?? null;
  return {
    on,
    lastOkAt: sync?.lastOkAt?.toISOString() ?? null,
    lastTryAt: sync?.lastTryAt?.toISOString() ?? null,
    failure: sync?.failure ?? null,
    folders: folders.length,
    matched: folders.filter((f) => f.section === 'active' && f.rentalId).length,
    // The moped came back by Drive's act; here the rental still runs.
    returnedThere: back.map((f) => {
      const a = act(f);
      return {
        folder: { name: f.name, url: f.webUrl },
        rental: { id: f.rental!.id, number: f.rental!.number, customer: f.rental!.customer },
        act: a
          ? { url: a.webUrl, returnedOn: isoDate(a.datedOn), contractOn: isoDate(a.contractOn), vin: a.vin, depositTetri: a.depositTetri, withheldTetri: a.withheldTetri, paidBackTetri: a.paidBackTetri }
          : null,
      };
    }),
    // A renter's folder among the running ones with no rental here.
    missingHere: folders
      .filter((f) => f.section === 'active' && !f.rentalId)
      .map((f) => {
        const c = contract(f);
        // `returned`: a return act is in it — a rental that has ended, not one to enter.
        return { id: f.id, name: f.name, url: f.webUrl, datedOn: isoDate(f.datedOn), returned: f.files.some((x) => x.kind === 'return_act'), contract: c ? { url: c.webUrl, signedOn: isoDate(c.contractOn), vin: c.vin } : null };
      }),
    // A running rental here with no folder in Drive.
    missingThere: rentals.filter((r) => !withFolder.has(r.id)).map((r) => ({ id: r.id, number: r.number, customer: r.customer, pickedUpOn: isoDate(r.pickedUpOn), vin: r.vehicle?.vin ?? null })),
  };
}

/**
 * What "Today" asks of an owner from Drive (ADR-0034): a contract of the last
 * two weeks with no rental here, to enter; a return Drive has and the rental
 * here has not, to close. The same reading as «Настройки → Drive», so the two
 * never disagree. Nothing while the link is off.
 */
export async function driveTasks(today: string): Promise<{
  contracts: { folderId: string; who: string; datedOn: string | null }[];
  returns: { rentalId: string; returnedOn: string | null; paidBackTetri: number | null }[];
}> {
  if (!driveConfig()) return { contracts: [], returns: [] };
  const r = await driveReconciliation();
  const since = addDays(today, -DRIVE_NEW_DAYS);
  return {
    contracts: r.missingHere.filter((f) => !f.returned && f.datedOn != null && f.datedOn >= since).map((f) => ({ folderId: f.id, who: folderName(f.name).person, datedOn: f.datedOn })),
    returns: r.returnedThere.map((x) => ({ rentalId: x.rental.id, returnedOn: x.act?.returnedOn ?? null, paidBackTetri: x.act?.paidBackTetri ?? null })),
  };
}

type DriveContract = Awaited<ReturnType<typeof driveTasks>>['contracts'][number];
type KommoDeal = { leadId: string; kind: 'rent' | 'sale'; who: string; customerId: string | null; phone: string | null };

/**
 * One person, one row on "Today" (ADR-0034): a deal Kommo has won and a
 * contract in Drive with no rental here are the same hand-over when the names
 * share two words — the Drive row stays, filled in from the contract, and
 * takes the deal's link, card and phone; the deal's own row goes.
 */
export function joinKommoDeals(contracts: readonly DriveContract[], deals: readonly KommoDeal[]): { contracts: (DriveContract & { leadId?: string; customerId?: string | null; phone?: string | null })[]; deals: KommoDeal[] } {
  let left = [...deals];
  const joined = contracts.map((c) => {
    const d = left.find((x) => x.kind === 'rent' && sharedWords(c.who, [x.who]) >= 2);
    if (!d) return c;
    left = left.filter((x) => x !== d);
    return { ...c, leadId: d.leadId, customerId: d.customerId, phone: d.phone };
  });
  return { contracts: joined, deals: left };
}

/** A rental's folder and contract in Drive, for its card: the running rentals' folder first. */
export async function driveOfRental(rentalId: string): Promise<{ folderUrl: string | null; contractUrl: string | null; returnActUrl: string | null } | null> {
  const folders = await prisma.driveFolder.findMany({ where: { rentalId }, include: { files: { orderBy: { modifiedAt: 'desc' } } } });
  if (folders.length === 0) return null;
  const active = folders.find((f) => f.section === 'active') ?? folders[0];
  const all = folders.flatMap((f) => f.files);
  return {
    folderUrl: active.webUrl,
    contractUrl: (all.find((x) => x.kind === 'contract') ?? all.find((x) => x.kind === 'scan'))?.webUrl ?? null,
    returnActUrl: all.find((x) => x.kind === 'return_act')?.webUrl ?? null,
  };
}
