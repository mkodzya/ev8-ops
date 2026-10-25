import { nameMatches } from '@ev8/shared';
import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../db.js';
import { ApiError } from '../errors.js';
import { attach } from './import.js';
import { ibanOf } from './ownTransfers.js';
import { beforeTransfer, decide, isCashDeposit, lineGross, loadCtx, recordedFor, storedLine, type Ctx, type Decision, type Line, type Reason } from './reconcile.js';

// Money coming in, and its payer remembered (migration 0069; issue #13 of the
// director, ADR-0046). A person answers what a line is and may tick
// «Запомнить для „…“»: the next line from that payer is sorted by itself, on
// every way a line comes in (a file, the Bank of Georgia API, the TBC API —
// all go through `ingest`), and is listed under «Разобрано правилами».
//
//   * A payer remembered as a customer — for rent, a deposit or an advance —
//     puts his next line on that customer's running rental, in the usual
//     order (deposit, weeks, charges), when exactly one rental takes this sum
//     and nothing else of his waits for exactly it. A rental with no debt, a
//     sum that fits nothing, two rentals that would take it: the line waits
//     for a person. That is also how a relative who pays, or a bank that
//     writes the name unlike the card, stops being a question every week.
//   * A payer remembered as money between the company's accounts, a
//     founder's contribution, or other income of a category: his next line
//     is set aside as that.
// A card line names a terminal, not a person, and cash paid in at a branch
// names whoever paid it in: neither has a payer to remember.
//
// Two guards since the review before 1.16.0 (25.10.2026; ADR-0046, addendum):
//   * where the bank gives the sender's account — the Bank of Georgia does,
//     in its English wording («Account: GE…») and in the row's own column —
//     the payer is his name and that account together: a namesake sending
//     from another account is another payer. A line with no account (TBC)
//     keeps the name alone;
//   * a remembered payer is silent when the line's own words name another
//     of our customers: the line goes on as if nobody had remembered him —
//     the name rule, or a person.

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export type PayerKind = 'customer' | 'own_transfer' | 'founder_equity' | 'other_income';

export interface LivePayerRule {
  id: string;
  kind: PayerKind;
  customerId: string | null;
  categoryId: string | null;
  /** The customer's name, for the queue's «Плательщик запомнен: …». */
  customerName?: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The account the money came from, where the bank writes it: the Bank of
 * Georgia, in its English wording after the sender («Sender: …; Account:
 * GE…»), and in the row's column of the other side's account — the third
 * cell of a stored line, from a file and from the API alike (`bog.ts`). TBC's
 * lines keep no account: none.
 */
export function senderAccount(line: Line): string | null {
  if (line.direction !== 'in' || line.bank !== 'bog') return null;
  const said = /\bAccount:\s*([A-Z0-9 ]{15,40})/i.exec(line.raw)?.[1];
  return ibanOf(said) ?? ibanOf(line.raw.split(' | ')[2]);
}

/**
 * Who sent the money, as one remembered key; none for a card line, cash paid
 * in, or a line that names nobody. The name as the bank writes it, and the
 * sender's account beside it where the bank gives one: `name|GE…`.
 */
export function payerKey(line: Line): string | null {
  if (line.direction !== 'in' || line.channel !== 'transfer' || isCashDeposit(line)) return null;
  const payer = norm(line.payer ?? '');
  if (payer.length < 3) return null;
  const account = senderAccount(line);
  return account ? `${payer}|${account}` : payer;
}

/** The same payer, as a person reads it beside «Запомнить для …». */
export function payerLabel(line: Line): string | null {
  if (payerKey(line) == null) return null;
  return (line.payer ?? '').replace(/\s+/g, ' ').trim();
}

/** The rules in force, by payer key. A category taken off stops its rules (as with expenses). */
export async function livePayerRules(db: Db): Promise<Map<string, LivePayerRule>> {
  const rows = await db.payerRule.findMany({
    where: { archivedAt: null, OR: [{ categoryId: null }, { category: { archived: false } }] },
    select: { id: true, payerKey: true, kind: true, customerId: true, categoryId: true, customer: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.payerKey, { id: r.id, kind: r.kind as PayerKind, customerId: r.customerId, categoryId: r.categoryId, customerName: r.customer?.name ?? null }]));
}

export type PayerAnswer =
  | { type: 'rule'; rule: 'payer_rule'; target: { rentalId: string }; customerId: string; reason: Reason; payerRuleId: string }
  | { type: 'aside'; resolution: 'own_transfer' | 'founder_equity' | 'other_income'; categoryId: string | null; payerRuleId: string };

const RULE_RENTALS = new Set(['active', 'overdue']);

/**
 * A rental the remembered customer's money can go on without a doubt: it
 * owes now, and the sum is what it owes, a week, the deposit with its first
 * week, the deposit or the first week left, or everything still open.
 */
function takes(r: Ctx['rentals'][number], gross: number): boolean {
  if (r.owedNowTetri <= 0) return false;
  return [r.owedNowTetri, r.weeklyRateTetri, r.openDepositTetri + r.openFirstPeriodTetri, r.openDepositTetri, r.openFirstPeriodTetri, r.openTotalTetri].some((n) => n > 0 && n === gross);
}

/** The customers the line's own words name — the payer and the purpose, read as the name rule reads them. */
export function namedCustomers(line: Line, ctx: Ctx): string[] {
  const text = [line.payer, line.purpose].filter(Boolean).join(' ');
  return text ? ctx.customers.filter((c) => nameMatches(text, c.names)).map((c) => c.id) : [];
}

/**
 * What a remembered payer makes of this line, or nothing — then the line goes
 * on as if nobody had remembered him. Never over money entered by hand: a
 * payment of this sum within ±3 days may be this very line (B2-03). Never
 * when the line names another of our customers (review of 25.10.2026): a
 * namesake, or the relative remembered for one customer who now rents
 * himself — the name speaks of somebody else, and a remembered payer does
 * not argue with it. For an answer that is no customer's — between own
 * accounts, a founder, other income — every customer is another.
 */
export function byPayerRule(line: Line, ctx: Ctx, rule: LivePayerRule): PayerAnswer | null {
  if (line.direction !== 'in' || recordedFor(line, ctx).length > 0) return null;
  if (namedCustomers(line, ctx).some((id) => id !== rule.customerId)) return null;
  if (rule.kind !== 'customer') {
    return { type: 'aside', resolution: rule.kind, categoryId: rule.kind === 'other_income' ? rule.categoryId : null, payerRuleId: rule.id };
  }
  const customerId = rule.customerId!;
  const gross = lineGross(line);
  const rentals = ctx.rentals.filter((r) => r.customerId === customerId && RULE_RENTALS.has(r.status) && !beforeTransfer(r, line.occurredOn) && takes(r, gross));
  // His sale or his goods waiting for exactly this sum: two records fit, a person says which.
  const other = ctx.sales.some((s) => s.customerId === customerId && (s.dueOpenTetri === gross || s.nextOpenTetri === gross)) || ctx.goods.some((g) => g.customerId === customerId && g.openTetri === gross);
  if (rentals.length !== 1 || other) return null;
  const r = rentals[0];
  return {
    type: 'rule',
    rule: 'payer_rule',
    target: { rentalId: r.id },
    customerId,
    reason: { code: 'payer_rule', name: payerLabel(line) ?? '', number: r.number, debtTetri: r.owedNowTetri },
    payerRuleId: rule.id,
  };
}

/**
 * What the import does with a line: money entered by hand and cash taken to
 * the bank first, as ever; then a remembered payer, a person's own word, over
 * the name rule — unless the line names another customer than the one he is
 * remembered as (`byPayerRule`); then the name rule; then a person.
 */
export function decideWithPayers(line: Line, ctx: Ctx, rules: Map<string, LivePayerRule>): Decision | PayerAnswer {
  const d = decide(line, ctx);
  if (d.type === 'recorded' || d.type === 'bank_deposit') return d;
  const key = payerKey(line);
  const rule = key ? rules.get(key) : undefined;
  return (rule && byPayerRule(line, ctx, rule)) || d;
}

/** A line set aside by a remembered payer; false when somebody got to it first. */
export async function asideByRule(tx: Tx, lineId: string, a: Extract<PayerAnswer, { type: 'aside' }>, actorId: string | null): Promise<boolean> {
  const done = await tx.statementLine.updateMany({
    where: { id: lineId, status: 'unmatched', direction: 'in' },
    data: {
      status: 'ignored',
      matchedRule: 'payer_rule',
      resolution: a.resolution,
      incomeCategoryId: a.categoryId,
      payerRuleId: a.payerRuleId,
      resolvedById: actorId,
      resolvedAt: new Date(),
    },
  });
  if (done.count === 0) return false;
  await tx.auditLog.create({
    data: { actorId, action: 'statement.line.payer_rule', entityType: 'statement_line', entityId: lineId, after: { resolution: a.resolution, categoryId: a.categoryId, ruleId: a.payerRuleId } },
  });
  return true;
}

/** A line put on a rental by a remembered payer. */
export async function attachByRule(tx: Tx, lineId: string, a: Extract<PayerAnswer, { type: 'rule' }>, actorId: string | null): Promise<void> {
  await attach(tx, { actorId, lineId, rule: 'payer_rule', rentalId: a.target.rentalId, customerId: a.customerId, reason: a.reason });
  await tx.statementLine.update({ where: { id: lineId }, data: { payerRuleId: a.payerRuleId } });
}

/**
 * The lines still waiting from this payer, sorted by a rule just remembered —
 * oldest first, each against what the one before it left owing. Returns the
 * lines it sorted.
 */
export async function sortWaitingBy(ruleId: string, key: string, except: string, actorId: string): Promise<string[]> {
  const rule = await prisma.payerRule.findUnique({ where: { id: ruleId }, select: { id: true, kind: true, customerId: true, categoryId: true, archivedAt: true } });
  if (!rule || rule.archivedAt) return [];
  const live: LivePayerRule = { id: rule.id, kind: rule.kind as PayerKind, customerId: rule.customerId, categoryId: rule.categoryId };
  const waiting = await prisma.statementLine.findMany({ where: { status: 'unmatched', direction: 'in', id: { not: except } }, orderBy: [{ occurredOn: 'asc' }, { createdAt: 'asc' }] });
  const mine = waiting.filter((l) => payerKey(storedLine(l)) === key);
  const sorted: string[] = [];
  for (const l of mine) {
    const ctx = await loadCtx();
    const a = byPayerRule(storedLine(l), ctx, live);
    if (!a) continue;
    let ok = false;
    try {
      ok = await prisma.$transaction(async (tx) => {
        if (a.type === 'aside') return asideByRule(tx, l.id, a, actorId);
        await attachByRule(tx, l.id, a, actorId);
        return true;
      });
    } catch (e) {
      // Taken in the meantime by somebody else: it is theirs, not the rule's.
      if (!(e instanceof ApiError) || e.statusCode !== 409) throw e;
    }
    if (ok) sorted.push(l.id);
  }
  return sorted;
}

/**
 * «Запомнить для „…“» (0069): the payer's rule, the old one put away — one
 * live rule a payer — and his lines still waiting sorted by it at once. The
 * line the person answered is not the rule's: «Отменить» takes it back by
 * itself, and the rule's undo takes back the rest.
 */
export async function rememberPayer(input: {
  actorId: string;
  key: string;
  kind: PayerKind;
  customerId: string | null;
  categoryId: string | null;
  lineId: string;
}): Promise<{ ruleId: string; alsoSorted: string[] }> {
  const rule = await prisma.$transaction(async (tx) => {
    await tx.payerRule.updateMany({ where: { payerKey: input.key, archivedAt: null }, data: { archivedAt: new Date(), archivedById: input.actorId } });
    const r = await tx.payerRule.create({
      data: { payerKey: input.key, kind: input.kind, customerId: input.customerId, categoryId: input.categoryId, createdById: input.actorId },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: { actorId: input.actorId, action: 'payer.rule.remember', entityType: 'payer_rule', entityId: r.id, after: { kind: input.kind, customerId: input.customerId, categoryId: input.categoryId, lineId: input.lineId } },
    });
    return r;
  });
  const alsoSorted = await sortWaitingBy(rule.id, input.key, input.lineId, input.actorId);
  return { ruleId: rule.id, alsoSorted };
}
