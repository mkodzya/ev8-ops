import { VEHICLE_COLORS, VEHICLE_POOLS, VEHICLE_STATES, colorOf, daysBetween, tokens, type VehiclePool, type VehicleState } from '@ev8/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useLoad } from '../lib/use.js';
import { LoadError } from '../components/LoadError.js';
import { Field } from '../components/Wizard.js';
import { FormSheet } from '../ds/form/Form.js';
import { ColorPicker } from '../components/ColorPicker.js';
import { ModelDrawer, NEW_MODEL } from '../components/ModelDrawer.js';
import { RowMenu, type RowAction } from '../components/RowMenu.js';
import { useSession } from '../session.js';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { todayISO } from '@ev8/shared';
import { ColorText, CustomerName, Empty, Loading, PageHead, PlaceText, StateBadge, Vin } from '../components/ui.js';
import { placeOf } from '../lib/place.js';
import { rowClick } from '../lib/rowLink.js';
import { SortHead, useSortable } from '../lib/sortable.js';
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
const UNDO_WINDOW_MS = Number.parseFloat(tokens.undoWindow) * 1000;

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
  models: { id: string; brand: string; name: string }[];
}

export function FleetPage() {
  const t = useT();
  const { can } = useSession();
  const fleet = useLoad<Fleet>('/api/fleet');
  const { data, failure } = fleet;
  const client = useQueryClient();
  // A park move redraws its row at once; the refetch after the write confirms it.
  const setData = (update: (d: Fleet | null) => Fleet | null) => client.setQueryData<Fleet>(['/api/fleet'], (d) => update(d ?? null) ?? undefined);
  const models = useLoad<Models>(can('settings.manage') ? '/api/models' : null);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  // The row a park move has just touched. It keeps its place in the list for
  // a while, even when the filter no longer wants it, so that the undo is
  // where the finger already is and nothing disappears under it.
  const [moved, setMoved] = useState<{ id: string; to: VehiclePool } | null>(null);
  // The heading opens into a field, and stays open while it holds anything.
  const [finding, setFinding] = useState(false);
  const state = params.get('state') as VehicleState | null;
  const pool = params.get('pool') as PoolKey | null;
  const noPoint = params.get('place') === 'unset';


  // Long enough to notice a wrong click, short enough that the list is not
  // left holding rows that no longer belong in it. The same figure draws the
  // line draining under the button, so it is read from the token rather than
  // written twice and left to drift.
  useEffect(() => {
    if (!moved) return;
    const id = setTimeout(() => setMoved(null), UNDO_WINDOW_MS);
    return () => clearTimeout(id);
  }, [moved]);

  /** The screen knows the answer before the server is asked again. */
  const patch = (id: string, pool: VehiclePool | null) =>
    setData((d) => (d ? { ...d, vehicles: d.vehicles.map((v) => (v.id === id ? { ...v, pool } : v)) } : d));

  const movePool = async (v: Vehicle, pool: VehiclePool) => {
    await api.post(`/api/fleet/${v.id}/pool`, { pool });
    patch(v.id, pool);
    setMoved({ id: v.id, to: pool });
  };

  const undoPool = async (id: string) => {
    const { pool } = await api.post<{ pool: VehiclePool | null }>(`/api/fleet/${id}/pool/undo`, {});
    patch(id, pool);
    setMoved(null);
  };

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

  // Where a moped stands, as the one string the column is ordered by: the
  // renter's name, the point, or nothing — and nothing sorts last, whichever
  // way the column is pointing, because "nobody said" is not a name.
  const whereKey = (v: Vehicle) => v.currentRental?.customer.name ?? v.location?.name ?? '';

  const today = todayISO();
  const shown = useMemo(() => {
    const needle = q.trim().toUpperCase();
    // Every filter at once, and one exception above all of them: a moped that
    // has just been moved holds its place while the undo is still on offer.
    // The park it was moved out of is the first filter it stops matching, so
    // the exception has to sit outside all three and not only the last two.
    const matches = (v: Vehicle) =>
      (!pool || poolOf(v) === pool) && (!state || v.state === state) && (!noPoint || placeOf(v).kind === 'unset');
    return (data?.vehicles ?? []).filter(
      (v) => (v.id === moved?.id || matches(v)) && (!needle || v.vin.endsWith(needle) || v.vin.includes(needle)),
    );
  }, [data, pool, state, noPoint, q, moved]);

  // Longest silence on top by default: the list is a queue of decisions, not a
  // register. The order itself is the system's one sorting rule, shared with
  // every other list (lib/sortable).
  const sorted = useSortable(
    shown,
    {
      model: { value: (v) => v.model },
      color: { value: (v) => { const c = colorOf(v.color); return c ? VEHICLE_COLORS.indexOf(c) : null; } },
      state: { value: (v) => VEHICLE_STATES.indexOf(v.state) },
      where: { value: (v) => whereKey(v) },
      quiet: { value: (v) => quietDays(v, today), first: 'desc' },
    },
    (a, b) => a.vin.localeCompare(b.vin),
    'quiet',
  );
  const rows = sorted.rows;

  const pick = (next: { pool?: PoolKey | null; state?: VehicleState | null; noPoint?: boolean }) => {
    const p = 'pool' in next ? next.pool : pool;
    const st = 'state' in next ? next.state : 'noPoint' in next ? null : state;
    const np = 'noPoint' in next ? next.noPoint : 'state' in next ? false : noPoint;
    // The order is not a filter and outlives every one of them.
    const order = Object.fromEntries([...params.entries()].filter(([k]) => k === 'sort' || k === 'dir'));
    setParams({
      ...order,
      ...(p ? { pool: p } : {}),
      ...(st ? { state: st } : {}),
      ...(np ? { place: 'unset' } : {}),
    });
  };

  const findOpen = finding || q.length > 0;
  const closeFind = () => {
    setQ('');
    setFinding(false);
  };

  if (!data && failure) return <LoadError failure={failure} onRetry={fleet.reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead title={t.fleet.title} sub={t.fleet.count(data.vehicles.length)}>
        {/* On a phone the search is a field of its own, because the list has
            no column headings to hide in. On a laptop it lives in the VIN
            column, and this one is not rendered. */}
        <input
          className="input input-search head-search mono"
          placeholder={t.fleet.searchHint}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        {can('settings.manage') && models.data && (
          <NewVehicle models={models.data.models} onModels={models.reload} onDone={fleet.reload} />
        )}
      </PageHead>
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
      {/* An empty fleet and a search that found nothing are two different
          things, and only one of them is about the fleet. A search that found
          nothing keeps its heading — and with it the field the words were
          typed into, which used to vanish along with the rows and leave
          nowhere to take them back. */}
      {data.vehicles.length === 0 ? (
        <Empty text={t.fleet.empty} />
      ) : (
        /* One markup, two shapes: a list a thumb can read on a phone, and the
           same rows as a table from 900 px up, where a laptop wants columns
           (U3). Rendering it twice would be two things to keep in step. */
        <ul className="vlist">
          {/* Seven columns, not eleven. Year and arrival are card facts; the
              renter is the answer to "where", not a column beside it; and
              "paid through" belongs under the name it is about. */}
          {/* The heading row carries the search, because a search for a VIN
              belongs over the column of VINs and nowhere else. It costs the
              screen nothing: the row was already there. */}
          <li className="vlist-head">
            {/* The VIN column is a heading until somebody wants to find a
                moped, and then it is the field they find it with. It stays a
                field while anything is typed in it, so a list that is
                filtered never hides what filtered it. */}
            <span className="vin-col">
              {findOpen ? (
                <span className="col-search">
                  <input
                    className="input list-search mono"
                    placeholder={t.fleet.searchShort}
                    aria-label={t.fleet.searchHint}
                    value={q}
                    autoFocus
                    onChange={(e) => setQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') closeFind();
                    }}
                    onBlur={() => {
                      if (!q) setFinding(false);
                    }}
                  />
                  <button type="button" className="col-x" aria-label={t.actions.cancel} onClick={closeFind}>
                    ✕
                  </button>
                </span>
              ) : (
                <button type="button" className="col-find" aria-label={t.fleet.searchHint} onClick={() => setFinding(true)}>
                  {t.fleet.vin}
                  <i className="col-mag" aria-hidden="true">
                    ⌕
                  </i>
                </button>
              )}
            </span>
            <span>
              <SortHead k="model" label={t.fleet.model} {...sorted} />
            </span>
            <span>
              <SortHead k="color" label={t.fleet.color} {...sorted} />
            </span>
            <span>
              <SortHead k="state" label={t.fleet.state} {...sorted} />
            </span>
            <span>
              <SortHead k="where" label={t.fleet.where} {...sorted} />
            </span>
            <span className="num">
              <SortHead k="quiet" label={t.fleet.quiet} {...sorted} />
            </span>
            {/* The header's last cell rides the right edge with the row's, or
                the columns would slide out from under a floating heading. */}
            <span className="v-move" />
          </li>
          {rows.length === 0 && (
            <li className="vlist-empty">
              <span>{t.fleet.nothingFound}</span>
              <button
                type="button"
                className="pill pill-sm"
                onClick={() => {
                  setQ('');
                  setParams({});
                }}
              >
                {t.fleet.showAll(data.vehicles.length)}
              </button>
            </li>
          )}
          {rows.map((v) => (
            /* Source order is the laptop's column order; the phone re-lays
               them out by name with grid-template-areas, so neither shape
               depends on the other. */
            <li
              key={v.id}
              className={`vrow vrow-go ${moved?.id === v.id ? 'vrow-changed' : ''}`}
              onClick={rowClick(() => navigate(`/fleet/${v.id}`))}
            >
              <Link to={`/fleet/${v.id}`} className="v-vin">
                <Vin vin={v.vin} />
              </Link>
              {/* Five columns, not seven. What is secondary sits under what it
                  belongs to: the colour under the model, the park under the
                  state, "paid through" under the name. Each column gets one
                  word and one quiet tail, and none of them elbows the next. */}
              <span className="v-model">{v.model}</span>
              <span className="v-color">
                <ColorText of={v.color} />
              </span>
              <span className="v-state">
                <StateBadge state={v.state} />
                {/* A label on every row is a label nobody reads. The park is
                    said only when it is still a question — and on the row that
                    has just moved, which says where it went. */}
                {moved?.id === v.id ? (
                  <span className="v-sub v-pool-new">→ {t.pools[moved.to]}</span>
                ) : (
                  !pool && poolOf(v) === 'none' && <span className="v-sub">{t.pools.none}</span>
                )}
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
                  <span className="v-sub mono">
                    {t.fleet.paidThrough}: {fmtDate(v.currentRental.paidThrough)}
                  </span>
                )}
              </span>
              <Quiet v={v} today={today} />
              <Actions v={v} can={can('fleet.pool.set')} moved={moved} onMove={movePool} onUndo={undoPool} />
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
 * What this row can be told to do, and what it just did.
 *
 * A park move used to be two chips that wrote at once and then took the row
 * out of the list under the finger that clicked them. Now the choice lives
 * behind the dots every table has, and for ten seconds afterwards the row
 * stays exactly where it was, saying what happened and offering to take it
 * back — including back to "nobody has decided", which no second click could
 * ever reach.
 */
function Actions({
  v,
  can,
  moved,
  onMove,
  onUndo,
}: {
  v: Vehicle;
  can: boolean;
  moved: { id: string; to: VehiclePool } | null;
  onMove: (v: Vehicle, pool: VehiclePool) => Promise<void>;
  onUndo: (id: string) => Promise<void>;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (moved?.id === v.id) {
    return (
      <span className="v-move">
        {/* The line under the word drains over exactly the seconds the offer
            lasts, so the button disappearing reads as a countdown ending and
            not as the screen misbehaving. */}
        <button type="button" className="mv mv-undo" disabled={busy} onClick={() => void run(() => onUndo(v.id))}>
          {t.actions.undo}
          <i className="mv-clock" />
        </button>
      </span>
    );
  }

  const where = poolOf(v);
  const actions: RowAction[] = [];
  if (can && where !== 'gone') {
    for (const p of VEHICLE_POOLS) {
      if (p === v.pool) continue;
      actions.push({
        key: p,
        label: p === 'rent' ? t.pools.menuToRent : t.pools.menuToSale,
        onPick: () => void run(() => onMove(v, p)),
      });
    }
  }
  return (
    <span className="v-move">
      <RowMenu actions={actions} />
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
const blankVehicle = () => ({ vin: '', modelId: '', color: '', year: '', arrivedOn: todayISO() });

function NewVehicle({ models, onModels, onDone }: { models: Models['models']; onModels: () => void; onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [addingModel, setAddingModel] = useState(false);
  const [f, setF] = useState(blankVehicle);

  return (
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.settings.addVehicle}
      </button>
      {open && (
        <FormSheet
          title={t.settings.addVehicle}
          onClose={() => setOpen(false)}
          value={f}
          initial={blankVehicle()}
          draft="vehicle-new"
          onRestore={setF}
          summary={(v) => v.vin}
          label={t.fleet.addVehicleCta}
          submit={async (key) => {
            const v = await api.post<{ id: string }>(
              '/api/fleet',
              {
                vin: f.vin.trim().toUpperCase(),
                modelId: f.modelId,
                color: f.color.trim() || null,
                year: f.year ? Number(f.year) : null,
                arrivedOn: f.arrivedOn || null,
              },
              { key },
            );
            return { created: v.id, toast: { text: t.fleet.vehicleAdded, open: `/fleet/${v.id}` } };
          }}
          onDone={() => {
            setF(blankVehicle());
            onDone();
          }}
        >
            <div className="two-col">
              <Field label={t.models.vin} name="vin">
                <input className="input mono" value={f.vin} onChange={(e) => setF({ ...f, vin: e.target.value })} required maxLength={17} autoFocus />
              </Field>
              <Field label={t.models.name} name="modelId">
                <select
                  className="input"
                  value={f.modelId}
                  onChange={(e) => (e.target.value === NEW_MODEL ? setAddingModel(true) : setF({ ...f, modelId: e.target.value }))}
                  required
                >
                  {/* No model until someone picks one: a preselected first
                      model gets saved by whoever did not look. */}
                  <option value="">{t.common.dash}</option>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.brand} {m.name}
                    </option>
                  ))}
                  <option value={NEW_MODEL}>+ {t.models.addEllipsis}</option>
                </select>
              </Field>
              <Field label={t.models.year} name="year">
                <input className="input input-amount mono" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} inputMode="numeric" />
              </Field>
              <Field label={t.models.arrivedOn} name="arrivedOn">
                <input className="input mono" type="date" value={f.arrivedOn} onChange={(e) => setF({ ...f, arrivedOn: e.target.value })} />
              </Field>
            </div>
            <ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} />
            {/* Nobody should type in by hand what a receipt already writes:
                a purchase creates its mopeds with the date, the landed cost
                and an "arrived" event of their own. */}
            <p className="drawer-tip">
              {t.fleet.addTip} <Link to="/purchases">{t.fleet.addTipLink}</Link>
            </p>
        </FormSheet>
      )}
      {addingModel && (
        <ModelDrawer
          brands={models.map((m) => m.brand)}
          onClose={() => setAddingModel(false)}
          onSaved={(m) => {
            setAddingModel(false);
            onModels();
            setF((cur) => ({ ...cur, modelId: m.id }));
          }}
        />
      )}
    </>
  );
}
