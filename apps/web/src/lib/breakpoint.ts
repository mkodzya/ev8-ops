import { tokens } from '@ev8/shared';
import { useSyncExternalStore } from 'react';

// The one layout chosen in code. Everywhere else a phone and a laptop differ
// by CSS alone, or by two copies of a list of which one is hidden (DataList).
// The payments calendar's two layouts share almost no markup — a row is two
// lines and a line of buttons on a phone, one line of four columns on a
// laptop — and a hidden copy would put every button on the page twice.

const LAPTOP = `(min-width: ${tokens.bpLaptop})`;

function subscribe(changed: () => void): () => void {
  const query = window.matchMedia(LAPTOP);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
}

/** True from the shell's own breakpoint up — where the rail stands instead of the bottom bar. Follows a resize. */
export function useLaptop(): boolean {
  return useSyncExternalStore(subscribe, () => window.matchMedia(LAPTOP).matches);
}
