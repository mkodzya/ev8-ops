import { VEHICLE_POOLS, VEHICLE_STATES, daysBetween, type VehiclePool, type VehicleState } from '@ev8/shared';
import { useEffect, useMemo, useState } from 'react';
import { errorText, useLoad } from '../lib/use.js';
import { Field } from '../components/Wizard.js';
import { Drawer } from '../components/Drawer.js';
import { useSession } from '../session.js';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { todayISO } from '@ev8/shared';
import { CustomerName, Empty, Loading, PlaceText, StateBadge, Vin } from '../components/ui.js';
import { placeOf } from '../lib/place.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';

interface Vehicle {
  id: string;
  vin: string;
  model: string;
  color: string | null;
  year: number | null;
  arrivedOn: string | null;
  state: VehicleState;
  pool: VehiclePool | null;
  weeklyRateTetri: number | null;
  salePriceTetri: number | null;
  location: { id: string; name: string } | null;
  lastSeenOn: string | null;
  currentRental: { id: string; number: string; paidThrough: string | null; customer: { id: string; name: string; nameKa: string | null; nameLat: string | null } } | null;
}

interface Fleet {
  byState: Record<VehicleState, number>;
  vehicles: Vehicle[];
}

/**
 * The park a moped counts in on this screen. A moped that has left the fleet
 * belongs to neither park, and one nobody has decided on is its own answer
 * rather than the likelier of the two (ADR-0005).
 */
type PoolKey = VehiclePool | 'none' | 'gone';
const POOL_KEYS: PoolKey[] = ['rent', 'sale', 'none', 'gone'];
const poolOf = (v: Vehicle): PoolKey => (v.state === 'sold' || v.state === 'out' ? 'gone' : (v.pool ?? 'none'));

/**
 * How long this moped has been quiet: days since the last thing that happened
 * to it, or since it arrived when nothing has. A moped at a customer is not
 * quiet, it is working. Odoo dated neither the arrival nor a single event for
 * seventeen of ours, and those get null — a dash on the screen, never a zero.
 */
function quietDays(v: Vehicle, today: string): number | null {
  if (v.state === 'rented') return null;
  if (!v.lastSeenOn) return null;
  return Math.max(0, daysBetween(v.lastSeenOn, today));
}

interface Models {
  models: { id: string; brand: string; name: string; forRent: boolean }[];
}

export function FleetPage() {
  const t = useT();
  const { can } = useSession();
  const [data, setData] = useState<Fleet | null>(null);
  const [tick, setTick] = useState(0);
  const models = useLoad<Models>(can('settings.manage') ? '/api/models' : null);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const state = params.get('state') as VehicleState | null;
  const pool = params.get('pool') as PoolKey | null;
  const noPoint = params.get('place') === 'unset';

  useEffect(() => {
    void api.get<Fleet>('/api/fleet').then(setData);
  }, [tick]);

  // Both counts are worked out from the rows already on the screen, so the
  // state counters mean "inside this park" the moment a park is chosen —
  // a segment reading 29 next to a list of two would be a lie.
  const byPool = useMemo(() => {
    const n: Record<PoolKey, number> = { rent: 0, sale: 0, none: 0, gone: 0 };
    for (const v of data?.vehicles ?? []) n[poolOf(v)]++;
    return n;
  }, [data]);
  const inPool = useMemo(() => (data ? data.vehicles.filter((v) => !pool || poolOf(v) === pool) : []), [data, pool]);
  const byState = useMemo(() => {
    const n = Object.fromEntries(VEHICLE_STATES.map((st) => [st, 0])) as Record<VehicleState, number>;
    for (const v of inPool) n[v.state]++;
    return n;
  }, [inPool]);
  const unplaced = useMemo(() => inPool.filter((v) => placeOf(v).kind === 'unset').length, [inPool]);

  // Longest silence on top: the list is a queue of decisions, not a register.
  // A moped with no date to count from sinks to the bottom rather than posing
  // as the freshest thing in the yard.
  const today = todayISO();
  const rows = useMemo(() => {
    const needle = q.trim().toUpperCase();
    return inPool
      .filter(
        (v) =>
          (!state || v.state === state) &&
          (!noPoint || placeOf(v).kind === 'unset') &&
          (!needle || v.vin.endsWith(needle) || v.vin.includes(needle)),
      )
      .slice()
      .sort((a, b) => (quietDays(b, today) ?? -1) - (quietDays(a, today) ?? -1));
  }, [inPool, state, noPoint, q, today]);

  // One filter at a time below the park: a card is either the state it names
  // or the mopeds nobody has placed, and clicking the one that is already on
  // turns it off. Two of them at once would ask a question no card answers.
  const pick = (next: { pool?: PoolKey | null; state?: VehicleState | null; noPoint?: boolean }) => {
    const p = 'pool' in next ? next.pool : pool;
    const st = 'state' in next ? next.state : 'noPoint' in next ? null : state;
    const np = 'noPoint' in next ? next.noPoint : 'state' in next ? false : noPoint;
    setParams({ ...(p ? { pool: p } : {}), ...(st ? { state: st } : {}), ...(np ? { place: 'unset' } : {}) });
  };

  if (!data) return <Loading />;

  return (
    <>
      <header className="page-head">
        <h1>{t.fleet.title}</h1>
        <span className="muted">{t.fleet.count(data.vehicles.length)}</span>
        <span className="spacer" />
        {/* Search is a field, not a band: it belongs beside the title, where
            it costs no row of its own. */}
        <input className="input input-search mono" placeholder={t.fleet.searchHint} value={q} onChange={(e) => setQ(e.target.value)} />
        {can('settings.manage') && models.data && (
          <NewVehicle models={models.data.models} onDone={() => setTick((n) => n + 1)} />
        )}
      </header>
      <div className="segments">
        {/* What a moped is for comes first: it splits the fleet into two
            businesses, and the state only means something inside one of
            them (ADR-0005). */}
        <div className="seg-row seg-pools">
          <button type="button" className={`seg seg-pool ${!pool ? 'on' : ''}`} onClick={() => pick({ pool: null, state: null })}>
            <span className="seg-lbl">{t.common.all}</span>
            <span className="seg-num">{data.vehicles.length}</span>
          </button>
          {POOL_KEYS.map((k) => (
            <button key={k} type="button" className={`seg seg-pool seg-pool-${k} ${pool === k ? 'on' : ''}`} onClick={() => pick({ pool: k, state: null })}>
              <span className="seg-lbl">{t.pools[k]}</span>
              <span className="seg-num">{byPool[k]}</span>
            </button>
          ))}
        </div>
      </div>
      {/* The cards are the state breakdown of the park, so they are the state
          filter as well: a number, the filter it stands for, and what it costs
          or brings underneath. A second row of pills would say this twice. */}
      <PoolCards pool={pool} rows={inPool} state={state} noPoint={noPoint} unplaced={unplaced} byState={byState} pick={pick} />
      {rows.length === 0 ? (
        <Empty text={t.fleet.empty} />
      ) : (
        /* One markup, two shapes: a list a thumb can read on a phone, and the
           same rows as a table from 900 px up, where a laptop wants columns
           (U3). Rendering it twice would be two things to keep in step. */
        <ul className="vlist">
          {/* Seven columns, not eleven. Year and arrival are card facts; the
              renter is the answer to "where", not a column beside it; and
              "paid through" belongs under the name it is about. */}
          <li className="vlist-head" aria-hidden="true">
            <span>{t.fleet.vin}</span>
            <span>{t.fleet.model}</span>
            <span>{t.fleet.color}</span>
            <span>{t.fleet.state}</span>
            <span>{t.fleet.where}</span>
            <span className="num">{t.fleet.quiet}</span>
            <span />
          </li>
          {rows.map((v) => (
            /* Source order is the laptop's column order; the phone re-lays
               them out by name with grid-template-areas, so neither shape
               depends on the other. */
            <li key={v.id} className="vrow">
              <Link to={`/fleet/${v.id}`} className="v-vin">
                <Vin vin={v.vin} />
              </Link>
              <span className="v-model">{v.model}</span>
              <span className="v-color">{v.color ?? t.common.dash}</span>
              <span className="v-state">
                <StateBadge state={v.state} />
                {/* Inside a park every row would repeat its name; only the
                    mixed list needs to say which is which. */}
                {!pool && <span className="v-pool">{t.pools[poolOf(v)]}</span>}
              </span>
              <span className="v-where">
                {v.currentRental ? (
                  <Link to={`/customers/${v.currentRental.customer.id}`}>
                    <CustomerName of={v.currentRental.customer} second={false} />
                  </Link>
                ) : (
                  <PlaceText of={v} />
                )}
                {v.currentRental && (
                  <span className="v-paid mono">
                    {t.fleet.paidThrough}: {fmtDate(v.currentRental.paidThrough)}
                  </span>
                )}
              </span>
              <Quiet v={v} today={today} />
              <MoveChips v={v} can={can('fleet.pool.set')} onDone={() => setTick((n) => n + 1)} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}


/** Days of silence, loud once they run past half a year. */
function Quiet({ v, today }: { v: Vehicle; today: string }) {
  const t = useT();
  const n = quietDays(v, today);
  if (n == null) return <span className="v-quiet mono muted">{t.common.dash}</span>;
  return <span className={`v-quiet mono ${n > 180 ? 'v-loud' : ''}`}>{t.fleet.quietDays(n)}</span>;
}

/**
 * The one move this row is waiting for. A moped in a park offers the other
 * park; one in neither offers both; one that has left the fleet offers
 * nothing, because its park is no longer our question.
 */
function MoveChips({ v, can, onDone }: { v: Vehicle; can: boolean; onDone: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const where = poolOf(v);
  if (!can || where === 'gone') return <span className="v-move" />;
  const offer = where === 'none' ? VEHICLE_POOLS : VEHICLE_POOLS.filter((p) => p !== v.pool);
  const move = async (pool: VehiclePool) => {
    setBusy(true);
    try {
      await api.post(`/api/fleet/${v.id}/pool`, { pool });
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="v-move">
      {offer.map((p) => (
        <button key={p} type="button" className="mv" disabled={busy} onClick={() => void move(p)}>
          {p === 'rent' ? t.pools.toRent : t.pools.toSale}
        </button>
      ))}
    </span>
  );
}

/**
 * The park's own numbers, and the filter at the same time. Each card is a
 * state of this park with what it costs or brings under it, plus the one
 * question a state cannot answer: how many mopeds nobody has placed. Clicking
 * the card that is already on turns it off.
 */
function PoolCards({
  pool,
  rows,
  state,
  noPoint,
  unplaced,
  byState,
  pick,
}: {
  pool: PoolKey | null;
  rows: Vehicle[];
  state: VehicleState | null;
  noPoint: boolean;
  unplaced: number;
  byState: Record<VehicleState, number>;
  pick: (next: { state?: VehicleState | null; noPoint?: boolean }) => void;
}) {
  const t = useT();
  const sum = (of: Vehicle[], f: (v: Vehicle) => number | null) => of.reduce((n, v) => n + (f(v) ?? 0), 0);
  const money = (n: number) => formatGel(n, { decimals: false });
  const weekly = (st: VehicleState) => money(sum(rows.filter((v) => v.state === st), (v) => v.weeklyRateTetri));

  type Card = { key: string; n: number; label: string; sub: string; on: boolean; go: () => void; warn?: boolean };
  const forState = (st: VehicleState, label: string, sub: string): Card => ({
    key: st,
    n: byState[st],
    label,
    sub,
    on: state === st,
    go: () => pick({ state: state === st ? null : st }),
  });
  const placeCard: Card = {
    key: 'place',
    n: unplaced,
    label: t.fleet.noPoint,
    sub: t.pools.noPointSub,
    on: noPoint,
    warn: unplaced > 0,
    go: () => pick({ noPoint: !noPoint }),
  };

  let cards: Card[];
  if (pool === 'rent') {
    cards = [
      forState('rented', t.pools.outWith, t.pools.incomingSub(weekly('rented'))),
      forState('available', t.pools.free, t.pools.idleSub(weekly('available'))),
      forState('service', t.pools.inService, t.pools.notHandedOut),
      placeCard,
    ];
  } else if (pool === 'sale') {
    cards = [
      forState('available', t.pools.onShelf, t.pools.listSub(money(sum(rows, (v) => v.salePriceTetri)))),
      forState('service', t.pools.inPrep, t.pools.notShown),
      placeCard,
    ];
  } else if (pool === 'none') {
    cards = [
      forState('available', t.pools.free, t.pools.bothWays),
      forState('service', t.pools.inService, t.pools.decidedOnExit),
      placeCard,
    ];
  } else if (pool === 'gone') {
    cards = [forState('sold', t.states.sold, t.pools.goneMoney), forState('out', t.states.out, t.pools.buyBackNote)];
  } else {
    // The whole fleet. The idle money counts only what is actually rentable —
    // fifteen of the free ones are Luyuan, which never carried a weekly rate.
    cards = [
      forState('available', t.pools.free, t.pools.idleAllSub(weekly('available'))),
      forState('rented', t.pools.outWith, t.pools.incomingSub(weekly('rented'))),
      forState('service', t.pools.inService, t.pools.notHandedOut),
      placeCard,
    ];
  }
  return (
    <div className={`kpis kpis-${cards.length}`}>
      {cards.map((c) => (
        <button type="button" key={c.key} className={`kpi ${c.on ? 'on' : ''} ${c.warn && c.n > 0 ? 'kpi-warn' : ''}`} onClick={c.go}>
          <span className="k-n mono">{c.n}</span>
          <span className="k-l">{c.label}</span>
          <span className="k-s">{c.sub}</span>
        </button>
      ))}
    </div>
  );
}

/** Adding a moped by hand: the owner's way in before the Odoo import runs. */
function NewVehicle({ models, onDone }: { models: Models['models']; onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ vin: '', modelId: '', color: '', year: '', arrivedOn: todayISO() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/api/fleet', {
        vin: f.vin.trim().toUpperCase(),
        modelId: f.modelId || models[0].id,
        color: f.color || null,
        year: f.year ? Number(f.year) : null,
        arrivedOn: f.arrivedOn || null,
      });
      setF({ vin: '', modelId: '', color: '', year: '', arrivedOn: todayISO() });
      setOpen(false);
      onDone();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)} disabled={models.length === 0}>
        + {t.settings.addVehicle}
      </button>
      {open && (
        <Drawer title={t.settings.addVehicle} onClose={() => setOpen(false)}>
          <form className="form" onSubmit={submit}>
            <div className="two-col">
              <Field label={t.models.vin}>
                <input className="input mono" value={f.vin} onChange={(e) => setF({ ...f, vin: e.target.value })} required maxLength={17} autoFocus />
              </Field>
              <Field label={t.models.name}>
                <select className="input" value={f.modelId} onChange={(e) => setF({ ...f, modelId: e.target.value })}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.brand} {m.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.models.color}>
                <input className="input" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
              </Field>
              <Field label={t.models.year}>
                <input className="input input-amount mono" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} inputMode="numeric" />
              </Field>
              <Field label={t.models.arrivedOn}>
                <input className="input mono" type="date" value={f.arrivedOn} onChange={(e) => setF({ ...f, arrivedOn: e.target.value })} />
              </Field>
            </div>
            {err && <div className="hint hint-bad">{err}</div>}
            <div className="row-actions">
              <button type="button" className="pill" onClick={() => setOpen(false)}>
                {t.actions.cancel}
              </button>
              <button className="pill pill-accent" disabled={busy || f.vin.trim().length === 0}>
                {busy ? t.common.checking : t.actions.save}
              </button>
            </div>
            {/* Nobody should type in by hand what a receipt already writes:
                a purchase creates its mopeds with the date, the landed cost
                and an "arrived" event of their own. */}
            <p className="drawer-tip">
              {t.fleet.addTip} <Link to="/purchases">{t.fleet.addTipLink}</Link>
            </p>
          </form>
        </Drawer>
      )}
    </>
  );
}
