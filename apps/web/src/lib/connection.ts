import { useSyncExternalStore } from 'react';

/**
 * Is the server reachable, as the app last found it (ux.md, "Нет связи").
 *
 * The browser's own online flag says whether there is a network, not whether
 * the stand answers; a phone on the showroom wifi with the server down is
 * "online" and still gets nothing. So the answer is what the last request
 * met: a fetch that never reached the server, or a gateway with nobody
 * behind it, marks the connection down; any answer from the API marks it up.
 */

export interface ConnectionState {
  online: boolean;
  /** When the connection came back, for "Связь есть — обновили в HH:MM". Null while down or never lost. */
  backAt: number | null;
}

let state: ConnectionState = { online: typeof navigator === 'undefined' ? true : navigator.onLine, backAt: null };
const listeners = new Set<() => void>();
const reconnectHandlers = new Set<() => void>();

function set(next: ConnectionState) {
  if (next.online === state.online && next.backAt === state.backAt) return;
  state = next;
  for (const l of listeners) l();
}

// While the server is out of reach it is asked every few seconds whether it
// is back: the browser's "online" event fires only when the network itself
// returns, and a screen waiting on a stopped server must not wait for a tap.
const PROBE_MS = 5000;
let probe: number | null = null;

/**
 * How often a return of the connection may set every screen refetching
 * (QA-W6-23).
 *
 * One broken route is enough to make the app chase its own tail: the route
 * answers 5xx without JSON, which by our rule means "not our API" and marks
 * the connection down; the next request that works marks it up; coming up
 * refetches everything, which asks the broken route again. The tester
 * measured 300–450 requests a second on a phone that looked idle. A server
 * that is properly down does not do this — nothing succeeds, so nothing
 * announces a return — which is why the storm only appears in the mixed
 * state, and why the answer is a floor rather than a flag.
 *
 * The connection's own state still flips freely: the sync bar must tell the
 * truth the moment it changes. It is the refetching of everything that is
 * rationed.
 */
const RECONNECT_FLOOR_MS = 10_000;
/** Never announced yet: the first return of the connection always counts. */
let announcedAt: number | null = null;

function probing(on: boolean) {
  if (typeof window === 'undefined') return;
  if (on && probe == null) {
    probe = window.setInterval(() => {
      void fetch('/api/health', { cache: 'no-store' }).then(
        (r) => r.ok && markUp(),
        () => {},
      );
    }, PROBE_MS);
  } else if (!on && probe != null) {
    window.clearInterval(probe);
    probe = null;
  }
}

export function markDown(): void {
  if (state.online) set({ online: false, backAt: null });
  probing(true);
}

export function markUp(): void {
  probing(false);
  if (state.online) return;
  const now = Date.now();
  set({ online: true, backAt: now });
  // Say so at most once in the floor. A blip that is really a broken route
  // goes on flapping; the screens simply stop refetching for every flap, and
  // `staleTime` and a return to the tab pick the data up soon enough.
  if (announcedAt != null && now - announcedAt < RECONNECT_FLOOR_MS) return;
  announcedAt = now;
  for (const h of reconnectHandlers) h();
}

/** Run something when the connection comes back — the data layer refetches. */
export function onReconnect(handler: () => void): () => void {
  reconnectHandlers.add(handler);
  return () => reconnectHandlers.delete(handler);
}

if (typeof window !== 'undefined') {
  window.addEventListener('offline', markDown);
  // The network is back; whether the server is, the next request tells.
  window.addEventListener('online', () => {
    void fetch('/api/health', { cache: 'no-store' }).then(
      (r) => (r.ok ? markUp() : markDown()),
      () => markDown(),
    );
  });
}

export function useConnection(): ConnectionState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}
