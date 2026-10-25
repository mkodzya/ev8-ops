import { daysBetween } from '@ev8/shared';

// One operation, two sources (B11-03, ADR-0021, ADR-0026).
//
// A Bank of Georgia line can reach the queue three ways: from a CSV the owner
// uploads, from the five-minute pull of the day's operations, and from the
// nightly statement. Each source keys its lines its own way — the CSV by a
// hash of the row's text, the day's pull by the bank's activity id, the
// statement by the bank's entry id — and none of those keys meet. What they
// share is the operation itself: its day, its direction, its sum and the
// bank's document number.
//
// A TBC line comes two ways: from a CSV, keyed by its "Transaction ID"
// (`txn:20000000001.20`), and from the bank's list of movements, keyed by
// the movement's id (`api:mv:020000000001.2`). TBC's documentation does not
// say the two are one number; read side by side they look like it — eleven
// digits and the leg, credit or debit, written as `.20`/`.10` in the file
// and `.2`/`.1` in the API, the API padding the digits with a zero. So the
// two are compared as numbers, and where they do not meet, the rules below
// still hold.
//
// So a line is already in when
//   1. a line with its own key is there; or
//   2. a line from another source carries the same TBC transaction id; or,
//      failing that,
//   3. a line from another source has the same direction, sum and document
//      number, dated the same day or one day apart (a bank can post on the
//      day after it received); or
//   4. one of the two has no document number, and a line from another source
//      has the same direction and sum on the same day; or
//   5. it is a Bank of Georgia card payment the bank has listed already
//      under its other number (below).
// Each stored line stands for one incoming line at most: three payments of
// 150 on one day, two of them already in, leave exactly one to add.
//
// Two lines from the same source are never one: the bank's ids tell them
// apart, and so does a file's row — but for rule 5. A document number that
// differs is a different operation; when in doubt the line is added rather
// than dropped — a duplicate in the queue is set aside in a click, a lost
// payment is not seen at all.
//
// Rule 5 (issue #16 of the director, 25.10.2026; ADR-0021, addendum of
// 25.10.2026). A payment by the company's Bank of Georgia card reaches the
// list of the day's operations twice, under two activity ids and two document
// numbers: first under the posting's number (eleven digits today), minutes or
// a night later under the card operation's number (twelve). Read on the test
// stand on 25.10.2026: five such pairs since 16.10, every one of them from the
// day's list — not one from the night, as the issue supposed — and each pair
// with the same text. Neither id nor document says they are one; the text does:
//   `გადახდა - თანხა: GEL12.40; ობიექტი: Example Cafe, Tbilisi; MCC:5814;
//    თარიღი: 03/03/2031 18:13; ბარათის No: ****0000; …` (an invented line)
// and a file of the same bank writes it in English — `Payment - Amount: …;
// Merchant: …; MCC: …; Date: …; Card No: …`. So two lines are one card
// payment when both texts say so and agree on the shop (`ობიექტი`, as far as
// its first comma or `>`: the bank writes `Example Cafe>TBILISI GE` in one and
// `Example Cafe, Tbilisi` in another), on the minute it was paid (`თარიღი`),
// and — where both carry them — on the MCC and the card's last digits; the
// direction and the sum are the same, the days at most three apart (a night
// or a weekend between the two listings), and the two document numbers are of
// the two kinds, so of different lengths. That last sign keeps two purchases
// of one sum in one shop in one minute two lines: each comes first under a
// posting number of its own, of the same length. A text cut short before the
// shop or the minute is no card payment for this rule. Whichever line came in
// first stays, as with every other rule; the later is the one not added.

export interface SameLineCandidate {
  naturalKey: string;
  docNo?: string | null;
  occurredOn: string;
  direction: 'in' | 'out';
  amountTetri: number;
  /** The line's text as stored: what rule 5 reads a card payment from. */
  raw?: string | null;
}

/** Where a line came from, by its key: a file, the day's pull, the nightly statement, or TBC's list of movements. */
export function sourceOf(naturalKey: string): 'file' | 'today' | 'entry' | 'movement' {
  if (naturalKey.startsWith('api:today:')) return 'today';
  if (naturalKey.startsWith('api:entry:')) return 'entry';
  if (naturalKey.startsWith('api:mv:')) return 'movement';
  return 'file';
}

/**
 * The TBC transaction id a key carries, written one way: `txn:20000000001.20`
 * of a file and `api:mv:020000000001.2` of the API are both `20000000001.2`.
 * Null for any other key.
 */
export function tbcIdOf(naturalKey: string): string | null {
  const m = /^(?:txn:|api:mv:)0*(\d+)\.(\d+)$/.exec(naturalKey);
  if (!m) return null;
  const leg = m[2]!.replace(/0+$/, '');
  return `${m[1]}.${leg || '0'}`;
}

/** "0017" and "17" are the same document. */
function docKey(docNo: string | null | undefined): string | null {
  const t = (docNo ?? '').trim();
  if (!t) return null;
  return t.replace(/^0+(?=.)/, '').toUpperCase();
}

export interface AlreadyIn<T> {
  fresh: T[];
  /** Known by their own key. */
  byKey: number;
  /** The same operation from another source, by TBC's transaction id. */
  byId: number;
  /** The same operation from another source, by its document number. */
  byDoc: number;
  /** The same operation from another source, by day and sum where one side has no number. */
  bySum: number;
  /** A Bank of Georgia card payment already in under its other number (rule 5). */
  byCard: number;
}

export function alreadyIn<T extends SameLineCandidate>(incoming: T[], stored: SameLineCandidate[]): AlreadyIn<T> {
  const keyAt = new Map(stored.map((s, i) => [s.naturalKey, i]));
  const taken = new Set<number>();
  const known = new Set<number>(); // indexes into `incoming`
  let byKey = 0;
  let byId = 0;
  let byDoc = 0;
  let bySum = 0;

  incoming.forEach((l, i) => {
    const at = keyAt.get(l.naturalKey);
    if (at === undefined) return;
    taken.add(at);
    known.add(i);
    byKey++;
  });

  const otherSource = (l: SameLineCandidate, s: SameLineCandidate) => sourceOf(s.naturalKey) !== sourceOf(l.naturalKey);

  incoming.forEach((l, i) => {
    if (known.has(i)) return;
    const id = tbcIdOf(l.naturalKey);
    if (!id) return;
    const j = stored.findIndex((s, j) => !taken.has(j) && otherSource(l, s) && tbcIdOf(s.naturalKey) === id);
    if (j < 0) return;
    taken.add(j);
    known.add(i);
    byId++;
  });

  const sameMoney = (l: SameLineCandidate, s: SameLineCandidate) => s.direction === l.direction && s.amountTetri === l.amountTetri;

  incoming.forEach((l, i) => {
    if (known.has(i)) return;
    const doc = docKey(l.docNo);
    if (!doc) return;
    let best = -1;
    let bestGap = 2;
    stored.forEach((s, j) => {
      if (taken.has(j) || !otherSource(l, s) || !sameMoney(l, s) || docKey(s.docNo) !== doc) return;
      const gap = Math.abs(daysBetween(s.occurredOn, l.occurredOn));
      if (gap < bestGap) {
        best = j;
        bestGap = gap;
      }
    });
    if (best < 0) return;
    taken.add(best);
    known.add(i);
    byDoc++;
  });

  incoming.forEach((l, i) => {
    if (known.has(i)) return;
    const doc = docKey(l.docNo);
    const j = stored.findIndex((s, j) => !taken.has(j) && otherSource(l, s) && sameMoney(l, s) && s.occurredOn === l.occurredOn && (!doc || !docKey(s.docNo)));
    if (j < 0) return;
    taken.add(j);
    known.add(i);
    bySum++;
  });

  // 5. A card payment listed again under its other number. A stored line
  // stands here for one other listing of itself: it may be known by its own
  // key in this very reading — the day's list holds both — and still close
  // its twin, but never two. Two listings new in one reading are one too:
  // the first stays.
  let byCard = 0;
  const storedCards = stored.map((s) => bogCardOf(s.raw));
  const twinned = new Set<number>();
  const freshCards: { at: number; card: BogCard }[] = [];
  incoming.forEach((l, i) => {
    if (known.has(i)) return;
    const card = bogCardOf(l.raw);
    if (!card) return;
    const j = stored.findIndex((s, j) => !twinned.has(j) && cardTwins(l, card, s, storedCards[j] ?? null));
    if (j >= 0) {
      twinned.add(j);
      known.add(i);
      byCard++;
      return;
    }
    const k = freshCards.findIndex((f) => cardTwins(l, card, incoming[f.at]!, f.card));
    if (k >= 0) {
      freshCards.splice(k, 1);
      known.add(i);
      byCard++;
      return;
    }
    freshCards.push({ at: i, card });
  });

  return { fresh: incoming.filter((_, i) => !known.has(i)), byKey, byId, byDoc, bySum, byCard };
}

// ── Rule 5: a Bank of Georgia card payment, listed twice ─────────────────

/** How far apart the two listings of one card payment may be dated: a night, or a weekend. */
export const CARD_DAYS = 3;

/** What the text of a Bank of Georgia card payment says of it — enough to know it again under its other number. */
export interface BogCard {
  /** The shop, as far as its first comma or `>`, in small letters. */
  merchant: string;
  /** The minute the card paid, `YYYY-MM-DD HH:MM`, as the bank writes it in the text. */
  at: string;
  mcc: string | null;
  /** The card's last four digits. */
  card: string | null;
}

// The two wordings: Georgian in the API, English in the CSV export. A value
// runs to the next `;`.
const CARD_PAYMENT = /(?:გადახდა|Payment)\s*-\s*(?:თანხა|Amount)\s*:/i;
const CARD_MERCHANT = /(?:ობიექტი|Merchant)\s*:\s*([^;]*)/i;
const CARD_AT = /(?:თარიღი|Date)\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/i;
const CARD_MCC = /MCC\s*:\s*(\d+)/i;
const CARD_NO = /(?:ბარათის\s*(?:No|ნომერი)|Card\s*No)\.?\s*:\s*([*\d ]*\d)/i;

/**
 * A Bank of Georgia card payment as its text states it, or null — for any
 * other line, and for a card payment whose text is cut short before its shop
 * or its minute.
 */
export function bogCardOf(raw: string | null | undefined): BogCard | null {
  const text = raw ?? '';
  if (!CARD_PAYMENT.test(text)) return null;
  const merchant = (CARD_MERCHANT.exec(text)?.[1] ?? '').split(/[,>]/)[0]!.replace(/\s+/g, ' ').trim().toLowerCase();
  const when = CARD_AT.exec(text);
  if (!merchant || !when) return null;
  const digits = (CARD_NO.exec(text)?.[1] ?? '').replace(/\D/g, '');
  return {
    merchant,
    at: `${when[3]}-${when[2]}-${when[1]} ${when[4]!.padStart(2, '0')}:${when[5]}`,
    mcc: CARD_MCC.exec(text)?.[1] ?? null,
    card: digits.length >= 4 ? digits.slice(-4) : null,
  };
}

/** Two lines, each read for its card payment, are one payment the bank listed twice (rule 5). */
function cardTwins(a: SameLineCandidate, ca: BogCard | null, b: SameLineCandidate, cb: BogCard | null): boolean {
  if (!ca || !cb || a.direction !== b.direction || a.amountTetri !== b.amountTetri) return false;
  if (Math.abs(daysBetween(a.occurredOn, b.occurredOn)) > CARD_DAYS) return false;
  const da = docKey(a.docNo);
  const db = docKey(b.docNo);
  if (!da || !db || da.length === db.length) return false;
  return ca.merchant === cb.merchant && ca.at === cb.at && (!ca.mcc || !cb.mcc || ca.mcc === cb.mcc) && (!ca.card || !cb.card || ca.card === cb.card);
}

/** Rule 5 for two lines as they stand. */
export function sameCardPayment(a: SameLineCandidate, b: SameLineCandidate): boolean {
  return cardTwins(a, bogCardOf(a.raw), b, bogCardOf(b.raw));
}

/**
 * Of lines already in, the ones that repeat an earlier line by rule 5 — a
 * card payment that reached the queue twice before the rule, or got past it
 * — each with the line it repeats: the one that came in first. Each line is
 * repeated by one line at most, as each stored line closes one listing. The
 * caller leaves out the lines a person already set aside as not ours or as a
 * duplicate: those repeat nothing and are repeated by nothing.
 */
export function cardRepeats<T extends SameLineCandidate & { id: string; createdAt: Date }>(lines: readonly T[]): Map<string, T> {
  const ordered = [...lines].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cards = ordered.map((l) => bogCardOf(l.raw));
  const served = new Set<number>();
  const out = new Map<string, T>();
  ordered.forEach((l, i) => {
    if (!cards[i]) return;
    for (let j = 0; j < i; j++) {
      if (served.has(j) || !cardTwins(l, cards[i]!, ordered[j]!, cards[j] ?? null)) continue;
      served.add(j);
      out.set(l.id, ordered[j]!);
      return;
    }
  });
  return out;
}
