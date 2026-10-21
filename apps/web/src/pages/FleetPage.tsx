import { parkOf, readFleetNumber, vinMatches, VEHICLE_COLORS, VEHICLE_POOLS, VEHICLE_STATES, colorOf, daysBetween, tokens, todayISO, type ServiceWhy, type VehiclePool, type VehicleState } from '@ev8/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { ColorPicker } from '../components/ColorPicker.js';
import { LoadError } from '../components/LoadError.js';
import { ModelDrawer, NEW_MODEL } from '../components/ModelDrawer.js';
import { RowMenu, type RowAction } from '../components/RowMenu.js';
import { ColorText, CustomerName, FleetNo, Loading, PageHead, PlaceText, StateBadge, Vin } from '../components/ui.js';
import { StickersButton } from '../components/Stickers.js';
import { Field } from '../components/Wizard.js';
import { FormSheet } from '../ds/form/Form.js';
import { DataList } from '../ds/list/DataList.js';
import { fmtDate } from '../format.js';
import type { Dict } from '../i18n/en.js';
import { useT } from '../i18n/index.js';
import { placeOf } from '../lib/place.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

interface Vehicle {
  id: string;
  vin: string;
  /** EV-007 on the sticker (migration 0043); absent while an older API answers. */
  fleetNo?: number | null;
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
  /** Why it stands in service, as recorded (21.10.2026); null in any other state, absent while an older API answers. */
  serviceWhy?: ServiceWhy | null;
}

interface Fleet {
  byState: Record<VehicleState, number>;
  vehicles: Vehicle[];
}

const UNDO_WINDOW_MS = Number.parseFloat(tokens.undoWindow) * 1000;

/**
 * Why a moped is in service, in the words somebody wrote (ADR-0005, addendum
 * 21.10.2026): the repair's kind when one was picked, else what happened, else
 * the reason of the move by hand. Null when nothing was written — the screen
 * says so with a quiet dash — and for a moped that is not in service.
 */
function whyText(v: Vehicle, t: Dict): string | null {
  const why = v.serviceWhy;
  if (!why) return null;
  return why.kind ? t.wjob.reasons[why.kind] : why.text;
}

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

/**
 * Парк → Мопеды on the one list every section uses (wave 4 §3.7, closes
 * wave 1's deviation 1): the section's search, chips with counts, cards on a
 * phone and a table on a laptop. What a moped is for is said on the row and
 * changed in its menu, where the undo is (§3.6).
 */
export function FleetPage() {
  const t = useT();
  const { can } = useSession();
  const fleet = useLoad<Fleet>('/api/fleet');
  const { data, failure } = fleet;
  const client = useQueryClient();
  // A park move redraws its row at once; the refetch after the write confirms it.
  const setData = (update: (d: Fleet | null) => Fleet | null) => client.setQueryData<Fleet>(['/api/fleet'], (d) => update(d ?? null) ?? undefined);
  const models = useLoad<Models>(can('settings.manage') ? '/api/models' : null);
  // The row a park move has just touched: it keeps its place while the undo
  // is still on offer, so nothing disappears under the finger.
  const [moved, setMoved] = useState<{ id: string; to: VehiclePool } | null>(null);
  const today = todayISO();

  useEffect(() => {
    if (!moved) return;
    const id = setTimeout(() => setMoved(null), UNDO_WINDOW_MS);
    return () => clearTimeout(id);
  }, [moved]);

  const movePool = async (v: Vehicle, pool: VehiclePool) => {
    await api.post(`/api/fleet/${v.id}/pool`, { pool });
    setData((d) => (d ? { ...d, vehicles: d.vehicles.map((x) => (x.id === v.id ? { ...x, pool } : x)) } : d));
    setMoved({ id: v.id, to: pool });
  };
  const undoPool = async (id: string) => {
    const back = await api.post<{ pool: VehiclePool | null }>(`/api/fleet/${id}/pool/undo`, {});
    setData((d) => (d ? { ...d, vehicles: d.vehicles.map((x) => (x.id === id ? { ...x, pool: back.pool } : x)) } : d));
    setMoved(null);
    fleet.reload();
  };

  if (!data && failure) return <LoadError failure={failure} onRetry={fleet.reload} />;
  if (!data) return <Loading />;
  const rows = data.vehicles;

  return (
    <>
      <PageHead title={t.fleet.title} sub={t.fleet.count(rows.length)}>
        {/* Drawn at once, not when the models arrive: a button that turns up a
            beat after the page pushed everything under it down (29.09.2026). */}
        <StickersButton numbers={rows.map((v) => v.fleetNo).filter((n): n is number => n != null)} />
        {can('settings.manage') && <NewVehicle models={models.data?.models ?? []} onModels={models.reload} onDone={fleet.reload} />}
      </PageHead>
      <DataList
        rows={rows}
        rowKey={(v) => v.id}
        href={(v) => `/fleet/${v.id}`}
        fallback={(a, b) => a.vin.localeCompare(b.vin)}
        byDefault="quiet"
        search={{
          placeholder: t.fleet.searchHint,
          // The number on the sticker, the last four of a VIN, or the model by name (§3.7).
          match: (v, q) => (v.fleetNo != null && readFleetNumber(q.text, { digitsToo: true }) === v.fleetNo) || vinMatches(q, v.vin) || v.model.toLowerCase().includes(q.text),
        }}
        chips={[
          { key: 'available', label: t.states.available, test: (v) => v.state === 'available' },
          { key: 'rented', label: t.states.rented, test: (v) => v.state === 'rented' },
          { key: 'service', label: t.states.service, test: (v) => v.state === 'service' },
          // The whole sale park, new stock and used mopeds alike, whatever is happening to them (21.10.2026).
          { key: 'sale', label: t.fleetList.forSale, test: (v) => parkOf(v) === 'sale' },
          { key: 'nopool', label: t.pools.none, test: (v) => parkOf(v) === 'none' },
          { key: 'nopoint', label: t.points.unset, test: (v) => placeOf(v).kind === 'unset' },
        ]}
        empty={{ text: t.fleet.empty }}
        card={(v) => ({
          title: (
            <>
              <FleetNo n={v.fleetNo} /> {v.model} <ColorText of={v.color} />
            </>
          ),
          sub: <Vin vin={v.vin} />,
          right: <StateBadge state={v.state} />,
          rightSub: <StateSub v={v} />,
        })}
        columns={[
          { key: 'no', label: t.fleet.no, cell: (v) => <FleetNo n={v.fleetNo} />, sort: { value: (v) => v.fleetNo ?? Number.MAX_SAFE_INTEGER } },
          { key: 'vin', label: t.fleet.vin, cell: (v) => <Vin vin={v.vin} />, sort: { value: (v) => v.vin } },
          { key: 'model', label: t.fleet.model, cell: (v) => <span>{v.model}</span>, sort: { value: (v) => v.model } },
          {
            key: 'color',
            label: t.fleet.color,
            cell: (v) => <ColorText of={v.color} />,
            sort: {
              value: (v) => {
                const c = colorOf(v.color);
                return c ? VEHICLE_COLORS.indexOf(c) : null;
              },
            },
          },
          {
            key: 'state',
            label: t.fleet.state,
            cell: (v) => (
              <span className="v-state">
                <StateBadge state={v.state} />
                {moved?.id === v.id ? <span className="v-sub v-pool-new">→ {t.pools[moved.to]}</span> : <ParkLine v={v} />}
              </span>
            ),
            sort: { value: (v) => VEHICLE_STATES.indexOf(v.state) },
          },
          // Only a moped in service has a reason; every other row leaves the cell empty rather than forty dashes.
          { key: 'why', label: t.wjob.reason, cell: (v) => <Why v={v} />, sort: { value: (v) => whyText(v, t) } },
          {
            key: 'where',
            label: t.fleet.where,
            cell: (v) =>
              v.currentRental ? (
                <span className="v-where">
                  <Link to={`/customers/${v.currentRental.customer.id}`} onClick={(e) => e.stopPropagation()}>
                    <CustomerName of={v.currentRental.customer} second={false} />
                  </Link>
                  <span className="v-sub mono">
                    {t.fleet.paidThrough}: {fmtDate(v.currentRental.paidThrough)}
                  </span>
                </span>
              ) : (
                <PlaceText of={v} />
              ),
            sort: { value: (v) => v.currentRental?.customer.name ?? v.location?.name ?? '' },
          },
          { key: 'quiet', label: t.fleet.quiet, num: true, cell: (v) => <Quiet v={v} today={today} />, sort: { value: (v) => quietDays(v, today), first: 'desc' } },
          { key: 'move', label: '', cell: (v) => <Actions v={v} can={can('fleet.pool.set')} moved={moved} onMove={movePool} onUndo={undoPool} /> },
        ]}
      />
    </>
  );
}


/**
 * The quiet line under the state in the table: "For sale" for the sale park,
 * "Not decided" for a moped in neither, nothing for the rental park and for
 * a moped that has left the fleet.
 */
function ParkLine({ v }: { v: Vehicle }) {
  const t = useT();
  const park = parkOf(v);
  if (park === 'sale') return <span className="v-sub">{t.fleetList.forSale}</span>;
  if (park === 'none') return <span className="v-sub">{t.pools.none}</span>;
  return null;
}

/**
 * Why it is in service, on one line: a long note ends in an ellipsis and is
 * read whole under the pointer, so it never stretches every row of the list.
 * Nothing at all for a moped in any other state.
 */
function Why({ v }: { v: Vehicle }) {
  const t = useT();
  if (!v.serviceWhy) return null;
  const text = whyText(v, t);
  if (!text) return <span className="muted">{t.common.dash}</span>;
  return (
    <span className="v-why" title={v.serviceWhy.text ?? text}>
      {text}
    </span>
  );
}

/**
 * The quiet line under the state on a phone: the one fact that state is
 * about — who has the moped, why it is in the workshop, or where it stands —
 * after "For sale" when it waits in the sale park (21.10.2026).
 */
function StateSub({ v }: { v: Vehicle }) {
  const t = useT();
  const fact = v.currentRental ? (
    <CustomerName of={v.currentRental.customer} second={false} />
  ) : v.serviceWhy ? (
    <Why v={v} />
  ) : (
    <PlaceText of={v} />
  );
  return (
    <span className="muted">
      {parkOf(v) === 'sale' && <>{t.fleetList.forSale} · </>}
      {fact}
    </span>
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

  const where = parkOf(v);
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
