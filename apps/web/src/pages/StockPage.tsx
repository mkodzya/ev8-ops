import { parseGel, spellingMatches } from '@ev8/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { Drawer } from '../components/Drawer.js';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { DataList } from '../ds/list/DataList.js';
import { formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

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
  /** A GPS tracker: fitting one asks for its IMEI and SIM (ADR-0036). */
  isTracker: boolean;
  onHand: number;
  valueTetri: number | null;
  avgCostTetri: number | null;
  /** How many are missing against «держать не меньше»; 0 when the shelf is enough. */
  shortBy: number;
}

interface Parts {
  parts: PartRow[];
  totals: { parts: number; valueTetri: number | null; short: number; negative: number };
}

/**
 * «Склад → Запчасти» (wave 5 §3.8; a section of its own since issue #19, was
 * «Ремонты → Склад»). Parts only — the mopeds-by-model table went back to
 * «Парк → Модели», where a moped is a VIN with a state rather than a line in
 * a stock report (deviation 3 of wave 1, crit. 30). What is short opens the
 * page by itself when anything is, because that is the only row on this
 * screen that asks for something to be done today.
 */
export function StockPage() {
  const t = useT();
  const { can } = useSession();
  const { locale } = useLocale();
  const { data, failure, reload } = useLoad<Parts>('/api/parts');
  const [params, setParams] = useSearchParams();
  const applied = useRef(false);

  const short = data?.totals.short ?? 0;
  useEffect(() => {
    // Once per visit: after that the chips are whatever the person chose,
    // «Все» included, and the address is what they can send to somebody.
    if (applied.current || short === 0) return;
    applied.current = true;
    if (params.get('f') != null || params.get('q')) return;
    const next = new URLSearchParams(params);
    next.set('f', 'short');
    setParams(next, { replace: true });
  }, [short, params, setParams]);

  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const partName = (p: PartRow) => (locale === 'ka' && p.nameKa) || p.name;
  const seeCost = can('cost.view');
  const mayOrder = can('purchases.manage');

  return (
    <>
      <PageHead
        wrap
        title={t.nav.stock}
        sub={
          <>
            {t.stock.partsCount(data.parts.length)}
            {seeCost && data.totals.valueTetri != null && (
              <>
                {' · '}
                {t.shelf.value} <span className="mono">{formatGel(data.totals.valueTetri)}</span>
              </>
            )}
          </>
        }
      >
        {can('service.manage') && <NewPart onDone={reload} />}
      </PageHead>

      {data.totals.negative > 0 && <div className="hint hint-bad">{t.stock.negativeHint}</div>}

      <DataList
        rows={data.parts}
        rowKey={(p) => p.id}
        fallback={(a, b) => b.shortBy - a.shortBy || partName(a).localeCompare(partName(b))}
        search={{
          placeholder: t.shelf.searchHint,
          match: (p, q) => spellingMatches(q, [p.name, p.nameKa, p.sku]),
        }}
        chips={[
          { key: 'short', label: t.shelf.chips.short, test: (p) => p.shortBy > 0 },
          { key: 'negative', label: t.shelf.chips.negative, test: (p) => p.onHand < 0 },
        ]}
        empty={{ text: t.stock.none }}
        card={(p) => ({
          title: <Link to={`/stock/parts/${p.id}`}>{partName(p)}</Link>,
          sub: (
            <>
              {p.sku && <span className="mono">{p.sku}</span>}
              {p.sku && p.minQty > 0 && ' · '}
              {p.minQty > 0 && t.shelf.keepAtLeast(p.minQty)}
            </>
          ),
          right: (
            <span className={`t-money ${p.onHand < 0 ? 'crit-text' : p.shortBy > 0 ? 'warn-text' : ''}`}>
              {p.onHand} <span className="muted">{t.stock.units[p.unit]}</span>
            </span>
          ),
          rightSub: p.shortBy > 0 && mayOrder ? <OrderButton part={p} /> : seeCost && p.valueTetri != null ? formatGel(p.valueTetri) : undefined,
        })}
        columns={[
          {
            key: 'name',
            label: t.stock.name,
            cell: (p) => <Link to={`/stock/parts/${p.id}`}>{partName(p)}</Link>,
            sort: { value: (p) => partName(p) },
          },
          { key: 'sku', label: t.stock.sku, cell: (p) => <span className="muted mono">{p.sku ?? t.common.dash}</span>, sort: { value: (p) => p.sku } },
          {
            key: 'onHand',
            label: t.shelf.onHand,
            num: true,
            cell: (p) => (
              <span className={`mono ${p.onHand < 0 ? 'crit-text' : p.shortBy > 0 ? 'warn-text' : ''}`}>
                {p.onHand} <span className="muted">{t.stock.units[p.unit]}</span>
              </span>
            ),
            sort: { value: (p) => p.onHand },
          },
          {
            key: 'minQty',
            label: t.shelf.minQty,
            num: true,
            cell: (p) => <span className="mono muted">{p.minQty > 0 ? p.minQty : t.common.dash}</span>,
            sort: { value: (p) => p.minQty, first: 'desc' },
          },
          ...(seeCost
            ? [
                {
                  key: 'avgCost',
                  label: t.shelf.avgCost,
                  num: true,
                  cell: (p: PartRow) => <span className="mono">{p.avgCostTetri == null ? t.common.dash : formatGel(p.avgCostTetri)}</span>,
                  sort: { value: (p: PartRow) => p.avgCostTetri, first: 'desc' as const },
                },
                {
                  key: 'value',
                  label: t.shelf.value,
                  num: true,
                  cell: (p: PartRow) => <span className="mono">{p.valueTetri == null ? t.common.dash : formatGel(p.valueTetri)}</span>,
                  sort: { value: (p: PartRow) => p.valueTetri, first: 'desc' as const },
                },
              ]
            : []),
          {
            key: 'order',
            label: '',
            cell: (p) => (p.shortBy > 0 && mayOrder ? <OrderButton part={p} /> : null),
          },
        ]}
      />
    </>
  );
}

/**
 * «В заказ» (B8-05, crit. 28): a draft order to whoever supplied this part
 * last, with one line for what is missing. The order opens straight away —
 * the point of the button is that nobody has to go and build it.
 */
export function OrderButton({ part }: { part: PartRow }) {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const op = useOperation();
  // Nobody has supplied this part yet. The refusal used to be the end of the
  // road — and a part somebody just created has no supplier by definition, so
  // the button never worked for it (QA-W5-15). Now the refusal opens the
  // question it was asking: which supplier.
  const [asking, setAsking] = useState(false);
  const suppliers = useLoad<{ suppliers: { id: string; name: string }[] }>(asking ? '/api/suppliers' : null);

  const order = async (supplierId?: string) => {
    const res = await op.run((key) =>
      api.post<{ id: string; number: string }>('/api/purchases/from-part', { partId: part.id, ...(supplierId ? { supplierId } : {}) }, { key }),
    );
    // `run` reports the refusal through `op.failure`, which is read after it.
    if (!res.ok) return;
    setAsking(false);
    toast({ text: t.shelf.ordered(res.value.number) });
    navigate(`/purchases/${res.value.id}`);
  };

  return (
    <>
      <SubmitButton small type="button" state={op.state} label={t.shelf.order} onClick={() => void order()} />
      {op.failure?.code === 'no_supplier' && !asking && (
        <button type="button" className="pill pill-sm" onClick={() => setAsking(true)}>
          {t.shelf.pickSupplier}
        </button>
      )}
      {asking && (
        <Drawer title={t.shelf.order} onClose={() => setAsking(false)}>
          <p className="hint">{t.shelf.pickSupplier}</p>
          <ul className="pick-list">
            {(suppliers.data?.suppliers ?? []).map((sup) => (
              <li key={sup.id}>
                <button type="button" onClick={() => void order(sup.id)}>
                  <span className="pick-main">{sup.name}</span>
                </button>
              </li>
            ))}
          </ul>
          {suppliers.data?.suppliers.length === 0 && <p className="empty">{t.shelf.noSuppliers}</p>}
        </Drawer>
      )}
      {op.failure && !asking && <span className="field-err">{op.failure.text}</span>}
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
          // The name or the article number is taken: the refusal goes under the one that was typed to be unique.
          fieldOf={{ part_exists: f.sku.trim() ? 'sku' : 'name' }}
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
            return { created: part.id, toast: { text: t.stock.partAdded, open: `/stock/parts/${part.id}` } };
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
            <Field label={t.shelf.minQty} name="minQty">
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
