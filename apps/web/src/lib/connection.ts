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

export function markDown(): void {
  if (state.online) set({ online: false, backAt: null });
}

export function markUp(): void {
  if (!state.online) {
    set({ online: true, backAt: Date.now() });
    for (const h of reconnectHandlers) h();
  }
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
