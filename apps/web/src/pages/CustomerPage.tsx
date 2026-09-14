import type { CustomerKind, DepositStatus, RentalStatus } from '@ev8/shared';
import { Link, useParams } from 'react-router-dom';
import { Empty, Loading, RentalBadge, Vin } from '../components/ui.js';
import { Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

interface Card {
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null; personalId: string | null; phone: string | null; email: string | null; kind: CustomerKind; tags: string[]; notes: string | null };
  rentals: { id: string; number: string; status: RentalStatus; vehicle: { id: string; vin: string } | null; vinUnconfirmed: boolean; pickedUpOn: string | null; returnedOn: string | null; paidThrough: string | null; weeklyRateTetri: number; deposit: { amountTetri: number; status: DepositStatus } | null }[];
}

export function CustomerPage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, error } = useLoad<Card>(id ? `/api/customers/${id}` : null);
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const c = data.customer;
  return (
    <>
      <header className="page-head page-head-wrap">
        <h1>{c.name}</h1>
        {c.nameLat && c.nameLat !== c.name && <span className="muted">{c.nameLat}</span>}
        <span className="spacer" />
        {can('rental.create') && (
          <Link className="pill pill-sm pill-accent" to={`/rentals/new?customer=${c.id}`}>
            {t.actions.newRental}
          </Link>
        )}
      </header>
      <div className="two-col">
        <section className="card">
          {c.nameKa && <Row k={t.customer.nameKa} v={c.nameKa} />}
          <Row k={t.customer.phone} v={<span className="mono">{c.phone ?? t.common.dash}</span>} />
          <Row k={t.customer.personalId} v={<span className="mono">{c.personalId ?? t.common.dash}</span>} />
          <Row k={t.customer.email} v={c.email ?? t.common.dash} />
          <Row k={t.customer.kind} v={t.customer.kinds[c.kind]} />
          <Row k={t.customers.tags} v={c.tags.length ? c.tags.map((x) => <span key={x} className="chip">{x}</span>) : t.common.dash} />
          {c.notes && <Row k={t.customer.notes} v={<span className="pre">{c.notes}</span>} />}
        </section>
        <section className="card">
          <h2>{t.customer.rentals}</h2>
          {data.rentals.length === 0 ? (
            <Empty text={t.customer.noRentals} />
          ) : (
            <ul className="timeline">
              {data.rentals.map((r) => (
                <li key={r.id}>
                  <span className="mono muted">{fmtDate(r.pickedUpOn)}</span>
                  <span>
                    <Link to={`/rentals/${r.id}`} className="mono">{r.number}</Link> <RentalBadge status={r.status} />{' '}
                    {r.vehicle ? <Vin vin={r.vehicle.vin} /> : <span className="warn-text">{t.rentals.vinUnconfirmed}</span>}
                    <span className="muted"> · {formatGel(r.weeklyRateTetri, { decimals: false })}{t.rentals.perWeek}</span>
                    {r.returnedOn && <span className="muted"> · {fmtDate(r.returnedOn)}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
