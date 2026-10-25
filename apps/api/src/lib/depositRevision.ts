import type { Prisma } from '../generated/prisma/client.js';
import { hasPerm, type Actor } from './auth.js';
import { isoDate } from './dates.js';
import { prisma } from './db.js';
import { badRequest, conflict, forbidden, notFound } from './errors.js';
import { recomputeRental, voidPaymentTx } from './payments.js';
import { rentalOwed, syncDeposit } from './rentalMoney.js';
import { writeDecision, type DepositDecision } from './rentals.js';

// An owner's decision on a deposit, revised after the return (issue #14,
// ADR-0047). The decision is taken apart — the money kept goes back onto the
// deposit, what it paid is owed again — and decided anew from that clean
// state by the same `writeDecision` a first decision uses. The money handed
// back is not touched here: a payout is its own record, written and annulled
// where it always is (cash in the card, a transfer from its bank line).

type Tx = Prisma.TransactionClient;

/** A deposit and its rental's debt, as a revision shows them «было → станет». */
export interface DepositFigures {
  /** Kept of the deposit: the return's and a repair's (B5-04). */
  withheldTetri: number;
  /** What the decision gives back. */
  backTetri: number;
  /** Handed back already: in cash, by transfer, or before EV8 Ops. */
  paidOutTetri: number;
  /** Still with the company: received, less kept and handed back. */
  onHandTetri: number;
  /** The rental's weeks and charges not paid. */
  debtTetri: number;
}

export interface RevisionView {
  number: string;
  /** The day the decision stands on; a revision keeps it. */
  decidedOn: string | null;
  before: DepositFigures;
  /** What a decision decides on once the return's is taken back: the deposit not kept by a repair nor handed back. */
  heldTetri: number;
  /** The debt the return's decision would find with its own money taken back. */
  claimsTetri: number;
  /** The decision standing now, to start the form from. */
  current: { keptTetri: number; grounds: string[]; reason: string | null; returnedTo: string | null; returnedToReason: string | null };
  /** The deposit and the debt with the new decision; null while none is given. */
  after: DepositFigures | null;
  /** The return act in the card is signed: the revision replaces it with one to sign again. */
  actSigned: boolean;
}

export interface ReviseInput {
  actor: Actor;
  rentalId: string;
  today: string;
  /** The new decision; none — only what the form starts from. */
  decision: DepositDecision | null;
  /** Why the decision is revised: required to write. */
  reason: string | null;
  /** False: worked out and rolled back, nothing is kept. */
  write: boolean;
}

/** Carries the view out of a transaction that must not keep what it did. */
class Preview extends Error {
  constructor(readonly view: RevisionView) {
    super('preview');
  }
}

async function figuresOf(tx: Tx, depositId: string, rentalId: string): Promise<DepositFigures> {
  const d = await tx.deposit.findUniqueOrThrow({ where: { id: depositId }, include: { payouts: { where: { voidedAt: null }, select: { grossTetri: true } } } });
  const paidOut = d.paidOutBeforeTetri + d.payouts.reduce((n, p) => n + p.grossTetri, 0);
  const owed = await rentalOwed(tx, rentalId);
  const debt =
    owed.periods.reduce((n, p) => n + Math.max(0, p.amountTetri - p.paidTetri), 0) + owed.charges.reduce((n, c) => n + Math.max(0, c.amountTetri - c.paidTetri), 0);
  return {
    withheldTetri: d.withheldTetri,
    backTetri: d.returnedTetri,
    paidOutTetri: paidOut,
    onHandTetri: Math.max(0, d.paidTetri - d.withheldTetri - paidOut),
    debtTetri: debt,
  };
}

/**
 * The return's decision taken back: its money from the deposit annulled (a
 * payment already annulled is passed by), the charge it made for what it
 * kept beyond the debt voided, its lines of «удержано» voided. A repair's
 * withholding stays: it was decided on the repair.
 */
async function takeBack(tx: Tx, actorId: string, depositId: string, rentalId: string, rows: { id: string; paymentId: string | null }[], why: string): Promise<void> {
  const now = new Date();
  for (const w of rows) {
    if (!w.paymentId) continue;
    const p = await tx.payment.findUnique({ where: { id: w.paymentId }, select: { voidedAt: true } });
    if (p && !p.voidedAt) await voidPaymentTx(tx, { actorId, paymentId: w.paymentId, reason: why });
  }
  // Only a return's decision makes a «withheld» charge (`writeDecision`).
  await tx.rentalCharge.updateMany({ where: { rentalId, kind: 'withheld', voidedAt: null }, data: { voidedAt: now } });
  if (rows.length > 0) await tx.depositWithholding.updateMany({ where: { id: { in: rows.map((w) => w.id) } }, data: { voidedAt: now } });
  // Nothing is given back until the decision is made again: kept and given
  // back never come to more than the deposit (deposits_split, 0001).
  await tx.deposit.update({ where: { id: depositId }, data: { returnedTetri: 0, updatedAt: now } });
  await syncDeposit(tx, depositId);
  await recomputeRental(tx, rentalId);
}

/**
 * «Пересмотреть решение по залогу»: an owner, any time after the return,
 * with a reason. One transaction; the preview runs the same one and rolls it
 * back, so «было → станет» is what saving would write.
 */
export async function reviseDeposit(input: ReviseInput): Promise<RevisionView> {
  if (!hasPerm(input.actor, 'deposit.decide')) throw forbidden('deposit_decision_forbidden', 'Only an owner decides on a deposit.');
  const reason = input.reason?.trim() || null;
  if (input.write && !input.decision) throw badRequest('missing_field', 'action is required', { field: 'action' });
  if (input.write && !reason) throw badRequest('missing_field', 'Say why the decision is revised.', { field: 'revisionReason' });
  try {
    return await prisma.$transaction(
      async (tx) => {
        const r = await tx.rental.findUnique({
          where: { id: input.rentalId },
          select: {
            id: true,
            number: true,
            status: true,
            customerId: true,
            returnedOn: true,
            documents: { where: { kind: 'pdf', docKind: 'return_act', archived: false }, select: { signedAt: true } },
          },
        });
        if (!r) throw notFound('rental_not_found', 'No such rental.');
        if (r.status !== 'returned') throw conflict('not_returned', 'A deposit is decided once the moped is back.');
        const d = await tx.deposit.findUnique({
          where: { rentalId: r.id },
          include: {
            withholdings: { where: { voidedAt: null, source: 'return' }, orderBy: { createdAt: 'asc' } },
            payouts: { where: { voidedAt: null }, select: { grossTetri: true } },
          },
        });
        if (!d) throw notFound('deposit_not_found', 'No deposit on this rental.');
        if (!d.decidedById || d.status === 'held') throw conflict('deposit_undecided', 'There is no decision on this deposit yet: decide it first.');

        const before = await figuresOf(tx, d.id, r.id);
        const current = {
          keptTetri: d.withholdings.reduce((n, w) => n + w.amountTetri, 0),
          grounds: [...new Set(d.withholdings.flatMap((w) => w.grounds))],
          reason: d.withholdings.map((w) => w.reason).join('; ') || null,
          returnedTo: d.returnedTo,
          returnedToReason: d.returnedTo ? d.notes : null,
        };
        // The decision keeps its day: what it keeps pays the weeks on the day it was decided.
        const on = isoDate(d.returnedOn) ?? isoDate(r.returnedOn) ?? input.today;

        await takeBack(tx, input.actor.id, d.id, r.id, d.withholdings, `deposit revised: ${reason ?? '—'}`);
        const clean = await tx.deposit.findUniqueOrThrow({ where: { id: d.id } });
        // What goes back counts the money handed back already, as «Вернуть
        // залог» reads it (returned less paid out, migration 0017); what may
        // still be kept is only what has not been handed back.
        const backable = Math.max(0, clean.paidTetri - clean.withheldTetri);
        const handedBack = clean.paidOutBeforeTetri + d.payouts.reduce((n, p) => n + p.grossTetri, 0);
        const held = Math.max(0, backable - handedBack);
        const claims = (await figuresOf(tx, d.id, r.id)).debtTetri;

        let after: DepositFigures | null = null;
        if (input.decision) {
          const keep = input.decision.action === 'return_all' ? 0 : input.decision.withheldTetri;
          if (keep > held) throw conflict('over_held', 'More than the deposit holds cannot be kept.', { field: 'withheldTetri', heldTetri: held });
          await writeDecision(tx, input.actor, { id: d.id, rentalId: r.id, customerId: r.customerId, notes: d.notes }, input.decision, on, backable);
          after = await figuresOf(tx, d.id, r.id);
        }
        const view: RevisionView = {
          number: r.number,
          decidedOn: on,
          before,
          heldTetri: held,
          claimsTetri: claims,
          current,
          after,
          actSigned: r.documents.some((f) => f.signedAt != null),
        };
        if (!input.write) throw new Preview(view);

        await tx.auditLog.create({
          data: {
            actorId: input.actor.id,
            action: 'deposit.revise',
            entityType: 'deposit',
            entityId: d.id,
            // The figures on both sides, each by its name in the journal; the
            // decision itself beside them, for the record.
            before: { ...before } as object,
            after: { ...after!, decision: input.decision, actReplaced: view.actSigned } as object,
            note: reason,
          },
        });
        return view;
      },
      { timeout: 20_000 },
    );
  } catch (e) {
    if (e instanceof Preview) return e.view;
    throw e;
  }
}
