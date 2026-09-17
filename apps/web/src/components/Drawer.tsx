import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useT } from '../i18n/index.js';

/** Open panels, oldest first. Escape belongs to the one on top. */
const open: symbol[] = [];

/**
 * A panel that comes in from the right and moves nothing behind it.
 *
 * A form for one new thing used to open inside the page head — a flex row
 * aligned on a text baseline — where a form is just a very tall word and the
 * row falls apart around it. Here it lives over the page instead: the list
 * keeps its place, and the three ways out are the ones a person already
 * knows — Escape, the cross, and a click on the page behind.
 *
 * On a phone it becomes a sheet from the bottom, because a 400px panel on a
 * 375px screen is a page with a stripe of wallpaper down one side.
 */
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const t = useT();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    // A panel can open over another — a new model over a new moped — and
    // then Escape closes the top one only, and the page stays still until
    // the last one is gone.
    const me = Symbol('drawer');
    open.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open[open.length - 1] === me) close.current();
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll away under the panel.
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      open.splice(open.indexOf(me), 1);
      if (open.length === 0) document.body.classList.remove('no-scroll');
    };
  }, []);

  // On the body, not where it was asked for: a panel inside a panel would
  // otherwise be positioned by its parent's slide-in transform.
  return createPortal(
    <div className="drawer-scrim" role="presentation" onClick={onClose}>
      <aside
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <h2>{title}</h2>
          <button type="button" className="drawer-x" onClick={onClose} aria-label={t.actions.cancel}>
            ✕
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>,
    document.body,
  );
}
