import type { MouseEvent } from 'react';

/**
 * A click that means "open this row", as opposed to a click on something
 * inside it.
 *
 * A row is not a link — it holds links, a menu and, for ten seconds, a button
 * that takes a decision back — so it cannot be wrapped in one without
 * swallowing them. It listens instead, and ignores anything that began on
 * something with its own job. Dragging across a VIN to copy it is not a click
 * either, so a selection cancels the trip.
 */
export function rowClick(go: () => void) {
  return (e: MouseEvent) => {
    const from = e.target as HTMLElement | null;
    if (from?.closest('a, button, input, select, textarea, label, [role="menu"]')) return;
    if (window.getSelection()?.toString()) return;
    go();
  };
}
