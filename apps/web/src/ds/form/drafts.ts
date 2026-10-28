import { DRAFT_PREFIX } from '@ev8/shared';
import { useEffect, useState } from 'react';

/**
 * Drafts of forms and wizards (wave 1 §3.7): what somebody typed and did not
 * send stays on this device until it is sent, thrown away, or its author
 * signs out (session.tsx clears every `ev8-draft:*`, B1-01) — or another
 * person signs in after him (`leftoversToForget` of @ev8/shared, QA before
 * 1.17.0).
 *
 * Storage can be missing or refuse (private mode, a full disk): then there is
 * simply no draft, and the form works as it did.
 */

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

/**
 * A draft kept in step with a form or a wizard. While a stored draft is on
 * offer nothing is written, or the untouched form would overwrite the draft
 * it offers. `hold` pauses writing (after a successful write, before the
 * form resets).
 */
export function useDraft<V>({ id, value, initial, hold = false }: { id?: string; value: V; initial: V; hold?: boolean }) {
  const [offer, setOffer] = useState<Draft<V> | null>(() => {
    if (!id) return null;
    const found = readDraft<V>(id);
    return found && !sameValue(found.value, initial) ? found : null;
  });
  const v = JSON.stringify(value);
  const i = JSON.stringify(initial);
  useEffect(() => {
    if (!id || offer || hold) return;
    if (v === i) dropDraft(id);
    else writeDraft(id, JSON.parse(v) as V);
  }, [id, offer, hold, v, i]);
  return {
    offer,
    /** The stored value, taken back into the form. */
    accept: (restore: (value: V) => void) => {
      if (offer) restore(offer.value);
      setOffer(null);
    },
    discard: () => {
      if (id) dropDraft(id);
      setOffer(null);
    },
    drop: () => {
      if (id) dropDraft(id);
    },
  };
}
