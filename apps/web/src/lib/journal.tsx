import type { Dict } from '../i18n/en.js';
import { currentDict, useT } from '../i18n/index.js';
import { fmtDate, formatGel } from '../format.js';
import { signedAtText } from '../components/Documents.js';
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
    case 'reasonKind':
      // A repair's kind, in the tablet's words wherever it was picked (Mika, 21.10.2026).
      return from(t.wjob.reasons) ?? raw;
    default:
      return raw;
  }
}

function value(field: string, raw: unknown, shifted = false): string | null {
  const t = currentDict();
  // A rental's pay day is a weekday, ISO 1–7, and none of its own is the
  // weeks' first day (ADR-0022, ADR-0041): «6 → 2» told nobody anything.
  // None is said as the card says it: the pickup's weekday, or the week's
  // first day once weeks were moved.
  if (field === 'payWeekday') {
    if (raw == null) return shifted ? t.payDay.asWeekStart : t.payDay.asPickup;
    return typeof raw === 'number' && raw >= 1 && raw <= 7 ? t.calendar.weekdaysIn[raw % 7] : String(raw);
  }
  // The weekday the rent falls due on, its own or the weeks' — what a moved
  // week writes on both sides (QA 21.10.2026), so a rental with none of its
  // own reads «пятница → понедельник» too.
  if (field === 'payDay') return typeof raw === 'number' && raw >= 1 && raw <= 7 ? t.calendar.weekdaysIn[raw % 7] : null;
  // The days a week gained, with their unit (ADR-0041).
  if (field === 'extraDays' && typeof raw === 'number') return t.weekShift.journal.days(raw);
  // The card a mechanic rents on (0066), by its name; none is a dash — «— → card», «card → —».
  if (field === 'renter') return typeof raw === 'string' && raw.trim() ? raw : t.common.dash;
  // A repair's kind may be given, changed and taken away again (Mika,
  // 21.10.2026): there «none» is an answer — «не указана → ДТП» — and not a
  // gap that hides the line.
  // A moped's first assignment, and an undone one, come from or go back to
  // none: «Не назначен → Аренда», where the line said only «Изменено
  // назначение» and not to what (QA after issue #9).
  if (raw == null) return field === 'reasonKind' ? t.rkind.none : field === 'pool' ? t.pools.none : null;
  if (isReference(field)) return null;
  if (isMoney(field)) return typeof raw === 'number' ? formatGel(raw) : String(raw);
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

/**
 * Notes the code wrote only to say what a flag meant: a workshop taken off the
 * list or put back (`workshop.update`). The «было → стало» says it now, in
 * words (`listWords`), so the note would say it twice; it is not a reason
 * anybody gave, and the reason column keeps its dash (QA, 22.10.2026).
 */
const FLAG_NOTES = new Set(['taken off the list', 'put back on the list']);

/** The note as written, from the note or from the reason kept inside what was written. */
function ownNote(note: string | null | undefined, after?: unknown): string {
  const inside = (after as { reason?: unknown } | null | undefined)?.reason;
  const own = ((note ?? (typeof inside === 'string' ? inside : '')) || '').trim();
  return FLAG_NOTES.has(own) ? '' : own;
}

/**
 * A journal note on a screen. The code's own words come from the dictionary,
 * already in the reader's language; a person's words are shown as typed — or,
 * when they are about a moped or a repair and a translation is ready, in the
 * reader's language, marked as a translation with the original one tap away
 * (ADR-0042). QA-W5-21 still holds: what was typed is what is kept.
 */
export function JournalNote({ note, after, quoted = false }: { note: string | null | undefined; after?: unknown; quoted?: boolean }) {
  const t = useT();
  const own = ownNote(note, after);
  if (!own) return null;
  const coded = t.feedNotes[own];
  if (coded) return <>{quoted ? `«${coded}»` : coded}</>;
  // In «» the quotes close around the words; the translation's mark stands after them.
  return <Typed text={own} quoted={quoted} />;
}

/**
 * "было → стало" for the fields both sides name. A journal entry whose sides
 * say nothing legible shows nothing rather than a line of JSON.
 */
export function ChangedFromTo({ action, before, after }: { action?: string; before: unknown; after: unknown }) {
  const was = (before ?? null) as Bag;
  const now = (after ?? null) as Bag;
  if (!was || !now || typeof was !== 'object' || typeof now !== 'object') return null;
  const t = currentDict();
  const pairs: { field: string; label: string | null; from: string; to: string }[] = [];
  // Whether the rental's weeks had been moved, which a pay day change keeps
  // beside it (ADR-0041); a line from before the move had none to keep.
  const shifted = typeof now.weekShiftDays === 'number' && now.weekShiftDays > 0;
  // A line that names the day the rent falls due on says it once, by that day.
  const payDayNamed = typeof was.payDay === 'number' && typeof now.payDay === 'number';
  for (const field of Object.keys(was)) {
    if (!(field in now)) continue;
    if (field === 'payWeekday' && payDayNamed) continue;
    const from = listWords(t, action, field, was[field]) ?? value(field, was[field], shifted);
    const to = listWords(t, action, field, now[field]) ?? value(field, now[field], shifted);
    if (from == null || to == null || from === to) continue;
    pairs.push({ field, label: named(t, field, action), from, to });
  }
  const moved = movedLines(was.schedule, now.schedule);
  // Which week a move was made on: the number is the same on both sides, so
  // no pair carries it (ADR-0041).
  const week = action && WEEK_SHIFT.has(action) && typeof now.seq === 'number' ? t.weekShift.journal.week(now.seq) : null;
  const markOff = markCleared(t, action, was, now);
  if (pairs.length === 0 && moved === 0 && !markOff) return null;
  return (
    <>
      {week && <span className="muted">{` · ${week}`}</span>}
      {pairs.map((p) => (
        <span key={p.field} className="muted">
          {' · '}
          {p.label && `${p.label}: `}
          <span className="mono">{p.from}</span> → <span className="mono">{p.to}</span>
        </span>
      ))}
      {moved > 0 && <span className="muted">{` · ${t.saleDate.linesMoved(moved)}`}</span>}
      {markOff && <span className="muted">{` · ${markOff}`}</span>}
    </>
  );
}

/**
 * A swap that took the «Подписан в Signify» mark off (ADR-0040, ADR-0039).
 * The line kept `contractMarkCleared` and the mark itself on its «before»
 * side, and the screen said nothing of either (QA 21.10.2026): now it says
 * the mark came off, with when it was made and by whom where that was kept.
 */
function markCleared(t: Dict, action: string | undefined, was: Bag, now: Bag): string | null {
  if (action !== 'rental.swap' || now?.contractMarkCleared !== true) return null;
  const mark = (was?.contractMark ?? {}) as { markedAt?: unknown; markedBy?: unknown };
  const at = typeof mark.markedAt === 'string' ? signedAtText(mark.markedAt) : null;
  const by = typeof mark.markedBy === 'string' && mark.markedBy.trim() ? mark.markedBy : null;
  return t.swap.markCleared(at && by ? `${at}, ${by}` : (at ?? by));
}

/**
 * A field the action's own words do not name. «Изменена дата продажи ·
 * 19.05.2026 → 16.05.2026 · 19.05.2027 → 16.05.2027» left the reader to guess
 * that the second pair was the warranty (review of the sale date, 21.10.2026).
 */
function named(t: Dict, field: string, action?: string): string | null {
  // «Изменена дата продажи · 21.09.2026 → 23.09.2026 · Гарантия до: …» named
  // the second pair and not the first (QA, 22.10.2026).
  if (field === 'soldOn') return t.sell.soldOn;
  if (field === 'warrantyUntil') return t.saleCard.warranty;
  // A rental's own pay day, whichever action moved it (ADR-0022, ADR-0041), and the day it falls due on.
  if (field === 'payWeekday' || field === 'payDay') return t.weekShift.journal.payDay;
  // A mechanic's rent link, set or taken off (0066): «Арендует мопед: — → card».
  if (field === 'renter') return t.wpay.renter;
  // A week moved: its end, its price, the days and their extra, each by name —
  // three bare pairs of dates and numbers side by side said nothing (review, 21.10.2026).
  if (action && WEEK_SHIFT.has(action)) {
    const words = t.weekShift.journal;
    if (field === 'endsOn') return words.endsOn;
    if (field === 'amountTetri') return words.amountTetri;
    if (field === 'extraDays') return words.extraDays;
    if (field === 'extraTetri') return words.extraTetri;
  }
  return null;
}

/**
 * A workshop taken off the list and put back (task #1 of 21.10.2026): «в
 * списке → убрана из списка», where the flag read «— → Да» (QA, 22.10.2026).
 * Null for every other field and action: their flags keep the general words.
 */
function listWords(t: Dict, action: string | undefined, field: string, raw: unknown): string | null {
  if (action !== 'workshop.update' || field !== 'archived' || typeof raw !== 'boolean') return null;
  return raw ? t.wshop.journalOff : t.wshop.journalOn;
}

/** A week made longer, and the move taken back (ADR-0041). */
const WEEK_SHIFT = new Set(['rental.week.shift', 'rental.week.shift.undo']);

/**
 * A schedule is a list, and a list has no "было → стало" of its own, so the
 * line dropped it: a sale was re-dated, its instalments fell due on other days
 * — which can change the debt — and the journal said nothing of it (ux.md №14).
 * The line now says how many instalments moved; each one's days stay in the
 * row. Lines are matched by their number, or by their place where a side
 * wrote none (`sale.schedule` keeps the rows as they were sent).
 */
function movedLines(was: unknown, now: unknown): number {
  if (!Array.isArray(was) || !Array.isArray(now)) return 0;
  const days = (rows: unknown[]) =>
    new Map(
      rows.map((raw, i) => {
        const row = (raw ?? {}) as { seq?: unknown; dueOn?: unknown };
        return [typeof row.seq === 'number' ? row.seq : i + 1, row.dueOn] as const;
      }),
    );
  const before = days(was);
  let moved = 0;
  for (const [seq, dueOn] of days(now)) {
    const had = before.get(seq);
    if (typeof had === 'string' && typeof dueOn === 'string' && had !== dueOn) moved += 1;
  }
  return moved;
}
