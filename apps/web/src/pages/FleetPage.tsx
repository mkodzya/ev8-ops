import { VEHICLE_STATES, type VehicleState } from '@ev8/shared';
import { useEffect, useMemo, useState } from 'react';
import { errorText, useLoad } from '../lib/use.js';
import { Field } from '../components/Wizard.js';
import { useSession } from '../session.js';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { todayISO } from '@ev8/shared';
import { Empty, Loading, StateBadge, Vin } from '../components/ui.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';

interface Vehicle {
  id: string;
  vin: string;
  model: string;
  color: string | null;
  year: number | null;
  arrivedOn: string | null;
  state: VehicleState;
  currentRental: { id: string; number: string; paidThrough: string | null; customer: { id: string; name: string } } | null;
}

interface Fleet {
  byState: Record<VehicleState, number>;
  vehicles: Vehicle[];
}

interface Models {
  models: { id: string; brand: string; name: string; forRent: boolean }[];
}

export function FleetPage() {
  const t = useT();
  const { can } = useSession();
  const [data, setData] = useState<Fleet | null>(null);
  const [tick, setTick] = useState(0);
  const models = useLoad<Models>(can('settings.manage') ? '/api/models' : null);
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const state = params.get('state') as VehicleState | null;

  useEffect(() => {
    void api.get<Fleet>('/api/fleet').then(setData);
  }, [tick]);

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toUpperCase();
    return data.vehicles.filter((v) => (!state || v.state === state) && (!needle || v.vin.endsWith(needle) || v.vin.includes(needle)));
  }, [data, state, q]);

  if (!data) return <Loading />;

  return (
    <>
      <header className="page-head">
        <h1>{t.fleet.title}</h1>
        <span className="muted">{t.fleet.count(data.vehicles.length)}</span>
        <span className="spacer" />
        {can('settings.manage') && models.data && (
          <NewVehicle models={models.data.models} onDone={() => setTick((n) => n + 1)} />
        )}
      </header>
      <div className="toolbar">
        <div className="chips">
          <button type="button" className={`pill pill-sm ${!state ? 'on' : ''}`} onClick={() => setParams({})}>
            {t.common.all}
          </button>
          {VEHICLE_STATES.map((st) => (
            <button
              key={st}
              type="button"
              className={`pill pill-sm ${state === st ? 'on' : ''}`}
              onClick={() => setParams({ state: st })}
            >
              {t.states[st]} <span className="mono">{data.byState[st]}</span>
            </button>
          ))}
        </div>
        <input className="input input-search mono" placeholder={t.fleet.searchHint} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {rows.length === 0 ? (
        <Empty text={t.fleet.empty} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.fleet.vin}</th>
                <th>{t.fleet.model}</th>
                <th>{t.fleet.color}</th>
                <th>{t.fleet.year}</th>
                <th>{t.fleet.arrived}</th>
                <th>{t.fleet.state}</th>
                <th>{t.fleet.renter}</th>
                <th>{t.fleet.paidThrough}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr key={v.id}>
                  <td>
                    <Link to={`/fleet/${v.id}`}>
                      <Vin vin={v.vin} />
                    </Link>
                  </td>
                  <td>{v.model}</td>
                  <td>{v.color ?? t.common.dash}</td>
                  <td className="mono">{v.year ?? t.common.dash}</td>
                  <td className="mono">{fmtDate(v.arrivedOn)}</td>
                  <td>
                    <StateBadge state={v.state} />
                  </td>
                  <td>{v.currentRental ? <Link to={`/customers/${v.currentRental.customer.id}`}>{v.currentRental.customer.name}</Link> : t.common.dash}</td>
                  <td className="mono">{v.currentRental ? fmtDate(v.currentRental.paidThrough) : t.common.dash}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}


/** Adding a moped by hand: the owner's way in before the Odoo import runs. */
function NewVehicle({ models, onDone }: { models: Models['models']; onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ vin: '', modelId: '', color: '', year: '', arrivedOn: todayISO() });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (!open) {
    return (
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)} disabled={models.length === 0}>
        + {t.settings.addVehicle}
      </button>
    );
  }
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/api/fleet', {
        vin: f.vin.trim().toUpperCase(),
        modelId: f.modelId || models[0].id,
        color: f.color || null,
        year: f.year ? Number(f.year) : null,
        arrivedOn: f.arrivedOn || null,
      });
      setF({ vin: '', modelId: '', color: '', year: '', arrivedOn: todayISO() });
      setOpen(false);
      onDone();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="form sub-form card" onSubmit={submit}>
      <div className="two-col">
        <Field label={t.models.vin}>
          <input className="input mono" value={f.vin} onChange={(e) => setF({ ...f, vin: e.target.value })} required maxLength={17} autoFocus />
        </Field>
        <Field label={t.models.name}>
          <select className="input" value={f.modelId} onChange={(e) => setF({ ...f, modelId: e.target.value })}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.brand} {m.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t.models.color}>
          <input className="input" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
        </Field>
        <Field label={t.models.year}>
          <input className="input input-amount mono" value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label={t.models.arrivedOn}>
          <input className="input mono" type="date" value={f.arrivedOn} onChange={(e) => setF({ ...f, arrivedOn: e.target.value })} />
        </Field>
      </div>
      {err && <div className="hint hint-bad">{err}</div>}
      <div className="row-actions">
        <button type="button" className="pill" onClick={() => setOpen(false)}>
          {t.actions.cancel}
        </button>
        <button className="pill pill-accent" disabled={busy || f.vin.trim().length === 0}>
          {busy ? t.common.checking : t.actions.save}
        </button>
      </div>
    </form>
  );
}
