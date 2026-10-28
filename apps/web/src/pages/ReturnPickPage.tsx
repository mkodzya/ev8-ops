import { todayISO } from '@ev8/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { CustomerName, Loading, PageHead } from '../components/ui.js';
import { useT } from '../i18n/index.js';
import { primaryName } from '../lib/names.js';
import { useLoad } from '../lib/use.js';
import { useLocale } from '../i18n/index.js';

interface Rental {
  id: string;
  number: string;
  status: string;
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null; phone?: string | null };
  vehicle: { id: string; vin: string; model: string } | null;
  expectedReturnOn?: string | null;
  returnedOn: string | null;
}

/**
 * "Whose return?" — the first step of «Вернуть мопед» from the "+" (wave 1
 * §3.2): the active rentals, searchable by name, phone or the last characters
 * of the VIN, with the ones due back today on top. Picking one opens the
 * return wizard for it.
 *
 * `swap`: the first step of «Заменить мопед» (issue #18, B2) — the same list
 * of the rentals that have a moped, the customer found the same way, and the
 * pick opens the swap wizard (ADR-0040). Nothing is "due" for a swap, so the
 * list is one.
 */
export function ReturnPickPage({ mode = 'return' }: { mode?: 'return' | 'swap' }) {
  const t = useT();
  const { locale } = useLocale();
  const { data, failure, reload } = useLoad<{ rentals: Rental[] }>('/api/rentals');
  const [q, setQ] = useState('');
  const today = todayISO();
  const swap = mode === 'swap';

  const active = useMemo(
    () => (data?.rentals ?? []).filter((r) => r.returnedOn == null && r.status !== 'returned' && (!swap || r.vehicle != null)),
    [data, swap],
  );
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return active;
    const digits = needle.replace(/\D/g, '');
    return active.filter(
      (r) =>
        [r.customer.name, r.customer.nameKa, r.customer.nameLat, r.number].some((s) => s?.toLowerCase().includes(needle)) ||
        (digits.length >= 3 && (r.customer.phone ?? '').replace(/\D/g, '').includes(digits)) ||
        (!!r.vehicle && r.vehicle.vin.toLowerCase().endsWith(needle)),
    );
  }, [active, q]);
  const due = swap ? [] : shown.filter((r) => r.expectedReturnOn && r.expectedReturnOn <= today);
  const rest = shown.filter((r) => !due.includes(r));

  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;

  const late = (r: Rental) => {
    if (!r.expectedReturnOn || r.expectedReturnOn >= today) return t.returnPick.planToday;
    const days = Math.round((Date.parse(today) - Date.parse(r.expectedReturnOn)) / 86_400_000);
    return t.returnPick.late(days);
  };

  const card = (r: Rental, note?: string) => (
    <li key={r.id}>
      <Link className="pick-card" to={`/rentals/${r.id}/${swap ? 'swap' : 'return'}`}>
        <span className="pick-card-main">
          <span className="pick-card-title">
            <CustomerName of={r.customer} second={false} />
          </span>
          <span className="pick-card-sub">
            {r.number}
            {r.vehicle && (
              <>
                {' · '}
                {r.vehicle.model} <span className="mono">···{r.vehicle.vin.slice(-4)}</span>
              </>
            )}
          </span>
        </span>
        {note && <span className={`pick-card-note ${note === t.returnPick.planToday ? '' : 'crit-text'}`}>{note}</span>}
      </Link>
    </li>
  );

  return (
    <>
      <PageHead title={swap ? t.simple.swapPick.title : t.returnPick.title} />
      <input className="input" placeholder={t.returnPick.placeholder} value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label={t.returnPick.placeholder} />
      {!data ? (
        <Loading rows={4} />
      ) : active.length === 0 ? (
        <p className="empty">{t.returnPick.none}</p>
      ) : shown.length === 0 ? (
        <p className="empty">{t.returnPick.nothing(q)}</p>
      ) : (
        <>
          {due.length > 0 && (
            <>
              <h3 className="pick-group">
                {t.returnPick.today} <span className="muted">{due.length}</span>
              </h3>
              <ul className="pick-cards">{due.map((r) => card(r, late(r)))}</ul>
            </>
          )}
          <h3 className="pick-group">
            {t.returnPick.all} <span className="muted">{rest.length}</span>
          </h3>
          <ul className="pick-cards">{rest.sort((a, b) => primaryName(a.customer, locale).localeCompare(primaryName(b.customer, locale))).map((r) => card(r))}</ul>
        </>
      )}
    </>
  );
}
