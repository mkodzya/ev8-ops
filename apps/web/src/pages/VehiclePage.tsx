import { TRANSLATED_EVENT_KINDS, VEHICLE_POOLS, isPoolEvent, localDateTime, manualStateTargets, type RentalStatus, type VehicleEventKind, type VehiclePool, type VehicleState } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { FormSheet, useFieldError } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { BlockHead, ColorText, Empty, FleetNo, Loading, PageHead, PlaceText, RentalBadge, StateBadge, Vin } from '../components/ui.js';
import { RowMenu } from '../components/RowMenu.js';
import { Field, Row } from '../components/Wizard.js';
import { fmtDate } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { kmText, leftText, spanText, type Downtime, type RepairHours, type VehicleMaintenance } from '../lib/maintenance.js';
import { ChangedFromTo, JournalNote, noteWords } from '../lib/journal.js';
import { Typed } from '../lib/typed.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { VehicleEconomics } from './EconomicsPage.js';
import { NewJob } from './ServicePage.js';
import { TrackerHistory, TrackerRows, type CardTracker } from './VehicleTracker.js';
import { formatGel } from '../format.js';

interface Card {
  vehicle: {
    id: string;
    vin: string;
    /** EV-007 (migration 0043); absent while an older API answers. */
    fleetNo?: number | null;
    model: { id: string; brand: string; name: string };
    color: string | null;
    year: number | null;
    arrivedOn: string | null;
    state: VehicleState;
    pool: VehiclePool | null;
    location: { id: string; name: string } | null;
    odometerKm: number | null;
    costTetri: number | null;
    costPreliminary: boolean;
    costPaidPercent: number | null;
    notes: string | null;
    currentRentalId: string | null;
  };
  events: { id: string; kind: VehicleEventKind; occurredOn: string; fromState: VehicleState | null; toState: VehicleState; fromPool: VehiclePool | null; toPool: VehiclePool | null; rentalId: string | null; reason: string | null; actor: string | null }[];
  serviceJobs: {
    id: string;
    number: string;
    status: 'draft' | 'open' | 'done' | 'cancelled';
    payer: 'company' | 'customer';
    reason: string;
    openedOn: string;
    closedOn: string | null;
    totalTetri: number | null;
    withheldTetri: number | null;
    /** Opening to closing in minutes (ADR-0038); empty for repairs without the times. */
    downtime?: Downtime | null;
  }[];
  /** Planned maintenance (ADR-0038); null for a moped sold, written off or archived. */
  maintenance?: VehicleMaintenance | null;
  /** Downtime of its repairs over the last 30 days. */
  downtime30?: RepairHours;
  rentals: {
    id: string;
    number: string;
    status: RentalStatus;
    customer: { id: string; name: string };
    pickedUpOn: string | null;
    returnedOn: string | null;
    paidThrough: string | null;
    weeklyRateTetri: number;
    /** This moped's part of a rental a swap went through (ADR-0040); null — the rental had no other moped. */
    withThisMoped?: { from: string; to: string | null; swappedIn: boolean; swappedOut: boolean } | null;
  }[];
  /** The tracker on it and the ones it had (ADR-0036); empty to whoever may not read an IMEI. */
  trackers?: CardTracker[] | null;
  /** What was taken off this moped for another, as a donor (ADR-0036). */
  donated?: { id: string; name: string; qty: number; on: string; job: { id: string; number: string }; to: { id: string; number: string | null; vin: string } }[];
  /** Corrections: what was changed by hand, from what to what, and why. */
  journal: { id: string; at: string; occurredOn: string | null; action: string; by: string | null; note: string | null; before: unknown; after: unknown }[];
}

/**
 * Is this event's reason a person's words about the moped, the kind that is
 * shown translated (ADR-0042)? Not a rental's — a pickup, a return, a swap —
 * and not a sale's or an arrival's.
 */
const typedEvent = (e: { kind: VehicleEventKind; rentalId: string | null }): boolean => e.rentalId == null && (TRANSLATED_EVENT_KINDS as readonly string[]).includes(e.kind);

export function VehiclePage() {
  const { id } = useParams();
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<Card>(id ? `/api/fleet/${id}` : null);
  // The state sheet, open or not; «Вернуть в парк» opens it on «Свободен».
  const [stateSheet, setStateSheet] = useState<{ prefer?: VehicleState } | null>(null);
  const [fixing, setFixing] = useState(false);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const v = data.vehicle;
  const current = data.rentals.find((r) => r.id === v.currentRentalId) ?? null;
  const locked = v.state === 'rented' && !!v.currentRentalId;
  // What the sheet may offer — the rule the server refuses by (21.10.2026).
  // Empty for a moped out on a rental and for a sold one: nothing to open.
  const targets = manualStateTargets(v.state, { mayWriteOff: can('deposit.decide'), hasRental: !!v.currentRentalId });
  const openJob = data.serviceJobs.find((j) => j.status === 'open') ?? null;

  // One action, and which one depends on where the moped is (U4). A card
  // that offers every verb makes the reader pick; a card that offers the
  // next one makes the state readable from the button alone. A free moped of
  // the sale park waits to be sold, so selling is its next step; renting it
  // out moves it to the other park, which is an owner's decision, and steps
  // back to a plain pill (21.10.2026). A manager gets no button here: the
  // hand-over would refuse him (`vehicle_in_sale_pool`).
  const forSale = v.state === 'available' && v.pool === 'sale';
  const primary: { label: string; to?: string; onClick?: () => void } | null =
    forSale
      ? can('sales.manage')
        ? { label: t.sales.newSale, to: `/sales/new?vehicle=${v.id}` }
        : null
      : v.state === 'available' && can('rental.create')
      ? { label: t.actions.newRental, to: `/rentals/new?vehicle=${v.id}` }
      : v.state === 'rented' && current && can('rental.return')
        ? { label: t.actions.returnRental, to: `/rentals/${current.id}/return` }
        : v.state === 'service' && openJob && can('service.manage')
          ? { label: t.vehicle.backToFleet, to: `/service/${openJob.id}` }
          : v.state === 'service' && can('fleet.state.manual')
            ? {
                label: t.vehicle.backToFleet,
                onClick: () => setStateSheet({ prefer: 'available' }),
              }
            : null;

  return (
    <>
      {/* The number people say and the sticker carries; the VIN goes to the card below (Mika, 15.10.2026). */}
      <PageHead wrap title={v.fleetNo ? <FleetNo n={v.fleetNo} /> : <Vin vin={v.vin} />} badge={<StateBadge state={v.state} />} sub={<Link to={`/fleet/models/${v.model.id}`}>{`${v.model.brand} ${v.model.name}`}</Link>}>
        {can('fleet.state.manual') && (
          <button
            type="button"
            className="pill pill-sm"
            onClick={() => setStateSheet({})}
            disabled={targets.length === 0}
            title={locked ? t.vehicle.rentedLock : v.state === 'sold' ? t.vehicleW4.soldNote : undefined}
          >
            {t.actions.changeState}
          </button>
        )}
        {can('service.report') && v.state !== 'sold' && v.state !== 'out' && !data.serviceJobs.some((j) => j.status === 'open') && (
          <NewJob vehicleId={v.id} onDone={reload} />
        )}
        {/* Selling starts from the moped as often as from the "+" (§3.1); on a
            moped for sale the two trade places with the main button. */}
        {v.state === 'available' && !forSale && can('sales.manage') && (
          <Link className="pill pill-sm" to={`/sales/new?vehicle=${v.id}`}>
            {t.sell.title}
          </Link>
        )}
        {forSale && can('rental.create') && can('fleet.pool.set') && (
          <Link className="pill pill-sm" to={`/rentals/new?vehicle=${v.id}`}>
            {t.actions.newRental}
          </Link>
        )}
        {can('settings.manage') && <RowMenu actions={[{ key: 'vin', label: t.vinFix.title, onPick: () => setFixing(true) }]} />}
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

      {fixing && (
        <VinSheet
          id={v.id}
          vin={v.vin}
          onClose={() => setFixing(false)}
          onDone={() => {
            setFixing(false);
            reload();
          }}
        />
      )}

      {stateSheet && <StateSheet v={v} targets={targets} prefer={stateSheet.prefer} onClose={() => setStateSheet(null)} onDone={reload} />}

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
          {/* The model was only ever in the header's subtitle, and on a phone
              that line gives way to the VIN — so the card could not answer
              "what is this moped" at all (QA-W5-27). It is the second thing
              anybody asks after the VIN, so it belongs in the card itself. */}
          {v.fleetNo != null && <Row k={t.fleet.vin} v={<Vin vin={v.vin} />} />}
          <Row k={t.fleet.model} v={<Link to={`/fleet/models/${v.model.id}`}>{`${v.model.brand} ${v.model.name}`}</Link>} />
          <Row k={t.fleet.color} v={v.color ? <ColorText of={v.color} named /> : t.common.dash} />
          <Row k={t.fleet.year} v={<span className="mono">{v.year ?? t.common.dash}</span>} />
          <Row k={t.fleet.arrived} v={<span className="mono">{fmtDate(v.arrivedOn)}</span>} />
          <Row k={t.fleet.pool} v={<PoolRow v={v} onDone={reload} />} />
          <Row k={t.points.place} v={<PlaceRow v={v} onDone={reload} />} />
          <Row k={t.vehicle.odometer} v={<span className="mono">{v.odometerKm ?? t.common.dash}</span>} />
          {/* The tracker's IMEI and SIM: the owners' (ADR-0036 §7), written here without a repair (addendum 21.10.2026). */}
          {data.trackers && <TrackerRows v={v} trackers={data.trackers} onDone={reload} />}
          {v.costTetri != null && (
            <Row
              k={t.purchases.cost}
              v={
                <>
                  <span className="mono">
                    {v.costPreliminary && <span className="muted">≈ </span>}
                    {formatGel(v.costTetri)}
                  </span>
                  {/* A figure worked out at a share of an unpaid invoice says so (§7). */}
                  {v.costPreliminary && v.costPaidPercent != null && (
                    <span className="hint warn-text">{t.receipt.costPreliminary(v.costPaidPercent)}</span>
                  )}
                </>
              }
            />
          )}
          <Row
            k={t.fleet.renter}
            v={current ? <Link to={`/customers/${current.customer.id}`}>{current.customer.name}</Link> : t.common.dash}
          />
          <Row k={t.fleet.paidThrough} v={<span className="mono">{current ? fmtDate(current.paidThrough) : t.common.dash}</span>} />
          {v.notes && (
            <Row
              k={t.vehicle.notes}
              v={
                <span className="pre">
                  <Typed text={v.notes} />
                </span>
              }
            />
          )}
        </section>

        <section className="card">
          <BlockHead title={t.vehicle.history} sub={t.vehicle.eventsCount(data.events.length + data.journal.length)} />
          {data.events.length === 0 && data.journal.length === 0 ? (
            <Empty text={t.common.dash} />
          ) : (
            <ul className="timeline">
              {/* What was corrected by hand belongs in the same history as
                  what happened to the moped (crit. 32, QA-W5-01). */}
              {data.journal.map((l) => (
                <li key={l.id}>
                  <span className="mono muted">{fmtDate(l.occurredOn)}</span>
                  <span>
                    {t.feedWords[l.action] ?? l.action}
                    <ChangedFromTo before={l.before} after={l.after} />
                    {noteWords(t, l.note) && (
                      <span className="muted">
                        {' · '}
                        <JournalNote note={l.note} />
                      </span>
                    )}
                    {l.by && <span className="muted"> · {l.by}</span>}
                  </span>
                </li>
              ))}
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
                    {e.reason && (
                      <span className="muted">
                        {' · '}
                        {/* A state change's reason in the reader's language (ADR-0042); a rental's, a sale's or an arrival's stays as written. */}
                        {typedEvent(e) ? <Typed text={e.reason} /> : e.reason}
                      </span>
                    )}
                    {e.actor && <span className="muted"> · {e.actor}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {data.maintenance && <MaintenanceCard m={data.maintenance} />}

      {can('reports.view') && <VehicleEconomics vehicleId={data.vehicle.id} />}

      <section className="card">
        <BlockHead
          title={t.service.history}
          sub={
            data.downtime30 && data.downtime30.counted > 0
              ? `${t.service.jobsCount(data.serviceJobs.length)} · ${t.wmaint.period30(spanText(data.downtime30.minutes, t, locale))}`
              : t.service.jobsCount(data.serviceJobs.length)
          }
        />
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
                  <Typed text={j.reason} /> <span className="muted">· {t.service.payers[j.payer]}</span>
                  {/* What it cost is the owners' (ADR-0033 §4). */}
                  {j.totalTetri != null && <span className="muted"> · {formatGel(j.totalTetri)}</span>}
                  {/* A repair waiting for approval has no word among the old statuses: the repairs' own says it. */}
                  <span className={j.status === 'open' || j.status === 'draft' ? 'warn-text' : 'muted'}> · {j.status === 'draft' ? t.repair.statuses.draft : t.service.statuses[j.status]}</span>
                  {/* Downtime in hours where the repair kept its times (ADR-0038). */}
                  {j.downtime && <span className="muted mono"> · {spanText(j.downtime.minutes, t, locale)}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data.trackers && <TrackerHistory trackers={data.trackers} />}
      {(data.donated?.length ?? 0) > 0 && (
        <section className="card">
          <BlockHead title={t.wparts.donatedBlock} sub={t.wparts.lines(data.donated!.length)} />
          <ul className="timeline">
            {data.donated!.map((d) => (
              <li key={d.id}>
                <span className="mono muted">{fmtDate(d.on)}</span>
                <span>
                  {d.name} × {d.qty} →{' '}
                  <Link to={`/fleet/${d.to.id}`} className="mono">
                    {d.to.number ?? `···${d.to.vin.slice(-6)}`}
                  </Link>{' '}
                  ·{' '}
                  <Link to={`/service/${d.job.id}`} className="mono">
                    {d.job.number}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

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
                    {/* With this moped: after a swap, from and to the swap's day, and so marked (ADR-0040). */}
                    <td className="mono">
                      {fmtDate(r.withThisMoped ? r.withThisMoped.from : r.pickedUpOn)}
                      {r.withThisMoped?.swappedIn && <span className="muted"> · {t.swap.mark}</span>}
                    </td>
                    <td className="mono">
                      {fmtDate(r.withThisMoped ? r.withThisMoped.to : r.returnedOn)}
                      {r.withThisMoped?.swappedOut && <span className="muted"> · {t.swap.mark}</span>}
                    </td>
                    <td className="num mono">{formatGel(r.weeklyRateTetri, { decimals: false })}</td>
                    <td>{r.withThisMoped?.swappedOut ? <span className="muted">{t.swap.changed}</span> : <RentalBadge status={r.status} />}</td>
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
function PlaceRow({ v, onDone }: { v: Card['vehicle']; onDone: () => void }) {
  const t = useT();
  const { can } = useSession();
  const toast = useToast();
  const editable = can('fleet.location.set') && v.state !== 'rented' && v.state !== 'sold' && v.state !== 'out';
  const points = useLoad<{ locations: { id: string; name: string }[] }>(editable ? '/api/locations' : null);
  const op = useOperation();

  if (!editable || !points.data || points.data.locations.length === 0) {
    return (
      <>
        <PlaceText of={v} />
        {v.state === 'rented' && <div className="hint">{t.points.rented}</div>}
      </>
    );
  }
  const set = async (locationId: string) => {
    const res = await op.run((key) => api.post(`/api/fleet/${v.id}/location`, { locationId: locationId || null }, { key }), locationId);
    if (!res.ok) return;
    toast({ text: t.points.placeSaved });
    onDone();
  };
  return (
    <>
      <select className="input input-inline" value={v.location?.id ?? ''} disabled={op.state === 'busy'} onChange={(e) => void set(e.target.value)}>
        <option value="">{t.points.unset}</option>
        {points.data.locations.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      {op.failure && <div className="field-err">{op.failure.text}</div>}
    </>
  );
}

/**
 * A moped's state by hand (FLT-03, wave 4 §3.6): the state it is in now, then
 * the ones it may go to — the list the server accepts (manualStateTargets),
 * so nothing is offered only to be refused. Each opening starts afresh on the
 * first state on offer: a sheet that kept the last choice once held the state
 * the moped had just been moved to, lit nowhere, and sent it (21.10.2026).
 */
function StateSheet({ v, targets, prefer, onClose, onDone }: { v: Card['vehicle']; targets: VehicleState[]; prefer?: VehicleState; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const first = prefer && targets.includes(prefer) ? prefer : (targets[0] ?? null);
  const [move, setMove] = useState<{ toState: VehicleState | null; reason: string }>({ toState: first, reason: '' });
  // Writing a moped off is the one state change that is confirmed as well as explained (crit. 26).
  const [writeOff, setWriteOff] = useState(false);
  // A choice the list no longer holds — the card reloaded under the sheet — is no choice at all.
  const toState = move.toState && targets.includes(move.toState) ? move.toState : null;
  return (
    <FormSheet
      title={t.actions.changeState}
      onClose={onClose}
      value={move}
      initial={{ toState: move.toState, reason: '' }}
      label={t.vehicle.changeStateCta}
      // The server's «already in this state» is about the choice, so it stands under it.
      fieldOf={{ same_state: 'toState' }}
      submit={async (key) => {
        // A refusal the screen makes itself brings its own words to the
        // box it is about: a code the error dictionary has never heard of
        // would otherwise read as «Не получилось» (QA-W4-10).
        if (!toState) throw new ApiError(400, 'missing_field', 'No state is chosen.', { field: 'toState' });
        if (toState === 'out' && !writeOff) {
          throw new ApiError(400, 'missing_field', 'Write-off is not confirmed.', { field: 'writeOff', fieldText: t.vehicleW4.writeOffAsk });
        }
        await api.post(`/api/fleet/${v.id}/state`, { toState, reason: move.reason }, { key });
        return { toast: { text: t.vehicle.stateChanged(t.states[toState]) } };
      }}
      onDone={onDone}
    >
      <StatePick now={v.state} targets={targets} value={toState} onPick={(s) => setMove({ ...move, toState: s })} />
      {toState === 'out' && (
        <Field label={t.vehicleW4.writeOffTitle} name="writeOff">
          <label className="check">
            <input type="checkbox" checked={writeOff} onChange={(e) => setWriteOff(e.target.checked)} />
            <span>{t.vehicleW4.writeOffConfirm}</span>
          </label>
        </Field>
      )}
      <Field label={t.vehicle.reason} hint={t.vehicle.reasonHint} name="reason">
        <input className="input" value={move.reason} onChange={(e) => setMove({ ...move, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/**
 * «◆ В сервисе · сейчас → [Свободен] [Списан]» (variant A, Mika 21.10.2026).
 * The state it is in is the same badge as in the head of the card and in the
 * list (ux.md, principle 9), and it is not a button: it is never a choice. A
 * plain block rather than a <Field>, whose <label> would hand a tap on the
 * badge to the first pill. Sold and rented are never on offer; the line
 * under the pills says why.
 */
function StatePick({ now, targets, value, onPick }: { now: VehicleState; targets: VehicleState[]; value: VehicleState | null; onPick: (s: VehicleState) => void }) {
  const t = useT();
  const error = useFieldError('toState');
  return (
    <div className={`field ${error ? 'field-bad' : ''}`} data-field="toState">
      <span className="lbl">{t.fleet.state}</span>
      <div className="state-pick">
        <span className="state-now" aria-current="true">
          <StateBadge state={now} />
          <span className="muted">{t.stateSheet.now}</span>
        </span>
        <span className="state-to">
          <span className="muted" aria-hidden="true">
            →
          </span>
          <span className="chips" role="radiogroup" aria-label={t.vehicle.toState}>
            {targets.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={value === s} className={`pill pill-sm ${value === s ? 'on' : ''}`} onClick={() => onPick(s)}>
                {t.states[s]}
              </button>
            ))}
          </span>
        </span>
      </div>
      {error ? <span className="field-err">{error}</span> : <span className="hint muted">{t.vehicleW4.soldNote}</span>}
    </div>
  );
}

/**
 * Which park this moped is in, and the one click that moves it to the other.
 * A moped that has left the fleet is in neither, and says so; deciding what a
 * sold moped is for would be a decision about somebody else's property.
 */
function PoolRow({ v, onDone }: { v: Card['vehicle']; onDone: () => void }) {
  const t = useT();
  const { can } = useSession();
  const toast = useToast();
  const op = useOperation();
  const gone = v.state === 'sold' || v.state === 'out';
  if (gone) return <span className="muted">{t.pools.gone}</span>;
  if (!can('fleet.pool.set')) return <span>{v.pool ? t.pools[v.pool] : <span className="place-unset">{t.pools.none}</span>}</span>;
  const move = async (pool: VehiclePool) => {
    const res = await op.run((key) => api.post(`/api/fleet/${v.id}/pool`, { pool }, { key }), pool);
    if (!res.ok) return;
    // A move between parks is taken back with one tap for ten seconds (wave 1 §3.7).
    toast({
      text: t.pools.moved(t.pools[pool]),
      undo: async () => {
        await api.post(`/api/fleet/${v.id}/pool/undo`, {});
        onDone();
      },
    });
    onDone();
  };
  return (
    <>
      <div className="chips">
        {VEHICLE_POOLS.map((p) => (
          <button key={p} type="button" className={`pill pill-sm ${v.pool === p ? 'on' : ''}`} disabled={op.state === 'busy'} onClick={() => void move(p)}>
            {t.pools[p]}
          </button>
        ))}
        {!v.pool && <span className="place-unset">{t.pools.none}</span>}
      </div>
      {op.failure && <div className="field-err">{op.failure.text}</div>}
      {v.state === 'rented' && <div className="hint">{t.pools.rentedNote}</div>}
    </>
  );
}

/**
 * A VIN typed wrong (wave 5 §3.9, crit. 32). Only an owner, always with a
 * reason; the moped is the same moped and its history does not move.
 */
function VinSheet({ id, vin, onClose, onDone }: { id: string; vin: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { vin, reason: '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={t.vinFix.title}
      onClose={onClose}
      value={f}
      initial={initial}
      onRestore={setF}
      label={t.vinFix.save}
      submit={async (key) => {
        await api.patch(`/api/fleet/${id}/vin`, { vin: f.vin.trim(), reason: f.reason.trim() }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onDone}
    >
      <Field label={t.vinFix.vin} hint={t.vinFix.hint} name="vin">
        <input className="input mono" value={f.vin} onChange={(e) => setF({ ...f, vin: e.target.value.toUpperCase() })} />
      </Field>
      <Field label={t.vinFix.reason} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/**
 * Planned maintenance of the moped (ADR-0038): what is left to the mark, the
 * mark, and where the mileage came from; a moped with no mileage written in
 * EV8 Ops says so instead of guessing.
 */
function MaintenanceCard({ m }: { m: VehicleMaintenance }) {
  const t = useT();
  const tone = m.state === 'overdue' ? 'crit-text' : m.state === 'soon' ? 'warn-text' : 'muted';
  return (
    <section className="card">
      <BlockHead title={t.wmaint.block} sub={<span className={tone}>{t.wmaint.states[m.state]}</span>} />
      {m.state === 'unknown' || m.dueKm == null || m.currentKm == null ? (
        <p className="hint muted">{t.wmaint.noMileage}</p>
      ) : (
        <>
          <p className={`t-money ${m.state === 'overdue' ? 'crit-text' : ''}`}>{leftText(m, t)}</p>
          <p className="hint">
            {t.wmaint.next(kmText(m.dueKm))} · {t.wmaint.mileageFrom(kmText(m.currentKm), t.wmaint.sources[m.readingSource ?? ''] ?? '', m.currentAt ? localDateTime(m.currentAt).date : '')}
          </p>
          <p className="hint muted">
            {m.lastPlanned ? (
              <>
                <Link to={`/service/${m.lastPlanned.jobId}`} className="mono">
                  {m.lastPlanned.number}
                </Link>{' '}
                {t.wmaint.lastPlannedAt(kmText(m.lastPlanned.km), fmtDate(m.lastPlanned.closedOn))}
              </>
            ) : (
              t.wmaint.firstMark
            )}
          </p>
          {m.openPlanned && (
            <p className="hint">
              <Link to={`/service/${m.openPlanned.jobId}`}>{t.wmaint.underway(m.openPlanned.number)}</Link>
            </p>
          )}
        </>
      )}
    </section>
  );
}
