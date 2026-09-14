import { parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

export type PurchaseStatus = 'ordered' | 'received' | 'cancelled';

export interface Purchase {
  id: string;
  number: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  currency: string;
  orderedOn: string;
  receivedOn: string | null;
  status: PurchaseStatus;
  supplier: { id: string; name: string };
  invoiceMinor: number;
  paidTetri: number;
  extrasTetri: number;
  extrasNote: string | null;
  rate: number | null;
  units: number;
  notes: string | null;
  lines: {
    id: string;
    model: { id: string; name: string } | null;
    partName: string | null;
    qty: number;
    unitPriceMinor: number;
    lineMinor: number;
    fobTetri: number;
    extrasTetri: number;
    totalTetri: number;
    unitCostTetri: number;
  }[];
  payments: { id: string; occurredOn: string; grossTetri: number; channel: string; direction: string }[];
}

/** An amount in the seller's currency: minor units, two decimals, no lari sign. */
export function fmtForeign(minor: number, currency: string): string {
  const whole = Math.floor(Math.abs(minor) / 100);
  const frac = Math.abs(minor) % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${minor < 0 ? '-' : ''}${grouped}.${String(frac).padStart(2, '0')} ${currency}`;
}

export function PurchasesPage() {
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<{ purchases: Purchase[] }>('/api/purchases');
  const [err, setErr] = useState<string | null>(null);

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <header className="page-head page-head-wrap">
        <h1>{t.purchases.title}</h1>
        <span className="mono muted">{data.purchases.length}</span>
        <span className="spacer" />
        {can('settings.manage') && <NewPurchase onDone={reload} onError={setErr} />}
      </header>
      {err && <div className="hint hint-bad">{err}</div>}
      {data.purchases.length === 0 ? (
        <Empty text={t.purchases.none} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.purchases.number}</th>
                <th>{t.purchases.supplier}</th>
                <th>{t.purchases.invoiceNo}</th>
                <th>{t.purchases.orderedOn}</th>
                <th>{t.purchases.receivedOn}</th>
                <th className="num">{t.purchases.invoiceTotal}</th>
                <th className="num">{t.purchases.paid}</th>
                <th className="num">{t.purchases.units}</th>
                <th>{t.fleet.state}</th>
              </tr>
            </thead>
            <tbody>
              {data.purchases.map((p) => (
                <tr key={p.id} className={p.status === 'cancelled' ? 'row-off' : ''}>
                  <td>
                    <Link to={`/purchases/${p.id}`} className="mono">
                      {p.number}
                    </Link>
                  </td>
                  <td>{p.supplier.name}</td>
                  <td className="muted">{p.invoiceNo ?? t.common.dash}</td>
                  <td className="mono">{fmtDate(p.orderedOn)}</td>
                  <td className="mono">{fmtDate(p.receivedOn)}</td>
                  <td className="num mono">{fmtForeign(p.invoiceMinor, p.currency)}</td>
                  <td className="num mono">{formatGel(p.paidTetri, { decimals: false })}</td>
                  <td className="num mono">{p.units}</td>
                  <td className="muted">{t.purchases.statuses[p.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function NewPurchase({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const suppliers = useLoad<{ suppliers: { id: string; name: string }[] }>(open ? '/api/suppliers' : null);
  const [f, setF] = useState({ supplierId: '', invoiceNo: '', invoiceDate: '', currency: 'CNY', orderedOn: todayISO(), extras: '', extrasNote: '' });
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.purchases.newOrder}
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/purchases', {
        supplierId: f.supplierId,
        invoiceNo: f.invoiceNo || null,
        invoiceDate: f.invoiceDate || null,
        currency: f.currency,
        orderedOn: f.orderedOn,
        extrasTetri: f.extras ? parseGel(f.extras) : 0,
        extrasNote: f.extrasNote || null,
      });
      setOpen(false);
      onDone();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card card-drawer form" onSubmit={submit}>
      <div className="two-col">
        <Field label={t.purchases.supplier}>
          <select className="input" value={f.supplierId} onChange={(e) => setF({ ...f, supplierId: e.target.value })} required>
            <option value="">{t.common.dash}</option>
            {(suppliers.data?.suppliers ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.purchases.currency}>
          <input className="input input-amount mono" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={3} />
        </Field>
        <Field label={t.purchases.invoiceNo}>
          <input className="input" value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} />
        </Field>
        <Field label={t.purchases.invoiceDate}>
          <input className="input mono" type="date" value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} />
        </Field>
        <Field label={t.purchases.orderedOn}>
          <input className="input mono" type="date" value={f.orderedOn} onChange={(e) => setF({ ...f, orderedOn: e.target.value })} />
        </Field>
        <Field label={t.purchases.extras} hint={t.purchases.extrasHint}>
          <input className="input input-amount mono" value={f.extras} onChange={(e) => setF({ ...f, extras: e.target.value })} inputMode="decimal" />
        </Field>
      </div>
      <Field label={t.purchases.extrasNote}>
        <input className="input" value={f.extrasNote} onChange={(e) => setF({ ...f, extrasNote: e.target.value })} />
      </Field>
      <div className="row-actions">
        <button type="button" className="pill" onClick={() => setOpen(false)}>
          {t.actions.cancel}
        </button>
        <button className="pill pill-accent" disabled={busy || !f.supplierId}>
          {busy ? t.common.checking : t.actions.confirm}
        </button>
      </div>
    </form>
  );
}
