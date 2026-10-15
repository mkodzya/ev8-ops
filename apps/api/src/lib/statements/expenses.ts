import type { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../db.js';

// Money going out, and what it was for (migration 0046; Mika's variant A of
// `docs/redesign/prototypes/expense-sort-options.html`, 15.10.2026). A person
// answers what a line is — an expense with its category, money between the
// company's own accounts, not ours — and may remember the payee: the next line
// from it is sorted into the same category by itself, on every way a line
// comes in (a file, the Bank of Georgia API, the TBC API — all go through
// `ingest`), and is listed under «Разобрано правилами».

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

interface PayeeOf {
  payer: string | null;
  purpose: string | null;
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * A card purchase on TBC names the bank as its payer — the same words for
 * every shop — and the shop only in the purpose: "POS - GOOGLE *Google One,
 * 1.25 GEL, …". Remembering the payer there would remember every card purchase.
 */
function shopOf(purpose: string | null): string | null {
  const m = /^POS\s*-\s*([^,]+),/i.exec(purpose ?? '');
  return m ? m[1].trim() : null;
}

/** Who the money went to, as one remembered key; none when the bank names nobody. */
export function expenseKey(line: PayeeOf): string | null {
  const shop = shopOf(line.purpose);
  if (shop) return `pos:${norm(shop)}`;
  const payer = norm(line.payer ?? '');
  return payer.length >= 3 ? payer : null;
}

/** The same payee, as a person reads it beside "Запомнить для …". */
export function payeeLabel(line: PayeeOf): string | null {
  const shop = shopOf(line.purpose);
  if (shop) return shop;
  const payer = (line.payer ?? '').replace(/\s+/g, ' ').trim();
  return payer.length >= 3 ? payer : null;
}

export interface LiveRule {
  id: string;
  categoryId: string;
}

export async function liveRules(db: Db): Promise<Map<string, LiveRule>> {
  const rows = await db.expenseRule.findMany({ where: { archivedAt: null, category: { archived: false } }, select: { id: true, payeeKey: true, categoryId: true } });
  return new Map(rows.map((r) => [r.payeeKey, { id: r.id, categoryId: r.categoryId }]));
}

/** A waiting line sorted by a remembered payee; false when somebody got to it first. */
export async function sortByRule(tx: Tx, lineId: string, rule: LiveRule, actorId: string | null): Promise<boolean> {
  const done = await tx.statementLine.updateMany({
    where: { id: lineId, status: 'unmatched', direction: 'out' },
    data: {
      status: 'ignored',
      matchedRule: 'expense_rule',
      resolution: 'company_expense',
      expenseCategoryId: rule.categoryId,
      expenseRuleId: rule.id,
      resolvedById: actorId,
      resolvedAt: new Date(),
    },
  });
  if (done.count === 0) return false;
  await tx.auditLog.create({
    data: { actorId, action: 'statement.line.expense_rule', entityType: 'statement_line', entityId: lineId, after: { categoryId: rule.categoryId, ruleId: rule.id } },
  });
  return true;
}

/** The waiting lines from this payee, for a rule just remembered to sort at once. */
export async function waitingFrom(tx: Tx, key: string, except: string): Promise<string[]> {
  const lines = await tx.statementLine.findMany({ where: { status: 'unmatched', direction: 'out', id: { not: except } }, select: { id: true, payer: true, purpose: true } });
  return lines.filter((l) => expenseKey(l) === key).map((l) => l.id);
}

/**
 * "Как в прошлый раз": the category the last line from this payee was given
 * by a person, for the lines still waiting — so that a payee nobody chose to
 * remember is still one tap the second time.
 */
export async function lastCategories(): Promise<Map<string, string>> {
  const done = await prisma.statementLine.findMany({
    where: { direction: 'out', resolution: 'company_expense', expenseCategoryId: { not: null }, expenseCategory: { archived: false } },
    orderBy: { resolvedAt: 'desc' },
    take: 1000,
    select: { payer: true, purpose: true, expenseCategoryId: true },
  });
  const out = new Map<string, string>();
  for (const l of done) {
    const key = expenseKey(l);
    if (key && !out.has(key)) out.set(key, l.expenseCategoryId!);
  }
  return out;
}
