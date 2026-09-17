import { parseGel, spellingMatches } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BlockHead, Loading, PageHead } from '../components/ui.js';
import { DataList } from '../ds/list/DataList.js';
import { Field } from '../components/Wizard.js';
import { formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { FormSheet } from '../ds/form/Form.js';
import { useLoad } from '../lib/use.js';
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
  valueTetri: number | null;
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
  const { locale } = useLocale();
  const partName = (p: PartRow) => (locale === 'ka' && p.nameKa) || p.name;

  if (!mopeds.data && mopeds.failure) return <LoadError failure={mopeds.failure} onRetry={mopeds.reload} />;
  if (!parts.data && parts.failure) return <LoadError failure={parts.failure} onRetry={parts.reload} />;
  if (!mopeds.data || !parts.data) return <Loading />;

  return (
    <>
      <PageHead wrap title={t.stock.title} sub={t.stock.partsCount(parts.data?.parts.length ?? 0)} note={t.stock.subtitle}>
        {can('service.manage') && <NewPart onDone={parts.reload} />}
      </PageHead>

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
        <BlockHead
          title={t.stock.parts}
          sub={
            <>
              {t.stock.partsCount(parts.data.parts.length)}
              {can('cost.view') && parts.data.totals.valueTetri != null && <> · {t.stock.value} <span className="mono">{formatGel(parts.data.totals.valueTetri)}</span></>}
            </>
          }
        />
        {parts.data.totals.negative > 0 && <div className="hint hint-bad">{t.stock.negativeHint}</div>}
        <DataList
          rows={parts.data.parts}
          rowKey={(p) => p.id}
          href={(p) => `/service/stock/parts/${p.id}`}
          fallback={(a, b) => partName(a).localeCompare(partName(b))}
          search={{
            placeholder: t.lists.partsSearch,
            match: (p, q) => spellingMatches(q, [p.name, p.nameKa, p.sku]),
          }}
          chips={[
            { key: 'short', label: t.lists.chips.belowMin, test: (p) => p.shortBy > 0 },
            { key: 'negative', label: t.lists.chips.negative, test: (p) => p.onHand < 0 },
          ]}
          empty={{ text: t.stock.none }}
          card={(p) => ({
            title: partName(p),
            sub: (
              <>
                {p.sku && <span className="mono">{p.sku}</span>}
                {p.sku && p.minQty > 0 && ' · '}
                {p.minQty > 0 && t.lists.keepAtLeast(p.minQty)}
              </>
            ),
            right: (
              <span className={`t-money ${p.onHand < 0 ? 'crit-text' : p.shortBy > 0 ? 'warn-text' : ''}`}>
                {p.onHand} <span className="muted">{t.stock.units[p.unit]}</span>
              </span>
            ),
            rightSub: can('cost.view') && p.valueTetri != null ? formatGel(p.valueTetri) : undefined,
          })}
          columns={[
            { key: 'name', label: t.stock.name, cell: (p) => partName(p), sort: { value: (p) => partName(p) } },
            { key: 'sku', label: t.stock.sku, cell: (p) => <span className="muted mono">{p.sku ?? t.common.dash}</span>, sort: { value: (p) => p.sku } },
            {
              key: 'onHand',
              label: t.stock.onHand,
              num: true,
              cell: (p) => (
                <span className={`mono ${p.onHand < 0 ? 'crit-text' : p.shortBy > 0 ? 'warn-text' : ''}`}>
                  {p.onHand} <span className="muted">{t.stock.units[p.unit]}</span>
                </span>
              ),
              sort: { value: (p) => p.onHand },
            },
            { key: 'minQty', label: t.stock.minQty, num: true, cell: (p) => <span className="mono muted">{p.minQty > 0 ? p.minQty : t.common.dash}</span>, sort: { value: (p) => p.minQty, first: 'desc' } },
            ...(can('cost.view')
              ? [
                  { key: 'avgCost', label: t.stock.avgCost, num: true, cell: (p: PartRow) => <span className="mono">{p.avgCostTetri == null ? t.common.dash : formatGel(p.avgCostTetri)}</span>, sort: { value: (p: PartRow) => p.avgCostTetri, first: 'desc' as const } },
                  { key: 'value', label: t.stock.value, num: true, cell: (p: PartRow) => <span className="mono">{p.valueTetri == null ? t.common.dash : formatGel(p.valueTetri)}</span>, sort: { value: (p: PartRow) => p.valueTetri, first: 'desc' as const } },
                ]
              : []),
          ]}
        />
      </section>
    </>
  );
}

const NO_PART = { name: '', nameKa: '', sku: '', unit: 'pcs', minQty: '', price: '' };

function NewPart({ onDone }: { onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(NO_PART);

  return (
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.stock.newPart}
      </button>
      {open && (
        <FormSheet
          title={t.stock.newPart}
          onClose={() => setOpen(false)}
          value={f}
          initial={NO_PART}
          draft="part-new"
          onRestore={setF}
          summary={(v) => v.name}
          label={t.stock.addPart}
          submit={async (key) => {
            const part = await api.post<{ id: string }>(
              '/api/parts',
              {
                name: f.name,
                nameKa: f.nameKa || null,
                sku: f.sku || null,
                unit: f.unit,
                minQty: f.minQty === '' ? 0 : Number(f.minQty),
                salePriceTetri: f.price ? parseGel(f.price) : null,
              },
              { key },
            );
            return { created: part.id, toast: { text: t.stock.partAdded, open: `/service/stock/parts/${part.id}` } };
          }}
          onDone={() => {
            setF(NO_PART);
            onDone();
          }}
        >
          <div className="two-col">
            <Field label={t.stock.name} name="name">
              <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus />
            </Field>
            <Field label={t.stock.nameKa} name="nameKa">
              <input className="input" value={f.nameKa} onChange={(e) => setF({ ...f, nameKa: e.target.value })} />
            </Field>
            <Field label={t.stock.sku} name="sku">
              <input className="input mono" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
            </Field>
            <Field label={t.stock.unit} name="unit">
              <select className="input" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>
                {(['pcs', 'set', 'l', 'kg', 'm'] as const).map((u) => (
                  <option key={u} value={u}>
                    {t.stock.units[u]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t.stock.minQty} name="minQty">
              <input className="input input-amount mono" value={f.minQty} onChange={(e) => setF({ ...f, minQty: e.target.value })} inputMode="numeric" />
            </Field>
            <Field label={t.stock.salePrice} name="salePriceTetri">
              <input className="input input-amount mono" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" />
            </Field>
          </div>
        </FormSheet>
      )}
    </>
  );
}
