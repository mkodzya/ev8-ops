// The Kommo link, step 1: read, keep, compare (Mika, 07.10.2026; ADR-0012).
//
// Kommo is where the front office writes the day down. This file asks it who
// is renting — the deals standing in the rental pipeline's "rented" stage —
// keeps the last list it gave, and lays that list beside the rentals running
// here. Nothing is written to Kommo in this step.
//
// The token is a server secret (CLAUDE.md rule 3): Mika issues it and puts
// it on the stand himself (`deploy/set-kommo-token.sh`). It is read from the
// environment and never logged, returned or written anywhere. Kommo's
// answers carry names, so no answer is logged either: a failure is one of
// our own words and a status code. Without the token the whole link is off,
// quietly — the same way the site's mail is off without its password.

import { kommoFreshness, reconcileKommo, type KommoFreshness, type KommoLead, type KommoMismatches } from '@ev8/shared';
import { prisma } from './db.js';

export interface KommoConfig {
  baseUrl: string;
  token: string;
  /** The rental pipeline ("Gaqiraveba") and its "rented" stage ("გაქირავებული"). */
  pipelineId: number;
  rentedStatusId: number;
  /** Kommo has gone silent when it has not answered for this long. */
  staleMs: number;
}

// The account's own numbers, read in Kommo on 07.10.2026. They are defaults:
// a stage that is re-made in Kommo gets a new id, and that is one line in the
// stand's env file rather than a release.
const DEFAULTS = {
  baseUrl: 'https://ev8mopeds.kommo.com',
  pipelineId: 13427775,
  rentedStatusId: 103582579,
  staleMinutes: 20,
} as const;

const positiveInt = (raw: string | undefined, fallback: number): number => {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

/** Null without a token, or with an address the token must not be sent to: the link is then off. */
export function kommoConfig(e: NodeJS.ProcessEnv = process.env): KommoConfig | null {
  const token = (e.KOMMO_TOKEN ?? '').trim();
  if (!token) return null;
  const baseUrl = ((e.KOMMO_BASE_URL ?? '').trim() || DEFAULTS.baseUrl).replace(/\/+$/, '');
  // The token travels in a header: never over plain http.
  if (!/^https:\/\/[^/\s]+$/i.test(baseUrl)) return null;
  return {
    baseUrl,
    token,
    pipelineId: positiveInt(e.KOMMO_RENTAL_PIPELINE_ID, DEFAULTS.pipelineId),
    rentedStatusId: positiveInt(e.KOMMO_RENTED_STATUS_ID, DEFAULTS.rentedStatusId),
    staleMs: positiveInt(e.KOMMO_STALE_MINUTES, DEFAULTS.staleMinutes) * 60_000,
  };
}

/** Where a deal opens in Kommo. */
export const kommoLeadUrl = (baseUrl: string, leadId: string): string => `${baseUrl}/leads/detail/${leadId}`;

// ── The client ──────────────────────────────────────────────────────────

/** Why Kommo gave nothing: our word for it, never its answer. */
export type KommoFailure = 'unauthorized' | 'rate_limited' | 'http' | 'network' | 'bad_answer';

export class KommoError extends Error {
  constructor(
    readonly failure: KommoFailure,
    readonly httpStatus: number | null = null,
  ) {
    super(`kommo: ${failure}${httpStatus ? ` (${httpStatus})` : ''}`);
  }
}

/** The part of `fetch` this needs, so a test can stand in for Kommo. */
export type KommoFetch = (url: string, init: { method: string; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; json: () => Promise<unknown> }>;

// Kommo allows 7 requests a second for the account as a whole. One request
// at a time with this gap between starts stays under it with room to spare.
const MIN_GAP_MS = 160;
const PAGE = 250; // the most Kommo gives on one page
const MAX_PAGES = 40;
const TIMEOUT_MS = 15_000;
const CONTACT_CHUNK = 50;

export interface KommoClientOptions {
  fetch?: KommoFetch;
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const idOf = (v: unknown): string | null => (typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'string' && /^\d+$/.test(v) ? v : null);

export class KommoClient {
  private readonly fetchFn: KommoFetch;
  private readonly gapMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastStart = 0;

  constructor(
    private readonly cfg: KommoConfig,
    opts: KommoClientOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? (fetch as unknown as KommoFetch);
    this.gapMs = opts.gapMs ?? MIN_GAP_MS;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? Date.now;
  }

  /**
   * The one door to Kommo: the token goes on here, the rate limit is kept
   * here, and a refusal becomes one of our words here. Reading is all step 1
   * does; writing a payment note or moving a deal to another stage are later
   * steps, and they go through this same door with their own method.
   * Null is Kommo's 204 — "nothing matches", which it says with no body.
   */
  private request(method: 'GET', path: string, query: [string, string][] = []): Promise<unknown | null> {
    const run = async (): Promise<unknown | null> => {
      const wait = this.lastStart + this.gapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.now();

      const url = `${this.cfg.baseUrl}${path}${query.length ? `?${query.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')}` : ''}`;
      let res: Awaited<ReturnType<KommoFetch>>;
      try {
        res = await this.fetchFn(url, {
          method,
          headers: { authorization: `Bearer ${this.cfg.token}`, accept: 'application/json' },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        // The cause is dropped on purpose: a fetch error can quote the request.
        throw new KommoError('network');
      }
      if (res.status === 204) return null;
      if (res.status === 401 || res.status === 403) throw new KommoError('unauthorized', res.status);
      if (res.status === 429) throw new KommoError('rate_limited', res.status);
      if (res.status < 200 || res.status >= 300) throw new KommoError('http', res.status);
      try {
        return await res.json();
      } catch {
        throw new KommoError('bad_answer', res.status);
      }
    };
    // One at a time, whoever asks: a failed request must not stall the next.
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /**
   * The deals in the "rented" stage, with the name of each one's main
   * contact. `contactsRead` is false when the deals came and the names did
   * not: who rents is still known then, only less readably.
   */
  async rentedLeads(): Promise<{ leads: KommoLead[]; contactsRead: boolean }> {
    const found: { id: string; name: string; contactId: string | null }[] = [];
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new KommoError('bad_answer');
      const body = await this.request('GET', '/api/v4/leads', [
        ['with', 'contacts'],
        ['filter[statuses][0][pipeline_id]', String(this.cfg.pipelineId)],
        ['filter[statuses][0][status_id]', String(this.cfg.rentedStatusId)],
        ['limit', String(PAGE)],
        ['page', String(page)],
      ]);
      if (body === null) break; // 204: no deals at all, or no further page
      const rows = obj(obj(body)._embedded).leads;
      if (!Array.isArray(rows)) throw new KommoError('bad_answer');
      for (const row of rows) {
        const lead = obj(row);
        const id = idOf(lead.id);
        if (!id) throw new KommoError('bad_answer');
        // Kept even though the request already filters: a filter Kommo did
        // not understand is ignored, not refused, and every deal of the
        // account would then read as "rented".
        if (lead.status_id !== this.cfg.rentedStatusId || lead.pipeline_id !== this.cfg.pipelineId) continue;
        const contacts = list(obj(lead._embedded).contacts).map(obj);
        const main = contacts.find((c) => c.is_main === true) ?? contacts[0];
        found.push({ id, name: typeof lead.name === 'string' ? lead.name.trim() : '', contactId: main ? idOf(main.id) : null });
      }
      if (!obj(obj(body)._links).next || rows.length === 0) break;
    }

    const names = new Map<string, string>();
    let contactsRead = true;
    const ids = [...new Set(found.map((l) => l.contactId).filter((x): x is string => x != null))];
    try {
      for (let i = 0; i < ids.length; i += CONTACT_CHUNK) {
        const chunk = ids.slice(i, i + CONTACT_CHUNK);
        const body = await this.request('GET', '/api/v4/contacts', [...chunk.map((id, n): [string, string] => [`filter[id][${n}]`, id]), ['limit', String(PAGE)]]);
        for (const row of list(obj(obj(body)._embedded).contacts)) {
          const c = obj(row);
          const id = idOf(c.id);
          if (id && typeof c.name === 'string' && c.name.trim()) names.set(id, c.name.trim());
        }
      }
    } catch (err) {
      if (!(err instanceof KommoError)) throw err;
      contactsRead = false;
    }

    return {
      leads: found.map((l) => ({ id: l.id, name: l.name, contactName: l.contactId ? (names.get(l.contactId) ?? null) : null })),
      contactsRead,
    };
  }
}

// ── The poll ────────────────────────────────────────────────────────────

let fetchForTests: KommoFetch | null = null;
let clientOptsForTests: KommoClientOptions = {};

/** Tests stand in for Kommo: no request leaves the machine. */
export function setKommoFetchForTests(fn: KommoFetch | null, opts: KommoClientOptions = {}): void {
  fetchForTests = fn;
  clientOptsForTests = opts;
}

export type KommoSyncOutcome =
  | { status: 'off' }
  | { status: 'busy' }
  | { status: 'ok'; leads: number; contactsRead: boolean }
  | { status: 'failed'; failure: KommoFailure; httpStatus: number | null };

let running: Promise<KommoSyncOutcome> | null = null;

/**
 * Ask Kommo once and keep what it said. A poll that fails leaves the last
 * list where it was and writes down only that it failed and why. Never
 * throws for Kommo's sake: the worker that calls this has nothing to do with
 * an exception except log it.
 */
export function syncKommo(now: Date = new Date()): Promise<KommoSyncOutcome> {
  const cfg = kommoConfig();
  if (!cfg) return Promise.resolve({ status: 'off' });
  if (running) return Promise.resolve({ status: 'busy' });
  running = pollOnce(cfg, now).finally(() => {
    running = null;
  });
  return running;
}

async function pollOnce(cfg: KommoConfig, now: Date): Promise<KommoSyncOutcome> {
  const client = new KommoClient(cfg, { ...clientOptsForTests, ...(fetchForTests ? { fetch: fetchForTests } : {}) });
  let seen: Awaited<ReturnType<KommoClient['rentedLeads']>>;
  try {
    seen = await client.rentedLeads();
  } catch (err) {
    if (!(err instanceof KommoError)) throw err;
    const failed = { lastTryAt: now, lastFailure: err.failure, lastHttpStatus: err.httpStatus };
    await prisma.kommoSync.upsert({ where: { id: true }, update: failed, create: { id: true, ...failed } });
    return { status: 'failed', failure: err.failure, httpStatus: err.httpStatus };
  }

  const statusId = BigInt(cfg.rentedStatusId);
  const ok = { lastOkAt: now, lastTryAt: now, lastFailure: null, lastHttpStatus: null, leads: seen.leads.length };
  await prisma.$transaction(async (tx) => {
    for (const l of seen.leads) {
      await tx.kommoLead.upsert({
        where: { leadId: l.id },
        // Names that did not come this time are not wiped by it.
        update: { name: l.name, statusId, seenAt: now, ...(seen.contactsRead ? { contactName: l.contactName } : {}) },
        create: { leadId: l.id, name: l.name, contactName: l.contactName, statusId, firstSeenAt: now, seenAt: now },
      });
    }
    // A deal that has left the stage leaves the list.
    await tx.kommoLead.deleteMany({ where: { leadId: { notIn: seen.leads.map((l) => l.id) } } });
    await tx.kommoSync.upsert({ where: { id: true }, update: ok, create: { id: true, ...ok } });
  });
  return { status: 'ok', leads: seen.leads.length, contactsRead: seen.contactsRead };
}

// ── The comparison ──────────────────────────────────────────────────────

export interface KommoReconciliation extends KommoMismatches {
  baseUrl: string;
  freshness: KommoFreshness;
  lastOkAt: Date | null;
  /** Deals in the list the comparison was made from. */
  leads: number;
}

/**
 * Kommo's last list beside the rentals running here. Null when the link is
 * off. Before Kommo has answered even once there is no list, and nothing is
 * compared: every rental here would read as "not rented in Kommo" on the
 * strength of a question that was never answered.
 */
export async function kommoReconciliation(now: Date = new Date()): Promise<KommoReconciliation | null> {
  const cfg = kommoConfig();
  if (!cfg) return null;
  const sync = await prisma.kommoSync.findUnique({ where: { id: true } });
  const lastOkAt = sync?.lastOkAt ?? null;
  const freshness = kommoFreshness(lastOkAt, sync?.lastTryAt ?? null, now, cfg.staleMs);
  if (!lastOkAt) return { baseUrl: cfg.baseUrl, freshness, lastOkAt, leads: 0, rentedThere: [], rentedHere: [], matched: 0 };

  const [leadRows, rentalRows, customerRows] = await Promise.all([
    prisma.kommoLead.findMany({ select: { leadId: true, name: true, contactName: true } }),
    prisma.rental.findMany({
      // Out with a customer: picked up and not returned. A booking is not a
      // rental yet — Kommo has a stage of its own for those.
      where: { status: { in: ['active', 'overdue', 'paused', 'disputed'] }, pickedUpOn: { not: null } },
      select: { id: true, number: true, kommoRef: true, vehicle: { select: { vin: true } }, customer: { select: { id: true, name: true, kommoRef: true } } },
    }),
    prisma.customer.findMany({ where: { kommoRef: { not: null }, archived: false, mergedIntoId: null }, select: { id: true, name: true, kommoRef: true }, orderBy: { createdAt: 'asc' } }),
  ]);

  const result = reconcileKommo(
    leadRows.map((l) => ({ id: l.leadId, name: l.name, contactName: l.contactName })),
    rentalRows.map((r) => ({ id: r.id, number: r.number, kommoRef: r.kommoRef, vin: r.vehicle?.vin ?? null, customer: r.customer })),
    customerRows,
  );
  return { baseUrl: cfg.baseUrl, freshness, lastOkAt, leads: leadRows.length, ...result };
}
