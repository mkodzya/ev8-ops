import { VEHICLE_STATES, type RentalStatus, type VehicleEventKind, type VehicleState } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading, RentalBadge, StateBadge, Vin } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { NewJob } from './ServicePage.js';
import { formatGel } from '../format.js';

interface Card {
  vehicle: {
    id: string;
    vin: string;
    model: { id: string; brand: string; name: string };
    color: string | null;
    year: number | null;
    arrivedOn: string | null;
    state: VehicleState;
    odometerKm: number | null;
    costTetri: number | null;
    notes: string | null;
    currentRentalId: string | null;
  };
  events: { id: string; kind: VehicleEventKind; occurredOn: string; fromState: VehicleState | null; toState: VehicleState; rentalId: string | null; reason: string | null; actor: string | null }[];
  serviceJobs: { id: string; number: string; status: 'open' | 'done' | 'cancelled'; payer: 'company' | 'customer'; reason: string; openedOn: string; closedOn: string | null; totalTetri: number; withheldTetri: number }[];
  rentals: { id: string; number: string; status: RentalStatus; customer: { id: string; name: string }; pickedUpOn: string | null; returnedOn: string | null; paidThrough: string | null; weeklyRateTetri: number }[];
}

export function VehiclePage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<Card>(id ? `/api/fleet/${id}` : null);
  const [open, setOpen] = useState(false);
  const [toState, setToState] = useState<VehicleState>('service');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const v = data.vehicle;
  const current = data.rentals.find((r) => r.id === v.currentRentalId) ?? null;
  const locked = v.state === 'rented' && !!v.currentRentalId;

  const move = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/fleet/${v.id}/state`, { toState, reason });
      setOpen(false);
      setReason('');
      reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header className="page-head page-head-wrap">
        <h1>
          <Vin vin={v.vin} />
        </h1>
        <StateBadge state={v.state} />
        <span className="muted">
          {v.model.brand} {v.model.name}
        </span>
        <span className="spacer" />
        {can('fleet.state.manual') && (
          <button type="button" className="pill pill-sm" onClick={() => setOpen((o) => !o)} disabled={locked} title={locked ? t.vehicle.rentedLock : undefined}>
            {t.actions.changeState}
          </button>
        )}
        {can('service.manage') && v.state !== 'sold' && v.state !== 'out' && !data.serviceJobs.some((j) => j.status === 'open') && (
          <NewJob vehicleId={v.id} onDone={reload} onError={setErr} />
        )}
        {v.state === 'available' && can('rental.create') && (
          <Link className="pill pill-sm pill-accent" to={`/rentals/new?vehicle=${v.id}`}>
            {t.actions.newRental}
          </Link>
        )}
      </header>

      {open && (
        <section className="card card-drawer">
          <Field label={t.vehicle.toState}>
            <div className="chips">
              {VEHICLE_STATES.filter((s) => s !== 'rented' && s !== v.state).map((s) => (
                <button key={s} type="button" className={`pill pill-sm ${toState === s ? 'on' : ''}`} onClick={() => setToState(s)}>
                  {t.states[s]}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t.vehicle.reason} hint={t.vehicle.reasonHint}>
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {err && <div className="hint hint-bad">{err}</div>}
          <div className="row-actions">
            <button type="button" className="pill" onClick={() => setOpen(false)}>
              {t.actions.cancel}
            </button>
            <button type="button" className="pill pill-accent" disabled={!reason.trim() || busy} onClick={move}>
              {t.actions.confirm}
            </button>
          </div>
        </section>
      )}

      <div className="two-col">
        <section className="card">
          <Row k={t.fleet.color} v={v.color ?? t.common.dash} />
          <Row k={t.fleet.year} v={<span className="mono">{v.year ?? t.common.dash}</span>} />
          <Row k={t.fleet.arrived} v={<span className="mono">{fmtDate(v.arrivedOn)}</span>} />
          <Row k={t.vehicle.odometer} v={<span className="mono">{v.odometerKm ?? t.common.dash}</span>} />
          {v.costTetri != null && <Row k={t.purchases.cost} v={<span className="mono">{formatGel(v.costTetri)}</span>} />}
          <Row
            k={t.fleet.renter}
            v={current ? <Link to={`/customers/${current.customer.id}`}>{current.customer.name}</Link> : t.common.dash}
          />
          <Row k={t.fleet.paidThrough} v={<span className="mono">{current ? fmtDate(current.paidThrough) : t.common.dash}</span>} />
          {v.notes && <Row k={t.vehicle.notes} v={<span className="pre">{v.notes}</span>} />}
        </section>

        <section className="card">
          <h2>{t.vehicle.history}</h2>
          {data.events.length === 0 ? (
            <Empty text={t.common.dash} />
          ) : (
            <ul className="timeline">
              {data.events.map((e) => (
                <li key={e.id}>
                  <span className="mono muted">{fmtDate(e.occurredOn)}</span>
                  <span>
                    {t.vehicle.events[e.kind]} <StateBadge state={e.toState} />
                    {e.rentalId && (
                      <>
                        {' '}
                        <Link to={`/rentals/${e.rentalId}`} className="mono">
                          {data.rentals.find((r) => r.id === e.rentalId)?.number ?? ''}
                        </Link>
                      </>
                    )}
                    {e.reason && <span className="muted"> · {e.reason}</span>}
                    {e.actor && <span className="muted"> · {e.actor}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <h2>{t.service.history}</h2>
        {data.serviceJobs.length === 0 ? (
          <Empty text={t.service.none} />
        ) : (
          <ul className="timeline">
            {data.serviceJobs.map((j) => (
              <li key={j.id}>
                <span className="mono muted">{fmtDate(j.openedOn)}</span>
                <span>
                  <Link to={`/service/${j.id}`} className="mono">
                    {j.number}
                  </Link>{' '}
                  {j.reason} <span className="muted">· {t.service.payers[j.payer]}</span>
                  <span className="muted"> · {formatGel(j.totalTetri)}</span>
                  <span className={j.status === 'open' ? 'warn-text' : 'muted'}> · {t.service.statuses[j.status]}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{t.vehicle.rentalsOf}</h2>
        {data.rentals.length === 0 ? (
          <Empty text={t.rentals.empty} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.rentals.number}</th>
                  <th>{t.rentals.customer}</th>
                  <th>{t.rentals.pickedUp}</th>
                  <th>{t.rentals.returned}</th>
                  <th className="num">{t.rentals.rate}</th>
                  <th>{t.fleet.state}</th>
                </tr>
              </thead>
              <tbody>
                {data.rentals.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link to={`/rentals/${r.id}`} className="mono">
                        {r.number}
                      </Link>
                    </td>
                    <td>
                      <Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link>
                    </td>
                    <td className="mono">{fmtDate(r.pickedUpOn)}</td>
                    <td className="mono">{fmtDate(r.returnedOn)}</td>
                    <td className="num mono">{formatGel(r.weeklyRateTetri, { decimals: false })}</td>
                    <td>
                      <RentalBadge status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
