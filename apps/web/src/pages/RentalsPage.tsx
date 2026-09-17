import type { RentalStatus } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useSession } from '../session.js';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { failureOf, type LoadFailure } from '../lib/use.js';
import { CustomerName, Empty, Loading, PageHead, RentalBadge, Vin } from '../components/ui.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { rowClick } from '../lib/rowLink.js';

interface Rental {
  id: string;
  number: string;
  odooName: string | null;
  status: RentalStatus;
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null };
  vehicle: { id: string; vin: string; model: string } | null;
  vinUnconfirmed: boolean;
  vinNote: string | null;
  weeklyRateTetri: number;
  depositTetri: number;
  pickedUpOn: string | null;
  returnedOn: string | null;
  paidThrough: string | null;
  overdueDays: number;
  debtTetri: number;
}

export function RentalsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { can } = useSession();
  const [rows, setRows] = useState<Rental[] | null>(null);
  const [failure, setFailure] = useState<LoadFailure | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setFailure(null);
    api
      .get<{ rentals: Rental[] }>('/api/rentals')
      .then((r) => setRows(r.rentals))
      .catch((e) => setFailure(failureOf(e)));
  }, [tick]);
  if (!rows && failure) return <LoadError failure={failure} onRetry={() => setTick((n) => n + 1)} />;
  if (!rows) return <Loading />;

  return (
    <>
      <PageHead title={t.rentals.title} sub={t.rentals.count(rows.length)}>
        {can('rental.create') && (
          <Link className="pill pill-sm pill-accent" to="/rentals/new">
            {t.actions.newRental}
          </Link>
        )}
      </PageHead>
      {rows.length === 0 ? (
        <Empty text={t.rentals.empty} />
      ) : (
        /* Cards on a phone, columns from 900 px — one markup, as on the fleet
           (U5). The status and what is owed are one pill: two badges side by
           side make the reader add them up. */
        <ul className="vlist rlist">
          <li className="vlist-head" aria-hidden="true">
            <span>{t.rentals.number}</span>
            <span>{t.rentals.customer}</span>
            <span>{t.rentals.vehicle}</span>
            <span>{t.rentals.rate}</span>
            <span>{t.rentals.deposit}</span>
            <span>{t.rentals.pickedUp}</span>
            <span>{t.rentals.paidThrough}</span>
            <span>{t.fleet.state}</span>
          </li>
          {rows.map((r) => (
            <li key={r.id} className="vrow vrow-go" onClick={rowClick(() => navigate(`/rentals/${r.id}`))}>
              <Link to={`/rentals/${r.id}`} className="r-num mono">
                {r.number}
              </Link>
              <Link to={`/customers/${r.customer.id}`} className="r-who">
                <CustomerName of={r.customer} />
              </Link>
              <span className="r-veh">
                {r.vehicle ? (
                  <>
                    <Link to={`/fleet/${r.vehicle.id}`}>
                      <Vin vin={r.vehicle.vin} />
                    </Link>{' '}
                    <span className="muted">{r.vehicle.model}</span>
                  </>
                ) : (
                  <span className="warn-text">{t.rentals.vinUnconfirmed}</span>
                )}
              </span>
              <span className="r-rate mono">
                {formatGel(r.weeklyRateTetri, { decimals: false })}
                <span className="muted">{t.rentals.perWeek}</span>
              </span>
              <span className="r-dep mono">{formatGel(r.depositTetri, { decimals: false })}</span>
              <span className="r-picked mono">{fmtDate(r.pickedUpOn)}</span>
              <span className="r-paid">
                <span className="r-paid-lbl">{t.rentals.paidThrough}</span>
                <span className="mono">{r.returnedOn ? fmtDate(r.returnedOn) : fmtDate(r.paidThrough)}</span>
              </span>
              <span className="r-status">
                <RentalBadge status={r.status} />
                {r.overdueDays > 0 && <span className="crit-text r-days">{t.rentals.overdueDays(r.overdueDays)}</span>}
                {r.debtTetri > 0 && <span className="t-money crit-text r-debt">{formatGel(r.debtTetri)}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
