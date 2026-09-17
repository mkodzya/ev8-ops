import { parseGel, todayISO } from '@ev8/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Empty, Loading, PageHead, Vin } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { Drawer } from '../components/Drawer.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

export type ServiceStatus = 'open' | 'done' | 'cancelled';

export interface ServiceJob {
  id: string;
  number: string;
  reason: string;
  openedOn: string;
  closedOn: string | null;
  status: ServiceStatus;
  payer: 'company' | 'customer';
  labourTetri: number;
  partsTetri: number;
  totalTetri: number;
  withheldTetri: number;
  doneBy: string | null;
  notes: string | null;
  movedVehicle: boolean;
  vehicle: { id: string; vin: string; model: string };
  rental: { id: string; number: string } | null;
  customer: { id: string; name: string } | null;
  parts: { id: string; name: string; qty: number; unitPriceTetri: number }[];
  photos: { id: string; label: string }[];
}

interface FleetVehicle {
  id: string;
  vin: string;
  model: string;
  state: 'available' | 'rented' | 'service' | 'out' | 'sold';
}

/** Repairs: what is open, what was done, and a way to open a new one. */
export function ServicePage() {
  const t = useT();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const status = params.get('status');
  const { data, failure, reload } = useLoad<{ open: number; jobs: ServiceJob[] }>(
    status ? `/api/service?status=${status}` : '/api/service',
  );
  const [err, setErr] = useState<string | null>(null);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead wrap title={t.service.title} sub={t.service.count(data.open)}>
        {can('service.manage') && <NewJob onDone={reload} onError={setErr} />}
      </PageHead>
      {err && <div className="hint hint-bad">{err}</div>}
      <div className="toolbar">
        <div className="chips">
          <button type="button" className={`pill pill-sm ${!status ? 'on' : ''}`} onClick={() => setParams({})}>
            {t.common.all}
          </button>
          {(['open', 'done', 'cancelled'] as ServiceStatus[]).map((s) => (
            <button key={s} type="button" className={`pill pill-sm ${status === s ? 'on' : ''}`} onClick={() => setParams({ status: s })}>
              {t.service.statuses[s]}
            </button>
          ))}
        </div>
      </div>
      {data.jobs.length === 0 ? (
        <Empty text={t.service.none} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.service.number}</th>
                <th>{t.service.vehicle}</th>
                <th>{t.service.reason}</th>
                <th>{t.service.openedOn}</th>
                <th>{t.service.closedOn}</th>
                <th>{t.service.payer}</th>
                <th className="num">{t.service.total}</th>
                <th className="num">{t.service.withhold}</th>
                <th>{t.fleet.state}</th>
              </tr>
            </thead>
            <tbody>
              {data.jobs.map((j) => (
                <tr key={j.id} className={j.status === 'cancelled' ? 'row-off' : ''}>
                  <td>
                    <Link to={`/service/${j.id}`} className="mono">
                      {j.number}
                    </Link>
                  </td>
                  <td>
                    <Link to={`/fleet/${j.vehicle.id}`}>
                      <Vin vin={j.vehicle.vin} />
                    </Link>
                  </td>
                  <td>{j.reason}</td>
                  <td className="mono">{fmtDate(j.openedOn)}</td>
                  <td className="mono">{fmtDate(j.closedOn)}</td>
                  <td>{t.service.payers[j.payer]}</td>
                  <td className="num mono">{formatGel(j.totalTetri)}</td>
                  <td className="num mono">{j.withheldTetri > 0 ? formatGel(j.withheldTetri) : t.common.dash}</td>
                  <td className={j.status === 'open' ? 'warn-text' : 'muted'}>{t.service.statuses[j.status]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Opening a repair: a moped, what is wrong, and who pays. */
export function NewJob({ vehicleId, onDone, onError }: { vehicleId?: string; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const fleet = useLoad<{ vehicles: FleetVehicle[] }>(open ? '/api/fleet' : null);
  const [f, setF] = useState({ vehicleId: vehicleId ?? '', reason: '', payer: 'company', labour: '', doneBy: '', openedOn: todayISO() });
  const [busy, setBusy] = useState(false);

  const repairable = useMemo(
    () => (fleet.data?.vehicles ?? []).filter((v) => v.state !== 'sold' && v.state !== 'out'),
    [fleet.data],
  );
  const chosen = repairable.find((v) => v.id === (f.vehicleId || vehicleId));
  const rented = chosen?.state === 'rented';


  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post('/api/service', {
        vehicleId: f.vehicleId || vehicleId,
        reason: f.reason,
        payer: rented ? f.payer : 'company',
        labourTetri: f.labour ? parseGel(f.labour) : 0,
        doneBy: f.doneBy || null,
        openedOn: f.openedOn,
      });
      setF({ ...f, reason: '', labour: '', doneBy: '' });
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
        + {t.service.newJob}
      </button>
      {open && (
        <Drawer title={t.service.newJob} onClose={() => setOpen(false)}>
          <form className="form" onSubmit={submit}>
      {!vehicleId && (
        <Field label={t.service.vehicle}>
          <select className="input" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })} required>
            <option value="">{t.common.dash}</option>
            {repairable.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vin} · {v.model}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t.service.reason}>
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required autoFocus />
      </Field>
      {rented && (
        <>
          <p className="hint muted">{t.service.rentedNote}</p>
          <Field label={t.service.payer}>
            <div className="chips">
              {(['company', 'customer'] as const).map((p) => (
                <button key={p} type="button" className={`pill pill-sm ${f.payer === p ? 'on' : ''}`} onClick={() => setF({ ...f, payer: p })}>
                  {t.service.payers[p]}
                </button>
              ))}
            </div>
          </Field>
        </>
      )}
      <div className="two-col">
        <Field label={t.service.labour}>
          <input className="input input-amount mono" value={f.labour} onChange={(e) => setF({ ...f, labour: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t.service.doneBy}>
          <input className="input" value={f.doneBy} onChange={(e) => setF({ ...f, doneBy: e.target.value })} />
        </Field>
        <Field label={t.service.openedOn}>
          <input className="input mono" type="date" value={f.openedOn} onChange={(e) => setF({ ...f, openedOn: e.target.value })} />
        </Field>
      </div>
      <div className="row-actions">
        <button type="button" className="pill" onClick={() => setOpen(false)}>
          {t.actions.cancel}
        </button>
        <button className="pill pill-accent" disabled={busy || !f.reason.trim() || !(f.vehicleId || vehicleId)}>
          {busy ? t.common.checking : t.actions.confirm}
        </button>
      </div>
          </form>
        </Drawer>
      )}
    </>
  );
}
