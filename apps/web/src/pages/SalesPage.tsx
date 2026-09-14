import { parseGel, todayISO } from '@ev8/shared';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading, Vin } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

export type SaleStatus = 'active' | 'cancelled' | 'bought_back';

export interface Sale {
  id: string;
  number: string;
  soldOn: string;
  priceTetri: number;
  paidTetri: number;
  outstandingTetri: number;
  overdueTetri: number;
  extras: string | null;
  warrantyUntil: string | null;
  status: SaleStatus;
  boughtBackOn: string | null;
  notes: string | null;
  customer: { id: string; name: string; phone?: string | null };
  vehicle: { id: string; vin: string; model: string } | null;
  vinNote: string | null;
  instalments: { id: string; seq: number; dueOn: string; amountTetri: number; paidTetri: number; payStatus: 'unpaid' | 'partial' | 'paid'; overdue: boolean }[];
}

interface FleetVehicle {
  id: string;
  vin: string;
  model: string;
  state: 'available' | 'rented' | 'service' | 'out' | 'sold';
}

export function SalesPage() {
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<{ overdueTetri: number; sales: Sale[] }>('/api/sales');
  const [err, setErr] = useState<string | null>(null);

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <header className="page-head page-head-wrap">
        <h1>{t.sales.title}</h1>
        <span className="mono muted">{data.sales.length}</span>
        {data.overdueTetri > 0 && (
          <span className="crit-text mono">
            {t.sales.overdue}: {formatGel(data.overdueTetri, { decimals: false })}
          </span>
        )}
        <span className="spacer" />
        {can('sales.manage') && <NewSale onDone={reload} onError={setErr} />}
      </header>
      {err && <div className="hint hint-bad">{err}</div>}
      {data.sales.length === 0 ? (
        <Empty text={t.sales.none} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.sales.number}</th>
                <th>{t.sales.soldOn}</th>
                <th>{t.sales.buyer}</th>
                <th>{t.sales.vehicle}</th>
                <th className="num">{t.sales.price}</th>
                <th className="num">{t.sales.paid}</th>
                <th className="num">{t.sales.outstanding}</th>
                <th className="num">{t.sales.overdue}</th>
                <th>{t.fleet.state}</th>
              </tr>
            </thead>
            <tbody>
              {data.sales.map((s) => (
                <tr key={s.id} className={s.status === 'cancelled' ? 'row-off' : ''}>
                  <td>
                    <Link to={`/sales/${s.id}`} className="mono">
                      {s.number}
                    </Link>
                  </td>
                  <td className="mono">{fmtDate(s.soldOn)}</td>
                  <td>
                    <Link to={`/customers/${s.customer.id}`}>{s.customer.name}</Link>
                  </td>
                  <td>
                    {s.vehicle ? (
                      <Link to={`/fleet/${s.vehicle.id}`}>
                        <Vin vin={s.vehicle.vin} />
                      </Link>
                    ) : (
                      <span className="muted">{s.vinNote}</span>
                    )}
                  </td>
                  <td className="num mono">{formatGel(s.priceTetri, { decimals: false })}</td>
                  <td className="num mono">{formatGel(s.paidTetri, { decimals: false })}</td>
                  <td className="num mono">{formatGel(s.outstandingTetri, { decimals: false })}</td>
                  <td className={`num mono ${s.overdueTetri > 0 ? 'crit-text' : ''}`}>
                    {s.overdueTetri > 0 ? formatGel(s.overdueTetri, { decimals: false }) : t.common.dash}
                  </td>
                  <td className="muted">{t.sales.statuses[s.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Selling: a buyer, a moped, a price, and how it will be paid for. */
function NewSale({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const fleet = useLoad<{ vehicles: FleetVehicle[] }>(open ? '/api/fleet' : null);
  const customers = useLoad<{ customers: { id: string; name: string; phone: string | null }[] }>(open ? '/api/customers' : null);
  const models = useLoad<{ models: { id: string; salePriceTetri: number | null }[] }>(open ? '/api/models' : null);
  const [f, setF] = useState({ customerId: '', vehicleId: '', vinNote: '', price: '', down: '', months: '0', soldOn: todayISO(), extras: '' });
  const [busy, setBusy] = useState(false);

  const free = useMemo(() => (fleet.data?.vehicles ?? []).filter((v) => v.state === 'available'), [fleet.data]);

  if (!open) {
    return (
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.sales.newSale}
      </button>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/sales', {
        customerId: f.customerId,
        vehicleId: f.vehicleId || null,
        vinNote: f.vehicleId ? null : f.vinNote || null,
        priceTetri: parseGel(f.price),
        downPaymentTetri: f.down ? parseGel(f.down) : 0,
        months: Number(f.months) || 0,
        soldOn: f.soldOn,
        extras: f.extras || null,
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
        <Field label={t.sales.buyer}>
          <select className="input" value={f.customerId} onChange={(e) => setF({ ...f, customerId: e.target.value })} required>
            <option value="">{t.common.dash}</option>
            {(customers.data?.customers ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.sales.vehicle}>
          <select className="input" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
            <option value="">{t.common.dash}</option>
            {free.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vin} · {v.model}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {!f.vehicleId && (
        <Field label={t.sales.noVehicle}>
          <input className="input" value={f.vinNote} onChange={(e) => setF({ ...f, vinNote: e.target.value })} />
        </Field>
      )}
      <div className="two-col">
        <Field label={t.sales.price}>
          <input className="input input-amount mono" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" required />
        </Field>
        <Field label={t.sales.soldOn}>
          <input className="input mono" type="date" value={f.soldOn} onChange={(e) => setF({ ...f, soldOn: e.target.value })} />
        </Field>
        <Field label={t.sales.downPayment}>
          <input className="input input-amount mono" value={f.down} onChange={(e) => setF({ ...f, down: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t.sales.months} hint={t.sales.monthsHint}>
          <input className="input input-amount mono" value={f.months} onChange={(e) => setF({ ...f, months: e.target.value })} inputMode="numeric" />
        </Field>
      </div>
      <Field label={t.sales.extras}>
        <input className="input" value={f.extras} onChange={(e) => setF({ ...f, extras: e.target.value })} />
      </Field>
      <div className="row-actions">
        <button type="button" className="pill" onClick={() => setOpen(false)}>
          {t.actions.cancel}
        </button>
        <button className="pill pill-accent" disabled={busy || !f.customerId || parseGel(f.price) == null || (!f.vehicleId && !f.vinNote.trim())}>
          {busy ? t.common.checking : t.actions.confirm}
        </button>
      </div>
      {models.data && free.length === 0 && <p className="hint muted">{t.pickup.noAvailable}</p>}
    </form>
  );
}
