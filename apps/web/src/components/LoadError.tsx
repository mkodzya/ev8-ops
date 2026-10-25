import { Link, useLocation } from 'react-router-dom';
import { useT } from '../i18n/index.js';
import type { LoadFailure } from '../lib/use.js';

/**
 * A screen that could not get its data says which of two things happened
 * (B1-02). No such record — a wrong link, a deleted row, `/sales/new` — says
 * so in the words of that section and leads back to its list. Anything else
 * — no connection, a server fault — says it did not load and offers to try
 * again, instead of a spinner that never ends.
 */
export function LoadError({ failure, onRetry }: { failure: LoadFailure | null; onRetry?: () => void }) {
  const t = useT();
  const { pathname } = useLocation();
  if (!failure) return null;

  if (failure.status === 404) {
    // The deepest known list the address sits under: /fleet/models/:id is a
    // model, /service/stock/parts/:id a part.
    const where: { prefix: string; missing: keyof typeof t.errors.codes; list: string }[] = [
      { prefix: '/fleet/models', missing: 'model_not_found', list: t.nav.models },
      { prefix: '/service/stock', missing: 'part_not_found', list: t.stock.nav },
      { prefix: '/fleet', missing: 'vehicle_not_found', list: t.nav.fleet },
      { prefix: '/rentals', missing: 'rental_not_found', list: t.shell.tabs.rentals },
      { prefix: '/sales', missing: 'sale_not_found', list: t.nav.sales },
      { prefix: '/purchases', missing: 'purchase_not_found', list: t.nav.purchases },
      { prefix: '/service', missing: 'job_not_found', list: t.nav.service },
      { prefix: '/customers', missing: 'customer_not_found', list: t.nav.customers },
    ];
    const hit = where.find((w) => pathname.startsWith(`${w.prefix}/`));
    return (
      <div className="load-error">
        <p className="empty">{t.errors.codes[hit?.missing ?? 'not_found']}</p>
        <Link className="pill pill-sm" to={hit ? hit.prefix : '/'}>
          ← {hit ? hit.list : t.nav.today}
        </Link>
      </div>
    );
  }

  return (
    <div className="load-error">
      <p className="empty">{t.errors.loadFailed}</p>
      <p className="hint muted">{failure.text}</p>
      {onRetry && (
        <button type="button" className="pill pill-sm" onClick={onRetry}>
          {t.errors.retry}
        </button>
      )}
    </div>
  );
}
