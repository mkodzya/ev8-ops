import { daysBetween, numberMatches, spellingMatches, todayISO, vinMatches } from '@ev8/shared';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { Loading, PageHead, Vin } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { DataList } from '../ds/list/DataList.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { uploadAll, type PreparedPhoto } from '../lib/photos.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

export type ServiceStatus = 'draft' | 'open' | 'done' | 'cancelled';

export interface Workshop {
  id: string;
  name: string;
  phone?: string | null;
}

export interface ServiceJobPart {
  id: string;
  partId: string | null;
  name: string;
  qty: number;
  /** Money is the owners' (ADR-0033 §4): empty for whoever does not see cost. */
  unitPriceTetri: number | null;
  unitCostTetri?: number | null;
}

export interface ServiceJob {
  id: string;
  number: string;
  reason: string;
  openedOn: string;
  closedOn: string | null;
  status: ServiceStatus;
  payer: 'company' | 'customer';
  // What the repair cost is the owners' (ADR-0033 §4): these come empty to
  // whoever does not see cost — a manager, a mechanic.
  labourTetri: number | null;
  labourMinutes: number;
  labourRateTetri: number | null;
  partsTetri: number | null;
  totalTetri: number | null;
  withheldTetri: number | null;
  /** What the deposit did not cover and the customer owes (Q26). */
  chargedTetri: number | null;
  odometerKm: number | null;
  workshop: Workshop | null;
  closedAt: { id: string; name: string } | null;
  notes: string | null;
  /** True when this job is what took the moped out of the yard: only then does closing bring it back. */
  movedVehicle: boolean;
  vehicle: { id: string; vin: string; model: string };
  rental: { id: string; number: string } | null;
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null } | null;
  parts: ServiceJobPart[];
  photos: { id: string; label: string }[];
}

export interface ServiceList {
  open: number;
  drafts: number;
  workshops: Workshop[];
  jobs: ServiceJob[];
}

interface FleetVehicle {
  id: string;
  vin: string;
  model: string;
  state: 'available' | 'rented' | 'service' | 'out' | 'sold';
}

/** How long this repair has been standing: until it closed, or until today. */
function daysOf(j: ServiceJob, today: string): number {
  return Math.max(0, daysBetween(j.openedOn, j.closedOn ?? today));
}

/**
 * Сервис (wave 5 §3.7): every repair on the one list of the house, and above
 * it the breakdowns a manager reported, which are not repairs yet and would
 * be lost among them. Each of those carries the one button that turns it into
 * one, so an owner never has to open a card to find out there is nothing to
 * read yet.
 */
export function ServicePage() {
  const t = useT();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<ServiceList>('/api/service');
  const today = todayISO();

  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const mayManage = can('service.manage');
  // Taking a reported breakdown up is the approval (ADR-0033): the chief mechanic's and the owners'.
  const mayApprove = can('service.approve');
  const mayCost = can('cost.view');
  const mayFleet = can('fleet.view');
  const drafts = data.jobs.filter((j) => j.status === 'draft');

  return (
    <>
      <PageHead wrap title={t.repair.title} sub={t.repair.openCount(data.open)}>
        {can('service.report') && <NewJob onDone={reload} />}
      </PageHead>

      {mayApprove && drafts.length > 0 && (
        <section className="card card-warn queue-card">
          <div className="queue-head">
            <h2>{t.repair.draftsHead}</h2>
            <span className="muted">{t.service.jobsCount(drafts.length)}</span>
          </div>
          <ul className="queue">
            {drafts.map((j) => (
              <Draft key={j.id} job={j} onDone={reload} />
            ))}
          </ul>
        </section>
      )}

      <DataList
        rows={data.jobs}
        rowKey={(j) => j.id}
        href={(j) => `/service/${j.id}`}
        fallback={(a, b) => b.openedOn.localeCompare(a.openedOn) || b.number.localeCompare(a.number)}
        byDefault="days"
        search={{
          placeholder: t.repair.searchHint,
          match: (j, q) => numberMatches(q, j.number) || vinMatches(q, j.vehicle.vin) || spellingMatches(q, [j.reason, j.vehicle.model, j.workshop?.name, j.customer?.name]),
        }}
        chips={[
          { key: 'open', label: t.repair.chips.working, test: (j) => j.status === 'open' },
          { key: 'drafts', label: t.repair.chips.drafts, test: (j) => j.status === 'draft' },
          { key: 'done', label: t.repair.chips.done, test: (j) => j.status === 'done' },
          { key: 'cancelled', label: t.repair.chips.cancelled, test: (j) => j.status === 'cancelled' },
        ]}
        empty={{ text: t.repair.none }}
        card={(j) => ({
          title: (
            <>
              {j.vehicle.model} <span className="mono">···{j.vehicle.vin.slice(-4)}</span>
            </>
          ),
          sub: (
            <>
              {/* The breakdown a manager wrote is what an owner decides by,
                  so the row says it; "от менеджера" is the badge on the
                  right, not a replacement for the words (QA-W5-19). */}
              <span className="mono">{j.number}</span> · {j.reason}
            </>
          ),
          sub2: j.workshop?.name ?? undefined,
          right:
            j.status === 'draft' ? (
              <span className="warn-text">{t.repair.statuses.draft}</span>
            ) : j.status === 'open' ? (
              <span className="warn-text">{t.repair.days(daysOf(j, today))}</span>
            ) : (
              <span className="muted">{t.repair.statuses[j.status]}</span>
            ),
          rightSub: j.totalTetri != null && j.totalTetri > 0 ? <span className="mono">{formatGel(j.totalTetri)}</span> : t.repair.payers[j.payer],
        })}
        columns={[
          { key: 'number', label: t.repair.cols.number, cell: (j) => <span className="mono">{j.number}</span>, sort: { value: (j) => j.number } },
          {
            key: 'vehicle',
            label: t.repair.cols.vehicle,
            cell: (j) => (
              <>
                {/* A mechanic sees the repair, not the fleet card behind it. */}
                {mayFleet ? (
                  <Link to={`/fleet/${j.vehicle.id}`}>
                    <Vin vin={j.vehicle.vin} />
                  </Link>
                ) : (
                  <Vin vin={j.vehicle.vin} />
                )}{' '}
                <span className="muted">{j.vehicle.model}</span>
              </>
            ),
            sort: { value: (j) => j.vehicle.model },
          },
          {
            key: 'reason',
            label: t.repair.cols.what,
            cell: (j) => j.reason,
          },
          {
            key: 'workshop',
            label: t.repair.cols.workshop,
            cell: (j) => (j.workshop ? j.workshop.name : <span className="muted">{t.repair.workshopNone}</span>),
            sort: { value: (j) => j.workshop?.name ?? '' },
          },
          { key: 'payer', label: t.repair.cols.payer, cell: (j) => t.repair.payers[j.payer], sort: { value: (j) => j.payer } },
          ...(mayCost
            ? [{ key: 'total', label: t.repair.cols.total, num: true, cell: (j: ServiceJob) => <span className="mono">{formatGel(j.totalTetri ?? 0)}</span>, sort: { value: (j: ServiceJob) => j.totalTetri ?? 0, first: 'desc' as const } }]
            : []),
          {
            key: 'days',
            label: t.repair.cols.days,
            num: true,
            cell: (j) => <span className={`mono ${j.status === 'open' || j.status === 'draft' ? 'warn-text' : 'muted'}`}>{daysOf(j, today)}</span>,
            sort: { value: (j) => daysOf(j, today), first: 'desc' },
          },
        ]}
      />
    </>
  );
}

/** A breakdown somebody reported: the moped, the words, the photos, one button. */
function Draft({ job, onDone }: { job: ServiceJob; onDone: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const op = useOperation();

  return (
    <li className="q-row">
      <Link className="q-who" to={`/service/${job.id}`}>
        <span className="q-name">{t.repair.fromManager}</span>
        <span className="q-sub muted">
          {job.vehicle.model} <span className="mono">···{job.vehicle.vin.slice(-4)}</span> · «{job.reason}»
          {job.photos.length > 0 && <> · {t.photos.count(job.photos.length)}</>}
        </span>
      </Link>
      <span className="q-sum mono muted">{fmtDate(job.openedOn)}</span>
      <span className="q-acts">
        <SubmitButton
          small
          type="button"
          state={op.state}
          label={t.repair.takeUp}
          onClick={async () => {
            const res = await op.run((key) => api.post(`/api/service/${job.id}/approve`, undefined, { key }));
            if (!res.ok) return;
            onDone();
            navigate(`/service/${job.id}`);
          }}
        />
      </span>
    </li>
  );
}

const blankJob = (vehicleId?: string) => ({ vehicleId: vehicleId ?? '', reason: '', workshopId: '', payer: 'company' });

/**
 * «Сообщить о поломке» and «Открыть ремонт» — one sheet, told apart by who
 * opened it (§3.7). A manager may say a moped is broken and no more, and the
 * API turns that into a draft for an owner; an owner fills in the workshop
 * and who pays, and the repair is open from the start. Kept exported under
 * the old name because the vehicle card opens it with the moped preselected.
 */
export function NewJob({ vehicleId, onDone }: { vehicleId?: string; onDone: () => void }) {
  const t = useT();
  const { can } = useSession();
  const navigate = useNavigate();
  const mayManage = can('service.manage');
  // "Open a repair" / "Report a breakdown" from the "+" arrive with ?new=1 (wave 1 §3.2).
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
  const workshops = useLoad<{ workshops: Workshop[] }>(open && mayManage ? '/api/workshops' : null);
  const [f, setF] = useState(() => blankJob(vehicleId));
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);

  const repairable = useMemo(() => (fleet.data?.vehicles ?? []).filter((v) => v.state !== 'sold' && v.state !== 'out'), [fleet.data]);
  const chosen = repairable.find((v) => v.id === (f.vehicleId || vehicleId));
  // Only a moped that is out with somebody can be repaired at their expense.
  const rented = chosen?.state === 'rented';
  const label = mayManage ? t.repair.newJob : t.repair.report;

  return (
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {label}
      </button>
      {open && (
        <FormSheet
          title={label}
          onClose={() => setOpen(false)}
          value={f}
          initial={blankJob(vehicleId)}
          draft={vehicleId ? `job-new:${vehicleId}` : 'job-new'}
          onRestore={setF}
          summary={(v) => v.reason}
          label={mayManage ? t.repair.newJob : t.repair.reportCta}
          submit={async (key) => {
            const job = await api.post<{ id: string }>(
              '/api/service',
              {
                vehicleId: f.vehicleId || vehicleId,
                reason: f.reason,
                ...(mayManage ? { workshopId: f.workshopId || null, payer: rented ? f.payer : 'company' } : {}),
              },
              { key },
            );
            // The photos follow the record they belong to, as a hand-over's do.
            // A breakdown that is written down is not thrown away because the
            // pictures were refused: the refusal is said instead of swallowed.
            let attached = true;
            if (photos.length > 0) {
              try {
                await uploadAll(`/api/service/${job.id}/photos`, photos, undefined, `${key}-photo`);
              } catch {
                attached = false;
              }
            }
            const said = attached ? (mayManage ? t.repair.opened : t.repair.reported) : t.repair.photosNotSaved;
            // An owner is taken to the repair to fill it in, so the message
            // does not also offer to open what is already open; a manager
            // stays where they were and is offered the way there.
            return { created: job.id, toast: mayManage && attached ? { text: said } : { text: said, open: `/service/${job.id}` } };
          }}
          onDone={(done) => {
            setF(blankJob(vehicleId));
            setPhotos([]);
            onDone();
            // An owner has a repair to fill in; a manager has said everything they can.
            if (mayManage && done?.created) navigate(`/service/${done.created}`);
          }}
        >
          {!vehicleId && (
            <Field label={t.repair.vehicle} name="vehicleId">
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
          <Field label={t.repair.what} name="reason">
            <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} required autoFocus />
          </Field>
          {mayManage && (
            <>
              <Field label={t.repair.workshop} name="workshopId">
                <select className="input" value={f.workshopId} onChange={(e) => setF({ ...f, workshopId: e.target.value })}>
                  <option value="">{t.repair.workshopNone}</option>
                  {(workshops.data?.workshops ?? []).map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </Field>
              {rented && (
                <>
                  <p className="hint muted">{t.repair.rentedNote}</p>
                  <Field label={t.repair.payer} name="payer">
                    <div className="chips">
                      {(['company', 'customer'] as const).map((p) => (
                        <button key={p} type="button" className={`pill pill-sm ${f.payer === p ? 'on' : ''}`} onClick={() => setF({ ...f, payer: p })}>
                          {t.repair.payers[p]}
                        </button>
                      ))}
                    </div>
                  </Field>
                </>
              )}
            </>
          )}
          <PhotoPicker photos={photos} onChange={setPhotos} label={t.repair.photos} />
          {!mayManage && <p className="hint muted">{t.repair.reportNote}</p>}
        </FormSheet>
      )}
    </>
  );
}
