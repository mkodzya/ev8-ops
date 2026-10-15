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
//      has the same direction and sum on the same day.
// Each stored line stands for one incoming line at most: three payments of
// 150 on one day, two of them already in, leave exactly one to add.
//
// Two lines from the same source are never one: the bank's ids tell them
// apart, and so does a file's row. A document number that differs is a
// different operation; when in doubt the line is added rather than dropped —
// a duplicate in the queue is set aside in a click, a lost payment is not
// seen at all.

export interface SameLineCandidate {
  naturalKey: string;
  docNo?: string | null;
  occurredOn: string;
  direction: 'in' | 'out';
  amountTetri: number;
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

  return { fresh: incoming.filter((_, i) => !known.has(i)), byKey, byId, byDoc, bySum };
}
