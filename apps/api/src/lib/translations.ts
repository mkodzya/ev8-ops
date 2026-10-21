// Typed text in the reader's language (ADR-0042; Mika, 21.10.2026): which
// texts are translated, the job that translates them, and what a screen reads.
//
// **What goes out is read here, by one list.** The sources below are keyed by
// TRANSLATED_SOURCES in packages/shared/src/typed.ts — answer A: only texts
// about mopeds and repairs. A source not on that list does not compile, and a
// customer's, a rental's, a payment's, a deposit's, the bank's, a sale's or a
// purchase's words are never read by it. Nothing is hooked into the routes
// that write those texts: a scan finds them, so every way a text is written,
// today's and tomorrow's, is covered, and the history is translated too.
//
// **One row per distinct text**, keyed by the sha256 of its UTF-8 bytes. The
// same reason in a moped's event and in its journal line is one request.
//
// **The job** is the worker's minute (POST /api/jobs/translate): it looks for
// texts written since the last look — and once an hour at all of them, which
// also forgets translations of texts nobody keeps any more — then asks the
// translator about what waits, one text a request, a few a run. A day in
// Tbilisi takes at most TRANSLATE_DAILY_LIMIT texts (500); the rest wait for
// the next day. A failure of the service backs the text off (1, 5, 15, 60
// minutes) and stops the run; a text the model declines, cannot fit or
// answers wrongly is given up, and its original is what everyone reads. The
// outcome is counts and token usage, never a text.
//
// **A screen asks** POST /api/texts/translations with the texts it shows and
// gets back what is ready. Asking never creates a row and never calls the
// translator: reading costs nothing, and the route translates nothing that
// was not already listed.

import { createHash } from 'node:crypto';
import {
  TEXT_LANGS,
  TRANSLATED_EVENT_KINDS,
  TRANSLATED_JOURNAL_LINES,
  TRANSLATED_SOURCES,
  stockReasonText,
  todayISO,
  translatable,
  type TextLang,
  type TextTranslation,
  type TranslatedSource,
} from '@ev8/shared';
import { dateFromISO } from './dates.js';
import { prisma } from './db.js';
import { TranslatorError, translateText, translatorConfig, type TranslatorAnswer, type TranslatorConfig, type TranslatorFailure } from './translator.js';

/** The key of a text: sha256 of its UTF-8 bytes, in hex. */
export const textHash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Rows written or changed since then; null — every row. */
type Since = Date | null;

/** One look at the sources: since when, and the repairs' texts read once for the five columns that need them. */
interface Look {
  at: Since;
  jobs: () => Promise<JobTexts[]>;
}

interface JobTexts {
  reason: string;
  notes: string | null;
  rejectReason: string | null;
  odometerReason: string | null;
  closedOdometerReason: string | null;
}

function look(at: Since): Look {
  let jobs: Promise<JobTexts[]> | null = null;
  return {
    at,
    jobs: () =>
      (jobs ??= prisma.serviceJob.findMany({
        where: at ? { OR: [{ createdAt: { gte: at } }, { updatedAt: { gte: at } }, { rejectedAt: { gte: at } }, { closedAt: { gte: at } }] } : {},
        select: { reason: true, notes: true, rejectReason: true, odometerReason: true, closedOdometerReason: true },
      })),
  };
}

/**
 * Where each listed text is read, as the screens show it. Keyed by the
 * shared list: `Record<TranslatedSource, …>` makes a missing source and an
 * extra one both a compile error. A look `since` reads what was written or
 * changed lately; a row changed without its time moving is found by the
 * hourly look at everything.
 */
const SOURCES: Record<TranslatedSource, (l: Look) => Promise<(string | null)[]>> = {
  // A state change's reason — not a pickup's, a return's, a sale's or an arrival's.
  'vehicle_events.reason': async ({ at }) =>
    (
      await prisma.vehicleEvent.findMany({
        where: { kind: { in: [...TRANSLATED_EVENT_KINDS] }, rentalId: null, reason: { not: null }, ...(at ? { createdAt: { gte: at } } : {}) },
        select: { reason: true },
        distinct: ['reason'],
      })
    ).map((r) => r.reason),
  'vehicles.notes': async ({ at }) =>
    (await prisma.vehicle.findMany({ where: { notes: { not: null }, ...(at ? { updatedAt: { gte: at } } : {}) }, select: { notes: true }, distinct: ['notes'] })).map((r) => r.notes),
  'service_jobs.reason': async (l) => (await l.jobs()).map((r) => r.reason),
  'service_jobs.notes': async (l) => (await l.jobs()).map((r) => r.notes),
  'service_jobs.reject_reason': async (l) => (await l.jobs()).map((r) => r.rejectReason),
  'service_jobs.odometer_reason': async (l) => (await l.jobs()).map((r) => r.odometerReason),
  'service_jobs.closed_odometer_reason': async (l) => (await l.jobs()).map((r) => r.closedOdometerReason),
  'service_works.free_text': async ({ at }) =>
    (
      await prisma.serviceWork.findMany({
        where: { freeText: { not: null }, ...(at ? { OR: [{ createdAt: { gte: at } }, { rejectedAt: { gte: at } }] } : {}) },
        select: { freeText: true },
        distinct: ['freeText'],
      })
    ).map((r) => r.freeText),
  'service_works.reject_reason': async ({ at }) =>
    (
      await prisma.serviceWork.findMany({
        where: { rejectReason: { not: null }, ...(at ? { rejectedAt: { gte: at } } : {}) },
        select: { rejectReason: true },
        distinct: ['rejectReason'],
      })
    ).map((r) => r.rejectReason),
  'service_parts.reject_reason': async ({ at }) =>
    (
      await prisma.servicePart.findMany({
        where: { rejectReason: { not: null }, ...(at ? { rejectedAt: { gte: at } } : {}) },
        select: { rejectReason: true },
        distinct: ['rejectReason'],
      })
    ).map((r) => r.rejectReason),
  // As the part's card reads it: without the repair's number in front, and never a receipt of a purchase.
  'stock_moves.reason': async ({ at }) =>
    (
      await prisma.stockMove.findMany({
        where: { reason: { not: null }, purchaseLineId: null, ...(at ? { createdAt: { gte: at } } : {}) },
        select: { reason: true, servicePart: { select: { job: { select: { number: true } } } } },
      })
    ).map((m) => stockReasonText(m.reason, { job: m.servicePart?.job.number ?? null })),
  // Not a battery a renter lost on a return: that is the rental's.
  'battery_moves.reason': async ({ at }) =>
    (
      await prisma.batteryMove.findMany({
        where: { reason: { not: null }, rentalId: null, actId: null, ...(at ? { createdAt: { gte: at } } : {}) },
        select: { reason: true },
        distinct: ['reason'],
      })
    ).map((r) => r.reason),
  'battery_inventories.reason': async ({ at }) =>
    (await prisma.batteryInventory.findMany({ where: { reason: { not: null }, ...(at ? { createdAt: { gte: at } } : {}) }, select: { reason: true }, distinct: ['reason'] })).map(
      (r) => r.reason,
    ),
  'workshops.note': async ({ at }) =>
    (await prisma.workshop.findMany({ where: { note: { not: null }, ...(at ? { updatedAt: { gte: at } } : {}) }, select: { note: true }, distinct: ['note'] })).map((r) => r.note),
  'locations.note': async ({ at }) =>
    (await prisma.location.findMany({ where: { note: { not: null }, ...(at ? { updatedAt: { gte: at } } : {}) }, select: { note: true }, distinct: ['note'] })).map((r) => r.note),
  // The journal lines that carry a moped's, a repair's or a battery count's reason — never a customer's or money's.
  'audit_log.note': async ({ at }) =>
    (
      await prisma.auditLog.findMany({
        where: { note: { not: null }, OR: TRANSLATED_JOURNAL_LINES.map((j) => ({ action: j.action, entityType: j.entityType })), ...(at ? { createdAt: { gte: at } } : {}) },
        select: { note: true },
        distinct: ['note'],
      })
    ).map((r) => r.note),
};

/** The listed texts worth a translation, each once. */
async function listedTexts(at: Since): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const l = look(at);
  for (const source of TRANSLATED_SOURCES) {
    for (const text of await SOURCES[source](l)) {
      if (text == null || !translatable(text)) continue;
      found.set(textHash(text), text);
    }
  }
  return found;
}

const CHUNK = 1000;
function chunks<T>(list: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
}

/** Every look at all the texts, at most this often; the minutes between look at what was written since. */
const FULL_SCAN_MS = 60 * 60_000;
/** A look since the last one starts this much before it: the database's clock and this process's may differ a little. */
const OVERLAP_MS = 2 * 60_000;
let lastFullAt = 0;
let lastLookAt: Date | null = null;

/**
 * Write each listed text that has no row yet, to wait for the translator.
 * With `full`, or once an hour, every text is looked at, and the rows of
 * texts no longer kept anywhere are deleted — a note rewritten leaves no copy
 * of its old words behind for long. Counts only.
 */
export async function scanTexts(opts: { full?: boolean; now?: Date } = {}): Promise<{ found: number; forgotten: number }> {
  const now = opts.now ?? new Date();
  const full = opts.full === true || lastLookAt == null || now.getTime() - lastFullAt >= FULL_SCAN_MS;
  const at = full ? null : new Date(lastLookAt!.getTime() - OVERLAP_MS);
  const started = new Date();
  const listed = await listedTexts(at);
  const hashes = [...listed.keys()];
  const known = new Set<string>();
  for (const part of chunks(hashes)) {
    for (const r of await prisma.textTranslation.findMany({ where: { sourceHash: { in: part } }, select: { sourceHash: true } })) known.add(r.sourceHash);
  }
  const fresh = hashes.filter((h) => !known.has(h));
  let found = 0;
  for (const part of chunks(fresh)) {
    found += (await prisma.textTranslation.createMany({ data: part.map((h) => ({ sourceHash: h, sourceText: listed.get(h)! })), skipDuplicates: true })).count;
  }
  let forgotten = 0;
  if (full) {
    const kept = await prisma.textTranslation.findMany({ where: { firstSeenAt: { lt: started } }, select: { sourceHash: true } });
    const gone = kept.map((r) => r.sourceHash).filter((h) => !listed.has(h));
    for (const part of chunks(gone)) {
      forgotten += (await prisma.textTranslation.deleteMany({ where: { sourceHash: { in: part }, firstSeenAt: { lt: started } } })).count;
    }
    lastFullAt = now.getTime();
  }
  lastLookAt = started;
  return { found, forgotten };
}

// ── The job ─────────────────────────────────────────────────────────────

/**
 * What a run did, in counts — never a text. `off` — no key on this stand:
 * nothing is sent and the texts wait; `busy` — another run is translating.
 * `today` is the day's spend so far, for measuring what a day costs.
 */
export interface TranslateOutcome {
  status: 'off' | 'busy' | 'ok';
  /** Texts newly listed by this run's look. */
  found: number;
  translated: number;
  /** Requests that did not bring a translation: the service failed, or the model gave none. */
  failed: number;
  /** Texts given up for good by this run. */
  gaveUp: number;
  /** Still waiting after the run. */
  pending: number;
  /** The day's cap was reached: the rest wait for tomorrow. */
  capped: boolean;
  today: { requests: number; inputTokens: number; outputTokens: number };
}

/** Texts a run asks about; a run every minute gets through a day's cap in under half an hour. */
const BATCH = 20;
/** A run stops asking after this long, so the next minute's run is not kept waiting. */
const RUN_BUDGET_MS = 45_000;
/** Tried this many times without an answer: given up. */
const MAX_ATTEMPTS = 8;
/** Minutes to wait after the first, second, third and every later failure. */
const BACKOFF_MIN = [1, 5, 15, 60];
/** The rest of the run would fail the same way: it stops. A request the service did not take may be this text's alone. */
const STOPS = new Set<TranslatorFailure>(['unauthorized', 'billing', 'rate_limited', 'overloaded', 'no_model', 'http', 'network']);

const WAITING = { translatedAt: null, gaveUpAt: null } as const;
const countPending = () => prisma.textTranslation.count({ where: WAITING });

let running: Promise<TranslateOutcome> | null = null;
/** The clock a run reads its own time on; a test may hold it. */
let clockMs: () => number = Date.now;

/** Tests start from a job that has never looked, on the real clock. */
export function resetTranslationsForTests(): void {
  lastFullAt = 0;
  lastLookAt = null;
  clockMs = Date.now;
}

/** Tests hold the run's clock, or move it. */
export function setTranslationClockForTests(fn: () => number): void {
  clockMs = fn;
}

/** The day in Tbilisi, as the `translation_days` key. */
const dayOf = (now: Date): Date => dateFromISO(todayISO(now))!;

async function spentOn(day: Date): Promise<TranslateOutcome['today']> {
  const row = await prisma.translationDay.findUnique({ where: { day } });
  return { requests: row?.requests ?? 0, inputTokens: row?.inputTokens ?? 0, outputTokens: row?.outputTokens ?? 0 };
}

async function tally(day: Date, d: { requests?: number; translated?: number; failed?: number; inputTokens?: number; outputTokens?: number }): Promise<void> {
  const n = { requests: d.requests ?? 0, translated: d.translated ?? 0, failed: d.failed ?? 0, inputTokens: d.inputTokens ?? 0, outputTokens: d.outputTokens ?? 0 };
  await prisma.translationDay.upsert({
    where: { day },
    create: { day, ...n },
    update: {
      requests: { increment: n.requests },
      translated: { increment: n.translated },
      failed: { increment: n.failed },
      inputTokens: { increment: n.inputTokens },
      outputTokens: { increment: n.outputTokens },
      updatedAt: new Date(),
    },
  });
}

/**
 * Look for new texts, then translate what waits. Single-flight: a second call
 * while one runs answers `busy`. Never throws for the translator's sake.
 */
export function runTranslations(now: Date = new Date()): Promise<TranslateOutcome> {
  if (running) return Promise.resolve(idle('busy', 0, 0, { requests: 0, inputTokens: 0, outputTokens: 0 }));
  running = (async () => {
    const { found } = await scanTexts({ now });
    return translateWaiting(now, found);
  })().finally(() => {
    running = null;
  });
  return running;
}

const idle = (status: TranslateOutcome['status'], found: number, pending: number, today: TranslateOutcome['today'], capped = false): TranslateOutcome => ({
  status,
  found,
  translated: 0,
  failed: 0,
  gaveUp: 0,
  pending,
  capped,
  today,
});

/**
 * Ask the translator about what waits, within the day's cap. Without a key
 * nothing is asked and the texts wait — the screens show their originals.
 */
export async function translateWaiting(now: Date = new Date(), found = 0, cfg: TranslatorConfig | null = translatorConfig()): Promise<TranslateOutcome> {
  const day = dayOf(now);
  if (!cfg) return idle('off', found, await countPending(), await spentOn(day));
  const room = Math.max(0, cfg.dailyLimit - (await spentOn(day)).requests);
  if (room === 0) return idle('ok', found, await countPending(), await spentOn(day), true);
  const due = await prisma.textTranslation.findMany({
    where: { ...WAITING, nextTryAt: { lte: now } },
    orderBy: [{ nextTryAt: 'asc' }, { firstSeenAt: 'asc' }],
    take: Math.min(BATCH, room),
  });
  const started = clockMs();
  const at = () => new Date(now.getTime() + (clockMs() - started));
  let translated = 0;
  let failed = 0;
  let gaveUp = 0;
  for (const row of due) {
    if (clockMs() - started > RUN_BUDGET_MS) break;
    // The rule, once more at the door: a row that is not worth a translation is never sent.
    if (!translatable(row.sourceText)) {
      await prisma.textTranslation.update({ where: { sourceHash: row.sourceHash }, data: { gaveUpAt: at(), lastFailure: 'skipped' } });
      gaveUp++;
      continue;
    }
    let answer: TranslatorAnswer;
    try {
      answer = await translateText(cfg, row.sourceText);
    } catch (err) {
      // Anything else than the door's own refusal is a fault of ours, and the job's route reports it.
      if (!(err instanceof TranslatorError)) throw err;
      failed++;
      await tally(day, { failed: 1 });
      if (await retryLater(row, at(), err.failure, err.httpStatus)) gaveUp++;
      if (STOPS.has(err.failure)) break;
      continue;
    }
    await tally(day, { requests: 1, translated: answer.ok ? 1 : 0, failed: answer.ok ? 0 : 1, inputTokens: answer.usage.inputTokens, outputTokens: answer.usage.outputTokens });
    if (answer.ok) {
      await prisma.textTranslation.update({
        where: { sourceHash: row.sourceHash },
        data: { lang: answer.lang, textKa: answer.ka, textRu: answer.ru, textEn: answer.en, model: cfg.model, translatedAt: at(), attempts: row.attempts + 1, lastFailure: null, lastHttpStatus: null },
      });
      translated++;
    } else {
      // Declined, too long, or not the answer asked for: asking again costs again and brings the same.
      await prisma.textTranslation.update({ where: { sourceHash: row.sourceHash }, data: { gaveUpAt: at(), attempts: row.attempts + 1, lastFailure: answer.failure, lastHttpStatus: null } });
      failed++;
      gaveUp++;
    }
  }
  const today = await spentOn(day);
  return { status: 'ok', found, translated, failed, gaveUp, pending: await countPending(), capped: today.requests >= cfg.dailyLimit, today };
}

/** Back off from the moment it failed — or, tried too often, give it up. True when given up. */
async function retryLater(row: { sourceHash: string; attempts: number }, failedAt: Date, failure: string, httpStatus: number | null): Promise<boolean> {
  const attempts = row.attempts + 1;
  const over = attempts >= MAX_ATTEMPTS;
  const next = new Date(failedAt.getTime() + BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1]! * 60_000);
  await prisma.textTranslation.update({
    where: { sourceHash: row.sourceHash },
    data: { attempts, lastFailure: failure, lastHttpStatus: httpStatus, ...(over ? { gaveUpAt: failedAt } : { nextTryAt: next }) },
  });
  return over;
}

// ── What a screen reads ─────────────────────────────────────────────────

/** A screen asks about at most this many texts at once. */
export const MAX_LOOKUP = 100;

/**
 * The ready translation of each text, in the order asked; null where there is
 * none — not listed, not translated yet, given up. Never writes, never asks
 * the translator.
 */
export async function translationsOf(texts: string[]): Promise<(TextTranslation | null)[]> {
  const hashes = texts.map(textHash);
  const rows = await prisma.textTranslation.findMany({
    where: { sourceHash: { in: [...new Set(hashes)] }, translatedAt: { not: null } },
    select: { sourceHash: true, lang: true, textKa: true, textRu: true, textEn: true },
  });
  const byHash = new Map(rows.map((r) => [r.sourceHash, r]));
  return hashes.map((h) => {
    const r = byHash.get(h);
    if (!r || !(TEXT_LANGS as readonly string[]).includes(r.lang ?? '')) return null;
    return { lang: r.lang as TextLang, ka: r.textKa, ru: r.textRu, en: r.textEn };
  });
}
