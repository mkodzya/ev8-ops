import { useEffect, useState } from 'react';
import { useT } from '../i18n/index.js';

export interface RowAction {
  key: string;
  label: string;
  onPick: () => void;
}

/**
 * The actions of one row, behind the three dots every table has.
 *
 * Fixed rather than absolute on purpose: the fleet list scrolls sideways, and
 * anything positioned inside it is cut off at the edge. Anchored to the
 * button's own rectangle when it opens, and closed by anything that moves that
 * rectangle — a scroll, a resize, Escape, or a click anywhere else.
 */
export function RowMenu({ actions }: { actions: RowAction[] }) {
  const t = useT();
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!at) return;
    const close = () => setAt(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAt(null);
    };
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [at]);

  if (actions.length === 0) return null;

  const open = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (at) return setAt(null);
    const r = e.currentTarget.getBoundingClientRect();
    const height = actions.length * 38 + 12;
    const below = r.bottom + 6;
    setAt({
      // Near the bottom of the window the menu opens upwards instead of
      // hanging off the screen.
      top: below + height > window.innerHeight ? Math.max(8, r.top - height - 6) : below,
      right: Math.max(8, window.innerWidth - r.right),
    });
  };

  return (
    <>
      <button type="button" className={`row-dots ${at ? 'on' : ''}`} aria-label={t.fleet.rowActions} onClick={open}>
        …
      </button>
      {at && (
        <div className="row-menu" style={{ top: at.top, right: at.right }} onClick={(e) => e.stopPropagation()} role="menu">
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setAt(null);
                a.onPick();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
