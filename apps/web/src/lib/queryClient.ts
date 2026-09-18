import { QueryClient } from '@tanstack/react-query';
import { onWrite } from '../api.js';
import { onReconnect } from './connection.js';

/**
 * One cache for the whole app (build plan Р4).
 *
 * - Data stays on screen while it is refetched, and after a refetch fails:
 *   with no connection a person keeps working from what they last saw, and
 *   the sync bar says from when.
 * - A failed request is not retried by the cache. A refusal will be refused
 *   again, and a retry the library holds back while the tab is not in front
 *   left a screen on its skeleton for good (QA-W1-01). The screen says "did
 *   not load" at once, with "Retry"; when the server answers again
 *   (lib/connection.ts watches for it) everything on screen refetches.
 * - networkMode 'always': a phone that thinks it is offline still tries, so
 *   a wrong guess about the network never leaves a screen waiting forever.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 30 * 60_000,
      networkMode: 'always',
      refetchOnWindowFocus: true,
      retry: false,
    },
  },
});

onReconnect(() => {
  void queryClient.invalidateQueries();
});

// After any successful write every screen's data may have moved: all of it
// goes stale, and what is on screen refetches.
onWrite(() => {
  void queryClient.invalidateQueries();
});
