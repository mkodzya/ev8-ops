import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';

/** Load one URL; `reload` after a write. Errors surface as a message, never a blank page. */
export function useLoad<T>(url: string | null): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!url) return;
    let alive = true;
    api
      .get<T>(url)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e)));
    return () => {
      alive = false;
    };
  }, [url, tick]);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { data, error, reload };
}

export function errorText(e: unknown): string {
  return e instanceof ApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
}
