import { daysBetween, numberMatches, parseGel, spellingMatches, todayISO, vinMatches } from '@ev8/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead, Vin } from '../components/ui.js';
import { DataList } from '../ds/list/DataList.js';
import { Field } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { FormSheet } from '../ds/form/Form.js';
import { useLoad } from '../lib/use.js';
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
  const { data, failure, reload } = useLoad<{ open: number; jobs: ServiceJob[] }>('/api/service');
  const today = todayISO();

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead wrap title={t.service.title} sub={t.service.count(data.open)}>
        {can('service.manage') && <NewJob onDone={reload} />}
      </PageHead>
      <DataList
        rows={data.jobs}
        rowKey={(j) => j.id}
        href={(j) => `/service/${j.id}`}
        fallback={(a, b) => b.openedOn.localeCompare(a.openedOn) || b.number.localeCompare(a.number)}
        search={{
          placeholder: t.lists.jobsSearch,
          match: (j, q) => numberMatches(q, j.number) || spellingMatches(q, [j.reason, j.vehicle.model, j.doneBy, j.customer?.name]) || vinMatches(q, j.vehicle.vin),
        }}
        chips={[
          { key: 'open', label: t.lists.chips.open, test: (j) => j.status === 'open' },
          { key: 'closed', label: t.lists.chips.closed, test: (j) => j.status !== 'open' },
        ]}
        empty={{ text: t.service.none }}
        card={(j) => ({
          title: (
            <>
              {j.vehicle.model} <span className="mono">···{j.vehicle.vin.slice(-4)}</span>
            </>
          ),
          sub: (
            <>
              {j.number} · {j.reason}
            </>
          ),
          sub2: j.doneBy ?? undefined,
          right:
            j.status === 'open' ? (
              <span className="warn-text">{t.lists.daysOpen(daysBetween(j.openedOn, today))}</span>
            ) : (
              <span className="muted">{t.service.statuses[j.status]}</span>
            ),
          rightSub: t.service.payers[j.payer],
        })}
        columns={[
          { key: 'number', label: t.service.number, cell: (j) => <span className="mono">{j.number}</span>, sort: { value: (j) => j.number } },
          {
            key: 'vehicle',
            label: t.service.vehicle,
            cell: (j) => (
              <>
                <Link to={`/fleet/${j.vehicle.id}`}>
                  <Vin vin={j.vehicle.vin} />
                </Link>{' '}
                <span className="muted">{j.vehicle.model}</span>
              </>
            ),
            sort: { value: (j) => j.vehicle.model },
          },
          { key: 'reason', label: t.service.reason, cell: (j) => j.reason },
          { key: 'openedOn', label: t.service.openedOn, cell: (j) => <span className="mono">{fmtDate(j.openedOn)}</span>, sort: { value: (j) => j.openedOn, first: 'desc' } },
          { key: 'closedOn', label: t.service.closedOn, cell: (j) => <span className="mono">{fmtDate(j.closedOn)}</span>, sort: { value: (j) => j.closedOn, first: 'desc' } },
          { key: 'payer', label: t.service.payer, cell: (j) => t.service.payers[j.payer], sort: { value: (j) => j.payer } },
          { key: 'total', label: t.service.total, num: true, cell: (j) => <span className="mono">{formatGel(j.totalTetri)}</span>, sort: { value: (j) => j.totalTetri, first: 'desc' } },
          { key: 'withheld', label: t.service.withhold, num: true, cell: (j) => <span className="mono">{j.withheldTetri > 0 ? formatGel(j.withheldTetri) : t.common.dash}</span>, sort: { value: (j) => j.withheldTetri, first: 'desc' } },
          {
            key: 'status',
            label: t.fleet.state,
            cell: (j) => <span className={j.status === 'open' ? 'warn-text' : 'muted'}>{t.service.statuses[j.status]}</span>,
            sort: { value: (j) => j.status },
          },
        ]}
      />
    </>
  );
}

/** Opening a repair: a moped, what is wrong, and who pays. */
const blankJob = (vehicleId?: string) => ({ vehicleId: vehicleId ?? '', reason: '', payer: 'company', labour: '', doneBy: '', openedOn: todayISO() });

export function NewJob({ vehicleId, onDone }: { vehicleId?: string; onDone: () => void }) {
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
  const [f, setF] = useState(() => blankJob(vehicleId));

  const repairable = useMemo(
    () => (fleet.data?.vehicles ?? []).filter((v) => v.state !== 'sold' && v.state !== 'out'),
    [fleet.data],
  );
  const chosen = repairable.find((v) => v.id === (f.vehicleId || vehicleId));
  const rented = chosen?.state === 'rented';


  return (
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.service.newJob}
      </button>
      {open && (
        <FormSheet
          title={t.service.newJob}
          onClose={() => setOpen(false)}
          value={f}
          initial={blankJob(vehicleId)}
          draft={vehicleId ? `job-new:${vehicleId}` : 'job-new'}
          onRestore={setF}
          summary={(v) => v.reason}
          label={t.service.openJob}
          submit={async (key) => {
            const job = await api.post<{ id: string }>(
              '/api/service',
              {
                vehicleId: f.vehicleId || vehicleId,
                reason: f.reason,
                payer: rented ? f.payer : 'company',
                labourTetri: f.labour ? parseGel(f.labour) : 0,
                doneBy: f.doneBy || null,
                openedOn: f.openedOn,
              },
              { key },
            );
            return { created: job.id, toast: { text: t.service.jobOpened, open: `/service/${job.id}` } };
          }}
          onDone={() => {
            setF(blankJob(vehicleId));
            onDone();
          }}
        >
      {!vehicleId && (
        <Field label={t.service.vehicle} name="vehicleId">
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
      <Field label={t.service.reason} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required autoFocus />
      </Field>
      {rented && (
        <>
          <p className="hint muted">{t.service.rentedNote}</p>
          <Field label={t.service.payer} name="payer">
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
        <Field label={t.service.labour} name="labourTetri">
          <input className="input input-amount mono" value={f.labour} onChange={(e) => setF({ ...f, labour: e.target.value })} inputMode="decimal" />
        </Field>
        <Field label={t.service.doneBy} name="doneBy">
          <input className="input" value={f.doneBy} onChange={(e) => setF({ ...f, doneBy: e.target.value })} />
        </Field>
        <Field label={t.service.openedOn} name="openedOn">
          <input className="input mono" type="date" value={f.openedOn} onChange={(e) => setF({ ...f, openedOn: e.target.value })} />
        </Field>
      </div>
        </FormSheet>
      )}
    </>
  );
}
