import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { daysBetween, looseNames, parseBankAmount } from '@ev8/shared';

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

/**
 * What a PDF is by its text, whatever its name: Signify's return act or its
 * rental contract (a contract named «Rental agreement — …» in Drive is one).
 * None — a scan of paper, or something else.
 */
export function kindOfText(text: string): 'contract' | 'return_act' | null {
  const t = flat(text);
  if (/დაბრუნებისა და საბოლოო ანგარიშსწორების აქტი/.test(t)) return 'return_act';
  if (/ქირაობის ხელშეკრულება/.test(t)) return 'contract';
  return null;
}

/** A date at the head of a file's name — «261012 …» — as Kardu names the acts he files. */
export function fileDate(name: string): string | null {
  return folderName(name).datedOn;
}

/** A piece of a page: printed text, or what was typed into a form field, where it stands. */
export interface PagePiece {
  y: number;
  x: number;
  str: string;
}

/**
 * Pieces in reading order: top to bottom, a line at a time, left to right. A
 * field and the label beside it stand a few points apart in height; within
 * that, they are one line.
 */
export function readingOrder(pieces: readonly PagePiece[], tolerance = 6): string {
  const sorted = [...pieces].filter((p) => p.str.trim() !== '').sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PagePiece[][] = [];
  for (const p of sorted) {
    const line = lines[lines.length - 1];
    if (line && Math.abs(line[0].y - p.y) <= tolerance) line.push(p);
    else lines.push([p]);
  }
  return lines.map((l) => l.sort((a, b) => a.x - b.x).map((p) => p.str).join(' ')).join('\n');
}

/**
 * The text of a PDF that has text — Signify's documents do. Signify prints the
 * form and puts what was filled in into form fields over it: the date, the
 * renter, the VIN, the deposit (seen on its return acts, 19.10.2026). So the
 * printed text and the fields' values are read together, each where it
 * stands, and a label is followed by its value as the page shows them.
 * Ticks (yes/no boxes) and signatures are not read.
 */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // The fourteen standard PDF fonts come with the library; a document that names one without embedding it is still read.
  const standardFontDataUrl = `${dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))}/standard_fonts/`;
  const doc = await pdfjs.getDocument({ data: bytes, useSystemFonts: false, isEvalSupported: false, disableFontFace: true, standardFontDataUrl }).promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const pieces: PagePiece[] = content.items.flatMap((it) => ('str' in it ? [{ x: it.transform[4] as number, y: it.transform[5] as number, str: it.str }] : []));
    for (const a of (await page.getAnnotations()) as { subtype?: string; fieldType?: string; fieldValue?: unknown; rect?: number[] }[]) {
      if (a.subtype !== 'Widget' || a.fieldType !== 'Tx' || typeof a.fieldValue !== 'string' || !a.rect) continue;
      // A field's text sits a little above its box's lower edge, as a printed line's baseline does.
      pieces.push({ x: a.rect[0], y: a.rect[1] + 3, str: a.fieldValue });
    }
    out.push(readingOrder(pieces));
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
/** A VIN as typed into a field, a letter or two short («H8LWF…» for «HH8LWF…»): the end of one. */
const VIN_TYPED = /\b[A-HJ-NPR-Z0-9]{11,17}\b/;
const vinAfterLabel = (t: string): string | null => {
  const near = after(t, /VIN\s*:?/) ?? '';
  return VIN.exec(near)?.[0] ?? VIN_TYPED.exec(near)?.[0] ?? VIN.exec(t)?.[0] ?? null;
};
const iso = (m: RegExpExecArray | null): string | null => (m && isRealDay(`${m[3]}-${m[2]}-${m[1]}`) ? `${m[3]}-${m[2]}-${m[1]}` : null);

/** What stands right after a label: the next few words, never the next section. */
function after(text: string, label: RegExp, span = 40): string | null {
  const at = label.exec(text);
  return at ? text.slice(at.index + at[0].length, at.index + at[0].length + span) : null;
}

/** A date right after a label; an empty field gives none. */
function dayAfter(text: string, label: RegExp): string | null {
  const near = after(text, label);
  return near ? iso(DAY.exec(near)) : null;
}

/** A sum between a label and its «ლარი» (lari), in tetri: «… 180 ლარი» → 18000; an empty field gives none. */
function sumAfter(text: string, label: RegExp): number | null {
  const near = after(text, label, 60);
  if (near == null) return null;
  const upTo = near.split('ლარი')[0];
  const m = /(\d[\d.,]*)/.exec(upTo);
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
  return {
    // The act's own date is the first «თარიღი» (date) on it; the contract's has its own label.
    returnedOn: dayAfter(t, /თარიღი:?/),
    contractOn: dayAfter(t, /ხელშეკრულების თარიღი:?/),
    vin: vinAfterLabel(t),
    depositTetri: sumAfter(t, /დეპოზიტის ოდენობა/),
    withheldTetri: sumAfter(t, /დაკავებული თანხა(?!ის)/),
    paidBackTetri: sumAfter(t, /დაბრუნებული თანხა/),
  };
}

/** Signify's rental contract: the day it was made, and the moped. */
export function readContract(text: string): { signedOn: string | null; vin: string | null } {
  const t = flat(text);
  return { signedOn: dayAfter(t, /თარიღი:?/) ?? iso(DAY.exec(t)), vin: vinAfterLabel(t) };
}

/** Text between a label and the next label, trimmed; none when the field is empty. */
function between(text: string, from: RegExp, to: RegExp, max = 120): string | null {
  const at = from.exec(text);
  if (!at) return null;
  const rest = text.slice(at.index + at[0].length);
  const end = to.exec(rest);
  const value = (end ? rest.slice(0, end.index) : rest.slice(0, max)).trim().replace(/^[:\s]+/, '');
  return value && value.length <= max ? value : null;
}

export interface ContractParty {
  /** The renter as the contract writes them. */
  name: string | null;
  /** Georgian personal number (11 digits) or a passport's. */
  personalId: string | null;
  phone: string | null;
  address: string | null;
  signedOn: string | null;
  vin: string | null;
  rateTetri: number | null;
  depositTetri: number | null;
}

/**
 * The renter and the terms off Signify's rental contract — to fill the
 * hand-over wizard when a contract in Drive has no rental here (Mika,
 * 19.10.2026). Read in the renter's part (after «მოქირავე», the renter): the
 * company's own address comes before it.
 */
export function readContractParty(text: string): ContractParty {
  const t = flat(text);
  const at = t.search(/მოქირავე\s*:/);
  const renter = at >= 0 ? t.slice(at) : t;
  const idNear = after(renter, /პირადი\s+ნომერი\s*:?/) ?? '';
  const phoneNear = after(renter, /ტელეფონი\s*:?/) ?? '';
  return {
    name: between(renter, /სახელი\s*,?\s*გვარი\s*:?/, /პირადი|ტელეფონი/, 80),
    personalId: /\b(\d{11}|[A-Z]{1,3}\d{6,9})\b/.exec(idNear)?.[1] ?? null,
    phone: /(\+?\d[\d\s-]{7,}\d)/.exec(phoneNear)?.[1].replace(/[\s-]+/g, ' ').trim() ?? null,
    address: between(renter, /მისამართი:?/, /\s\d\.\s|ხელშეკრულების საგანი/, 120),
    ...readContract(text),
    rateTetri: sumAfter(t, /ქირა\s*:/),
    depositTetri: sumAfter(t, /დეპოზიტი\s*:/),
  };
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
export function matchFolders(
  folders: readonly FolderToMatch[],
  rentals: readonly RentalToMatch[],
  opts: { nameAlone?: boolean } = {},
): Map<string, { rentalId: string; by: 'vin' | 'name_date' | 'name' }> {
  // Among the finished folders a name alone is not enough, and a folder dated
  // before the pickup is an older rental: a renter who comes back has one there,
  // and it is not this rental's return (19.10.2026, production: a renter's
  // folder of June beside his rental of October). Three days of slack for a
  // folder named a day or two off.
  const nameAlone = opts.nameAlone ?? true;
  const pairs: { folderId: string; rentalId: string; score: number; by: 'vin' | 'name_date' | 'name' }[] = [];
  for (const f of folders) {
    for (const r of rentals) {
      const words = sharedWords(f.person, r.names);
      // A VIN typed a letter or two short is the end of the moped's.
      const vin = !!r.vin && f.vins.some((v) => v === r.vin || (v.length >= 11 && r.vin!.endsWith(v)));
      const day = !!f.datedOn && f.datedOn === r.pickedUpOn;
      // A VIN without the person's name is the moped, not the renter — the
      // same moped goes from hand to hand — so it counts only with the day.
      if (words === 0 && !(vin && day)) continue;
      const score = words + (day ? 2 : 0) + (vin ? 3 : 0);
      if (score < 2) continue;
      if (!nameAlone && !day && !vin) continue;
      if (!nameAlone && f.datedOn && r.pickedUpOn && daysBetween(f.datedOn, r.pickedUpOn) > 3) continue;
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
