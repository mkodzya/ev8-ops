import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Empty, Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { FormSheet } from '../ds/form/Form.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { Typed } from '../lib/typed.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

// Батареи — счёт без номеров (wave 4 §3.8, D16): four numbers, how they moved,
// and the stocktake that sets them straight. Зарядки — the same count since
// migration 0044 (meeting of 14.10.2026), one switch at the top.

type Item = 'battery' | 'charger';

interface Batteries {
  total: number;
  couriers: number;
  repair: number;
  showroom: number;
  couriersByActs: number;
  lastInventory: { countedOn: string; showroomQty: number; repairQty: number; couriersQty: number; totalQty: number; by: string | null; reason: string | null } | null;
  moves: { id: string; kind: string; qty: number; reason: string | null; number: string | null; occurredOn: string; by: string | null }[];
  inventories: { id: string; countedOn: string; totalQty: number; showroomQty: number; repairQty: number; couriersQty: number; reason: string | null; by: string | null }[];
}

export function BatteriesPage() {
  const t = useT();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const item: Item = params.get('item') === 'charger' ? 'charger' : 'battery';
  const { data, failure, reload } = useLoad<Batteries>(`/api/batteries?item=${item}`);
  const [sheet, setSheet] = useState<null | 'inventory' | 'move'>(null);
  const mayCount = can('fleet.pool.set');
  const switcher = (
    <div className="list-chips" role="tablist">
      {(['battery', 'charger'] as const).map((it) => (
        <button key={it} type="button" role="tab" aria-selected={item === it} className={`list-chip ${item === it ? 'on' : ''}`} onClick={() => setParams(it === 'battery' ? {} : { item: it }, { replace: true })}>
          {t.bat.items[it]}
        </button>
      ))}
    </div>
  );
  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead title={t.bat.items[item]} sub={data.lastInventory ? t.bat.counted(fmtDate(data.lastInventory.countedOn), data.lastInventory.by ?? '') : t.bat.never}>
        {mayCount && (
          <>
            <button type="button" className="pill pill-sm" onClick={() => setSheet('move')}>
              {t.bat.move}
            </button>
            <button type="button" className="pill pill-sm pill-accent" onClick={() => setSheet('inventory')}>
              {t.bat.inventory}
            </button>
          </>
        )}
      </PageHead>
      {switcher}

      <div className="num-strip">
        <span className="num">
          <span className="num-v">{data.showroom}</span>
          <span className="num-l">{t.bat.showroom}</span>
        </span>
        <span className="num">
          <span className="num-v">{data.couriers}</span>
          <span className="num-l">{t.bat.couriers}</span>
        </span>
        <span className="num">
          <span className="num-v">{data.repair}</span>
          <span className="num-l">{t.bat.repair}</span>
        </span>
        <span className="num">
          <span className="num-v">{data.total}</span>
          <span className="num-l">{t.bat.total}</span>
        </span>
      </div>

      <section className="card">
        <div className="queue-head">
          <h2>{t.bat.feed}</h2>
        </div>
        {data.moves.length === 0 && data.inventories.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <ul className="timeline">
            {data.moves.map((m) => (
              <li key={m.id}>
                <span className="mono muted">{fmtDate(m.occurredOn)}</span>
                <span>
                  <span className="mono">{m.kind === 'lost' || m.kind === 'to_repair' || m.kind === 'handed_out' ? `−${m.qty}` : `+${m.qty}`}</span> {t.bat.kinds[m.kind] ?? t.batWords[m.kind] ?? m.kind}
                  {m.number && <span className="muted"> · {m.kind === 'lost' ? t.bat.lostOn(m.number) : m.number}</span>}
                  {m.reason && (
                    <span className="muted">
                      {' · '}
                      <Typed text={m.reason} />
                    </span>
                  )}
                  {m.by && <span className="muted"> · {m.by}</span>}
                </span>
              </li>
            ))}
            {data.inventories.map((i) => (
              <li key={i.id}>
                <span className="mono muted">{fmtDate(i.countedOn)}</span>
                <span>
                  {t.bat.inventory} · <span className="mono">{i.totalQty}</span>
                  <span className="muted">
                    {' '}
                    ({t.bat.showroom} {i.showroomQty} · {t.bat.repair} {i.repairQty} · {t.bat.couriers} {i.couriersQty})
                  </span>
                  {i.reason && (
                    <span className="muted">
                      {' · '}
                      <Typed text={i.reason} />
                    </span>
                  )}
                  {i.by && <span className="muted"> · {i.by}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sheet === 'inventory' && <InventorySheet item={item} now={data} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload(); }} />}
      {sheet === 'move' && <MoveSheet item={item} onClose={() => setSheet(null)} onSaved={() => { setSheet(null); reload(); }} />}
    </>
  );
}

/** The owner counted the shelf; what the couriers hold comes from the acts (§3.8). */
function InventorySheet({ item, now, onClose, onSaved }: { item: Item; now: Batteries; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const initial = { showroom: String(now.showroom), repair: String(now.repair), reason: '' };
  const [f, setF] = useState(initial);
  const counted = (Number(f.showroom) || 0) + (Number(f.repair) || 0) + now.couriersByActs;
  const differs = counted !== now.total;
  return (
    <FormSheet
      title={item === 'charger' ? t.bat.chargerInventoryTitle : t.bat.inventoryTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      onRestore={setF}
      label={t.bat.save}
      submit={async (key) => {
        await api.post('/api/batteries/inventory', { item, showroomQty: Number(f.showroom), repairQty: Number(f.repair), reason: f.reason.trim() || null }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onSaved}
    >
      <div className="two-col two-col-tight">
        <Field label={t.bat.showroomQty} name="showroomQty">
          <input className="input input-amount mono" inputMode="numeric" value={f.showroom} onChange={(e) => setF({ ...f, showroom: e.target.value })} />
        </Field>
        <Field label={t.bat.repairQty} name="repairQty">
          <input className="input input-amount mono" inputMode="numeric" value={f.repair} onChange={(e) => setF({ ...f, repair: e.target.value })} />
        </Field>
      </div>
      <p className="hint muted">{t.bat.couriersNote(now.couriersByActs)}</p>
      <p className="hint">{t.bat.willBe(counted)}</p>
      {differs && <p className="warn-text">{t.bat.diff(now.total, counted)}</p>}
      <Field label={t.bat.reason} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/** To repair and back, a loss outside a return, a battery that turned up. */
function MoveSheet({ item, onClose, onSaved }: { item: Item; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const initial = { kind: 'to_repair', qty: '1', reason: '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={item === 'charger' ? t.bat.chargerMoveTitle : t.bat.moveTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      onRestore={setF}
      label={t.bat.moveSave}
      submit={async (key) => {
        await api.post('/api/batteries/moves', { item, kind: f.kind, qty: Number(f.qty), reason: f.reason.trim() }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onSaved}
    >
      <div className="chips">
        {(['to_repair', 'from_repair', 'lost', 'found'] as const).map((k) => (
          <button key={k} type="button" className={`pill pill-sm ${f.kind === k ? 'on' : ''}`} onClick={() => setF({ ...f, kind: k })}>
            {t.bat.kinds[k]}
          </button>
        ))}
      </div>
      <Field label={t.bat.qty} name="qty">
        <input className="input input-amount mono" inputMode="numeric" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} />
      </Field>
      <Field label={t.bat.reason} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}
