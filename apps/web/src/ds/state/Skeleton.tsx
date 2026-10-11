import { useEffect, useState } from 'react';
import './state.css';

/**
 * False for the first `--skeleton-delay`, then true. Its own hook so that a
 * skeleton of another shape — the payments calendar's grid — waits exactly as
 * long as this one.
 */
export function useSkeletonDelay(): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const delay = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--skeleton-delay')) || 300;
    const t = window.setTimeout(() => setShown(true), delay);
    return () => window.clearTimeout(t);
  }, []);
  return shown;
}

/**
 * Loading, the way ux.md asks: nothing for the first 300 ms (a fast answer
 * never flashes), then grey bars roughly the shape of what is coming. No
 * words — "Loading…" in three languages is a sentence nobody needs.
 */
export function Skeleton({ rows = 4, variant = 'list' }: { rows?: number; variant?: 'list' | 'card' }) {
  const shown = useSkeletonDelay();
  if (!shown) return <div className="skeleton-wait" aria-busy="true" />;
  return (
    <div className={`skeleton skeleton-${variant}`} aria-busy="true" aria-live="polite">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton-row">
          <span className="skel skel-a" />
          <span className="skel skel-b" />
        </div>
      ))}
    </div>
  );
}
