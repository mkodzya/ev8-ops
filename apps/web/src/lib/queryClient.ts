import { QueryClient } from '@tanstack/react-query';
import { ApiError, onWrite } from '../api.js';
import { onReconnect } from './connection.js';

/**
 * One cache for the whole app (build plan Р4).
 *
 * - Data stays on screen while it is refetched, and after a refetch fails:
 *   with no connection a person keeps working from what they last saw, and
 *   the sync bar says from when.
 * - A request that reached the API and was refused (4xx) is not retried: it
 *   will be refused again. One that never arrived is retried once.
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
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
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
