import type { Dict } from '../i18n/en.js';
import { currentDict, useT } from '../i18n/index.js';
import { fmtDate, formatGel } from '../format.js';
import { Typed } from './typed.js';

// The journal on a screen (crit. 13, 19, 32 — QA-W5-01).
//
// Corrections are written to `audit_log` and nothing read them back, so a VIN
// put right, a park changed or a cost worked out again left no trace anybody
// could see. A journal line says what changed and from what to what; the
// fields it knows how to read are the ones a person asks about.

type Bag = Record<string, unknown> | null | undefined;

/**
 * Money is money by its name, not by a list somebody keeps up to date: every
 * amount in the product is stored in tetri and named `…Tetri`. A list was
 * three fields long and said nothing about the fourth (QA-W6-15).
 */
const isMoney = (field: string) => field.endsWith('Tetri');

/** A date is a date by its shape, whatever the field is called. */
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * An id or a hash says nothing to a person, and the record itself is already
 * named in the "запись" column. Printing two UUIDs side by side as "было →
 * стало" is noise that hides the line that matters.
 */
const isReference = (field: string) => field.endsWith('Id') || field === 'sha256';

/**
 * The words the rest of the product uses for a value. The screen showed
 * `active → disputed` where the card beside it says «Активна → Спорная`:
 * the dictionaries had the words all along and the journal never asked
 * (QA-W6-20).
 *
 * Matched by the field's name and only accepted when that dictionary knows
 * the value, so a code nobody has words for stays a code rather than
 * borrowing somebody else's sentence.
 */
function said(t: Dict, field: string, raw: string): string {
  // A dictionary block may hold a function or two beside its words (`pools`
  // has `moved(pool)`); only a string is a word.
  const from = (...books: (Record<string, unknown> | undefined)[]) => {
    for (const book of books) {
      const word = book?.[raw];
      if (typeof word === 'string') return word;
    }
    return undefined;
  };
  switch (field) {
    case 'state':
    case 'toState':
      return from(t.states) ?? raw;
    case 'status':
      // A rental's status and a repair's share the column and not the
      // vocabulary; where they overlap they mean the same thing.
      return from(t.rentalStatus, t.service.statuses) ?? raw;
    case 'pool':
    case 'toPool':
      return from(t.pools) ?? raw;
    case 'role':
      return from(t.users.roles) ?? raw;
    case 'channel':
      return from(t.payments.channels) ?? raw;
    case 'kind':
      return from(t.money.kinds) ?? raw;
    case 'decision':
      return from(t.migrationPage.decide) ?? raw;
    case 'payer':
      return from(t.service.payers) ?? raw;
    default:
      return raw;
  }
}

function value(field: string, raw: unknown): string | null {
  if (raw == null) return null;
  if (isReference(field)) return null;
  if (isMoney(field)) return typeof raw === 'number' ? formatGel(raw) : String(raw);
  const t = currentDict();
  if (typeof raw === 'boolean') return raw ? t.common.yes : t.common.dash;
  if (typeof raw === 'string') return ISO_DAY.test(raw) ? fmtDate(raw) : said(t, field, raw);
  if (typeof raw === 'number') return String(raw);
  return null;
}

/**
 * The words of a journal note. What the code writes for itself — the reasons
 * a recost carries — is translated; what a person typed is shown as they
 * typed it (QA-W5-21).
 *
 * Some rows carry the reason inside what was written rather than in the note
 * beside it: a deposit decided keeps `after.reason`, and a person who came to
 * the journal asking "почему вернули не всё" saw an empty column
 * (QA-W6-15). The reason is read from either place.
 */
export function noteWords(t: { feedNotes: Record<string, string> }, note: string | null | undefined, after?: unknown): string | null {
  const own = ownNote(note, after);
  if (!own) return null;
  return t.feedNotes[own] ?? own;
}

/** The note as written, from the note or from the reason kept inside what was written. */
function ownNote(note: string | null | undefined, after?: unknown): string {
  const inside = (after as { reason?: unknown } | null | undefined)?.reason;
  return ((note ?? (typeof inside === 'string' ? inside : '')) || '').trim();
}

/**
 * A journal note on a screen. The code's own words come from the dictionary,
 * already in the reader's language; a person's words are shown as typed — or,
 * when they are about a moped or a repair and a translation is ready, in the
 * reader's language, marked as a translation with the original one tap away
 * (ADR-0042). QA-W5-21 still holds: what was typed is what is kept.
 */
export function JournalNote({ note, after }: { note: string | null | undefined; after?: unknown }) {
  const t = useT();
  const own = ownNote(note, after);
  if (!own) return null;
  const coded = t.feedNotes[own];
  return coded ? <>{coded}</> : <Typed text={own} />;
}

/**
 * "было → стало" for the fields both sides name. A journal entry whose sides
 * say nothing legible shows nothing rather than a line of JSON.
 */
export function ChangedFromTo({ before, after }: { before: unknown; after: unknown }) {
  const was = (before ?? null) as Bag;
  const now = (after ?? null) as Bag;
  if (!was || !now || typeof was !== 'object' || typeof now !== 'object') return null;
  const pairs: { field: string; from: string; to: string }[] = [];
  for (const field of Object.keys(was)) {
    if (!(field in now)) continue;
    const from = value(field, was[field]);
    const to = value(field, now[field]);
    if (from == null || to == null || from === to) continue;
    pairs.push({ field, from, to });
  }
  if (pairs.length === 0) return null;
  return (
    <>
      {pairs.map((p) => (
        <span key={p.field} className="muted">
          {' · '}
          <span className="mono">{p.from}</span> → <span className="mono">{p.to}</span>
        </span>
      ))}
    </>
  );
}
