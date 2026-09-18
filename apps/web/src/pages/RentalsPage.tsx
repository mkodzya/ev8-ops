import { numberMatches, phoneMatches, spellingMatches, vinMatches, type RentalStatus } from '@ev8/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { useSession } from '../session.js';
import { LoadError } from '../components/LoadError.js';
import { useLoad } from '../lib/use.js';
import { CustomerName, Loading, PageHead, RentalBadge, Vin } from '../components/ui.js';
import { DataList } from '../ds/list/DataList.js';
import { primaryName } from '../lib/names.js';
import { fmtDate, formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';

interface Rental {
  id: string;
  number: string;
  odooName: string | null;
  status: RentalStatus;
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null; phone: string | null };
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
  /** Signed on the screen (wave 3 §3.2). */
  contractSigned?: boolean;
}

export function RentalsPage() {
  const t = useT();
  const { can } = useSession();
  const { locale } = useLocale();
  const { data, failure, reload } = useLoad<{ rentals: Rental[] }>('/api/rentals');
  const [params, setParams] = useSearchParams();
  const all = data?.rentals ?? null;
  if (!all && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!all) return <Loading />;
  // "Не подписан": a running rental whose contract has no signature yet (wave 3 §3.2).
  const unsignedRows = all.filter((r) => r.status !== 'returned' && r.contractSigned === false);
  const unsigned = params.get('f') === 'unsigned';
  const rows = unsigned ? unsignedRows : all;

  // What the right of a row says: the debt when there is one, otherwise how
  // far it is paid — one figure, as on the card (U5).
  const owed = (r: Rental) =>
    r.debtTetri > 0 ? (
      <span className="t-money crit-text">{formatGel(r.debtTetri)}</span>
    ) : (
      <span className="mono">{r.returnedOn ? fmtDate(r.returnedOn) : fmtDate(r.paidThrough)}</span>
    );

  return (
    <>
      <PageHead title={t.rentals.title} sub={t.rentals.count(all.length)}>
        {can('rental.create') && (
          <Link className="pill pill-sm pill-accent" to="/rentals/new">
            {t.actions.newRental}
          </Link>
        )}
      </PageHead>
      {unsignedRows.length > 0 && (
        <div className="list-chips">
          <button type="button" className={`list-chip ${unsigned ? 'on' : ''}`} onClick={() => setParams(unsigned ? {} : { f: 'unsigned' }, { replace: true })}>
            {t.w3.unsigned} <span className="n">{unsignedRows.length}</span>
          </button>
        </div>
      )}
      <DataList
        rows={rows}
        rowKey={(r) => r.id}
        href={(r) => `/rentals/${r.id}`}
        fallback={(a, b) => (b.pickedUpOn ?? '').localeCompare(a.pickedUpOn ?? '') || a.number.localeCompare(b.number)}
        search={{
          placeholder: t.lists.rentalsSearch,
          match: (r, q) =>
            numberMatches(q, r.number) ||
            spellingMatches(q, [r.customer.name, r.customer.nameKa, r.customer.nameLat, r.vehicle?.model]) ||
            phoneMatches(q, r.customer.phone) ||
            vinMatches(q, r.vehicle?.vin),
        }}
        empty={{
          text: t.rentals.empty,
          action: can('rental.create') ? (
            <Link className="pill pill-sm pill-accent" to="/rentals/new">
              {t.actions.newRental}
            </Link>
          ) : undefined,
        }}
        card={(r) => ({
          title: <CustomerName of={r.customer} second={false} />,
          sub: (
            <>
              {r.number}
              {r.vehicle ? (
                <>
                  {' · '}
                  {r.vehicle.model} <span className="mono">···{r.vehicle.vin.slice(-4)}</span>
                </>
              ) : (
                <span className="warn-text"> · {t.rentals.vinUnconfirmed}</span>
              )}
            </>
          ),
          right: owed(r),
          rightSub: <RentalBadge status={r.status} />,
        })}
        columns={[
          { key: 'number', label: t.rentals.number, cell: (r) => <span className="mono">{r.number}</span>, sort: { value: (r) => r.number } },
          {
            key: 'customer',
            label: t.rentals.customer,
            cell: (r) => (
              <Link to={`/customers/${r.customer.id}`}>
                <CustomerName of={r.customer} />
              </Link>
            ),
            sort: { value: (r) => primaryName(r.customer, locale) },
          },
          {
            key: 'vehicle',
            label: t.rentals.vehicle,
            cell: (r) =>
              r.vehicle ? (
                <>
                  <Link to={`/fleet/${r.vehicle.id}`}>
                    <Vin vin={r.vehicle.vin} />
                  </Link>{' '}
                  <span className="muted">{r.vehicle.model}</span>
                </>
              ) : (
                <span className="warn-text">{t.rentals.vinUnconfirmed}</span>
              ),
            sort: { value: (r) => r.vehicle?.model },
          },
          { key: 'rate', label: t.rentals.rate, num: true, cell: (r) => <span className="mono">{formatGel(r.weeklyRateTetri, { decimals: false })}</span>, sort: { value: (r) => r.weeklyRateTetri, first: 'desc' } },
          { key: 'deposit', label: t.rentals.deposit, num: true, cell: (r) => <span className="mono">{formatGel(r.depositTetri, { decimals: false })}</span>, sort: { value: (r) => r.depositTetri, first: 'desc' } },
          { key: 'pickedUp', label: t.rentals.pickedUp, cell: (r) => <span className="mono">{fmtDate(r.pickedUpOn)}</span>, sort: { value: (r) => r.pickedUpOn, first: 'desc' } },
          { key: 'paidThrough', label: t.rentals.paidThrough, cell: (r) => <span className="mono">{r.returnedOn ? fmtDate(r.returnedOn) : fmtDate(r.paidThrough)}</span>, sort: { value: (r) => r.returnedOn ?? r.paidThrough } },
          {
            key: 'status',
            label: t.fleet.state,
            cell: (r) => (
              <span className="r-status">
                <RentalBadge status={r.status} />
                {r.overdueDays > 0 && <span className="crit-text r-days">{t.rentals.overdueDays(r.overdueDays)}</span>}
                {r.debtTetri > 0 && <span className="t-money crit-text r-debt">{formatGel(r.debtTetri)}</span>}
              </span>
            ),
            sort: { value: (r) => r.debtTetri, first: 'desc' },
          },
        ]}
      />
    </>
  );
}
