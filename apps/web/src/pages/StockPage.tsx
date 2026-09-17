import { parseGel } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { Drawer } from '../components/Drawer.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { LoadError } from '../components/LoadError.js';

export interface PartRow {
  id: string;
  sku: string | null;
  name: string;
  nameKa: string | null;
  unit: 'pcs' | 'set' | 'l' | 'kg' | 'm';
  minQty: number;
  salePriceTetri: number | null;
  notes: string | null;
  archived: boolean;
  onHand: number;
  valueTetri: number;
  avgCostTetri: number | null;
  shortBy: number;
}

interface ModelRow {
  id: string;
  name: string;
  byState: Record<'available' | 'rented' | 'service' | 'out' | 'sold', number>;
  inStock: number;
  ours: number;
  onOrder: number;
  valueTetri: number;
  unpriced: number;
}

/** The warehouse: parts on the shelf, and mopeds counted by model. */
export function StockPage() {
  const t = useT();
  const { can } = useSession();
  const mopeds = useLoad<{ rows: ModelRow[]; totals: { inStock: number; ours: number; onOrder: number; valueTetri: number; unpriced: number } }>(
    '/api/stock/vehicles',
  );
  const parts = useLoad<{ parts: PartRow[]; totals: { parts: number; valueTetri: number; short: number; negative: number } }>('/api/parts');
  const [err, setErr] = useState<string | null>(null);

  if (!mopeds.data && mopeds.failure) return <LoadError failure={mopeds.failure} onRetry={mopeds.reload} />;
  if (!parts.data && parts.failure) return <LoadError failure={parts.failure} onRetry={parts.reload} />;
  if (!mopeds.data || !parts.data) return <Loading />;

  return (
    <>
      <PageHead wrap title={t.stock.title} sub={t.stock.partsCount(parts.data?.parts.length ?? 0)} note={t.stock.subtitle}>
        {can('service.manage') && <NewPart onDone={parts.reload} onError={setErr} />}
      </PageHead>
      {err && <div className="hint hint-bad">{err}</div>}

      <section className="card">
        <BlockHead title={t.stock.mopeds} sub={t.models.count(mopeds.data.rows.length)} />
        <div className="table-wrap table-flat">
          <table className="table">
            <thead>
              <tr>
                <th>{t.stock.model}</th>
                <th className="num">{t.stock.inStock}</th>
                <th className="num">{t.states.rented}</th>
                <th className="num">{t.states.service}</th>
                <th className="num">{t.stock.ours}</th>
                <th className="num">{t.stock.onOrder}</th>
                <th className="num">{t.stock.value}</th>
              </tr>
            </thead>
            <tbody>
              {mopeds.data.rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/fleet/models/${m.id}`}>{m.name}</Link>
                  </td>
                  <td className="num mono state-available">{m.inStock}</td>
                  <td className="num mono">{m.byState.rented}</td>
                  <td className="num mono">{m.byState.service}</td>
                  <td className="num mono">{m.ours}</td>
                  <td className="num mono">{m.onOrder > 0 ? m.onOrder : t.common.dash}</td>
                  <td className="num mono">
                    {formatGel(m.valueTetri, { decimals: false })}
                    {m.unpriced > 0 && <span className="muted"> · {t.stock.unpriced}: {m.unpriced}</span>}
                  </td>
                </tr>
              ))}
              <tr className="row-total">
                <td>{t.stock.value}</td>
                <td className="num mono">{mopeds.data.totals.inStock}</td>
                <td />
                <td />
                <td className="num mono">{mopeds.data.totals.ours}</td>
                <td className="num mono">{mopeds.data.totals.onOrder}</td>
                <td className="num mono">{formatGel(mopeds.data.totals.valueTetri, { decimals: false })}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <BlockHead title={t.stock.parts} sub={t.stock.partsCount(parts.data.parts.length)} />
        {parts.data.totals.negative > 0 && <div className="hint hint-bad">{t.stock.negativeHint}</div>}
        {parts.data.parts.length === 0 ? (
          <Empty text={t.stock.none} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.stock.name}</th>
                  <th>{t.stock.sku}</th>
                  <th className="num">{t.stock.onHand}</th>
                  <th className="num">{t.stock.minQty}</th>
                  <th className="num">{t.stock.avgCost}</th>
                  <th className="num">{t.stock.value}</th>
                </tr>
              </thead>
              <tbody>
                {parts.data.parts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/service/stock/parts/${p.id}`}>{p.name}</Link>
                    </td>
                    <td className="muted mono">{p.sku ?? t.common.dash}</td>
                    <td className={`num mono ${p.onHand < 0 ? 'crit-text' : p.shortBy > 0 ? 'warn-text' : ''}`}>
                      {p.onHand} <span className="muted">{t.stock.units[p.unit]}</span>
                    </td>
                    <td className="num mono muted">{p.minQty > 0 ? p.minQty : t.common.dash}</td>
                    <td className="num mono">{p.avgCostTetri == null ? t.common.dash : formatGel(p.avgCostTetri)}</td>
                    <td className="num mono">{formatGel(p.valueTetri)}</td>
                  </tr>
                ))}
                <tr className="row-total">
                  <td>{t.stock.value}</td>
                  <td />
                  <td />
                  <td />
                  <td />
                  <td className="num mono">{formatGel(parts.data.totals.valueTetri)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function NewPart({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', nameKa: '', sku: '', unit: 'pcs', minQty: '', price: '' });
  const [busy, setBusy] = useState(false);


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/parts', {
        name: f.name,
        nameKa: f.nameKa || null,
        sku: f.sku || null,
        unit: f.unit,
        minQty: Number(f.minQty) || 0,
        salePriceTetri: f.price ? parseGel(f.price) : null,
      });
      setOpen(false);
      setF({ name: '', nameKa: '', sku: '', unit: 'pcs', minQty: '', price: '' });
      onDone();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.stock.newPart}
      </button>
      {open && (
        <Drawer title={t.stock.newPart} onClose={() => setOpen(false)}>
          <form className="form" onSubmit={submit}>
      <div className="two-col">
        <Field label={t.stock.name}>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <Field label={t.stock.nameKa}>
          <input className="input" value={f.nameKa} onChange={(e) => setF({ ...f, nameKa: e.target.value })} />
        </Field>
        <Field label={t.stock.sku}>
          <input className="input mono" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
        </Field>
        <Field label={t.stock.unit}>
          <select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
            {(['pcs', 'set', 'l', 'kg', 'm'] as const).map((u) => (
              <option key={u} value={u}>
                {t.stock.units[u]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.stock.minQty}>
          <input className="input input-amount mono" value={f.minQty} onChange={(e) => setF({ ...f, minQty: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label={t.stock.salePrice}>
          <input className="input input-amount mono" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" />
        </Field>
      </div>
      <div className="row-actions">
        <button type="button" className="pill" onClick={() => setOpen(false)}>
          {t.actions.cancel}
        </button>
        <button className="pill pill-accent" disabled={busy || !f.name.trim()}>
          {busy ? t.common.checking : t.actions.confirm}
        </button>
      </div>
          </form>
        </Drawer>
      )}
    </>
  );
}
