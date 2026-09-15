import { useEffect, type ReactNode } from 'react';
import { useT } from '../i18n/index.js';

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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // The page behind must not scroll away under the panel.
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);

  return (
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
    </div>
  );
}
