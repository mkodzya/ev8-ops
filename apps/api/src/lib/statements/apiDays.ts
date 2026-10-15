import { addDays, todayISO } from '@ev8/shared';
import { dateFromISO, isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { ingest, knownLines } from './import.js';
import type { ParsedLine } from './parse.js';

// What the two banks read by their APIs have in common (B11-03; ADR-0021 for
// Bank of Georgia, ADR-0026 for TBC): a day of an account becomes one
// statement in the list, its new lines go into the queue a CSV upload feeds,
// and the days an uploaded file covers in full are not read again.

export type ApiBank = 'bog' | 'tbc';

/**
 * A day as a bank writes it: `2026-10-14T00:00:00` is that day as written;
 * a moment with its zone is the day it was in Tbilisi; `14.10.2026` is read
 * too. An empty date of a .NET serializer (`0001-01-01`) is no date.
 */
export function bankDay(v: unknown, tz: string = env.TZ): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const ms = /^\/Date\((-?\d+)/.exec(s);
  let day: string | null = null;
  if (ms) day = todayISO(new Date(Number(ms[1])), tz);
  const iso = /^(\d{4})-(\d{2})-(\d{2})(T[\d:.]+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (iso) day = iso[4] && iso[5] ? todayISO(new Date(s), tz) : `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{2})[./](\d{2})[./](\d{4})/.exec(s);
  if (dmy) day = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  if (!day || day < '2000-01-01' || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return null;
  return day;
}


const IBAN = /^GE\d{2}[A-Z]{2}\d{16}$/;

/**
 * An account as a bank's API takes it: the IBAN, without the currency a
 * statement file may write after it (`GE…BG…GEL`). With a bank code, only an
 * account of that bank (`BG`, `TB`). Null when it is not one.
 */
export function accountOf(raw: string | null | undefined, bankCode?: string): string | null {
  const t = (raw ?? '').replace(/\s+/g, '').toUpperCase();
  const iban = t.slice(0, 22);
  if (!IBAN.test(iban) || !/^([A-Z]{3})?$/.test(t.slice(22))) return null;
  return !bankCode || iban.slice(4, 6) === bankCode ? iban : null;
}

/** What one reading did: listed by the bank, new in the queue, and of the new ones what the rules settled. */
export interface Tally {
  /** Operations the bank listed. */
  listed: number;
  /** New lines in the queue, and of them: linked to money entered by hand, attached by a rule. */
  added: number;
  recorded: number;
  matched: number;
  /** Listed and already in: by their own key, by TBC's transaction id, by document number from another source, by day and sum. */
  known: { byKey: number; byId: number; byDoc: number; bySum: number };
}

export function tally(): Tally {
  return { listed: 0, added: 0, recorded: 0, matched: 0, known: { byKey: 0, byId: 0, byDoc: 0, bySum: 0 } };
}

/** Each operation once, should the bank list one twice. */
export function onceEach(lines: (ParsedLine | null)[]): ParsedLine[] {
  const seen = new Set<string>();
  return lines.filter((l): l is ParsedLine => {
    if (!l || seen.has(l.naturalKey)) return false;
    seen.add(l.naturalKey);
    return true;
  });
}

export function byDay(lines: ParsedLine[]): Map<string, ParsedLine[]> {
  const days = new Map<string, ParsedLine[]>();
  for (const l of lines) days.set(l.occurredOn, [...(days.get(l.occurredOn) ?? []), l]);
  return days;
}

export function daysFrom(from: string, to: string): string[] {
  const days: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
  return days;
}

/** The last day a file of this bank reached, by its lines and by the period it states. */
export async function lastFileDay(bank: ApiBank): Promise<string | null> {
  const [line, statement] = await Promise.all([
    prisma.statementLine.findFirst({ where: { bank, statement: { source: 'file' } }, orderBy: { occurredOn: 'desc' }, select: { occurredOn: true } }),
    prisma.statement.findFirst({ where: { bank, source: 'file', periodTo: { not: null } }, orderBy: { periodTo: 'desc' }, select: { periodTo: true } }),
  ]);
  return [isoDate(line?.occurredOn ?? null), isoDate(statement?.periodTo ?? null)].filter((d): d is string => d != null).sort().pop() ?? null;
}

/**
 * The days an uploaded statement of this account covers in full: every day
 * of its period but the last, and the last too when the file was uploaded
 * after that day was over. A file of the same bank that names no account is
 * taken to be this one — the company has one account at each bank.
 */
export async function daysInFiles(bank: ApiBank, account: string, from: string, to: string): Promise<Set<string>> {
  const files = await prisma.statement.findMany({
    where: { bank, source: 'file', periodFrom: { lte: dateFromISO(to)! }, periodTo: { gte: dateFromISO(from)! } },
    select: { account: true, periodFrom: true, periodTo: true, createdAt: true },
  });
  const days = new Set<string>();
  for (const f of files) {
    if (f.account && accountOf(f.account) !== account) continue;
    const first = isoDate(f.periodFrom)!;
    const last = isoDate(f.periodTo)!;
    const lastIsWhole = todayISO(f.createdAt, env.TZ) > last;
    for (const d of daysFrom(first, last)) if (d < last || lastIsWhole) days.add(d);
  }
  return days;
}

/**
 * One day of one account: its new lines into the queue, under that day's
 * statement from the API — made the first time the day brings a new line,
 * and added to as the day goes on. `name` is what the list of statements
 * calls it: the bank's own name for its API.
 */
export async function keep(bank: ApiBank, name: string, account: string, day: string, lines: ParsedLine[], t: Tally): Promise<void> {
  const sorted = await knownLines({ bank, lines });
  t.known.byKey += sorted.byKey;
  t.known.byId += sorted.byId;
  t.known.byDoc += sorted.byDoc;
  t.known.bySum += sorted.bySum;
  const statement = await prisma.statement.findFirst({ where: { bank, source: 'api', account, periodFrom: dateFromISO(day)! }, select: { id: true, lineCount: true } });
  if (sorted.fresh.length === 0) {
    if (statement && lines.length > statement.lineCount) await prisma.statement.update({ where: { id: statement.id }, data: { lineCount: lines.length } });
    return;
  }
  const id =
    statement?.id ??
    (
      await prisma.statement.create({
        data: { bank, source: 'api', fileName: name, fileSha256: 'api', account, periodFrom: dateFromISO(day), periodTo: dateFromISO(day), uploadedById: null },
        select: { id: true },
      })
    ).id;
  const { recorded, matched } = await ingest({ statementId: id, bank, actorId: null, lines: sorted.fresh });
  await prisma.statement.update({
    where: { id },
    data: { lineCount: Math.max(statement?.lineCount ?? 0, lines.length), newLines: { increment: sorted.fresh.length }, matched: { increment: recorded + matched } },
  });
  await prisma.auditLog.create({
    data: {
      actorId: null,
      action: 'statement.pull',
      entityType: 'statement',
      entityId: id,
      after: { bank, source: 'api', day, newLines: sorted.fresh.length, recorded, matched },
    },
  });
  t.added += sorted.fresh.length;
  t.recorded += recorded;
  t.matched += matched;
}
