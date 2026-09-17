/**
 * Drafts of forms and wizards (wave 1 §3.7): what somebody typed and did not
 * send stays on this device until it is sent, thrown away, or its author
 * signs out (session.tsx clears every `ev8-draft:*`, B1-01).
 *
 * Storage can be missing or refuse (private mode, a full disk): then there is
 * simply no draft, and the form works as it did.
 */
export const DRAFT_PREFIX = 'ev8-draft:';

export interface Draft<V> {
  at: string; // ISO time it was last written
  value: V;
}

export function readDraft<V>(id: string): Draft<V> | null {
  try {
    const raw = localStorage.getItem(DRAFT_PREFIX + id);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Draft<V>;
    return parsed && typeof parsed.at === 'string' && 'value' in parsed ? parsed : null;
  } catch {
    return null;
  }
}

export function writeDraft<V>(id: string, value: V): void {
  try {
    localStorage.setItem(DRAFT_PREFIX + id, JSON.stringify({ at: new Date().toISOString(), value }));
  } catch {
    /* no storage — no draft */
  }
}

export function dropDraft(id: string): void {
  try {
    localStorage.removeItem(DRAFT_PREFIX + id);
  } catch {
    /* nothing to drop */
  }
}

/** Two form values are the same when they serialise the same — forms hold plain strings, numbers and flags. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
