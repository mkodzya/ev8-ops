// Whether a rental's contract is signed, and whether anybody still asks for
// it (ADR-0039). Two places ask — the list's "Не подписан" filter and the
// "Fill in" group of "Today" — and they used to ask it each in their own
// words: a signature here, a rental brought over. One rule now, so the chip
// and the row cannot disagree about a contract signed in Signify.

/**
 * - `signed_here` — signed on this system's screen (D17);
 * - `signed_elsewhere` — a person marked it signed in Signify or on paper;
 * - `not_asked` — a rental brought over keeps its paper from before EV8 Ops
 *   (Mika, 08.10.2026) until its moped is swapped, and a returned one is over;
 * - `unsigned` — a contract made here and waiting for its signature.
 */
export const CONTRACT_STATES = ['signed_here', 'signed_elsewhere', 'not_asked', 'unsigned'] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

export interface ContractFacts {
  /** A copy signed on the screen is among the rental's documents. */
  signedHere: boolean;
  /** When somebody marked it signed in Signify; null — not marked. */
  signedElsewhereAt: Date | string | null;
  /** When the rental was brought over from before EV8 Ops; null — handed over here. */
  transferredAt: Date | string | null;
  /**
   * Its moped was swapped (ADR-0040): the paper from before EV8 Ops names a
   * moped the customer no longer has, and the contract is EV8 Ops' from then
   * on — asked for even of a rental brought over. Absent — never swapped.
   */
  swapped?: boolean;
  /** The rental is returned: its contract is no longer asked for. */
  returned: boolean;
}

/**
 * A signature here outranks the mark, the mark outranks "not asked": a
 * rental brought over whose contract somebody marked is signed, not merely
 * left alone. Nothing here reads Drive — only a person marks (ADR-0034 §5).
 */
export function contractState(f: ContractFacts): ContractState {
  if (f.signedHere) return 'signed_here';
  if (f.signedElsewhereAt != null) return 'signed_elsewhere';
  if ((f.transferredAt != null && !f.swapped) || f.returned) return 'not_asked';
  return 'unsigned';
}

/**
 * What the list says of a contract (wave 3 §3.2): true — signed, here or in
 * Signify; false — waiting for a signature; null — nobody asks.
 */
export function contractSignedOf(state: ContractState): boolean | null {
  return state === 'not_asked' ? null : state !== 'unsigned';
}

/**
 * "Today" asks from the day after the hand-over (wave 3: «Не подписан за
 * сутки»); the list's chip counts it from the hand-over itself. The day of
 * grace is the queue's alone.
 */
export function asksForSignature(state: ContractState, handedOverDaysAgo: number): boolean {
  return state === 'unsigned' && handedOverDaysAgo >= 1;
}
