import { numberMatches, parseGel, spellingMatches, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { DataList } from '../ds/list/DataList.js';
import { Drawer } from '../components/Drawer.js';
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
    partId: string | null;
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
  const { data, failure, reload } = useLoad<{ purchases: Purchase[] }>('/api/purchases');
  const [err, setErr] = useState<string | null>(null);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead wrap title={t.purchases.title} sub={t.purchases.count(data.purchases.length)}>
        {can('settings.manage') && <NewPurchase onDone={reload} onError={setErr} />}
      </PageHead>
      {err && <div className="hint hint-bad">{err}</div>}
      <DataList
        rows={data.purchases}
        rowKey={(p) => p.id}
        href={(p) => `/purchases/${p.id}`}
        fallback={(a, b) => b.orderedOn.localeCompare(a.orderedOn) || a.number.localeCompare(b.number)}
        search={{
          placeholder: t.lists.purchasesSearch,
          match: (p, q) => numberMatches(q, p.number) || spellingMatches(q, [p.invoiceNo, p.supplier.name]),
        }}
        chips={[
          { key: 'unpaid', label: t.lists.chips.awaitingPayment, test: (p) => p.status !== 'cancelled' && p.paidTetri === 0 },
          { key: 'ordered', label: t.lists.chips.awaitingReceipt, test: (p) => p.status === 'ordered' },
          { key: 'received', label: t.lists.chips.arrived, test: (p) => p.status === 'received' },
        ]}
        empty={{ text: t.purchases.none }}
        card={(p) => ({
          title: p.supplier.name,
          sub: (
            <>
              {p.number}
              {p.invoiceNo && <> · {p.invoiceNo}</>}
            </>
          ),
          sub2: fmtDate(p.orderedOn),
          right: <span className="t-money">{fmtForeign(p.invoiceMinor, p.currency)}</span>,
          rightSub: p.status === 'cancelled' ? t.purchases.statuses.cancelled : p.paidTetri > 0 ? `${t.purchases.paid} ${formatGel(p.paidTetri, { decimals: false })}` : t.lists.chips.awaitingPayment,
        })}
        columns={[
          { key: 'number', label: t.purchases.number, cell: (p) => <span className="mono">{p.number}</span>, sort: { value: (p) => p.number } },
          { key: 'supplier', label: t.purchases.supplier, cell: (p) => <span>{p.supplier.name}</span>, sort: { value: (p) => p.supplier.name } },
          { key: 'invoiceNo', label: t.purchases.invoiceNo, cell: (p) => <span className="muted">{p.invoiceNo ?? t.common.dash}</span>, sort: { value: (p) => p.invoiceNo } },
          { key: 'orderedOn', label: t.purchases.orderedOn, cell: (p) => <span className="mono">{fmtDate(p.orderedOn)}</span>, sort: { value: (p) => p.orderedOn, first: 'desc' } },
          { key: 'receivedOn', label: t.purchases.receivedOn, cell: (p) => <span className="mono">{fmtDate(p.receivedOn)}</span>, sort: { value: (p) => p.receivedOn, first: 'desc' } },
          { key: 'invoiceTotal', label: t.purchases.invoiceTotal, num: true, cell: (p) => <span className="mono">{fmtForeign(p.invoiceMinor, p.currency)}</span>, sort: { value: (p) => p.invoiceMinor, first: 'desc' } },
          { key: 'paid', label: t.purchases.paid, num: true, cell: (p) => <span className="mono">{formatGel(p.paidTetri, { decimals: false })}</span>, sort: { value: (p) => p.paidTetri, first: 'desc' } },
          { key: 'units', label: t.purchases.units, num: true, cell: (p) => <span className="mono">{p.units}</span>, sort: { value: (p) => p.units, first: 'desc' } },
          { key: 'status', label: t.fleet.state, cell: (p) => <span className="muted">{t.purchases.statuses[p.status]}</span>, sort: { value: (p) => p.status } },
        ]}
      />
    </>
  );
}

function NewPurchase({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const suppliers = useLoad<{ suppliers: { id: string; name: string }[] }>(open ? '/api/suppliers' : null);
  const [f, setF] = useState({ supplierId: '', invoiceNo: '', invoiceDate: '', currency: 'CNY', orderedOn: todayISO(), extras: '', extrasNote: '' });
  const [busy, setBusy] = useState(false);


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
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.purchases.newOrder}
      </button>
      {open && (
        <Drawer title={t.purchases.newOrder} onClose={() => setOpen(false)}>
          <form className="form" onSubmit={submit}>
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
        </Drawer>
      )}
    </>
  );
}
