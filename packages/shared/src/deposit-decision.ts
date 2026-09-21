import { parseGel, type Tetri } from './money.js';

/**
 * What an owner decides about a deposit when a moped comes back (wave 3
 * §3.4 step 2, §3.5; B5-02, D18).
 *
 * The rules used to live in the screen that draws the choice, where nothing
 * could test them: how much is kept, whether the form may be sent, and what
 * is sent. A return that kept part of a deposit went through one of the
 * longest paths in the product with no test under it at all (QA-W6-16).
 */

export const GROUNDS = ['rent_arrears', 'fines', 'moped_damage', 'incomplete_return', 'key_loss', 'charger_loss', 'cleaning', 'other'] as const;
export type Ground = (typeof GROUNDS)[number];

export interface DecisionState {
  /** No default: an owner says what happens, the screen does not guess (B5-02). */
  action: null | 'return_all' | 'keep_part' | 'keep_all';
  amount: string;
  grounds: Ground[];
  reason: string;
  toOther: boolean;
  toName: string;
  toReason: string;
}

export const NO_DECISION: DecisionState = { action: null, amount: '', grounds: [], reason: '', toOther: false, toName: '', toReason: '' };

/** How much stays with the company; null while nothing has been chosen. */
export function keptOf(d: DecisionState, heldTetri: Tetri): Tetri | null {
  if (d.action === 'return_all') return 0;
  if (d.action === 'keep_all') return heldTetri;
  if (d.action === 'keep_part') return parseGel(d.amount || '');
  return null;
}

/** Ready to send: chosen, within what is held, grounds and a reason when keeping (B5-02). */
export function decisionOk(d: DecisionState, heldTetri: Tetri): boolean {
  const kept = keptOf(d, heldTetri);
  if (kept == null || kept < 0 || kept > heldTetri) return false;
  if (d.action === 'keep_part' && kept <= 0) return false;
  if (kept > 0 && (d.grounds.length === 0 || !d.reason.trim())) return false;
  if (kept < heldTetri && d.toOther && (!d.toName.trim() || !d.toReason.trim())) return false;
  return true;
}

/** What goes to the API. Keeping nothing is a return, whatever button was pressed. */
export function decisionBody(d: DecisionState, heldTetri: Tetri) {
  const kept = keptOf(d, heldTetri) ?? 0;
  const to = kept < heldTetri && d.toOther ? { returnedTo: d.toName.trim(), returnedToReason: d.toReason.trim() } : {};
  return kept > 0 ? { action: 'withhold' as const, withheldTetri: kept, grounds: d.grounds, reason: d.reason.trim(), ...to } : { action: 'return_all' as const, ...to };
}

/**
 * Does keeping this money need a yes of its own? Money that stays with the
 * company is not undone by a tap (wave 3 §3.5), so the screen asks first —
 * and the screen has to know it asked, or the person presses again into
 * silence (QA-W6-16).
 */
export function needsConfirming(d: DecisionState, heldTetri: Tetri): boolean {
  return (keptOf(d, heldTetri) ?? 0) > 0;
}
