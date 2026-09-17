import { parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { ModelDrawer, NEW_MODEL } from '../components/ModelDrawer.js';
import { Drawer } from '../components/Drawer.js';
import { BlockHead, Empty, Loading, PageHead, StateBadge, Vin } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { fmtForeign, type Purchase } from './PurchasesPage.js';
import type { PartRow } from './StockPage.js';
import type { VehicleState } from '@ev8/shared';

interface Card {
  purchase: Purchase;
  vehicles: { id: string; vin: string; state: VehicleState; costTetri: number | null; model: string }[];
}

/** One order: what was invoiced, what was paid, and what each unit cost. */
export function PurchasePage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<Card>(id ? `/api/purchases/${id}` : null);
  const models = useLoad<{ models: { id: string; brand: string; name: string }[] }>(can('settings.manage') ? '/api/models' : null);
  const parts = useLoad<{ parts: PartRow[] }>(can('settings.manage') ? '/api/parts' : null);
  const [err, setErr] = useState<string | null>(null);
  const [line, setLine] = useState({ modelId: '', partId: '', partName: '', qty: '1', price: '', asPart: false });
  const [pay, setPay] = useState({ open: false, amount: '', on: todayISO() });
  const [receiving, setReceiving] = useState(false);
  const [vins, setVins] = useState<Record<string, string>>({});
  const [receivedOn, setReceivedOn] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  // The model on the invoice may not be in the catalogue yet; it is made
  // here, over the order, rather than by leaving a half-typed line behind.
  const [addingModel, setAddingModel] = useState(false);

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const p = data.purchase;
  const open = p.status === 'ordered';
  const mayEdit = open && can('settings.manage');

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const closePay = () => {
    setPay({ ...pay, open: false });
    setErr(null);
  };
  const closeReceive = () => {
    setReceiving(false);
    setErr(null);
  };

  return (
    <>
      <PageHead wrap title={p.number} sub={t.purchases.statuses[p.status]}>
        {open && can('payments.reconcile') && (
          <button type="button" className="pill pill-sm" onClick={() => setPay({ ...pay, open: true })}>
            {t.purchases.addPayment}
          </button>
        )}
        {mayEdit && p.lines.some((l) => l.model) && (
          <button type="button" className="pill pill-sm pill-accent" onClick={() => setReceiving(true)}>
            {t.purchases.receive}
          </button>
        )}
      </PageHead>
      {err && <div className="hint hint-bad">{err}</div>}

      {pay.open && (
        <Drawer title={t.purchases.addPayment} onClose={closePay}>
          <Field label={t.payments.gross}>
            <input className="input input-amount mono" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} inputMode="decimal" autoFocus />
          </Field>
          <Field label={t.payments.date}>
            <input className="input mono" type="date" value={pay.on} onChange={(e) => setPay({ ...pay, on: e.target.value })} />
          </Field>
          {err && <div className="hint hint-bad">{err}</div>}
          <div className="row-actions">
            <button type="button" className="pill" onClick={closePay}>
              {t.actions.cancel}
            </button>
            <button
              type="button"
              className="pill pill-accent"
              disabled={busy || parseGel(pay.amount) == null}
              onClick={() => void act(async () => {
                await api.post(`/api/purchases/${p.id}/payments`, { grossTetri: parseGel(pay.amount), occurredOn: pay.on });
                setPay({ ...pay, open: false, amount: '' });
              })}
            >
              {t.actions.confirm}
            </button>
          </div>
        </Drawer>
      )}

      {receiving && mayEdit && (
        <Drawer title={t.purchases.receive} onClose={closeReceive}>
          <p className="hint muted">{t.purchases.receiveHint}</p>
          <Field label={t.purchases.receivedOn}>
            <input className="input mono" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </Field>
          {p.lines.filter((l) => l.model).map((l) => (
            <Field key={l.id} label={`${l.model!.name} — ${l.qty}`}>
              <textarea
                className="input textarea mono"
                rows={Math.min(l.qty, 6)}
                placeholder={t.purchases.vins}
                value={vins[l.id] ?? ''}
                onChange={(e) => setVins({ ...vins, [l.id]: e.target.value })}
              />
            </Field>
          ))}
          {err && <div className="hint hint-bad">{err}</div>}
          <div className="row-actions">
            <button type="button" className="pill" onClick={closeReceive}>
              {t.actions.cancel}
            </button>
            <button
              type="button"
              className="pill pill-accent"
              disabled={busy}
              onClick={() => void act(async () => {
                await api.post(`/api/purchases/${p.id}/receive`, {
                  receivedOn,
                  vins: Object.fromEntries(
                    p.lines
                      .filter((l) => l.model)
                      .map((l) => [l.id, (vins[l.id] ?? '').split('\n').map((v) => v.trim()).filter(Boolean)]),
                  ),
                });
                setReceiving(false);
              })}
            >
              {t.actions.confirm}
            </button>
          </div>
        </Drawer>
      )}

      <div className="two-col">
        <section className="card">
          <Row k={t.purchases.supplier} v={<Link to={`/customers/${p.supplier.id}`}>{p.supplier.name}</Link>} />
          <Row k={t.purchases.invoiceNo} v={p.invoiceNo ?? t.common.dash} />
          <Row k={t.purchases.invoiceDate} v={<span className="mono">{fmtDate(p.invoiceDate)}</span>} />
          <Row k={t.purchases.orderedOn} v={<span className="mono">{fmtDate(p.orderedOn)}</span>} />
          <Row k={t.purchases.receivedOn} v={<span className="mono">{fmtDate(p.receivedOn)}</span>} />
          {p.notes && <Row k={t.rental.notes} v={<span className="pre">{p.notes}</span>} />}
        </section>
        <section className="card">
          <Row k={t.purchases.invoiceTotal} v={<span className="mono">{fmtForeign(p.invoiceMinor, p.currency)}</span>} />
          <Row k={t.purchases.paid} v={<span className="mono">{formatGel(p.paidTetri)}</span>} />
          <Row
            k={t.purchases.rate}
            v={p.rate == null ? <span className="muted">{t.purchases.rateHint}</span> : <span className="mono">{p.rate}</span>}
          />
          <Row k={t.purchases.extras} v={<span className="mono">{formatGel(p.extrasTetri)}</span>} />
          {p.extrasNote && <Row k={t.purchases.extrasNote} v={<span className="muted">{p.extrasNote}</span>} />}
          <Row k={t.purchases.units} v={<span className="mono">{p.units}</span>} />
        </section>
      </div>

      <section className="card">
        <BlockHead title={t.purchases.lines} sub={t.purchases.linesCount(p.lines.length)} />
        {p.lines.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <div className="table-wrap table-flat">
            {/* Seven money columns with long names: the headings wrap so the
                numbers fit the card instead of scrolling out of it. */}
            <table className="table table-heads-wrap">
              <thead>
                <tr>
                  <th>{t.purchases.line}</th>
                  <th className="num nowrap">{t.purchases.qty}</th>
                  <th className="num">{t.purchases.unitPrice}</th>
                  <th className="num">{t.purchases.lineTotal}</th>
                  <th className="num">{t.purchases.fob}</th>
                  <th className="num">{t.purchases.extras}</th>
                  <th className="num">{t.purchases.unitCost}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.model ? (
                        l.model.name
                      ) : l.partId ? (
                        <Link to={`/stock/parts/${l.partId}`}>{l.partName}</Link>
                      ) : (
                        <span className="muted">{l.partName}</span>
                      )}
                    </td>
                    <td className="num mono">{l.qty}</td>
                    <td className="num mono">{fmtForeign(l.unitPriceMinor, p.currency)}</td>
                    <td className="num mono">{fmtForeign(l.lineMinor, p.currency)}</td>
                    <td className="num mono">{formatGel(l.fobTetri)}</td>
                    <td className="num mono">{formatGel(l.extrasTetri)}</td>
                    <td className="num mono">{formatGel(l.unitCostTetri)}</td>
                    <td className="num">
                      {mayEdit && (
                        <button type="button" className="pill pill-sm" onClick={() => void act(() => api.del(`/api/purchases/${p.id}/lines/${l.id}`))}>
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {mayEdit && (
          <div className="row-actions">
            {line.asPart ? (
              <>
                {/* A line that names a part from the catalogue lands on the
                    shelf when the shipment arrives; a typed one does not. */}
                <select
                  className="input input-inline"
                  value={line.partId}
                  onChange={(e) => setLine({ ...line, partId: e.target.value, partName: '' })}
                >
                  <option value="">{t.stock.freeText}</option>
                  {(parts.data?.parts ?? []).map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.name}
                    </option>
                  ))}
                </select>
                {!line.partId && (
                  <input className="input input-inline" placeholder={t.purchases.part} value={line.partName} onChange={(e) => setLine({ ...line, partName: e.target.value })} />
                )}
              </>
            ) : (
              <select
                className="input input-inline"
                value={line.modelId}
                onChange={(e) => (e.target.value === NEW_MODEL ? setAddingModel(true) : setLine({ ...line, modelId: e.target.value }))}
              >
                <option value="">{t.common.dash}</option>
                {(models.data?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.brand} {m.name}
                  </option>
                ))}
                <option value={NEW_MODEL}>+ {t.models.addEllipsis}</option>
              </select>
            )}
            <input className="input input-amount mono" placeholder={t.purchases.qty} value={line.qty} onChange={(e) => setLine({ ...line, qty: e.target.value })} inputMode="numeric" />
            <input className="input input-amount mono" placeholder={t.purchases.unitPriceShort(p.currency)} value={line.price} onChange={(e) => setLine({ ...line, price: e.target.value })} inputMode="decimal" />
            <label className="check">
              <input type="checkbox" checked={line.asPart} onChange={(e) => setLine({ ...line, asPart: e.target.checked })} />
              <span>{t.purchases.part}</span>
            </label>
            <button
              type="button"
              className="pill pill-sm pill-accent"
              disabled={busy || parseGel(line.price) == null || (line.asPart ? !line.partName.trim() && !line.partId : !line.modelId)}
              onClick={() => void act(async () => {
                await api.post(`/api/purchases/${p.id}/lines`, {
                  modelId: line.asPart ? null : line.modelId,
                  partId: line.asPart && line.partId ? line.partId : null,
                  partName: line.asPart && !line.partId ? line.partName : null,
                  qty: Number(line.qty) || 1,
                  unitPrice: parseGel(line.price),
                });
                setLine({ ...line, partName: '', partId: '', qty: '1', price: '' });
              })}
            >
              + {t.purchases.addLine}
            </button>
          </div>
        )}
      </section>

      {data.vehicles.length > 0 && (
        <section className="card">
          <BlockHead title={t.purchases.vehicles} sub={t.fleet.count(data.vehicles.length)} />
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.fleet.vin}</th>
                  <th>{t.fleet.model}</th>
                  <th>{t.fleet.state}</th>
                  <th className="num">{t.purchases.cost}</th>
                </tr>
              </thead>
              <tbody>
                {data.vehicles.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link to={`/fleet/${v.id}`}>
                        <Vin vin={v.vin} />
                      </Link>
                    </td>
                    <td>{v.model}</td>
                    <td>
                      <StateBadge state={v.state} />
                    </td>
                    <td className="num mono">{formatGel(v.costTetri)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <BlockHead title={t.payments.title} sub={t.payments.count(p.payments.length)} />
        {p.payments.length === 0 ? (
          <Empty text={t.payments.none} />
        ) : (
          <ul className="timeline">
            {p.payments.map((x) => (
              <li key={x.id}>
                <span className="mono muted">{fmtDate(x.occurredOn)}</span>
                <span className="mono crit-text">-{formatGel(x.grossTetri)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      {addingModel && (
        <ModelDrawer
          brands={(models.data?.models ?? []).map((m) => m.brand)}
          onClose={() => setAddingModel(false)}
          onSaved={(m) => {
            setAddingModel(false);
            models.reload();
            setLine((l) => ({ ...l, modelId: m.id, asPart: false }));
          }}
        />
      )}
    </>
  );
}
