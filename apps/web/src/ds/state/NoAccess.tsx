import { Lock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import './state.css';

/**
 * A direct link to something the role does not see (ux.md, "Нет прав"). The
 * section is not in the menu; the address still says what it is and where to
 * go instead, rather than silently landing on Today.
 */
export function NoAccess() {
  const t = useT();
  return (
    <div className="state-empty">
      <span className="state-empty-icon">
        <Lock size={24} strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h2 className="state-empty-title">{t.noAccess.title}</h2>
      <Link className="pill pill-sm" to="/">
        {t.noAccess.toToday}
      </Link>
    </div>
  );
}
