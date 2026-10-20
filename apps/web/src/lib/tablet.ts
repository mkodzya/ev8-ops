import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '../api.js';

/**
 * What the sign-in screen knows on this browser (ADR-0033 §6): nothing on an
 * ordinary one; on the registered workshop tablet its name and the people who
 * may sign in on it with a PIN. Asked without a session — the token is the
 * tablet's cookie, which the page itself never sees.
 */
export interface Tablet {
  device: { name: string } | null;
  people: { id: string; name: string; role: 'mechanic' | 'chief_mechanic'; lockedUntil: string | null }[];
}

export function useTablet(): { tablet: Tablet | null; reload: () => void } {
  const [tablet, setTablet] = useState<Tablet | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    api
      .get<Tablet>('/api/workshop/tablet')
      // No answer is an ordinary browser: the sign-in by address works offline-first as before.
      .then((t) => live && setTablet(t))
      .catch(() => live && setTablet({ device: null, people: [] }));
    return () => {
      live = false;
    };
  }, [n]);
  return { tablet, reload: useCallback(() => setN((x) => x + 1), []) };
}

/** How a PIN went: in, wrong with tries left, or closed until a time. */
export type PinAnswer =
  | { ok: true; locale: string }
  | { ok: false; wrong: true; left: number | null }
  | { ok: false; closedUntil: string }
  | { ok: false; error: unknown };

export async function signInWithPin(userId: string, pin: string): Promise<PinAnswer> {
  try {
    const res = await api.post<{ me: { locale: string } }>('/api/auth/pin', { userId, pin });
    return { ok: true, locale: res.me.locale };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const left = e.extra.left;
      return { ok: false, wrong: true, left: typeof left === 'number' ? left : null };
    }
    if (e instanceof ApiError && e.status === 429) {
      const until = e.extra.until;
      if (typeof until === 'string') return { ok: false, closedUntil: until };
    }
    return { ok: false, error: e };
  }
}
