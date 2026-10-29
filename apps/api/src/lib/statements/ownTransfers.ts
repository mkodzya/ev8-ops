import { transliterateGeorgian } from '@ev8/shared';
import { audit } from '../audit.js';
import { isoDate } from '../dates.js';
import { prisma } from '../db.js';
import { cardOf } from './parse.js';

// Money between the company's own accounts, found by itself (Mika, 16.10.2026,
// variant A; ADR-0028). A transfer from the Bank of Georgia account to the TBC
// one is two lines — one going out, one coming in — and neither is an expense
// or anybody's payment. Until now a person answered «Между счетами» on each.
//
// A line is ours to mark when it says so itself: the other side of it is the
// company, or its text names another of the company's accounts. Its partner on
// the other account — the same sum the other way, within three days — is then
// marked too, even when the bank names nobody on it. A line a person put back
// in the queue is never marked again: that person has answered.

/** The rule a line marked here carries, beside the person-made `own_transfer`. */
export const OWN_AUTO = 'own_transfer_auto';

/** How far back a waiting line is looked at, and how far apart the two halves of a transfer may be. */
const LOOK_BACK_DAYS = 45;
const PAIR_DAYS = 3;

const IBAN = /GE\d{2}[A-Z]{2}\d{16}/g;

/** An account as a statement names it — the Bank of Georgia adds the currency — cut to the IBAN. */
export function ibanOf(account: string | null | undefined): string | null {
  const m = /GE\d{2}[A-Z]{2}\d{16}/.exec((account ?? '').toUpperCase().replace(/\s+/g, ''));
  return m ? m[0] : null;
}

/** Every IBAN a text names, spaces taken out. */
export function ibansIn(text: string): string[] {
  return [...new Set(text.toUpperCase().replace(/\s+/g, '').match(IBAN) ?? [])];
}

/**
 * Is this the company, as a bank writes its name: «E MOTION MOTORS LLC»,
 * «შპს ე-მოუშენ მოთორს», or that in Latin letters either way. The other side of a line
 * only — a card settlement names the company in its text, as the merchant.
 */
export function isCompany(name: string | null | undefined): boolean {
  const flat = transliterateGeorgian(name ?? '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  // The banks' own transliteration writes შ as S: «e-mouSen moTors».
  return /e(motion|moushen|mousen)motors/.test(flat);
}

export interface OwnLine {
  id: string;
  /** The company's account the line is on: the statement's. */
  account: string | null;
  bank: string;
  direction: 'in' | 'out';
  occurredOn: string;
  amountTetri: number;
  grossTetri: number | null;
  feeTetri: number | null;
  payer: string | null;
  purpose: string | null;
  raw: string;
}

/** Why a line is money between the company's accounts, by itself; null — it does not say. */
export function ownSign(line: OwnLine, own: ReadonlySet<string>): string | null {
  // A card payment is a customer's money, whoever the bank names as the merchant.
  if (line.direction === 'in' && cardOf(line)) return null;
  // The line's own account is not "another": when its statement does not say
  // which account it is, every account at the line's own bank is taken for it.
  const ownBank = line.bank === 'bog' ? 'BG' : line.bank === 'tbc' ? 'TB' : null;
  const isItself = (i: string) => (line.account ? i === line.account : i.slice(4, 6) === ownBank);
  const other = ibansIn([line.payer, line.purpose, line.raw].filter(Boolean).join(' ')).find((i) => own.has(i) && !isItself(i));
  if (other) return `account:${other.slice(4, 6).toLowerCase()}`;
  if (isCompany(line.payer)) return 'company';
  return null;
}

const daysApart = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;

/**
 * The marks to make among waiting lines: each line that says it is a transfer
 * between the company's accounts, and the one partner of each — the other way,
 * the same sum, on another of the accounts, the closest in days. Two partners
 * equally close: none is chosen, a person decides.
 */
export function ownTransfers(lines: readonly OwnLine[], own: ReadonlySet<string>): { id: string; reason: string }[] {
  const out = new Map<string, string>();
  const signed = lines.map((l) => ({ l, sign: ownSign(l, own) })).filter((x): x is { l: OwnLine; sign: string } => x.sign !== null);
  for (const { l, sign } of signed) out.set(l.id, sign);
  for (const { l } of signed) {
    const near = lines
      .filter(
        (p) =>
          !out.has(p.id) &&
          p.direction !== l.direction &&
          p.amountTetri === l.amountTetri &&
          p.account !== null &&
          l.account !== null &&
          p.account !== l.account &&
          daysApart(p.occurredOn, l.occurredOn) <= PAIR_DAYS &&
          !(p.direction === 'in' && cardOf(p)),
      )
      .map((p) => ({ p, d: daysApart(p.occurredOn, l.occurredOn) }))
      .sort((a, b) => a.d - b.d);
    if (near.length === 0 || (near.length > 1 && near[1].d === near[0].d)) continue;
    out.set(near[0].p.id, `pair:${l.bank}:${l.occurredOn}`);
  }
  return [...out].map(([id, reason]) => ({ id, reason }));
}

/**
 * Mark the waiting lines that are money between the company's own accounts.
 * Run after every batch of lines comes in — a file, the Bank of Georgia, TBC —
 * so the second half of a transfer finds the first. Returns how many it marked.
 */
export async function markOwnTransfers(): Promise<number> {
  // The accounts in lari only. One in dollars on a number of its own is not
  // "another of ours" for a line in lari: that line is the lari half of an
  // exchange, and a person sorts it, as before (ADR-0051).
  const accounts = await prisma.statement.findMany({ where: { account: { not: null }, currency: 'GEL' }, distinct: ['account'], select: { account: true } });
  const own = new Set(accounts.map((a) => ibanOf(a.account)).filter((a): a is string => a !== null));
  if (own.size < 2) return 0;
  const since = new Date(Date.now() - LOOK_BACK_DAYS * 86_400_000);
  const rows = await prisma.statementLine.findMany({
    where: { status: 'unmatched', occurredOn: { gte: since } },
    select: { id: true, bank: true, direction: true, occurredOn: true, amountTetri: true, grossTetri: true, feeTetri: true, payer: true, purpose: true, raw: true, statement: { select: { account: true } } },
  });
  if (rows.length === 0) return 0;
  // A line somebody put back in the queue has its answer: theirs.
  const restored = new Set(
    (await prisma.auditLog.findMany({ where: { action: 'statement.line.restore', entityId: { in: rows.map((r) => r.id) } }, select: { entityId: true } })).map((a) => a.entityId),
  );
  const lines: OwnLine[] = rows
    .filter((r) => !restored.has(r.id))
    .map((r) => ({
      id: r.id,
      account: ibanOf(r.statement.account),
      bank: r.bank,
      direction: r.direction as 'in' | 'out',
      occurredOn: isoDate(r.occurredOn)!,
      amountTetri: r.amountTetri,
      grossTetri: r.grossTetri,
      feeTetri: r.feeTetri,
      payer: r.payer,
      purpose: r.purpose,
      raw: r.raw,
    }));
  let marked = 0;
  for (const { id, reason } of ownTransfers(lines, own)) {
    const done = await prisma.statementLine.updateMany({
      where: { id, status: 'unmatched' },
      data: { status: 'ignored', matchedRule: OWN_AUTO, resolution: 'own_transfer', resolutionReason: reason, resolvedById: null, resolvedAt: new Date() },
    });
    if (done.count === 0) continue;
    marked++;
    await audit({ actorId: null, action: 'statement.line.own_transfer', entityType: 'statement_line', entityId: id, after: { rule: OWN_AUTO, reason } });
  }
  return marked;
}
