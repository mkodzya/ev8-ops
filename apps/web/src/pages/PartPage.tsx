import { parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { FormSheet } from '../ds/form/Form.js';
import { fmtDate, formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { OrderButton, type PartRow } from './StockPage.js';

interface Move {
  id: string;
  kind: 'receipt' | 'issue' | 'adjust';
  qty: number;
  unitCostTetri: number | null;
  occurredOn: string;
  reason: string | null;
  actor: string | null;
  purchase: { id: string; number: string } | null;
  job: { id: string; number: string } | null;
}

interface Part {
  part: PartRow;
  moves: Move[];
}

type Sheet = 'initial' | 'receipt' | 'count' | 'edit';

/**
 * Карточка запчасти (wave 5 §3.8). What is on the shelf, what it is worth,
 * and every movement that put it there. An opening balance is offered while
 * the shelf has no history at all (B3-05, crit. 29); after that history is
 * added to — a receipt without an order, or a stocktake — and never
 * restarted.
 */
export function PartPage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { locale } = useLocale();
  const { data, failure, reload } = useLoad<Part>(id ? `/api/parts/${id}` : null);
  const [sheet, setSheet] = useState<Sheet | null>(null);

  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const p = data.part;
  const name = (locale === 'ka' && p.nameKa) || p.name;
  const seeCost = can('cost.view');
  const mayCount = can('stock.count');
  const fresh = data.moves.length === 0;
  const unit = t.stock.units[p.unit];

  const close = () => setSheet(null);
  const saved = () => {
    close();
    reload();
  };

  return (
    <>
      <PageHead wrap title={name} sub={p.archived ? t.stock.archived : p.sku ? <span className="mono">{p.sku}</span> : undefined}>
        {p.shortBy > 0 && can('purchases.manage') && <OrderButton part={p} />}
        {can('service.manage') && (
          <button type="button" className="pill pill-sm" onClick={() => setSheet('edit')}>
            {t.shelf.edit}
          </button>
        )}
        {mayCount && !fresh && (
          <button type="button" className="pill pill-sm" onClick={() => setSheet('receipt')}>
            {t.shelf.receipt}
          </button>
        )}
        {mayCount && !fresh && (
          <button type="button" className="pill pill-sm" onClick={() => setSheet('count')}>
            {t.shelf.count}
          </button>
        )}
        {mayCount && fresh && (
          <button type="button" className="pill pill-sm pill-accent" onClick={() => setSheet('initial')}>
            {t.shelf.initial}
          </button>
        )}
      </PageHead>

      <div className="num-strip">
        <span className={`num ${p.onHand < 0 ? 'num-crit' : ''}`}>
          <span className="num-v">
            {p.onHand} <span className="muted">{unit}</span>
          </span>
          <span className="num-l">{t.shelf.onHand}</span>
        </span>
        {p.minQty > 0 && (
          <span className="num">
            <span className="num-v">{p.minQty}</span>
            <span className="num-l">{t.shelf.minQty}</span>
          </span>
        )}
        {seeCost && (
          <>
            <span className="num">
              <span className="num-v">{p.avgCostTetri == null ? t.common.dash : formatGel(p.avgCostTetri)}</span>
              <span className="num-l">{t.shelf.avgCost}</span>
            </span>
            <span className="num">
              <span className="num-v">{formatGel(p.valueTetri)}</span>
              <span className="num-l">{t.shelf.value}</span>
            </span>
          </>
        )}
      </div>

      {p.onHand < 0 && <div className="hint hint-bad">{t.stock.negativeHint}</div>}
      {fresh && <div className="hint">{t.shelf.noMovesYet}</div>}

      {(p.salePriceTetri != null || p.nameKa || p.notes) && (
        <section className="card">
          {p.nameKa && <Row k={t.stock.nameKa} v={p.nameKa} />}
          {p.salePriceTetri != null && <Row k={t.stock.salePrice} v={<span className="mono">{formatGel(p.salePriceTetri)}</span>} />}
          {p.notes && <Row k={t.stock.notes} v={<span className="pre">{p.notes}</span>} />}
        </section>
      )}

      <section className="card">
        <BlockHead title={t.shelf.moves} sub={t.stock.movesCount(data.moves.length)} />
        {data.moves.length === 0 ? (
          <Empty text={t.stock.noMoves} />
        ) : (
          <ul className="timeline">
            {data.moves.map((m) => (
              <li key={m.id}>
                <span className="mono muted">{fmtDate(m.occurredOn)}</span>
                <span>
                  <span className={`mono ${m.qty < 0 ? 'crit-text' : ''}`}>
                    {m.qty > 0 ? '+' : ''}
                    {m.qty}
                  </span>{' '}
                  {t.stock.kinds[m.kind]}
                  {seeCost && m.unitCostTetri != null && (
                    <span className="muted">
                      {' · '}
                      {t.shelf.moveCost} <span className="mono">{formatGel(m.unitCostTetri)}</span>
                    </span>
                  )}
                  {m.purchase && (
                    <>
                      {' · '}
                      <Link to={`/purchases/${m.purchase.id}`} className="mono">
                        {m.purchase.number}
                      </Link>
                    </>
                  )}
                  {m.job && (
                    <>
                      {' · '}
                      <Link to={`/service/${m.job.id}`} className="mono">
                        {m.job.number}
                      </Link>
                    </>
                  )}
                  {m.reason && <span className="muted"> · {m.reason}</span>}
                  {m.actor && <span className="muted"> · {m.actor}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {sheet === 'initial' && <InitialSheet part={p} onClose={close} onSaved={saved} />}
      {sheet === 'receipt' && <ReceiptSheet part={p} onClose={close} onSaved={saved} />}
      {sheet === 'count' && <CountSheet part={p} onClose={close} onSaved={saved} />}
      {sheet === 'edit' && <EditSheet part={p} onClose={close} onSaved={saved} />}
    </>
  );
}

/** The first count of a shelf nobody has moved yet: how many, and what one cost (B3-05). */
function InitialSheet({ part, onClose, onSaved }: { part: PartRow; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const initial = { qty: '', cost: '', on: todayISO() };
  const [f, setF] = useState(initial);
  const value = (Number(f.qty) || 0) * (parseGel(f.cost) ?? 0);

  return (
    <FormSheet
      title={t.shelf.initial}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={`part-initial:${part.id}`}
      onRestore={setF}
      summary={(v) => v.qty}
      label={t.shelf.initialCta}
      submit={async (key) => {
        await api.post(`/api/parts/${part.id}/initial`, { qty: Number(f.qty), unitCostTetri: parseGel(f.cost), occurredOn: f.on }, { key });
        return { toast: { text: t.shelf.initialDone } };
      }}
      onDone={onSaved}
    >
      <div className="two-col two-col-tight">
        <Field label={t.shelf.initialQty} name="qty">
          <input className="input input-amount mono" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="numeric" autoFocus />
        </Field>
        <Field label={t.shelf.initialCost} name="unitCostTetri">
          <input className="input input-amount mono" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t.shelf.initialOn} name="occurredOn">
          <input className="input mono" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
        </Field>
      </div>
      <p className="hint">{t.shelf.initialWillBe(formatGel(value))}</p>
    </FormSheet>
  );
}

/** Parts bought in a shop down the road, or brought back from a workshop (§3.8). */
function ReceiptSheet({ part, onClose, onSaved }: { part: PartRow; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const initial = { qty: '', cost: '', reason: '', on: todayISO() };
  const [f, setF] = useState(initial);

  return (
    <FormSheet
      title={t.shelf.receipt}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={`part-receipt:${part.id}`}
      onRestore={setF}
      summary={(v) => v.reason}
      label={t.shelf.receiptCta}
      submit={async (key) => {
        await api.post(`/api/parts/${part.id}/receipt`, { qty: Number(f.qty), unitCostTetri: parseGel(f.cost), reason: f.reason, occurredOn: f.on }, { key });
        return { toast: { text: t.shelf.receiptDone } };
      }}
      onDone={onSaved}
    >
      <div className="two-col two-col-tight">
        <Field label={t.shelf.receiptQty} name="qty">
          <input className="input input-amount mono" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="numeric" autoFocus />
        </Field>
        <Field label={t.shelf.receiptCost} name="unitCostTetri">
          <input className="input input-amount mono" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t.shelf.receiptOn} name="occurredOn">
          <input className="input mono" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
        </Field>
      </div>
      <Field label={t.shelf.receiptReason} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required />
      </Field>
    </FormSheet>
  );
}

/** A stocktake: what a person counted, and where the difference came from. */
function CountSheet({ part, onClose, onSaved }: { part: PartRow; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const initial = { qty: String(part.onHand), reason: '', on: todayISO() };
  const [f, setF] = useState(initial);

  return (
    <FormSheet
      title={t.shelf.count}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={`part-count:${part.id}`}
      onRestore={setF}
      summary={(v) => v.qty}
      label={t.stock.saveCount}
      submit={async (key) => {
        await api.post(`/api/parts/${part.id}/count`, { countedQty: f.qty === '' ? null : Number(f.qty), reason: f.reason, occurredOn: f.on }, { key });
        return { toast: { text: t.stock.countSaved } };
      }}
      onDone={onSaved}
    >
      <p className="hint">{t.stock.countHint}</p>
      <Field label={t.stock.countedQty} name="countedQty">
        <input className="input input-amount mono" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="numeric" autoFocus />
      </Field>
      <Field label={t.stock.countReason} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required />
      </Field>
      <Field label={t.payments.date} name="occurredOn">
        <input className="input mono" type="date" value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/** The card itself: its names, its article number, the minimum and the price. */
function EditSheet({ part, onClose, onSaved }: { part: PartRow; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const initial = {
    name: part.name,
    nameKa: part.nameKa ?? '',
    sku: part.sku ?? '',
    minQty: part.minQty > 0 ? String(part.minQty) : '',
    price: part.salePriceTetri != null ? (part.salePriceTetri / 100).toFixed(2) : '',
    notes: part.notes ?? '',
  };
  const [f, setF] = useState(initial);

  return (
    <FormSheet
      title={t.shelf.editTitle(part.name)}
      onClose={onClose}
      value={f}
      initial={initial}
      onRestore={setF}
      label={t.shelf.editSave}
      // The name or the article number is taken: the refusal goes under the one that was typed to be unique.
      fieldOf={{ part_exists: f.sku.trim() ? 'sku' : 'name' }}
      submit={async (key) => {
        await api.patch(
          `/api/parts/${part.id}`,
          {
            name: f.name,
            nameKa: f.nameKa || null,
            sku: f.sku || null,
            minQty: f.minQty === '' ? 0 : Number(f.minQty),
            salePriceTetri: f.price ? parseGel(f.price) : null,
            notes: f.notes || null,
          },
          { key },
        );
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onSaved}
    >
      <div className="two-col">
        <Field label={t.stock.name} name="name">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required autoFocus />
        </Field>
        <Field label={t.stock.nameKa} name="nameKa">
          <input className="input" value={f.nameKa} onChange={(e) => setF({ ...f, nameKa: e.target.value })} />
        </Field>
        <Field label={t.stock.sku} name="sku">
          <input className="input mono" value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value })} />
        </Field>
        <Field label={t.shelf.minQty} name="minQty">
          <input className="input input-amount mono" value={f.minQty} onChange={(e) => setF({ ...f, minQty: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label={t.stock.salePrice} name="salePriceTetri">
          <input className="input input-amount mono" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" />
        </Field>
      </div>
      <Field label={t.stock.notes} name="notes">
        <textarea className="input" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
    </FormSheet>
  );
}
