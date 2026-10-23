import { useQuery } from '@tanstack/react-query';
import { useCallback } from 'react';
import { formatGel } from '@ev8/shared';
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

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** Set only when there is nothing to show. Data already on screen stays, and the sync bar speaks for the failed refetch. */
  failure: LoadFailure | null;
  reload: () => void;
  /** When the data on screen was fetched (ms), for "данные на HH:MM". */
  updatedAt: number | null;
}

/**
 * Load one URL through the shared cache (build plan Р4). The same URL on two
 * screens is one request; data stays on screen while it refreshes; a failure
 * is kept as a status as well as words, so a screen can tell "no such
 * record" from "no connection" (B1-02). Never a blank page, never a spinner
 * that waits forever.
 */
export function useLoad<T>(url: string | null): Loaded<T> {
  const q = useQuery<T>({
    queryKey: [url],
    queryFn: () => api.get<T>(url!),
    enabled: url != null,
  });
  const refetch = q.refetch;
  const reload = useCallback(() => {
    void refetch();
  }, [refetch]);
  const failure = q.data === undefined && q.error ? failureOf(q.error) : null;
  return {
    data: q.data ?? null,
    error: failure?.text ?? null,
    failure,
    reload,
    updatedAt: q.dataUpdatedAt || null,
  };
}

/**
 * What went wrong, in the language on screen, saying what to do. A code the
 * dictionary does not know yet (errors-guard keeps that from shipping) still
 * reads as a sentence, with the code small at the end for whoever is asked.
 */
export function errorText(e: unknown): string {
  const t = currentDict().errors;
  // A gateway with nobody behind it answers 5xx with no body of ours: that is
  // "no connection to the server", not a fault somebody should report.
  if (e instanceof ApiError && e.status >= 500 && (e.code === 'error' || e.status >= 502)) return t.network;
  if (e instanceof ApiError) {
    const figured = withFigures(e);
    if (figured) return figured;
    const known = (t.codes as Record<string, string>)[e.code];
    return known ?? `${t.unknown} (${e.code})`;
  }
  // fetch rejects with a TypeError when the request never reached the server.
  if (e instanceof TypeError) return t.network;
  return t.unknown;
}

/**
 * A refusal that names the record and what is still open on it says both:
 * «Это больше, чем ждёт TS-00003: осталось заплатить 22.30 ₾» rather than
 * that it is more than something (QA 23.10.2026, a bank line on a goods sale).
 * The code's plain words stay the answer when the figures did not come.
 */
function withFigures(e: ApiError): string | null {
  const said: ((number: string, sum: string) => string) | undefined = currentDict().goods.refusals[e.code];
  const { number, openTetri } = e.extra;
  return said && typeof number === 'string' && typeof openTetri === 'number' ? said(number, formatGel(openTetri)) : null;
}
