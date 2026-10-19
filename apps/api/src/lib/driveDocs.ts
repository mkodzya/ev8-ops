import { looseNames, parseBankAmount } from '@ev8/shared';

// What EV8 Ops reads off the rentals folders in Drive (ADR-0031): the date and
// the person in a folder's name, what kind of document a file is by its name,
// and — from the documents Signify made, which carry their text — the dates,
// the moped and the deposit. A scan of paper has no text worth reading: its
// folder's name is what is known of it. Every function here is pure.

/** A folder named the way the company names them: «260718 Name Surname» — the pickup day, then the person. */
export function folderName(name: string): { datedOn: string | null; person: string } {
  const m = /^\s*(\d{2})(\d{2})(\d{2})\s+(.*)$/.exec(name);
  if (!m) return { datedOn: null, person: name.trim() };
  const [, yy, mm, dd, rest] = m;
  const datedOn = `20${yy}-${mm}-${dd}`;
  return { datedOn: isRealDay(datedOn) ? datedOn : null, person: rest.trim() };
}

/** A calendar day that exists: 31.02 does not. */
function isRealDay(iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/**
 * What a file is, by its name and type. Signify's own PDFs are read; a scan is
 * kept by name only; a photo — an identity document among them — is never
 * opened, nor is Signify's audit trail (`…-at.pdf`).
 */
export type DriveFileKind = 'contract' | 'return_act' | 'scan' | 'skip';

export function fileKind(name: string, mimeType: string): DriveFileKind {
  if (mimeType !== 'application/pdf') return 'skip';
  const n = name.toLowerCase();
  if (/-at\.pdf$/.test(n)) return 'skip';
  if (/(^|\b)id\b|passport|pasport/.test(n)) return 'skip';
  if (n.includes('დაბრუნებისა')) return 'return_act';
  if (n.includes('ხელშეკრულება')) return 'contract';
  return 'scan';
}

/** A date at the head of a file's name — «261012 …» — as Kardu names the acts he files. */
export function fileDate(name: string): string | null {
  return folderName(name).datedOn;
}

/** The text of a PDF that has text: Signify's documents do. Lines as the pages give them. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false, disableFontFace: true }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    out.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
  }
  await doc.destroy();
  return out.join('\n');
}

/** Underlines, escapes and runs of space out of the way; what is left reads label, then value. */
const flat = (text: string): string =>
  text
    .replace(/[_\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const DAY = /\b(\d{2})[/.](\d{2})[/.](\d{4})\b/;
const VIN = /\b[A-HJ-NPR-Z0-9]{17}\b/;
const iso = (m: RegExpExecArray | null): string | null => (m && isRealDay(`${m[3]}-${m[2]}-${m[1]}`) ? `${m[3]}-${m[2]}-${m[1]}` : null);

/** The first date after a label. */
function dayAfter(text: string, label: RegExp): string | null {
  const at = label.exec(text);
  return at ? iso(DAY.exec(text.slice(at.index + at[0].length))) : null;
}

/** The first sum after a label, in tetri: «… 180 ლარი» → 18000. */
function sumAfter(text: string, label: RegExp): number | null {
  const at = label.exec(text);
  if (!at) return null;
  const m = /(\d[\d.,]*)/.exec(text.slice(at.index + at[0].length, at.index + at[0].length + 60));
  return m ? parseBankAmount(m[1].replace(/[.,]$/, '')) : null;
}

export interface ReturnActFacts {
  /** The act's date: the day the moped came back. */
  returnedOn: string | null;
  /** The contract the act closes. */
  contractOn: string | null;
  vin: string | null;
  depositTetri: number | null;
  withheldTetri: number | null;
  /** What the act says was actually handed back to the renter. */
  paidBackTetri: number | null;
}

/**
 * Signify's «დაბრუნებისა და საბოლოო ანგარიშსწორების აქტი» (return and final
 * settlement act): its date, the contract's date, the VIN, and section 6 —
 * the deposit paid in (შეტანილი დეპოზიტის ოდენობა), the sum kept (დაკავებული
 * თანხა) and what was handed back (ფაქტობრივად დაბრუნებული თანხა).
 */
export function readReturnAct(text: string): ReturnActFacts {
  const t = flat(text);
  const contractOn = dayAfter(t, /ხელშეკრულების თარიღი/);
  return {
    returnedOn: iso(DAY.exec(t)),
    contractOn,
    vin: VIN.exec(t)?.[0] ?? null,
    depositTetri: sumAfter(t, /დეპოზიტის ოდენობა/),
    withheldTetri: sumAfter(t, /დაკავებული თანხა(?!ის)/),
    paidBackTetri: sumAfter(t, /დაბრუნებული თანხა/),
  };
}

/** Signify's rental contract: the day it was made, and the moped. */
export function readContract(text: string): { signedOn: string | null; vin: string | null } {
  const t = flat(text);
  return { signedOn: iso(DAY.exec(t)), vin: VIN.exec(t)?.[0] ?? null };
}

// ---------------------------------------------------------------------------
// Which rental a folder is
// ---------------------------------------------------------------------------

export interface FolderToMatch {
  id: string;
  datedOn: string | null;
  person: string;
  /** VINs the folder's Signify documents name. */
  vins: string[];
}

export interface RentalToMatch {
  id: string;
  pickedUpOn: string | null;
  vin: string | null;
  names: (string | null)[];
}

/** Edits between two words, to forgive a letter typed wrong in a folder's name («gulovani»). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

const near = (a: string, b: string): boolean => a === b || (Math.min(a.length, b.length) >= 4 && distance(a, b) <= (Math.min(a.length, b.length) >= 7 ? 2 : 1));

/** How many words of a person's name the folder's name has, one spelling or another. */
export function sharedWords(folderPerson: string, names: (string | null)[]): number {
  const folder = looseNames(folderPerson)[0] ?? [];
  let best = 0;
  for (const name of names) {
    if (!name) continue;
    for (const form of looseNames(name)) {
      const left = [...folder];
      let n = 0;
      for (const w of form) {
        const i = left.findIndex((x) => near(x, w));
        if (i >= 0) {
          n++;
          left.splice(i, 1);
        }
      }
      best = Math.max(best, n);
    }
  }
  return best;
}

/**
 * Each rental its folder, at most one, and each folder at most one rental —
 * among the running rentals' folders, or among the finished ones, never the
 * two together. A folder speaks for a rental by the person's name (a word of
 * it, spelt however), the pickup day in its name, and a VIN in its documents;
 * the day alone never does — two rentals start on one day. The best pairs
 * are taken first.
 */
export function matchFolders(folders: readonly FolderToMatch[], rentals: readonly RentalToMatch[]): Map<string, { rentalId: string; by: 'vin' | 'name_date' | 'name' }> {
  const pairs: { folderId: string; rentalId: string; score: number; by: 'vin' | 'name_date' | 'name' }[] = [];
  for (const f of folders) {
    for (const r of rentals) {
      const words = sharedWords(f.person, r.names);
      const vin = !!r.vin && f.vins.includes(r.vin);
      const day = !!f.datedOn && f.datedOn === r.pickedUpOn;
      // A VIN without the person's name is the moped, not the renter — the
      // same moped goes from hand to hand — so it counts only with the day.
      if (words === 0 && !(vin && day)) continue;
      const score = words + (day ? 2 : 0) + (vin ? 3 : 0);
      if (score < 2) continue;
      pairs.push({ folderId: f.id, rentalId: r.id, score, by: vin ? 'vin' : day ? 'name_date' : 'name' });
    }
  }
  pairs.sort((a, b) => b.score - a.score);
  const out = new Map<string, { rentalId: string; by: 'vin' | 'name_date' | 'name' }>();
  const taken = new Set<string>();
  for (const p of pairs) {
    if (out.has(p.folderId) || taken.has(p.rentalId)) continue;
    // Two folders as good as each other for one rental: neither is chosen here.
    const rival = pairs.find((q) => q !== p && q.rentalId === p.rentalId && q.score === p.score && !out.has(q.folderId));
    if (rival) continue;
    out.set(p.folderId, { rentalId: p.rentalId, by: p.by });
    taken.add(p.rentalId);
  }
  return out;
}
