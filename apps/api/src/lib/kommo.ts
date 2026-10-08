// The Kommo link: read, keep, compare (Mika, 07.10.2026; ADR-0012).
//
// Kommo is the company's CRM: enquiries, conversations, the pipeline. This
// file asks it who is renting — the deals standing in the rental pipeline's
// "rented" stage — keeps the last list it gave, and lays that list beside
// the rentals running here.
//
// Nothing is written to Kommo, and that is a decision, not a step not yet
// taken (Mika, 08.10.2026; ADR-0014): everything but the CRM itself lives in
// EV8 Ops, and what lives here is not copied there. A payment note written
// into the deal was built, checked against Kommo and taken out again the
// same day (ADR-0013).
//
// What Kommo has won comes in (Mika, 08.10.2026; ADR-0015): a deal that
// reaches the rented stage, or is closed as won in the sales pipeline, brings
// its contact — the card is made here from the name and the phone, or the
// deal is tied to the card that already has that phone — and "Today" asks
// for the hand-over or the sale to be entered. The rental and the sale
// themselves are not taken from Kommo: it holds neither the moped, nor the
// dates, nor the money, and what it does not hold is not made up.
//
// The token is a server secret (CLAUDE.md rule 3): Mika issues it and puts
// it on the stand himself (`deploy/set-kommo-token.sh`). It is read from the
// environment and never logged, returned or written anywhere. Kommo's
// answers carry names, so no answer is logged either: a failure is one of
// our own words and a status code. Without the token the whole link is off,
// quietly — the same way the site's mail is off without its password.

import { kommoFreshness, kommoLeadId, phoneAsOnCard, phoneKey, reconcileKommo, unenteredSales, type KommoFreshness, type KommoLead, type KommoMismatches, type KommoRentedThere } from '@ev8/shared';
import { prisma } from './db.js';

export interface KommoConfig {
  baseUrl: string;
  token: string;
  /** The rental pipeline ("Gaqiraveba") and its "rented" stage ("გაქირავებული"). */
  pipelineId: number;
  rentedStatusId: number;
  /** The sales pipeline ("Gayidvebi") and Kommo's own status for a deal closed as won. */
  salesPipelineId: number;
  wonStatusId: number;
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
  // Read in Kommo on 08.10.2026; 142 is Kommo's own "closed as won" in every pipeline.
  salesPipelineId: 11266343,
  wonStatusId: 142,
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
    salesPipelineId: positiveInt(e.KOMMO_SALES_PIPELINE_ID, DEFAULTS.salesPipelineId),
    wonStatusId: positiveInt(e.KOMMO_WON_STATUS_ID, DEFAULTS.wonStatusId),
    staleMs: positiveInt(e.KOMMO_STALE_MINUTES, DEFAULTS.staleMinutes) * 60_000,
  };
}

/** Where a deal opens in Kommo. */
export const kommoLeadUrl = (baseUrl: string, leadId: string): string => `${baseUrl}/leads/detail/${leadId}`;

/**
 * A Kommo field as it is kept: a bare deal number becomes the deal's address,
 * so the field opens in Kommo. A hand-over started from a deal in "Today"
 * carries only the number.
 */
export function kommoRefToKeep(raw: string | null): string | null {
  const cfg = kommoConfig();
  return raw && cfg && /^\d+$/.test(raw.trim()) ? kommoLeadUrl(cfg.baseUrl, raw.trim()) : raw;
}

/** A deal as the poll reads it: who it is with, and when it was won. */
export interface KommoDeal extends KommoLead {
  contactPhone: string | null;
  closedAt: Date | null;
}

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
   * here, and a refusal becomes one of our words here. It only reads — the
   * method is `GET` and nothing else on purpose (ADR-0014).
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

  /** One stage of one pipeline, page by page: each deal with its main contact's id. */
  private async stage(pipelineId: number, statusId: number, more: [string, string][] = []): Promise<{ id: string; name: string; contactId: string | null; closedAt: Date | null }[]> {
    const found: { id: string; name: string; contactId: string | null; closedAt: Date | null }[] = [];
    for (let page = 1; ; page++) {
      if (page > MAX_PAGES) throw new KommoError('bad_answer');
      const body = await this.request('GET', '/api/v4/leads', [
        ['with', 'contacts'],
        ['filter[statuses][0][pipeline_id]', String(pipelineId)],
        ['filter[statuses][0][status_id]', String(statusId)],
        ...more,
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
        // account would then read as standing in this stage.
        if (lead.status_id !== statusId || lead.pipeline_id !== pipelineId) continue;
        const contacts = list(obj(lead._embedded).contacts).map(obj);
        const main = contacts.find((c) => c.is_main === true) ?? contacts[0];
        const closed = typeof lead.closed_at === 'number' && lead.closed_at > 0 ? new Date(lead.closed_at * 1000) : null;
        found.push({ id, name: typeof lead.name === 'string' ? lead.name.trim() : '', contactId: main ? idOf(main.id) : null, closedAt: closed });
      }
      if (!obj(obj(body)._links).next || rows.length === 0) break;
    }
    return found;
  }

  /**
   * Those deals with the name and the phone of each one's main contact.
   * `contactsRead` is false when the deals came and the contacts did not:
   * who it is about is still known then, only less readably.
   */
  private async withContacts(found: { id: string; name: string; contactId: string | null; closedAt: Date | null }[]): Promise<{ leads: KommoDeal[]; contactsRead: boolean }> {
    const people = new Map<string, { name: string | null; phone: string | null }>();
    let contactsRead = true;
    const ids = [...new Set(found.map((l) => l.contactId).filter((x): x is string => x != null))];
    try {
      for (let i = 0; i < ids.length; i += CONTACT_CHUNK) {
        const chunk = ids.slice(i, i + CONTACT_CHUNK);
        const body = await this.request('GET', '/api/v4/contacts', [...chunk.map((id, n): [string, string] => [`filter[id][${n}]`, id]), ['limit', String(PAGE)]]);
        for (const row of list(obj(obj(body)._embedded).contacts)) {
          const c = obj(row);
          const id = idOf(c.id);
          if (!id) continue;
          // The first phone on the contact: Kommo keeps them in one field of several values.
          const phones = list(c.custom_fields_values).map(obj).filter((f) => f.field_code === 'PHONE').flatMap((f) => list(f.values).map((v) => obj(v).value));
          const phone = phones.find((v): v is string => typeof v === 'string' && v.trim() !== '') ?? null;
          people.set(id, { name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : null, phone: phone ? phone.trim() : null });
        }
      }
    } catch (err) {
      if (!(err instanceof KommoError)) throw err;
      contactsRead = false;
    }
    return {
      leads: found.map((l) => {
        const person = l.contactId ? people.get(l.contactId) : undefined;
        return { id: l.id, name: l.name, contactName: person?.name ?? null, contactPhone: person?.phone ?? null, closedAt: l.closedAt };
      }),
      contactsRead,
    };
  }

  /** The deals in the "rented" stage of the rental pipeline. */
  async rentedLeads(): Promise<{ leads: KommoDeal[]; contactsRead: boolean }> {
    return this.withContacts(await this.stage(this.cfg.pipelineId, this.cfg.rentedStatusId));
  }

  /**
   * The deals of the sales pipeline closed as won on or after `since`. The
   * date is asked of Kommo and checked again here, for the same reason the
   * stage is: a filter it did not understand is ignored, and every sale of
   * the past years would come in as today's.
   */
  async wonSales(since: Date): Promise<{ leads: KommoDeal[]; contactsRead: boolean }> {
    const found = await this.stage(this.cfg.salesPipelineId, this.cfg.wonStatusId, [['filter[closed_at][from]', String(Math.floor(since.getTime() / 1000))]]);
    return this.withContacts(found.filter((l) => l.closedAt != null && l.closedAt.getTime() >= since.getTime()));
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
  // The moment this stand began taking deals in: a sale won before it is not a task.
  const intakeFrom = (await prisma.kommoSync.findUnique({ where: { id: true }, select: { intakeFrom: true } }))?.intakeFrom ?? now;
  let rented: Awaited<ReturnType<KommoClient['rentedLeads']>>;
  let won: Awaited<ReturnType<KommoClient['wonSales']>>;
  try {
    rented = await client.rentedLeads();
    won = await client.wonSales(intakeFrom);
  } catch (err) {
    if (!(err instanceof KommoError)) throw err;
    const failed = { lastTryAt: now, lastFailure: err.failure, lastHttpStatus: err.httpStatus };
    await prisma.kommoSync.upsert({ where: { id: true }, update: failed, create: { id: true, ...failed } });
    return { status: 'failed', failure: err.failure, httpStatus: err.httpStatus };
  }

  const seen = [
    ...rented.leads.map((l) => ({ ...l, kind: 'rent' as const, statusId: BigInt(cfg.rentedStatusId), contacts: rented.contactsRead })),
    ...won.leads.map((l) => ({ ...l, kind: 'sale' as const, statusId: BigInt(cfg.wonStatusId), contacts: won.contactsRead })),
  ];
  const ok = { lastOkAt: now, lastTryAt: now, lastFailure: null, lastHttpStatus: null, leads: rented.leads.length, intakeFrom };
  await prisma.$transaction(async (tx) => {
    for (const l of seen) {
      await tx.kommoLead.upsert({
        where: { leadId: l.id },
        // A name and a phone that did not come this time are not wiped by it.
        update: { name: l.name, statusId: l.statusId, kind: l.kind, closedAt: l.closedAt, seenAt: now, ...(l.contacts ? { contactName: l.contactName, contactPhone: l.contactPhone } : {}) },
        create: { leadId: l.id, name: l.name, contactName: l.contactName, contactPhone: l.contactPhone, statusId: l.statusId, kind: l.kind, closedAt: l.closedAt, firstSeenAt: now, seenAt: now },
      });
    }
    // A deal that has left its stage leaves the list.
    await tx.kommoLead.deleteMany({ where: { leadId: { notIn: seen.map((l) => l.id) } } });
    await tx.kommoSync.upsert({ where: { id: true }, update: ok, create: { id: true, ...ok } });
  });
  // Cards only from contacts that were read: a deal whose contact did not
  // come this time waits for the next poll rather than becoming a nameless card.
  await takeIn(cfg, new Set(seen.filter((l) => l.contacts).map((l) => l.id)));
  return { status: 'ok', leads: rented.leads.length, contactsRead: rented.contactsRead && won.contactsRead };
}

// ── What comes in ───────────────────────────────────────────────────────

const NOT_GONE = { archived: false, mergedIntoId: null } as const;

/**
 * Each deal of the list gets its card (ADR-0015): the one whose Kommo field
 * names the deal; failing that, the one card with the contact's phone, which
 * takes the deal's link if it has none; failing that, a new card made from
 * the contact. Two cards with that phone is a question for a person, and the
 * deal waits without a card. A deal with neither a name nor a phone of a
 * contact makes no card: there would be nothing true to write on it.
 */
async function takeIn(cfg: KommoConfig, readNow: Set<string>): Promise<void> {
  const waiting = (await prisma.kommoLead.findMany({ where: { OR: [{ customerId: null }, { customer: { OR: [{ archived: true }, { mergedIntoId: { not: null } }] } }] }, orderBy: { firstSeenAt: 'asc' } })).filter((l) =>
    readNow.has(l.leadId),
  );
  if (waiting.length === 0) return;

  const cards = await prisma.customer.findMany({ where: NOT_GONE, select: { id: true, phone: true, kommoRef: true, recordKind: true }, orderBy: { createdAt: 'asc' } });
  const byLead = new Map<string, string>();
  const byPhone = new Map<string, string[]>();
  const refOf = new Map<string, string | null>();
  for (const c of cards) {
    refOf.set(c.id, c.kommoRef);
    const lead = kommoLeadId(c.kommoRef);
    if (lead && !byLead.has(lead)) byLead.set(lead, c.id);
    const key = phoneKey(c.phone);
    // A supplier's switchboard is not a renter's phone.
    if (key && c.recordKind !== 'supplier') byPhone.set(key, [...(byPhone.get(key) ?? []), c.id]);
  }

  for (const l of waiting) {
    const url = kommoLeadUrl(cfg.baseUrl, l.leadId);
    const key = phoneKey(l.contactPhone);
    const samePhone = key ? (byPhone.get(key) ?? []) : [];
    let customerId = byLead.get(l.leadId) ?? null;

    if (!customerId && samePhone.length === 1) {
      customerId = samePhone[0]!;
      if (!refOf.get(customerId)?.trim()) {
        await prisma.$transaction(async (tx) => {
          await tx.customer.update({ where: { id: customerId! }, data: { kommoRef: url, updatedAt: new Date() } });
          await tx.auditLog.create({ data: { actorId: null, action: 'customer.update', entityType: 'customer', entityId: customerId!, before: { kommoRef: null }, after: { kommoRef: url }, note: `Kommo deal ${l.leadId}: the same phone` } });
        });
        refOf.set(customerId, url);
        byLead.set(l.leadId, customerId);
      }
    } else if (!customerId && samePhone.length === 0 && (l.contactName || key)) {
      const name = l.contactName ?? l.name;
      const phone = l.contactPhone ? phoneAsOnCard(l.contactPhone) : null;
      customerId = await prisma.$transaction(async (tx) => {
        const made = await tx.customer.create({ data: { name, phone, kind: 'person', recordKind: 'client', kommoRef: url } });
        await tx.auditLog.create({ data: { actorId: null, action: 'customer.create', entityType: 'customer', entityId: made.id, after: { name, fromKommoDeal: l.leadId }, note: `from Kommo deal ${l.leadId}` } });
        return made.id;
      });
      refOf.set(customerId, url);
      byLead.set(l.leadId, customerId);
      if (key) byPhone.set(key, [customerId]);
    }

    if (customerId && customerId !== l.customerId) await prisma.kommoLead.update({ where: { leadId: l.leadId }, data: { customerId } });
  }
}

// ── The comparison ──────────────────────────────────────────────────────

export interface KommoReconciliation extends KommoMismatches {
  baseUrl: string;
  freshness: KommoFreshness;
  lastOkAt: Date | null;
  /** Deals in the list the comparison was made from. */
  leads: number;
  /** Closed as won in Kommo's sales pipeline since this stand began taking deals in, with no sale here. */
  wonThere: KommoRentedThere[];
  /** Both halves as tasks: what to enter, for whom, from which card. */
  deals: { leadId: string; kind: 'rent' | 'sale'; who: string; customerId: string | null; phone: string | null }[];
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
  if (!lastOkAt) return { baseUrl: cfg.baseUrl, freshness, lastOkAt, leads: 0, rentedThere: [], rentedHere: [], matched: 0, wonThere: [], deals: [] };

  const leadRows = await prisma.kommoLead.findMany({ select: { leadId: true, name: true, contactName: true, contactPhone: true, kind: true, customerId: true } });
  const tied = leadRows.map((l) => l.customerId).filter((x): x is string => x != null);
  const [rentalRows, saleRows, customerRows] = await Promise.all([
    prisma.rental.findMany({
      // Out with a customer: picked up and not returned. A booking is not a
      // rental yet — Kommo has a stage of its own for those.
      where: { status: { in: ['active', 'overdue', 'paused', 'disputed'] }, pickedUpOn: { not: null } },
      select: { id: true, number: true, kommoRef: true, vehicle: { select: { vin: true } }, customer: { select: { id: true, name: true, kommoRef: true } } },
    }),
    prisma.sale.findMany({ where: { status: { not: 'cancelled' } }, select: { kommoRef: true, customer: { select: { kommoRef: true } } } }),
    // The cards a deal can belong to: those naming a deal, and those a deal was tied to by its phone.
    prisma.customer.findMany({ where: { ...NOT_GONE, OR: [{ kommoRef: { not: null } }, { id: { in: tied } }] }, select: { id: true, name: true, kommoRef: true }, orderBy: { createdAt: 'asc' } }),
  ]);

  const asLead = (l: (typeof leadRows)[number]): KommoLead => ({ id: l.leadId, name: l.name, contactName: l.contactName, customerId: l.customerId });
  const rentLeads = leadRows.filter((l) => l.kind === 'rent');
  const result = reconcileKommo(
    rentLeads.map(asLead),
    rentalRows.map((r) => ({ id: r.id, number: r.number, kommoRef: r.kommoRef, vin: r.vehicle?.vin ?? null, customer: r.customer })),
    customerRows,
  );
  const wonThere = unenteredSales(leadRows.filter((l) => l.kind === 'sale').map(asLead), saleRows, customerRows);
  const phoneOf = new Map(leadRows.map((l) => [l.leadId, l.contactPhone]));
  const task = (kind: 'rent' | 'sale') => (x: KommoRentedThere) => ({ leadId: x.leadId, kind, who: x.customer?.name ?? x.contactName ?? x.leadName, customerId: x.customer?.id ?? null, phone: phoneOf.get(x.leadId) ?? null });
  const deals = [...result.rentedThere.map(task('rent')), ...wonThere.map(task('sale'))];
  return { baseUrl: cfg.baseUrl, freshness, lastOkAt, leads: rentLeads.length, ...result, wonThere, deals };
}
