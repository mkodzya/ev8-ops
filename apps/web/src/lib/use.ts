import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { currentDict } from '../i18n/index.js';

/** Why a screen has nothing to show: the HTTP status (0 = no connection) and the words for it. */
export interface LoadFailure {
  status: number;
  code: string;
  text: string;
}

export function failureOf(e: unknown): LoadFailure {
  if (e instanceof ApiError) return { status: e.status, code: e.code, text: errorText(e) };
  return { status: 0, code: 'network', text: errorText(e) };
}

/**
 * Load one URL; `reload` after a write. A failure is kept as a status as
 * well as words, so a screen can tell "no such record" from "no connection"
 * and offer the right way on (B1-02). Never a blank page, never a spinner
 * that waits forever.
 */
export function useLoad<T>(url: string | null): { data: T | null; error: string | null; failure: LoadFailure | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    setFailure(null);
    api
      .get<T>(url)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setFailure(failureOf(e)));
    return () => {
      alive = false;
    };
  }, [url, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error: failure?.text ?? null, failure, reload };
}

/**
 * What went wrong, in the language on screen, saying what to do. A code the
 * dictionary does not know yet (errors-guard keeps that from shipping) still
 * reads as a sentence, with the code small at the end for whoever is asked.
 */
export function errorText(e: unknown): string {
  const t = currentDict().errors;
  if (e instanceof ApiError) {
    const known = (t.codes as Record<string, string>)[e.code];
    return known ?? `${t.unknown} (${e.code})`;
  }
  // fetch rejects with a TypeError when the request never reached the server.
  if (e instanceof TypeError) return t.network;
  return t.unknown;
}
