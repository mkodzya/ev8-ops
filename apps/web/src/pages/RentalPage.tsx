import type { ActKind, DepositStatus, PeriodPayStatus, RentalStatus } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading, RentalBadge, Vin } from '../components/ui.js';
import { Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

export interface RentalCard {
  rental: {
    id: string;
    number: string;
    odooName: string | null;
    status: RentalStatus;
    storedStatus: RentalStatus;
    customer: { id: string; name: string; phone: string | null };
    vehicle: { id: string; vin: string; model: string } | null;
    vinUnconfirmed: boolean;
    vinNote: string | null;
    weeklyRateTetri: number;
    depositTetri: number;
    pickedUpOn: string | null;
    expectedReturnOn: string | null;
    returnedOn: string | null;
    paidThrough: string | null;
    buyoutTargetTetri: number | null;
    buyoutPerPaymentTetri: number | null;
    notes: string | null;
  };
  deposit: { amountTetri: number; status: DepositStatus; returnedTetri: number; withheldTetri: number; withheldReason: string | null; returnedTo: string | null; returnedOn: string | null; confirmed?: boolean } | null;
  periods: { seq: number; startsOn: string; endsOn: string; amountTetri: number; paidTetri: number; payStatus: PeriodPayStatus }[];
  acts: { id: string; kind: ActKind; occurredOn: string; odometerKm: number | null; condition: string | null; photos: unknown; pdfUrl: string | null }[];
}

export function RentalPage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<RentalCard>(id ? `/api/rentals/${id}` : null);
  const [err, setErr] = useState<string | null>(null);
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const r = data.rental;
  const d = data.deposit;
  const open = r.status !== 'returned';
  const decided = d && d.status !== 'held';

  const confirm = async () => {
    try {
      await api.post(`/api/rentals/${r.id}/deposit/confirm`);
      reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };

  return (
    <>
      <header className="page-head page-head-wrap">
        <h1 className="mono">{r.number}</h1>
        <RentalBadge status={r.status} />
        {r.odooName && <span className="muted mono">{r.odooName}</span>}
        <span className="spacer" />
        {open && can('rental.return') && (
          <Link className="pill pill-sm pill-accent" to={`/rentals/${r.id}/return`}>
            {t.actions.returnRental}
          </Link>
        )}
      </header>
      {err && <div className="hint hint-bad">{err}</div>}

      <div className="two-col">
        <section className="card">
          <Row k={t.rentals.customer} v={<Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link>} />
          <Row
            k={t.rentals.vehicle}
            v={
              r.vehicle ? (
                <Link to={`/fleet/${r.vehicle.id}`}>
                  <Vin vin={r.vehicle.vin} /> <span className="muted">{r.vehicle.model}</span>
                </Link>
              ) : (
                <span className="warn-text">
                  {t.rentals.vinUnconfirmed}
                  {r.vinNote && <span className="muted"> · {r.vinNote}</span>}
                </span>
              )
            }
          />
          <Row k={t.rentals.rate} v={<span className="mono">{formatGel(r.weeklyRateTetri, { decimals: false })}{t.rentals.perWeek}</span>} />
          <Row k={t.rentals.pickedUp} v={<span className="mono">{fmtDate(r.pickedUpOn)}</span>} />
          <Row k={t.pickup.expectedReturnOn} v={<span className="mono">{fmtDate(r.expectedReturnOn)}</span>} />
          <Row k={t.rentals.returned} v={<span className="mono">{fmtDate(r.returnedOn)}</span>} />
          <Row k={t.rentals.paidThrough} v={<span className="mono">{fmtDate(r.paidThrough)}</span>} />
          {r.buyoutTargetTetri && (
            <Row k={t.rental.buyout} v={t.rental.buyoutProgress(formatGel(r.buyoutTargetTetri, { decimals: false }), formatGel(r.buyoutPerPaymentTetri ?? 0, { decimals: false }))} />
          )}
          {r.notes && <Row k={t.rental.notes} v={<span className="pre">{r.notes}</span>} />}
        </section>

        <section className="card">
          <h2>{t.rentals.deposit}</h2>
          {d ? (
            <>
              <Row k={t.rental.amount} v={<span className="mono">{formatGel(d.amountTetri, { decimals: false })}</span>} />
              <Row k={t.fleet.state} v={t.rental.depositStatus[d.status]} />
              {decided && (
                <>
                  {d.returnedTetri > 0 && <Row k={t.rentals.returned} v={<span className="mono">{formatGel(d.returnedTetri, { decimals: false })} · {fmtDate(d.returnedOn)}</span>} />}
                  {d.withheldTetri > 0 && <Row k={t.rental.withheldReason} v={<span><span className="mono">{formatGel(d.withheldTetri, { decimals: false })}</span> · {d.withheldReason}</span>} />}
                  {d.returnedTo && <Row k={t.rental.returnedTo} v={d.returnedTo} />}
                  {d.confirmed === false && (
                    <div className="row-actions">
                      <span className="warn-text">{t.rental.awaitingOwner}</span>
                      {can('deposit.confirm') && (
                        <button type="button" className="pill pill-sm pill-accent" onClick={confirm}>
                          {t.actions.confirmDeposit}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <Empty text={t.common.dash} />
          )}
        </section>
      </div>

      <section className="card">
        <h2>{t.rental.periods}</h2>
        {data.periods.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.rental.week}</th>
                  <th>{t.rental.from}</th>
                  <th>{t.rental.to}</th>
                  <th className="num">{t.rental.amount}</th>
                  <th className="num">{t.rental.paid}</th>
                  <th>{t.fleet.state}</th>
                </tr>
              </thead>
              <tbody>
                {data.periods.map((p) => (
                  <tr key={p.seq}>
                    <td className="mono">{p.seq}</td>
                    <td className="mono">{fmtDate(p.startsOn)}</td>
                    <td className="mono">{fmtDate(p.endsOn)}</td>
                    <td className="num mono">{formatGel(p.amountTetri, { decimals: false })}</td>
                    <td className="num mono">{formatGel(p.paidTetri, { decimals: false })}</td>
                    <td className={p.payStatus === 'paid' ? 'state-available' : p.payStatus === 'partial' ? 'warn-text' : 'crit-text'}>{t.rental.payStatus[p.payStatus]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t.rental.acts}</h2>
        {data.acts.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <ul className="timeline">
            {data.acts.map((a) => (
              <li key={a.id}>
                <span className="mono muted">{fmtDate(a.occurredOn)}</span>
                <span>
                  {t.rental.actKind[a.kind]}
                  {a.odometerKm != null && <span className="muted"> · {a.odometerKm} km</span>}
                  {a.condition && <span className="muted"> · {a.condition}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
