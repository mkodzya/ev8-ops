// The notices to the workshop's Telegram group (stage 6; ADR-0038 §6–7).
//
// A notice is written into `notices` in the same transaction as the event it
// tells of — a repair waiting, approved, refused, closed — so it exists only
// if the event was committed, and once: its key is unique. Right after the
// commit the sender is kicked; the worker knocks every minute for what did not
// go. A moped due for maintenance and a part below its minimum are not events
// anybody writes: they are worked out at every read, so a scan finds them,
// once per mark and once per restock.
//
// Nothing about the event is copied into the row. The text is written when
// it is sent, from the record as it is then: a repair no longer waiting is
// not announced as waiting. It names the repair's number, the moped's and the
// mechanic, in Georgian and under it in Russian, with a link to the record on
// this stand — never money, never a customer (ADR-0038 §6).
//
// The sender never throws for Telegram's sake, and what it answers is counts:
// the token is in the address Telegram is asked at, and no outcome, error or
// log line here carries it.

import { fleetNumber, maintenanceDue } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from './db.js';
import { downtimeOf } from './downtime.js';
import { maintenanceOf } from './maintenance.js';
import { twoLanguages as message, type JobPeople, type JobRef, type NoticeLang, type NoticeWords, type Waiting } from './noticeWords.js';
import { partRows } from './stock.js';
import { TelegramError, telegramClient, telegramConfig, type TelegramConfig, type TelegramFailure } from './telegram.js';

type Tx = Prisma.TransactionClient;

export const NOTICE_KINDS = ['job_waiting', 'job_approved', 'job_rejected', 'job_closed', 'maintenance_due', 'stock_low'] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

/**
 * The keys that make a notice one of its kind. A repair may wait, be approved
 * or refused more than once — each time is the journal row that wrote it; it
 * closes once. A moped is told once per maintenance mark, a part once per
 * restock.
 */
export const noticeKey = {
  waiting: (jobId: string, auditId: string) => `job_waiting:${jobId}:${auditId}`,
  approved: (jobId: string, auditId: string) => `job_approved:${jobId}:${auditId}`,
  rejected: (jobId: string, auditId: string) => `job_rejected:${jobId}:${auditId}`,
  closed: (jobId: string) => `job_closed:${jobId}`,
  maintenance: (vehicleId: string, dueKm: number) => `maintenance_due:${vehicleId}:${dueKm}`,
  stock: (partId: string, restockMoveId: string | null) => `stock_low:${partId}:${restockMoveId ?? 'none'}`,
};

/** The third part of a key: the journal row of a repair's event, the mark of a maintenance. */
const keyPart = (key: string): string => key.split(':')[2] ?? '';

/**
 * Write a notice inside the caller's transaction: it goes with the event or
 * not at all, and the same key twice is one notice. True when it is new.
 */
export async function enqueueNotice(tx: Tx, n: { kind: NoticeKind; entityId: string; dedupeKey: string }): Promise<boolean> {
  const made = await tx.notice.createMany({ data: [{ kind: n.kind, entityId: n.entityId, dedupeKey: n.dedupeKey }], skipDuplicates: true });
  return made.count > 0;
}

/** A repair's event, keyed by the journal row the same transaction wrote. */
export function enqueueJobNotice(tx: Tx, kind: 'job_waiting' | 'job_approved' | 'job_rejected', jobId: string, auditId: string): Promise<boolean> {
  const key = kind === 'job_waiting' ? noticeKey.waiting : kind === 'job_approved' ? noticeKey.approved : noticeKey.rejected;
  return enqueueNotice(tx, { kind, entityId: jobId, dedupeKey: key(jobId, auditId) });
}

// ── The text ────────────────────────────────────────────────────────────

/** Telegram's HTML takes these three as entities; nothing else needs it. */
export const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 12 300 — thousands apart by a space that does not break. */
const km = (n: number): string => String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');

/** How long a repair stood: minutes, hours and minutes, or whole hours past a day. */
function span(min: number, w: NoticeWords): string {
  if (min < 60) return `${min} ${w.minutes}`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h >= 24 || m === 0 ? `${h} ${w.hours}` : `${h} ${w.hours} ${m} ${w.minutes}`;
}

/** A moped by its number; one not numbered yet by the tail of its VIN. */
const mopedOf = (v: { fleetNo: number | null; vin: string }): string => fleetNumber(v.fleetNo) ?? `···${v.vin.slice(-6)}`;

type NoticeRow = { kind: string; entityId: string; dedupeKey: string };

/**
 * The notice as it is sent now, or null when it no longer has anything to
 * say: the repair stopped waiting, the moped had its maintenance or passed to
 * another mark, the part was restocked, the record is gone.
 */
export async function composeNotice(n: NoticeRow, opts: { now?: Date; env?: NodeJS.ProcessEnv } = {}): Promise<string | null> {
  const now = opts.now ?? new Date();
  const e = opts.env ?? process.env;
  switch (n.kind) {
    case 'job_waiting':
    case 'job_approved':
    case 'job_rejected':
    case 'job_closed':
      return composeJob(n, now, e);
    case 'maintenance_due':
      return composeMaintenance(n, e);
    case 'stock_low':
      return composeStock(n, e);
    default:
      return null;
  }
}

async function composeJob(n: NoticeRow, now: Date, e: NodeJS.ProcessEnv): Promise<string | null> {
  const job = await prisma.serviceJob.findUnique({
    where: { id: n.entityId },
    select: {
      id: true,
      number: true,
      status: true,
      reasonKind: true,
      openedOn: true,
      closedOn: true,
      openedAt: true,
      approvedAt: true,
      rejectedAt: true,
      closedAt: true,
      vehicle: { select: { fleetNo: true, vin: true } },
      mechanic: { select: { name: true } },
    },
  });
  if (!job) return null;
  const ref: JobRef = { number: escapeHtml(job.number), moped: escapeHtml(mopedOf(job.vehicle)) };
  const mechanic = job.mechanic ? escapeHtml(job.mechanic.name) : null;
  const path = `/service/${job.id}`;
  if (n.kind === 'job_closed') {
    if (job.status !== 'done') return null;
    const dt = downtimeOf(job, now);
    return message((w) => w.closed(ref, { mechanic }, dt ? span(dt.minutes, w) : null), path, e);
  }
  // The journal row the event wrote: who did it, and what it was.
  const logged = await prisma.auditLog.findUnique({ where: { id: keyPart(n.dedupeKey) }, select: { action: true, after: true, actor: { select: { name: true } } } }).catch(() => null);
  const after = (logged?.after ?? {}) as { again?: boolean; status?: string };
  const actor = logged?.actor ? escapeHtml(logged.actor.name) : null;
  if (n.kind === 'job_waiting') {
    // Told only while it still waits: approved or refused since, it has nothing to ask.
    if (job.status !== 'draft') return null;
    // Waiting again since — approved, then a work added — the later wait is the
    // one to tell; this one would repeat it in its words (ADR-0038 §7).
    if (await supersededWait(n)) return null;
    const what: Waiting = logged?.action === 'service.part.add' ? 'part' : job.approvedAt != null ? 'work' : 'repair';
    const people: JobPeople = { mechanic, reporter: mechanic ? null : actor };
    return message((w) => w.waiting(ref, what, people, job.reasonKind ? (w.reasons[job.reasonKind] ?? null) : null), path, e);
  }
  if (n.kind === 'job_approved') return message((w) => w.approved(ref, after.again === true, { mechanic, by: actor }), path, e);
  return message((w) => w.rejected(ref, after.status === 'cancelled', { mechanic, by: actor }), path, e);
}

/** A later wait, approval or refusal of the same repair was written after this wait. */
async function supersededWait(n: NoticeRow): Promise<boolean> {
  const self = await prisma.notice.findUnique({ where: { dedupeKey: n.dedupeKey }, select: { createdAt: true } });
  if (!self) return false;
  const later = await prisma.notice.count({
    where: { entityId: n.entityId, kind: { in: ['job_waiting', 'job_approved', 'job_rejected'] }, createdAt: { gt: self.createdAt } },
  });
  return later > 0;
}

async function composeMaintenance(n: NoticeRow, e: NodeJS.ProcessEnv): Promise<string | null> {
  const [m] = await maintenanceOf(prisma, { vehicleIds: [n.entityId] });
  // Had its maintenance, has one under way, or reached another mark since: this one is over.
  if (!m || !maintenanceDue(m.state) || m.openPlanned != null || String(m.dueKm) !== keyPart(n.dedupeKey)) return null;
  const moped = escapeHtml(m.number ?? `···${m.vin.slice(-6)}`);
  const [due, current, left] = [km(m.dueKm!), km(m.currentKm!), km(m.leftKm!)];
  // The sticker's address: the owners land on the moped's card, the chief mechanic — who
  // does not see the fleet — in a new planned repair of it (MopedByNumber). A moped with no
  // number of its own is only the owners' card.
  const path = m.number ? `/m/${encodeURIComponent(m.number)}?reason=planned` : `/fleet/${m.vehicleId}`;
  return message((w) => (m.state === 'overdue' ? w.maintenanceOverdue(moped, due, current, left) : w.maintenanceSoon(moped, due, current, left)), path, e);
}

async function composeStock(n: NoticeRow, e: NodeJS.ProcessEnv): Promise<string | null> {
  const [p] = await partRows({ ids: [n.entityId] });
  if (!p || p.shortBy <= 0) return null;
  // Restocked since and short again: the notice of that restock tells it, not this one.
  if (noticeKey.stock(p.id, (await lastRestocks([p.id])).get(p.id) ?? null) !== n.dedupeKey) return null;
  const [onHand, min] = [String(p.onHand), String(p.minQty)];
  // The Georgian line names the part in Georgian where the catalogue has it.
  const name: Record<NoticeLang, string> = { ka: escapeHtml(p.nameKa?.trim() || p.name), ru: escapeHtml(p.name) };
  return message((w, lang) => w.stockLow(name[lang], onHand, min), `/stock/parts/${p.id}`, e);
}

// ── The sender ──────────────────────────────────────────────────────────

/**
 * What a run of the sender did, in counts. `off` — no token or group on this
 * stand: nothing is sent and the notices wait; `busy` — another run is
 * sending, and this one did nothing.
 */
export interface NoticeOutcome {
  status: 'off' | 'busy' | 'ok';
  sent: number;
  failed: number;
  /** Still to go after the run. */
  pending: number;
}

/** Ten a run, one every three seconds (lib/telegram.ts): the group hears at most that many a minute. */
const BATCH = 10;
/** A notice a day old has missed its moment: given up, not sent late. */
const GIVE_UP_MS = 24 * 60 * 60_000;
/** Minutes to wait after the first, second, third and every later failure. */
const BACKOFF_MIN = [1, 5, 15, 60];
/** Telegram will not take this one, whatever is tried: given up at once. */
const FINAL = new Set<TelegramFailure>(['chat_not_found', 'chat_moved', 'forbidden', 'bad_request', 'bad_answer']);
/** The rest of the run would fail the same way: it stops. */
const STOPS = new Set<TelegramFailure>(['unauthorized', 'rate_limited', 'network', 'http', 'chat_not_found', 'chat_moved', 'forbidden']);

let running: Promise<NoticeOutcome> | null = null;
/** Telegram asked to wait (429): until then no run sends anything. */
let pausedUntil = 0;
/** The clock a run reads its time passing on; a test may hold it or move it. */
let clockMs: () => number = Date.now;

const WAITING = { sentAt: null, gaveUpAt: null } as const;
const countPending = () => prisma.notice.count({ where: WAITING });

/** Tests start from a sender that was never paused, on the real clock. */
export function resetNoticeSenderForTests(): void {
  pausedUntil = 0;
  clockMs = Date.now;
}

/** Tests hold the clock, or move it with a stand-in Telegram's pauses. */
export function setNoticeClockForTests(fn: () => number): void {
  clockMs = fn;
}

/**
 * Send what waits, a few at a time. Single-flight: a second call while one
 * runs answers `busy`. Never throws for Telegram's sake.
 */
export function deliverNotices(now: Date = new Date()): Promise<NoticeOutcome> {
  const cfg = telegramConfig();
  if (!cfg) return countPending().then((pending) => ({ status: 'off' as const, sent: 0, failed: 0, pending }));
  if (running) return Promise.resolve({ status: 'busy', sent: 0, failed: 0, pending: 0 });
  running = deliverOnce(cfg, now).finally(() => {
    running = null;
  });
  return running;
}

async function deliverOnce(cfg: TelegramConfig, now: Date): Promise<NoticeOutcome> {
  // A day old — the link was off, or Telegram away that long: the moment has
  // passed, and a burst of yesterday's news would bury today's.
  await prisma.notice.updateMany({ where: { ...WAITING, createdAt: { lt: new Date(now.getTime() - GIVE_UP_MS) } }, data: { gaveUpAt: now, lastFailure: 'expired' } });
  if (now.getTime() < pausedUntil) return { status: 'ok', sent: 0, failed: 0, pending: await countPending() };
  const due = await prisma.notice.findMany({ where: { ...WAITING, nextTryAt: { lte: now } }, orderBy: [{ nextTryAt: 'asc' }, { createdAt: 'asc' }], take: BATCH });
  const client = telegramClient(cfg);
  // A run takes time — three seconds between messages — and a wait Telegram
  // asks for counts from its refusal, not from the run's start: ten messages
  // in, a 30-second pause counted from the start would be nearly over.
  const started = clockMs();
  const at = () => new Date(now.getTime() + (clockMs() - started));
  let sent = 0;
  let failed = 0;
  for (const n of due) {
    let html: string | null;
    try {
      html = await composeNotice(n, { now });
    } catch {
      // A record that could not be read now is tried again later, like a failed send.
      failed++;
      await retryLater(n, at(), 'compose', null);
      continue;
    }
    if (html == null) {
      await prisma.notice.update({ where: { id: n.id }, data: { gaveUpAt: now, lastFailure: 'stale' } });
      continue;
    }
    try {
      await client.sendMessage(cfg.chatId, html);
    } catch (err) {
      if (!(err instanceof TelegramError)) throw err;
      failed++;
      const refusedAt = at();
      if (FINAL.has(err.failure)) {
        await prisma.notice.update({ where: { id: n.id }, data: { attempts: n.attempts + 1, gaveUpAt: refusedAt, lastFailure: err.failure, lastHttpStatus: err.httpStatus } });
      } else {
        const wait = err.failure === 'rate_limited' && err.retryAfterSec != null ? err.retryAfterSec * 1000 : null;
        if (wait != null) pausedUntil = refusedAt.getTime() + wait;
        await retryLater(n, refusedAt, err.failure, err.httpStatus, wait);
      }
      if (STOPS.has(err.failure)) break;
      continue;
    }
    await prisma.notice.update({ where: { id: n.id }, data: { sentAt: new Date(), attempts: n.attempts + 1, lastFailure: null, lastHttpStatus: null } });
    sent++;
  }
  return { status: 'ok', sent, failed, pending: await countPending() };
}

/** Back off from the moment it failed — or, past a day since it was written, give it up. */
async function retryLater(n: { id: string; attempts: number; createdAt: Date }, failedAt: Date, failure: string, httpStatus: number | null, waitMs: number | null = null): Promise<void> {
  const attempts = n.attempts + 1;
  const next = new Date(failedAt.getTime() + (waitMs ?? BACKOFF_MIN[Math.min(attempts, BACKOFF_MIN.length) - 1]! * 60_000));
  const over = next.getTime() - n.createdAt.getTime() > GIVE_UP_MS;
  await prisma.notice.update({ where: { id: n.id }, data: { attempts, lastFailure: failure, lastHttpStatus: httpStatus, ...(over ? { gaveUpAt: failedAt } : { nextTryAt: next }) } });
}

/**
 * After a commit that wrote a notice: send it now, without making the person
 * who closed the repair wait for Telegram. Under test nothing is kicked — the
 * suites share one database and call the sender themselves.
 */
export function kickNotices(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (!telegramConfig()) return;
  void deliverNotices().catch(() => undefined);
}

// ── The scan ────────────────────────────────────────────────────────────

/**
 * Mopeds that reached «Пора на ТО» and parts below their minimum, written as
 * notices once: a moped once per maintenance mark, a part once per restock.
 * A moped with a planned repair already open is being seen to. With the link
 * off nothing is written: a mark passed while nobody could be told would
 * otherwise be kept from the group for good once it is on.
 */
export async function scanNotices(): Promise<{ status: 'off' | 'ok'; maintenance: number; stock: number }> {
  if (!telegramConfig()) return { status: 'off', maintenance: 0, stock: 0 };
  const due = (await maintenanceOf(prisma)).filter((m) => maintenanceDue(m.state) && m.dueKm != null && m.openPlanned == null);
  const short = (await partRows()).filter((p) => p.shortBy > 0);
  const restocked = await lastRestocks(short.map((p) => p.id));
  const maintenance = due.length
    ? (await prisma.notice.createMany({ data: due.map((m) => ({ kind: 'maintenance_due', entityId: m.vehicleId, dedupeKey: noticeKey.maintenance(m.vehicleId, m.dueKm!) })), skipDuplicates: true })).count
    : 0;
  const stock = short.length
    ? (await prisma.notice.createMany({ data: short.map((p) => ({ kind: 'stock_low', entityId: p.id, dedupeKey: noticeKey.stock(p.id, restocked.get(p.id) ?? null) })), skipDuplicates: true })).count
    : 0;
  return { status: 'ok', maintenance, stock };
}

/**
 * The last arrival of each part — «до следующего прихода» (ADR-0038 §6): a
 * shipment, a part bought in a shop for the shelf, the first count, a part
 * taken off a moped onto the shelf. Parts given back — a line taken off a
 * repair, a repair called off — and a stock-take that found more arrive from
 * nowhere: they correct the shelf and tell nothing new. A part a mechanic
 * bought or took off a donor only passes through (ADR-0036), and neither
 * counts — not even once its line is gone and the movement names no line:
 * its pair, the issue written in the same instant, still gives it away.
 */
async function lastRestocks(partIds: string[]): Promise<Map<string, string>> {
  if (partIds.length === 0) return new Map();
  const receipts = await prisma.stockMove.findMany({
    where: { partId: { in: partIds }, kind: 'receipt', qty: { gt: 0 } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, partId: true, qty: true, createdAt: true, servicePart: { select: { kind: true } }, servicePartId: true },
  });
  const loose = receipts.filter((m) => m.servicePartId == null);
  const pairs = loose.length
    ? await prisma.stockMove.findMany({
        where: { partId: { in: partIds }, kind: 'issue', servicePartId: null, createdAt: { in: loose.map((m) => m.createdAt) } },
        select: { partId: true, qty: true, createdAt: true },
      })
    : [];
  const paired = new Set(pairs.map((m) => `${m.partId}:${m.createdAt.getTime()}:${-m.qty}`));
  const last = new Map<string, string>();
  for (const m of receipts) {
    if (last.has(m.partId)) continue;
    if (m.servicePart && (m.servicePart.kind === 'bought' || m.servicePart.kind === 'donor')) continue;
    if (m.servicePartId == null && paired.has(`${m.partId}:${m.createdAt.getTime()}:${m.qty}`)) continue;
    last.set(m.partId, m.id);
  }
  return last;
}
