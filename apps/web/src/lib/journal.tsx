import { formatGel } from '../format.js';

// The journal on a screen (crit. 13, 19, 32 — QA-W5-01).
//
// Corrections are written to `audit_log` and nothing read them back, so a VIN
// put right, a park changed or a cost worked out again left no trace anybody
// could see. A journal line says what changed and from what to what; the
// fields it knows how to read are the ones a person asks about.

type Bag = Record<string, unknown> | null | undefined;

const MONEY = new Set(['costTetri', 'extrasTetri', 'paidBeforeTetri']);

function value(field: string, raw: unknown): string | null {
  if (raw == null) return null;
  if (MONEY.has(field)) return typeof raw === 'number' ? formatGel(raw) : String(raw);
  if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') return String(raw);
  return null;
}

/**
 * The words of a journal note. What the code writes for itself — the reasons
 * a recost carries — is translated; what a person typed is shown as they
 * typed it (QA-W5-21).
 */
export function noteWords(t: { feedNotes: Record<string, string> }, note: string | null | undefined): string | null {
  const own = (note ?? '').trim();
  if (!own) return null;
  return t.feedNotes[own] ?? own;
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
