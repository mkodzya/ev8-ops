import { parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { ModelDrawer, NEW_MODEL } from '../components/ModelDrawer.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { BlockHead, Empty, Loading, PageHead, StateBadge, Vin } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
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
  const { data, failure, reload } = useLoad<Card>(id ? `/api/purchases/${id}` : null);
  const models = useLoad<{ models: { id: string; brand: string; name: string }[] }>(can('settings.manage') ? '/api/models' : null);
  const parts = useLoad<{ parts: PartRow[] }>(can('settings.manage') ? '/api/parts' : null);
  const [line, setLine] = useState({ modelId: '', partId: '', partName: '', qty: '1', price: '', asPart: false });
  const [paying, setPaying] = useState(false);
  const [pay, setPay] = useState({ amount: '', on: todayISO() });
  const [receiving, setReceiving] = useState(false);
  const [receipt, setReceipt] = useState<{ receivedOn: string; vins: Record<string, string> }>({ receivedOn: todayISO(), vins: {} });
  // Lines are added and removed in place; one operation at a time, its refusal under the lines.
  const lineOp = useOperation();
  const toast = useToast();
  // The model on the invoice may not be in the catalogue yet; it is made
  // here, over the order, rather than by leaving a half-typed line behind.
  const [addingModel, setAddingModel] = useState(false);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const p = data.purchase;
  const open = p.status === 'ordered';
  const mayEdit = open && can('settings.manage');

  const act = async (fn: (key: string) => Promise<unknown>, scope = 'add') => {
    const res = await lineOp.run(fn, scope);
    if (res.ok) reload();
  };

  return (
    <>
      <PageHead wrap title={p.number} sub={t.purchases.statuses[p.status]}>
        {open && can('payments.reconcile') && (
          <button type="button" className="pill pill-sm" onClick={() => setPaying(true)}>
            {t.purchases.addPayment}
          </button>
        )}
        {mayEdit && p.lines.some((l) => l.model) && (
          <button type="button" className="pill pill-sm pill-accent" onClick={() => setReceiving(true)}>
            {t.purchases.receive}
          </button>
        )}
      </PageHead>

      {paying && (
        <FormSheet
          title={t.purchases.addPayment}
          onClose={() => setPaying(false)}
          value={pay}
          initial={{ amount: '', on: todayISO() }}
          draft={`purchase-pay:${p.id}`}
          onRestore={setPay}
          summary={(v) => v.amount}
          label={t.purchases.recordPayment}
          submit={async (key) => {
            await api.post(`/api/purchases/${p.id}/payments`, { grossTetri: parseGel(pay.amount), occurredOn: pay.on }, { key });
            return { toast: { text: t.purchases.paymentRecorded } };
          }}
          onDone={() => {
            setPay({ amount: '', on: todayISO() });
            reload();
          }}
        >
          {/* Money going out: the customer-payment label read "the customer paid". */}
          <Field label={t.purchases.payAmount} name="grossTetri">
            <input className="input input-amount mono" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} inputMode="decimal" autoFocus />
          </Field>
          <Field label={t.payments.date} name="occurredOn">
            <input className="input mono" type="date" value={pay.on} onChange={(e) => setPay({ ...pay, on: e.target.value })} />
          </Field>
        </FormSheet>
      )}

      {receiving && mayEdit && (
        <FormSheet
          title={t.purchases.receive}
          onClose={() => setReceiving(false)}
          value={receipt}
          initial={{ receivedOn: todayISO(), vins: {} }}
          draft={`purchase-receive:${p.id}`}
          onRestore={setReceipt}
          label={t.purchases.receiveCta}
          submit={async (key) => {
            await api.post(
              `/api/purchases/${p.id}/receive`,
              {
                receivedOn: receipt.receivedOn,
                vins: Object.fromEntries(
                  p.lines
                    .filter((l) => l.model)
                    .map((l) => [l.id, (receipt.vins[l.id] ?? '').split('\n').map((v) => v.trim()).filter(Boolean)]),
                ),
              },
              { key },
            );
            return { toast: { text: t.purchases.received } };
          }}
          onDone={reload}
        >
          <p className="hint muted">{t.purchases.receiveHint}</p>
          <Field label={t.purchases.receivedOn} name="receivedOn">
            <input className="input mono" type="date" value={receipt.receivedOn} onChange={(e) => setReceipt({ ...receipt, receivedOn: e.target.value })} />
          </Field>
          <div data-field="vins">
            {p.lines.filter((l) => l.model).map((l) => (
              <Field key={l.id} label={`${l.model!.name} — ${l.qty}`}>
                <textarea
                  className="input textarea mono"
                  rows={Math.min(l.qty, 6)}
                  placeholder={t.purchases.vins}
                  value={receipt.vins[l.id] ?? ''}
                  onChange={(e) => setReceipt({ ...receipt, vins: { ...receipt.vins, [l.id]: e.target.value } })}
                />
              </Field>
            ))}
          </div>
        </FormSheet>
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
                        <Link to={`/service/stock/parts/${l.partId}`}>{l.partName}</Link>
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
                        <button type="button" className="pill pill-sm" onClick={() => void act((key) => api.del(`/api/purchases/${p.id}/lines/${l.id}`, { key }), `del:${l.id}`)}>
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
            <SubmitButton
              small
              type="button"
              state={lineOp.state}
              label={`+ ${t.purchases.addLine}`}
              onClick={() =>
                void act(async (key) => {
                  await api.post(
                    `/api/purchases/${p.id}/lines`,
                    {
                      modelId: line.asPart ? null : line.modelId || null,
                      partId: line.asPart && line.partId ? line.partId : null,
                      partName: line.asPart && !line.partId ? line.partName : null,
                      qty: Number(line.qty) || 1,
                      unitPrice: parseGel(line.price),
                    },
                    { key },
                  );
                  setLine({ ...line, partName: '', partId: '', qty: '1', price: '' });
                  toast({ text: t.purchases.lineAdded });
                })
              }
            />
          </div>
        )}
        {mayEdit && lineOp.failure && (
          <p className="field-err" role="alert">
            {lineOp.failure.fieldText ?? lineOp.failure.text}
          </p>
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
