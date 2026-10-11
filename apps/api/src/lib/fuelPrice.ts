import { prisma } from './db.js';

// The price of a litre of petrol for the site's calculator (Kardu,
// 11.10.2026: "стоимость бензина для сравнения должна подтягиваться всегда
// актуальная"). Once a day the worker knocks, this reads the price boards of
// the Georgian chains and keeps one number: the median of their regular
// petrol (92/93), what a courier's petrol moped runs on. The site asks for it
// when the calculator opens and says which day the price is of.
//
// Where it reads: priceshub.ge, one page with a table per chain (SOCAR,
// Rompetrol, Gulf, Lukoil, Wissol, Portal, Connect), prices in the HTML as
// `data-std="4.03"` beside the octane. It is somebody else's page and can
// change without notice, so the reading is strict: fewer than three chains,
// or a price outside 2–8 GEL, and nothing is written — the last good price
// stays, with its date, and the failure is kept for whoever looks.

export const FUEL_SOURCE = 'https://priceshub.ge/';
/** Fewer chains than this and the page is not what we think it is. */
const MIN_CHAINS = 3;
const SANE_TETRI = { min: 200, max: 800 };

export type FuelFetch = (url: string) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
let fetchPage: FuelFetch = (url) =>
  fetch(url, { headers: { 'user-agent': 'EV8 Ops (info@ev8.ge) — daily fuel price for ev8.ge' }, signal: AbortSignal.timeout(15_000) });

/** Tests read a page they wrote themselves. */
export function setFuelFetchForTests(fn: FuelFetch): void {
  fetchPage = fn;
}

/**
 * Regular petrol, one price per chain: the first row of each table whose
 * octane starts with 92 (Gulf lists the same price twice; one is enough).
 * Prices in tetri.
 */
export function regularPrices(html: string): number[] {
  const out: number[] = [];
  for (const table of html.split(/<table\b/i).slice(1)) {
    const m = table.match(/<td[^>]*>\s*92[^<]*<\/td>\s*<td[^>]*\bdata-std="(\d{1,2}(?:\.\d{1,2})?)"/i);
    if (m) out.push(Math.round(Number(m[1]) * 100));
  }
  return out;
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

export type FuelOutcome =
  | { status: 'ok'; perLitreTetri: number; chains: number }
  | { status: 'failed'; failure: string; httpStatus: number | null };

/** Read the boards and keep the price — or keep the failure and the old price. */
export async function refreshFuelPrice(now: Date = new Date()): Promise<FuelOutcome> {
  let outcome: FuelOutcome;
  try {
    const res = await fetchPage(FUEL_SOURCE);
    if (!res.ok) {
      outcome = { status: 'failed', failure: 'the page did not answer', httpStatus: res.status };
    } else {
      const prices = regularPrices(await res.text()).filter((p) => p >= SANE_TETRI.min && p <= SANE_TETRI.max);
      outcome =
        prices.length < MIN_CHAINS
          ? { status: 'failed', failure: `regular petrol found for ${prices.length} chain(s), fewer than ${MIN_CHAINS}`, httpStatus: null }
          : { status: 'ok', perLitreTetri: median(prices), chains: prices.length };
    }
  } catch (err) {
    outcome = { status: 'failed', failure: `the page could not be read — ${(err as Error)?.name ?? 'error'}`, httpStatus: null };
  }

  if (outcome.status === 'ok') {
    const data = { perLitreTetri: outcome.perLitreTetri, chains: outcome.chains, source: FUEL_SOURCE, asOf: now, lastTryAt: now, lastFailure: null };
    await prisma.fuelPrice.upsert({ where: { id: true }, create: { id: true, ...data }, update: data });
  } else {
    await prisma.fuelPrice.upsert({
      where: { id: true },
      create: { id: true, lastTryAt: now, lastFailure: outcome.failure },
      update: { lastTryAt: now, lastFailure: outcome.failure },
    });
  }
  return outcome;
}

export interface FuelAnswer {
  perLitreTetri: number;
  /** When the price was read — the site prints it beside the figure. */
  asOf: string;
  chains: number;
  grade: 'regular';
}

/** The last good price, or null when none was ever read. */
export async function currentFuelPrice(): Promise<FuelAnswer | null> {
  const row = await prisma.fuelPrice.findUnique({ where: { id: true } });
  if (!row || row.perLitreTetri == null || !row.asOf) return null;
  return { perLitreTetri: row.perLitreTetri, asOf: row.asOf.toISOString(), chains: row.chains ?? 0, grade: 'regular' };
}
