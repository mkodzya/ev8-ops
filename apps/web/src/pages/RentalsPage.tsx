import type { RentalStatus } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../session.js';
import { api } from '../api.js';
import { Empty, Loading, RentalBadge, Vin } from '../components/ui.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';

interface Rental {
  id: string;
  number: string;
  odooName: string | null;
  status: RentalStatus;
  customer: { id: string; name: string };
  vehicle: { id: string; vin: string; model: string } | null;
  vinUnconfirmed: boolean;
  vinNote: string | null;
  weeklyRateTetri: number;
  depositTetri: number;
  pickedUpOn: string | null;
  returnedOn: string | null;
  paidThrough: string | null;
  overdueDays: number;
}

export function RentalsPage() {
  const t = useT();
  const { can } = useSession();
  const [rows, setRows] = useState<Rental[] | null>(null);
  useEffect(() => {
    void api.get<{ rentals: Rental[] }>('/api/rentals').then((r) => setRows(r.rentals));
  }, []);
  if (!rows) return <Loading />;

  return (
    <>
      <header className="page-head">
        <h1>{t.rentals.title}</h1>
        <span className="mono muted">{rows.length}</span>
        <span className="spacer" />
        {can('rental.create') && (
          <Link className="pill pill-sm pill-accent" to="/rentals/new">
            {t.actions.newRental}
          </Link>
        )}
      </header>
      {rows.length === 0 ? (
        <Empty text={t.rentals.empty} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.rentals.number}</th>
                <th>{t.rentals.customer}</th>
                <th>{t.rentals.vehicle}</th>
                <th className="num">{t.rentals.rate}</th>
                <th className="num">{t.rentals.deposit}</th>
                <th>{t.rentals.pickedUp}</th>
                <th>{t.rentals.paidThrough}</th>
                <th>{t.fleet.state}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/rentals/${r.id}`} className="mono">
                      {r.number}
                    </Link>
                  </td>
                  <td>
                    <Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link>
                  </td>
                  <td>
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
                  </td>
                  <td className="num mono">
                    {formatGel(r.weeklyRateTetri, { decimals: false })}
                    <span className="muted">{t.rentals.perWeek}</span>
                  </td>
                  <td className="num mono">{formatGel(r.depositTetri, { decimals: false })}</td>
                  <td className="mono">{fmtDate(r.pickedUpOn)}</td>
                  <td className="mono">{r.returnedOn ? fmtDate(r.returnedOn) : fmtDate(r.paidThrough)}</td>
                  <td>
                    <RentalBadge status={r.status} />
                    {r.overdueDays > 0 && <span className="crit-text"> {t.rentals.overdueDays(r.overdueDays)}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
