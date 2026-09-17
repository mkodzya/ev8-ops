import { VEHICLE_POOLS, VEHICLE_STATES, isPoolEvent, type RentalStatus, type VehicleEventKind, type VehiclePool, type VehicleState } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Drawer } from '../components/Drawer.js';
import { BlockHead, ColorText, Empty, Loading, PageHead, PlaceText, RentalBadge, StateBadge, Vin } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { VehicleEconomics } from './EconomicsPage.js';
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
    pool: VehiclePool | null;
    location: { id: string; name: string } | null;
    odometerKm: number | null;
    costTetri: number | null;
    notes: string | null;
    currentRentalId: string | null;
  };
  events: { id: string; kind: VehicleEventKind; occurredOn: string; fromState: VehicleState | null; toState: VehicleState; fromPool: VehiclePool | null; toPool: VehiclePool | null; rentalId: string | null; reason: string | null; actor: string | null }[];
  serviceJobs: { id: string; number: string; status: 'open' | 'done' | 'cancelled'; payer: 'company' | 'customer'; reason: string; openedOn: string; closedOn: string | null; totalTetri: number; withheldTetri: number }[];
  rentals: { id: string; number: string; status: RentalStatus; customer: { id: string; name: string }; pickedUpOn: string | null; returnedOn: string | null; paidThrough: string | null; weeklyRateTetri: number }[];
}

export function VehiclePage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<Card>(id ? `/api/fleet/${id}` : null);
  const [open, setOpen] = useState(false);
  const [toState, setToState] = useState<VehicleState>('service');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const v = data.vehicle;
  const current = data.rentals.find((r) => r.id === v.currentRentalId) ?? null;
  const locked = v.state === 'rented' && !!v.currentRentalId;
  const openJob = data.serviceJobs.find((j) => j.status === 'open') ?? null;

  // One action, and which one depends on where the moped is (U4). A card
  // that offers every verb makes the reader pick; a card that offers the
  // next one makes the state readable from the button alone.
  const primary: { label: string; to?: string; onClick?: () => void } | null =
    v.state === 'available' && can('rental.create')
      ? { label: t.actions.newRental, to: `/rentals/new?vehicle=${v.id}` }
      : v.state === 'rented' && current && can('rental.return')
        ? { label: t.actions.returnRental, to: `/rentals/${current.id}/return` }
        : v.state === 'service' && openJob && can('service.manage')
          ? { label: t.vehicle.backToFleet, to: `/service/${openJob.id}` }
          : v.state === 'service' && can('fleet.state.manual')
            ? {
                label: t.vehicle.backToFleet,
                onClick: () => {
                  setToState('available');
                  setOpen(true);
                },
              }
            : null;

  const closeMove = () => {
    setOpen(false);
    setErr(null);
  };

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
      <PageHead wrap title={<Vin vin={v.vin} />} badge={<StateBadge state={v.state} />} sub={<Link to={`/fleet/models/${v.model.id}`}>{`${v.model.brand} ${v.model.name}`}</Link>}>
        {can('fleet.state.manual') && (
          <button type="button" className="pill pill-sm" onClick={() => setOpen(true)} disabled={locked} title={locked ? t.vehicle.rentedLock : undefined}>
            {t.actions.changeState}
          </button>
        )}
        {can('service.manage') && v.state !== 'sold' && v.state !== 'out' && !data.serviceJobs.some((j) => j.status === 'open') && (
          <NewJob vehicleId={v.id} onDone={reload} onError={setErr} />
        )}
        {primary &&
          (primary.to ? (
            <Link className="pill pill-sm pill-accent head-primary" to={primary.to}>
              {primary.label}
            </Link>
          ) : (
            <button type="button" className="pill pill-sm pill-accent head-primary" onClick={primary.onClick}>
              {primary.label}
            </button>
          ))}
      </PageHead>
      {err && !open && <div className="hint hint-bad">{err}</div>}

      {open && (
        <Drawer title={t.actions.changeState} onClose={closeMove}>
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
            <button type="button" className="pill" onClick={closeMove}>
              {t.actions.cancel}
            </button>
            <button type="button" className="pill pill-accent" disabled={!reason.trim() || busy} onClick={move}>
              {t.actions.confirm}
            </button>
          </div>
        </Drawer>
      )}

      {/* On a phone the one action lives at the bottom, over the tab bar,
          where a thumb already is (ux.md, principle 2). */}
      {primary && (
        <div className="page-actions">
          {primary.to ? (
            <Link className="pill pill-accent pill-wide" to={primary.to}>
              {primary.label}
            </Link>
          ) : (
            <button type="button" className="pill pill-accent pill-wide" onClick={primary.onClick}>
              {primary.label}
            </button>
          )}
        </div>
      )}

      <div className="two-col">
        <section className="card">
          <Row k={t.fleet.color} v={v.color ? <ColorText of={v.color} named /> : t.common.dash} />
          <Row k={t.fleet.year} v={<span className="mono">{v.year ?? t.common.dash}</span>} />
          <Row k={t.fleet.arrived} v={<span className="mono">{fmtDate(v.arrivedOn)}</span>} />
          <Row k={t.fleet.pool} v={<PoolRow v={v} onDone={reload} onError={setErr} />} />
          <Row k={t.points.place} v={<PlaceRow v={v} onDone={reload} onError={setErr} />} />
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
          <BlockHead title={t.vehicle.history} sub={t.vehicle.eventsCount(data.events.length)} />
          {data.events.length === 0 ? (
            <Empty text={t.common.dash} />
          ) : (
            <ul className="timeline">
              {data.events.map((e) => (
                <li key={e.id}>
                  <span className="mono muted">{fmtDate(e.occurredOn)}</span>
                  <span>
                    {t.vehicle.events[e.kind]}{' '}
                    {isPoolEvent(e.kind) ? <span className="pool-mark">{e.toPool ? t.pools[e.toPool] : t.common.dash}</span> : <StateBadge state={e.toState} />}
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

      {can('reports.view') && <VehicleEconomics vehicleId={data.vehicle.id} />}

      <section className="card">
        <BlockHead title={t.service.history} sub={t.service.jobsCount(data.serviceJobs.length)} />
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
        <BlockHead title={t.vehicle.rentalsOf} sub={t.rentals.count(data.rentals.length)} />
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

/**
 * Where this moped stands. Kardu and the mechanic may answer it, the owner
 * names the places — so the row is a picker for whoever can move a moped and
 * a plain sentence for everyone else. A moped out on rent has no point to
 * choose: it is at its customer until it comes back.
 */
function PlaceRow({ v, onDone, onError }: { v: Card['vehicle']; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const { can } = useSession();
  const editable = can('fleet.location.set') && v.state !== 'rented' && v.state !== 'sold' && v.state !== 'out';
  const points = useLoad<{ locations: { id: string; name: string }[] }>(editable ? '/api/locations' : null);
  const [busy, setBusy] = useState(false);

  if (!editable || !points.data || points.data.locations.length === 0) {
    return (
      <>
        <PlaceText of={v} />
        {v.state === 'rented' && <div className="hint">{t.points.rented}</div>}
      </>
    );
  }
  const set = async (locationId: string) => {
    setBusy(true);
    try {
      await api.post(`/api/fleet/${v.id}/location`, { locationId: locationId || null });
      onDone();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <select className="input input-inline" value={v.location?.id ?? ''} disabled={busy} onChange={(e) => void set(e.target.value)}>
      <option value="">{t.points.unset}</option>
      {points.data.locations.map((l) => (
        <option key={l.id} value={l.id}>
          {l.name}
        </option>
      ))}
    </select>
  );
}

/**
 * Which park this moped is in, and the one click that moves it to the other.
 * A moped that has left the fleet is in neither, and says so; deciding what a
 * sold moped is for would be a decision about somebody else's property.
 */
function PoolRow({ v, onDone, onError }: { v: Card['vehicle']; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const { can } = useSession();
  const [busy, setBusy] = useState(false);
  const gone = v.state === 'sold' || v.state === 'out';
  if (gone) return <span className="muted">{t.pools.gone}</span>;
  if (!can('fleet.pool.set')) return <span>{v.pool ? t.pools[v.pool] : <span className="place-unset">{t.pools.none}</span>}</span>;
  const move = async (pool: VehiclePool) => {
    setBusy(true);
    try {
      await api.post(`/api/fleet/${v.id}/pool`, { pool });
      onDone();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="chips">
        {VEHICLE_POOLS.map((p) => (
          <button key={p} type="button" className={`pill pill-sm ${v.pool === p ? 'on' : ''}`} disabled={busy} onClick={() => void move(p)}>
            {t.pools[p]}
          </button>
        ))}
        {!v.pool && <span className="place-unset">{t.pools.none}</span>}
      </div>
      {v.state === 'rented' && <div className="hint">{t.pools.rentedNote}</div>}
    </>
  );
}
