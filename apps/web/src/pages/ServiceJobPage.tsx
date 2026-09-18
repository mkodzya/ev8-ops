import { parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { LoadError } from '../components/LoadError.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { BlockHead, Empty, Loading, PageHead, Vin } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { uploadAll, type PreparedPhoto } from '../lib/photos.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import type { PartRow } from './StockPage.js';
import type { ServiceJob } from './ServicePage.js';

/** One repair: what it cost, what was photographed, and how it was settled. */
export function ServiceJobPage() {
  const { id } = useParams();
  const t = useT();
  const openMoney = useMoneyForm();
  const navigate = useNavigate();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<{ job: ServiceJob }>(id ? `/api/service/${id}` : null);
  const [part, setPart] = useState({ partId: '', name: '', qty: '1', price: '' });
  const parts = useLoad<{ parts: PartRow[] }>(can('service.manage') ? '/api/parts' : null);
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [closing, setClosing] = useState(false);
  const [closure, setClosure] = useState({ closedOn: todayISO(), withhold: '' });
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  // Parts and photos are changed in place; one operation at a time, its refusal beside it.
  const partOp = useOperation();
  const photoOp = useOperation();
  const toast = useToast();

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const j = data.job;
  const open = j.status === 'open';
  const mayEdit = open && can('service.manage');
  const mayWithhold = can('deposit.decide') && j.payer === 'customer' && j.rental != null;

  const partAct = async (fn: (key: string) => Promise<unknown>, scope: string) => {
    const res = await partOp.run(fn, scope);
    if (res.ok) reload();
    return res.ok;
  };

  return (
    <>
      <PageHead wrap title={j.number} sub={<span className={open ? 'warn-text' : undefined}>{t.service.statuses[j.status]}</span>}>
        {mayEdit && (
          <>
            <button type="button" className="pill pill-sm" onClick={() => setCancelling(true)}>
              {t.service.cancel}
            </button>
            <button type="button" className="pill pill-sm pill-accent" onClick={() => setClosing(true)}>
              {t.service.close}
            </button>
          </>
        )}
      </PageHead>

      {cancelling && mayEdit && (
        <FormSheet
          title={t.service.cancel}
          onClose={() => setCancelling(false)}
          value={cancelReason}
          initial=""
          draft={`job-cancel:${j.id}`}
          onRestore={setCancelReason}
          summary={(v) => v}
          label={t.service.cancelCta}
          submit={async (key) => {
            await api.post(`/api/service/${j.id}/cancel`, { reason: cancelReason }, { key });
            return { toast: { text: t.service.cancelled } };
          }}
          onDone={() => navigate('/service')}
        >
          <Field label={t.service.cancelReason} name="reason">
            <input className="input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
          </Field>
        </FormSheet>
      )}

      {closing && mayEdit && (
        <FormSheet
          title={t.service.close}
          onClose={() => setClosing(false)}
          value={closure}
          initial={{ closedOn: todayISO(), withhold: '' }}
          draft={`job-close:${j.id}`}
          onRestore={setClosure}
          label={t.service.closeCta}
          submit={async (key) => {
            await api.post(`/api/service/${j.id}/close`, { closedOn: closure.closedOn, withheldTetri: closure.withhold ? parseGel(closure.withhold) : 0 }, { key });
            return { toast: { text: t.service.closed } };
          }}
          onDone={reload}
        >
          <Field label={t.service.closedOn} name="closedOn">
            <input className="input mono" type="date" value={closure.closedOn} onChange={(e) => setClosure({ ...closure, closedOn: e.target.value })} />
          </Field>
          {mayWithhold && (
            <Field label={t.service.withhold} hint={t.service.withholdHint} name="withheldTetri">
              <input className="input input-amount mono" value={closure.withhold} onChange={(e) => setClosure({ ...closure, withhold: e.target.value })} inputMode="decimal" />
            </Field>
          )}
        </FormSheet>
      )}

      <div className="two-col">
        <section className="card">
          <Row
            k={t.service.vehicle}
            v={
              <Link to={`/fleet/${j.vehicle.id}`}>
                <Vin vin={j.vehicle.vin} /> <span className="muted">{j.vehicle.model}</span>
              </Link>
            }
          />
          <Row k={t.service.reason} v={j.reason} />
          <Row k={t.service.openedOn} v={<span className="mono">{fmtDate(j.openedOn)}</span>} />
          <Row k={t.service.closedOn} v={<span className="mono">{fmtDate(j.closedOn)}</span>} />
          <Row k={t.service.doneBy} v={j.doneBy ?? t.common.dash} />
          <Row k={t.service.payer} v={t.service.payers[j.payer]} />
          {j.rental && (
            <Row
              k={t.rentals.title}
              v={
                <Link to={`/rentals/${j.rental.id}`} className="mono">
                  {j.rental.number}
                </Link>
              }
            />
          )}
          {j.customer && (
            <Row k={t.rentals.customer} v={<Link to={`/customers/${j.customer.id}`}>{j.customer.name}</Link>} />
          )}
          {j.notes && <Row k={t.rental.notes} v={<span className="pre">{j.notes}</span>} />}
        </section>

        <section className="card">
          <BlockHead title={t.service.total} />
          <Row k={t.service.labour} v={<span className="mono">{formatGel(j.labourTetri)}</span>} />
          <Row k={t.service.parts} v={<span className="mono">{formatGel(j.partsTetri)}</span>} />
          <Row k={t.service.total} v={<span className="mono">{formatGel(j.totalTetri)}</span>} />
          {j.withheldTetri > 0 && <Row k={t.service.withhold} v={<span className="mono">{formatGel(j.withheldTetri)}</span>} />}
          {/* A repair charged to the customer is paid through the one money form (wave 2 §3.1). */}
          {j.payer === 'customer' && j.status === 'done' && j.customer && can('cash.record') && (
            <div className="row-actions">
              <button
                type="button"
                className="pill pill-sm pill-accent"
                onClick={() => openMoney({ target: { kind: 'service', serviceJobId: j.id, number: j.number, customerId: j.customer!.id, customer: j.customer!.name } })}
              >
                {can('payments.reconcile') ? t.money.take : t.money.takeCash}
              </button>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <BlockHead title={t.service.parts} sub={t.stock.partsCount(j.parts.length)} />
        {j.parts.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.service.part}</th>
                  <th className="num">{t.service.qty}</th>
                  <th className="num">{t.service.unitPrice}</th>
                  <th className="num">{t.service.total}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {j.parts.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td className="num mono">{p.qty}</td>
                    <td className="num mono">{formatGel(p.unitPriceTetri)}</td>
                    <td className="num mono">{formatGel(p.qty * p.unitPriceTetri)}</td>
                    <td className="num">
                      {mayEdit && (
                        <button
                          type="button"
                          className="pill pill-sm"
                          onClick={() => void partAct((key) => api.del(`/api/service/${j.id}/parts/${p.id}`, { key }), `del:${p.id}`)}
                        >
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
            {/* Picked off the shelf, or just named: a repair on a part
                nobody stocks is still a repair. */}
            <select
              className="input input-inline"
              value={part.partId}
              onChange={(e) => {
                const picked = (parts.data?.parts ?? []).find((x) => x.id === e.target.value);
                setPart({
                  ...part,
                  partId: e.target.value,
                  name: '',
                  // The catalogue's usual charge, ready to be overtyped.
                  price: picked?.salePriceTetri != null ? (picked.salePriceTetri / 100).toFixed(2) : part.price,
                });
              }}
            >
              <option value="">{t.stock.freeText}</option>
              {(parts.data?.parts ?? []).map((pt) => (
                <option key={pt.id} value={pt.id}>
                  {pt.name} · {pt.onHand} {t.stock.units[pt.unit]}
                </option>
              ))}
            </select>
            {!part.partId && (
              <input className="input input-inline" placeholder={t.service.part} value={part.name} onChange={(e) => setPart({ ...part, name: e.target.value })} />
            )}
            <input className="input input-amount mono" placeholder={t.service.qty} value={part.qty} onChange={(e) => setPart({ ...part, qty: e.target.value })} inputMode="numeric" />
            <input className="input input-amount mono" placeholder={t.service.unitPrice} value={part.price} onChange={(e) => setPart({ ...part, price: e.target.value })} inputMode="decimal" />
            <SubmitButton
              small
              type="button"
              state={partOp.state}
              label={`+ ${t.service.addPart}`}
              onClick={() =>
                void partAct(async (key) => {
                  await api.post(
                    `/api/service/${j.id}/parts`,
                    { partId: part.partId || null, name: part.partId ? null : part.name, qty: Number(part.qty) || 1, unitPriceTetri: parseGel(part.price) },
                    { key },
                  );
                  setPart({ partId: '', name: '', qty: '1', price: '' });
                  toast({ text: t.service.partAdded });
                }, 'add')
              }
            />
          </div>
        )}
        {mayEdit && partOp.failure && (
          <p className="field-err" role="alert">
            {partOp.failure.fieldText ?? partOp.failure.text}
          </p>
        )}
      </section>

      <section className="card">
        <BlockHead title={t.photos.add} sub={t.photos.count(j.photos.length)} />
        {j.photos.length > 0 && (
          <div className="thumbs">
            {j.photos.map((p) => (
              <a key={p.id} className="thumb" href={`/api/files/${p.id}`} target="_blank" rel="noreferrer">
                <img src={`/api/files/${p.id}`} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        )}
        {mayEdit && (
          <>
            <PhotoPicker photos={photos} onChange={setPhotos} label={t.photos.add} />
            {photos.length > 0 && (
              <SubmitButton
                small
                type="button"
                state={photoOp.state}
                label={t.photos.save}
                onClick={async () => {
                  const res = await photoOp.run((key) => uploadAll(`/api/service/${j.id}/photos`, photos, undefined, key));
                  if (!res.ok) return;
                  setPhotos([]);
                  toast({ text: t.photos.saved });
                  reload();
                }}
              />
            )}
            {photoOp.failure && (
              <p className="field-err" role="alert">
                {photoOp.failure.text}
              </p>
            )}
          </>
        )}
      </section>
    </>
  );
}
