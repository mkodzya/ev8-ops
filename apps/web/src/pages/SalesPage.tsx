import { numberMatches, parseGel, spellingMatches, todayISO, vinMatches } from '@ev8/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead, Vin } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { DataList } from '../ds/list/DataList.js';
import { Drawer } from '../components/Drawer.js';
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
  const { data, failure, reload } = useLoad<{ overdueTetri: number; sales: Sale[] }>('/api/sales');
  const [err, setErr] = useState<string | null>(null);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead wrap title={t.sales.title} sub={t.sales.count(data.sales.length)}>
        {data.overdueTetri > 0 && (
          <span className="crit-text mono">
            {t.sales.overdue}: {formatGel(data.overdueTetri, { decimals: false })}
          </span>
        )}
        {can('sales.manage') && <NewSale onDone={reload} onError={setErr} />}
      </PageHead>
      {err && <div className="hint hint-bad">{err}</div>}
      <DataList
        rows={data.sales}
        rowKey={(s) => s.id}
        href={(s) => `/sales/${s.id}`}
        fallback={(a, b) => b.soldOn.localeCompare(a.soldOn) || a.number.localeCompare(b.number)}
        search={{
          placeholder: t.lists.salesSearch,
          match: (s, q) => numberMatches(q, s.number) || spellingMatches(q, [s.customer.name, s.vehicle?.model, s.vinNote]) || vinMatches(q, s.vehicle?.vin),
        }}
        chips={[
          { key: 'instalments', label: t.lists.chips.withInstalments, test: (s) => s.instalments.length > 0 },
          { key: 'overdue', label: t.lists.chips.instalmentOverdue, test: (s) => s.overdueTetri > 0 },
          { key: 'boughtBack', label: t.sales.statuses.bought_back, test: (s) => s.status === 'bought_back' },
        ]}
        empty={{ text: t.sales.none }}
        card={(s) => {
          const paidInstalments = s.instalments.filter((i) => i.payStatus === 'paid').length;
          return {
            title: s.customer.name,
            sub: (
              <>
                {s.number}
                {s.vehicle && (
                  <>
                    {' · '}
                    {s.vehicle.model} <span className="mono">···{s.vehicle.vin.slice(-4)}</span>
                  </>
                )}
              </>
            ),
            sub2: (
              <>
                {fmtDate(s.soldOn)}
                {s.instalments.length > 0 && <> · {t.lists.instalmentOf(paidInstalments, s.instalments.length)}</>}
              </>
            ),
            right:
              s.overdueTetri > 0 ? (
                <span className="t-money crit-text">{formatGel(s.overdueTetri, { decimals: false })}</span>
              ) : (
                <span className="t-money">{formatGel(s.outstandingTetri, { decimals: false })}</span>
              ),
            rightSub: t.sales.statuses[s.status],
          };
        }}
        columns={[
          { key: 'number', label: t.sales.number, cell: (s) => <span className="mono">{s.number}</span>, sort: { value: (s) => s.number } },
          { key: 'soldOn', label: t.sales.soldOn, cell: (s) => <span className="mono">{fmtDate(s.soldOn)}</span>, sort: { value: (s) => s.soldOn, first: 'desc' } },
          { key: 'buyer', label: t.sales.buyer, cell: (s) => <Link to={`/customers/${s.customer.id}`}>{s.customer.name}</Link>, sort: { value: (s) => s.customer.name } },
          {
            key: 'vehicle',
            label: t.sales.vehicle,
            cell: (s) =>
              s.vehicle ? (
                <Link to={`/fleet/${s.vehicle.id}`}>
                  <Vin vin={s.vehicle.vin} />
                </Link>
              ) : (
                <span className="muted">{s.vinNote}</span>
              ),
            sort: { value: (s) => s.vehicle?.vin ?? s.vinNote },
          },
          { key: 'price', label: t.sales.price, num: true, cell: (s) => <span className="mono">{formatGel(s.priceTetri, { decimals: false })}</span>, sort: { value: (s) => s.priceTetri, first: 'desc' } },
          { key: 'paid', label: t.sales.paid, num: true, cell: (s) => <span className="mono">{formatGel(s.paidTetri, { decimals: false })}</span>, sort: { value: (s) => s.paidTetri, first: 'desc' } },
          { key: 'outstanding', label: t.sales.outstanding, num: true, cell: (s) => <span className="mono">{formatGel(s.outstandingTetri, { decimals: false })}</span>, sort: { value: (s) => s.outstandingTetri, first: 'desc' } },
          {
            key: 'overdue',
            label: t.sales.overdue,
            num: true,
            cell: (s) => <span className={`mono ${s.overdueTetri > 0 ? 'crit-text' : ''}`}>{s.overdueTetri > 0 ? formatGel(s.overdueTetri, { decimals: false }) : t.common.dash}</span>,
            sort: { value: (s) => s.overdueTetri, first: 'desc' },
          },
          { key: 'status', label: t.fleet.state, cell: (s) => <span className="muted">{t.sales.statuses[s.status]}</span>, sort: { value: (s) => s.status } },
        ]}
      />
    </>
  );
}

/** Selling: a buyer, a moped, a price, and how it will be paid for. */
function NewSale({ onDone, onError }: { onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  // "Open a repair" / "Sell a moped" from the "+" arrive with ?new=1 (wave 1 §3.2).
  const [params, setParams] = useSearchParams();
  const [open, setOpenState] = useState(params.get('new') === '1');
  const setOpen = (v: boolean) => {
    setOpenState(v);
    if (!v && params.has('new')) {
      params.delete('new');
      setParams(params, { replace: true });
    }
  };
  const fleet = useLoad<{ vehicles: FleetVehicle[] }>(open ? '/api/fleet' : null);
  const customers = useLoad<{ customers: { id: string; name: string; phone: string | null }[] }>(open ? '/api/customers' : null);
  const models = useLoad<{ models: { id: string; salePriceTetri: number | null }[] }>(open ? '/api/models' : null);
  const [f, setF] = useState({ customerId: '', vehicleId: '', vinNote: '', price: '', down: '', months: '0', soldOn: todayISO(), extras: '' });
  const [busy, setBusy] = useState(false);

  const free = useMemo(() => (fleet.data?.vehicles ?? []).filter((v) => v.state === 'available'), [fleet.data]);


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
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.sales.newSale}
      </button>
      {open && (
        <Drawer title={t.sales.newSale} onClose={() => setOpen(false)}>
          <form className="form" onSubmit={submit}>
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
        </Drawer>
      )}
    </>
  );
}
