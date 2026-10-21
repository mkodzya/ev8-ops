import { AFTER_PHOTOS_MAX, daysBetween, localDateTime, hoursFromMinutes, labourTetri as labourFor, minutesFromHours, normSecFromMinutes, parseGel, todayISO, workshopChoices } from '@ev8/shared';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { RowMenu } from '../components/RowMenu.js';
import { BlockHead, CustomerName, Empty, Loading, PageHead, Vin } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { fmtDate, formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { toBase64, uploadAll, type PreparedPhoto } from '../lib/photos.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { groupDigits } from '../lib/workBook.js';
import { DowntimeText } from '../components/Downtime.js';
import type { ServiceJob, ServiceWorkLine, Workshop } from './ServicePage.js';
import { AddWorkSheet, NormTotal, RejectSheet, StatedLines, SuggestCustomer, isRepeat, useDecisionWords, useWhen, waitingLines } from './RepairApproval.js';
import { PartNote, PartsBlock, TrackerFields } from './RepairParts.js';
import { Photos } from './WorkshopJobWizard.js';
import { lastKmOf, refusedLastKm } from './RepairClosePage.js';
import type { PartRow } from './StockPage.js';

interface Locations {
  locations: { id: string; name: string }[];
}

/** Enough of a rental to say what is still free in its deposit (§3.7). */
interface RentalDeposit {
  rental: {
    deposit: { paidTetri: number; paidOutTetri: number; withholdings: { amountTetri: number }[] } | null;
  };
}

type Sheet = 'workshop' | 'payer' | 'part' | 'work' | 'close' | 'cancel' | 'reject' | 'addWork';

/**
 * Ремонт (wave 5 §3.7). The head says which moped and how long it has stood;
 * the workshop and who pays are rows that open a sheet rather than a form to
 * fill in, because they are two decisions and not a document; the lines are
 * parts off the shelf and hours of work, priced by whoever pays; and the two
 * ways out — closed with an odometer reading, or cancelled with the parts
 * going back — are the only writes that end it.
 */
export function ServiceJobPage() {
  const { id } = useParams();
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const openMoney = useMoneyForm();
  const { data, failure, reload } = useLoad<{ job: ServiceJob }>(id ? `/api/service/${id}` : null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [after, setAfter] = useState<PreparedPhoto[]>([]);
  // A line and a photo are changed in place; one operation at a time, its refusal beside it.
  const lineOp = useOperation();
  const photoOp = useOperation();
  const takeUpOp = useOperation();
  const afterOp = useOperation();
  const when = useWhen();
  const decisionWords = useDecisionWords();

  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const j = data.job;
  const draft = j.status === 'draft';
  const open = j.status === 'open';
  const mayManage = can('service.manage');
  const mayEdit = open && mayManage;
  // The approval of ADR-0033 — taking a reported breakdown up — is the chief
  // mechanic's as well as the owners'; what it costs stays the owners'.
  const mayApprove = draft && can('service.approve');
  // Stage 3: the mechanic carries his repair to its end — a work found later,
  // the photos after, the closing. One the customer pays for an owner closes.
  const repeat = isRepeat(j);
  const words = decisionWords(j);
  // Only a part bought waits — the hint says so, not «a work waits» (stage 4).
  const partsOnlyWait = repeat && waitingLines(j).length === 0;
  const workshopHand = can('service.work') && !mayManage && j.mechanic != null;
  const mayAddWork = can('service.work') && j.mechanic != null && (open || draft);
  const ownersClose = j.payer === 'customer';
  const mayCloseHere = workshopHand && open && !ownersClose;
  const afterHad = j.photos.filter((p) => p.tag === 'after').length;
  const mayAfter = can('service.work') && j.mechanic != null && (open || draft) && afterHad < AFTER_PHOTOS_MAX;
  const mayFleet = can('fleet.view');
  const money = j.totalTetri != null;
  const days = Math.max(0, daysBetween(j.openedOn, j.closedOn ?? todayISO()));
  const hours = hoursFromMinutes(j.labourMinutes);
  // Only what came off the shelf goes back to it when the repair is cancelled.
  const fromShelf = j.parts.filter((p) => p.partId);
  const backCount = fromShelf.reduce((n, p) => n + p.qty, 0);

  const close = () => setSheet(null);
  const saved = () => {
    close();
    reload();
  };

  return (
    <>
      <PageHead
        wrap
        title={j.number}
        badge={<span className={draft || open ? 'warn-text' : 'muted'}>{j.rejected ? t.wappr.statusRejected : j.paid ? t.wpay.paid : t.repair.statuses[j.status]}</span>}
        sub={
          <>
            {j.vehicle.model} <span className="mono">···{j.vehicle.vin.slice(-4)}</span> · {t.repair.openedOn(fmtDate(j.openedOn))} · {t.repair.days(days)}
          </>
        }
      >
        {(mayApprove || (mayManage && (draft || open))) && (
          <>
            {mayManage && <RowMenu actions={[{ key: 'cancel', label: t.repair.cancel, onPick: () => setSheet('cancel') }]} />}
            {draft ? (
              mayApprove && (
                <>
                  <button type="button" className="pill pill-sm" onClick={() => setSheet('reject')}>
                    {words.reject}
                  </button>
                  <SubmitButton
                    small
                    type="button"
                    state={takeUpOp.state}
                    label={words.approve}
                    onClick={async () => {
                      const res = await takeUpOp.run((key) => api.post(`/api/service/${j.id}/approve`, undefined, { key }));
                      if (!res.ok) return;
                      toast({ text: repeat ? t.wappr.approvedWork : t.repair.takenUp });
                      reload();
                    }}
                  />
                </>
              )
            ) : (
              <button type="button" className="pill pill-sm pill-accent" onClick={() => setSheet('close')}>
                {t.repair.close}
              </button>
            )}
          </>
        )}
        {mayCloseHere && (
          <Link className="pill pill-accent wappr-close" to={`/service/${j.id}/close`}>
            {t.wappr.close}
          </Link>
        )}
      </PageHead>

      {draft && <p className="hint">{partsOnlyWait ? t.wparts.partWaitHint : repeat ? t.wappr.waitHint : j.mechanic ? t.wjob.waitsNote : t.repair.reportNote}</p>}
      {takeUpOp.failure && (
        <p className="field-err" role="alert">
          {takeUpOp.failure.text}
        </p>
      )}
      {j.rejected && (
        <section className="wappr-reason">
          <b>{t.wappr.rejectHead}</b>
          <span className="pre">{j.rejected.reason}</span>
          <span className="muted">{t.wappr.rejectedBy(j.rejected.by ?? t.common.dash, when(j.rejected.at))}</span>
        </section>
      )}
      {j.approved && !j.rejected && <p className="hint muted">{t.wappr.approvedBy(j.approved.by ?? t.common.dash, when(j.approved.at))}</p>}
      {workshopHand && open && ownersClose && <p className="hint">{t.wappr.ownersClose}</p>}
      {j.rejected && workshopHand && j.vehicle.number && (
        <Link className="wjob-new" to={`/service/new?q=${encodeURIComponent(j.vehicle.number)}`}>
          + {t.wappr.newJobOn(j.vehicle.number)}
        </Link>
      )}
      <SuggestCustomer job={j} onPick={() => setSheet('payer')} />

      <div className="two-col">
        <section className="card">
          <Row
            k={t.repair.vehicle}
            v={
              mayFleet ? (
                <Link to={`/fleet/${j.vehicle.id}`}>
                  <Vin vin={j.vehicle.vin} /> <span className="muted">{j.vehicle.model}</span>
                </Link>
              ) : (
                <>
                  <Vin vin={j.vehicle.vin} /> <span className="muted">{j.vehicle.model}</span>
                </>
              )
            }
          />
          <Row
            k={t.repair.what}
            v={
              <span className="pre">
                {j.reasonKind ? `${t.wjob.reasons[j.reasonKind] ?? j.reasonKind} — ` : ''}
                {j.reason}
              </span>
            }
          />
          {j.mechanic && <Row k={t.wjob.mechanic} v={j.mechanic.name} />}
          {j.openedOdometerKm != null && (
            <Row
              k={t.wjob.openedKm}
              v={
                <>
                  <span className="mono">{groupDigits(j.openedOdometerKm)}</span>
                  {j.odometerReason && <span className="muted"> · {j.odometerReason}</span>}
                </>
              }
            />
          )}
          {j.rental && (
            <Row
              k={t.repair.rental}
              v={
                mayFleet ? (
                  <Link to={`/rentals/${j.rental.id}`} className="mono">
                    {j.rental.number}
                  </Link>
                ) : (
                  <span className="mono">{j.rental.number}</span>
                )
              }
            />
          )}
          {j.customer && (
            <Row
              k={t.repair.customer}
              v={
                <Link to={`/customers/${j.customer.id}`}>
                  <CustomerName of={j.customer} />
                </Link>
              }
            />
          )}
          {j.odometerKm != null && <Row k={t.repair.odometer} v={<span className="mono">{j.odometerKm}</span>} />}
          {j.closedLocation && <Row k={t.repair.closedAt} v={j.closedLocation.name} />}
          {j.closedOn && (
            <Row
              k={t.repair.closedOn}
              v={
                <span className="mono">
                  {fmtDate(j.closedOn)}
                  {j.closedAt ? ` ${localDateTime(j.closedAt).time}` : ''}
                </span>
              }
            />
          )}
          {/* Downtime in hours, and the wait for approval within it (ADR-0038): a repair
              closed before the times were kept says «no data», never days turned into hours. */}
          {(j.downtime != null || j.status === 'done') && <Row k={t.wmaint.downtime} v={<DowntimeText d={j.downtime ?? null} />} />}
          {/* Its mechanic is paid for it: the repair is a record now (ADR-0037 §5). */}
          {j.paid && <Row k={t.wpay.paid} v={t.wpay.paidIn(fmtDate(j.paid.paidOn), j.paid.markedBy.name)} />}
          {j.notes && <Row k={t.repair.notes} v={<span className="pre">{j.notes}</span>} />}
        </section>

        {/* Two decisions, not a form: each opens its own sheet and writes on its own (§3.7). */}
        <section className="card">
          <Choice k={t.repair.workshop} v={j.workshop?.name ?? t.repair.workshopNone} quiet={!j.workshop} onPick={mayEdit ? () => setSheet('workshop') : undefined} />
          <Choice k={t.repair.payer} v={t.repair.payers[j.payer]} onPick={mayEdit ? () => setSheet('payer') : undefined} />
          {money && (
            <div className="kv kv-total">
              <span className="kv-k">{t.repair.total}</span>
              <span className="kv-v mono">{formatGel(j.totalTetri ?? 0)}</span>
            </div>
          )}
          {(j.withheldTetri ?? 0) > 0 && <Row k={t.repair.withhold} v={<span className="mono">{formatGel(j.withheldTetri ?? 0)}</span>} />}
          {(j.chargedTetri ?? 0) > 0 && <p className="hint">{t.repair.debtNote(formatGel(j.chargedTetri ?? 0), j.number)}</p>}
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

      {/* Parts and the old single line of work. A mechanic adds neither yet
          (parts are stage 4), so an empty block is only shown to who can fill it. */}
      {(mayManage || j.labourMinutes > 0 || (j.labourTetri ?? 0) > 0) && (
      <section className="card">
        <BlockHead title={t.repair.lines} />
        {j.parts.length === 0 && (j.labourTetri ?? 0) === 0 && j.labourMinutes === 0 && (j.worksCostTetri ?? 0) === 0 ? (
          <Empty text={t.repair.noLines} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.repair.lineWhat}</th>
                  <th className="num">{t.repair.lineQty}</th>
                  {money && <th className="num">{t.repair.lineSum}</th>}
                  {mayEdit && <th />}
                </tr>
              </thead>
              <tbody>
                {j.parts.map((p) => (
                  <tr key={p.id} className={p.state === 'rejected' || (j.rejected && p.state) ? 'wparts-struck' : ''}>
                    <td>
                      {p.kind !== 'stock' && <span className="wparts-kind">{t.wparts.kinds[p.kind] ?? p.kind}</span>} {p.name}{' '}
                      {p.kind === 'stock' && <span className="muted">· {j.payer === 'customer' ? t.repair.retailWord : t.repair.costWord}</span>}
                      {p.kind === 'stock' && p.partId && p.unitCostTetri == null && money && <span className="muted"> · {t.wparts.costUnknown}</span>}
                      {p.state === 'waiting' && <span className="wjob-wtag">{t.wappr.waitingTag}</span>}
                      <PartNote p={p} />
                    </td>
                    <td className="num mono">{p.qty}</td>
                    {money && <td className="num mono">{p.lineTetri == null || p.kind === 'removed' || p.state === 'rejected' ? '—' : formatGel(p.lineTetri)}</td>}
                    {mayEdit && (
                      <td className="num">
                        <button
                          type="button"
                          className="pill pill-sm"
                          aria-label={t.repair.removeLine}
                          onClick={async () => {
                            // The parts go back on the shelf, and that is a
                            // movement, not an undo: a person is told what
                            // will be written before it is (QA-W5-18).
                            if (p.partId && !window.confirm(t.repair.returnToStock(p.qty))) return;
                            const res = await lineOp.run((key) => api.del(`/api/service/${j.id}/parts/${p.id}`, { key }), `del:${p.id}`);
                            if (!res.ok) return;
                            toast({ text: p.partId ? t.repair.partReturned(p.qty) : t.repair.partRemoved });
                            reload();
                          }}
                        >
                          ×
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {((j.labourTetri ?? 0) > 0 || j.labourMinutes > 0) && (
                  <tr>
                    <td>
                      {t.repair.workLine(t.repair.hours(hours))}
                      {money && <span className="muted"> · {formatGel(j.labourRateTetri ?? 0)}</span>}
                    </td>
                    <td className="num mono">{t.repair.hours(hours)}</td>
                    {money && <td className="num mono">{formatGel(j.labourTetri ?? 0)}</td>}
                    {mayEdit && <td />}
                  </tr>
                )}
                {/* The mechanic's approved work is in the company's repair cost (ADR-0037 §6): its own
                    row, so the lines add up to the total under them. */}
                {money && (j.worksCostTetri ?? 0) > 0 && (
                  <tr>
                    <td>{t.wpay.worksCost}</td>
                    <td />
                    <td className="num mono">{formatGel(j.worksCostTetri ?? 0)}</td>
                    {mayEdit && <td />}
                  </tr>
                )}
                {money && (
                  <tr className="row-total">
                    <td>{t.repair.total}</td>
                    <td />
                    <td className="num mono">{formatGel(j.totalTetri ?? 0)}</td>
                    {mayEdit && <td />}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {mayEdit && (
          <div className="row-actions">
            <button type="button" className="pill pill-sm" onClick={() => setSheet('part')}>
              + {t.repair.addPart}
            </button>
            {/* No "+": there is one line of work on a repair and this button
                edits it rather than adding another (wave 5 §3.7,
                улучшение 2). A list of jobs waits for the time norms the
                book does not have yet (register #33). */}
            <button type="button" className="pill pill-sm" onClick={() => setSheet('work')}>
              {t.repair.addWork}
            </button>
          </div>
        )}
        {lineOp.failure && (
          <p className="field-err" role="alert">
            {lineOp.failure.fieldText ?? lineOp.failure.text}
          </p>
        )}
      </section>
      )}

      {/* The works a mechanic wrote, with the norm and rate they were written
          with (stage 2), and where each stands (stage 3). A repair from before
          has none, and no block. */}
      {(j.works.length > 0 || mayAddWork) && (
        <section className="card">
          <BlockHead title={t.wjob.works} />
          {j.works.length > 0 && (
            <>
              <StatedLines
                job={j}
                lines={j.works}
                tagWaiting={j.approved ? t.wappr.waitingTag : undefined}
                editNorm={can('service.norms') && j.status !== 'cancelled' && !j.paid ? (l) => <NormEdit job={j} line={l} onSaved={reload} /> : undefined}
              />
              <NormTotal lines={j.works} />
            </>
          )}
          {mayAddWork && (
            <div className="row-actions">
              <button type="button" className="wjob-btn" onClick={() => setSheet('addWork')}>
                + {t.wappr.addWork}
              </button>
            </div>
          )}
        </section>
      )}

      {/* The parts the workshop writes as the work goes (stage 4, variant A). The
          owners keep their own form above; anyone else reads them here. */}
      {!mayManage && <PartsBlock job={j} editable={can('service.work') && j.mechanic != null && (open || draft)} onChanged={reload} />}
      {mayManage && (j.batteries.length > 0 || j.trackers.fitted.length > 0 || j.trackers.removed.length > 0) && <PartsBlock job={{ ...j, parts: [] }} editable={false} onChanged={reload} />}

      <section className="card">
        <BlockHead title={t.repair.photos} sub={t.photos.count(j.photos.length)} />
        {j.photos.length > 0 && (
          <div className="thumbs">
            {j.photos.map((p) => (
              <a key={p.id} className="thumb wjob-thumb" href={`/api/files/${p.id}`} target="_blank" rel="noreferrer">
                <img src={`/api/files/${p.id}`} alt="" loading="lazy" />
                {p.tag && <span className="wjob-tag">{t.wjob.photoTags[p.tag] ?? p.tag}</span>}
              </a>
            ))}
          </div>
        )}
        {(mayEdit || (draft && mayManage)) && (
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
        {/* Photos after the repair, left before it closes — on one the owner
            closes, this is where the mechanic puts them (stage 3). */}
        {mayAfter && (
          <>
            <Photos photos={after} onChange={setAfter} label={t.wappr.afterAdd} tag={t.wjob.photoTags.after} max={AFTER_PHOTOS_MAX - afterHad} />
            {after.length > 0 && (
              <SubmitButton
                small
                type="button"
                state={afterOp.state}
                label={t.photos.save}
                onClick={async () => {
                  const res = await afterOp.run(async (key) =>
                    api.post(`/api/service/${j.id}/photos/after`, { photos: await Promise.all(after.map(async (p) => ({ mimeType: p.mimeType, dataBase64: await toBase64(p.blob) }))) }, { key }),
                  );
                  if (!res.ok) return;
                  setAfter([]);
                  toast({ text: t.wappr.afterSaved });
                  reload();
                }}
              />
            )}
            {afterOp.failure && (
              <p className="field-err" role="alert">
                {afterOp.failure.fieldText ?? afterOp.failure.text}
              </p>
            )}
          </>
        )}
      </section>

      {sheet === 'workshop' && <WorkshopSheet job={j} onClose={close} onSaved={saved} />}
      {sheet === 'payer' && <PayerSheet job={j} onClose={close} onSaved={saved} />}
      {sheet === 'part' && <PartSheet job={j} onClose={close} onSaved={saved} />}
      {sheet === 'work' && <WorkSheet job={j} onClose={close} onSaved={saved} />}
      {sheet === 'close' && <CloseSheet job={j} onClose={close} onSaved={saved} />}
      {sheet === 'reject' && <RejectSheet job={j} onClose={close} onDone={reload} />}
      {sheet === 'addWork' && <AddWorkSheet job={j} onClose={close} onDone={reload} />}
      {sheet === 'cancel' && <CancelSheet job={j} backCount={backCount} names={fromShelf.map((p) => `${p.name} × ${p.qty}`).join(', ')} onClose={close} onDone={() => navigate('/service')} />}
    </>
  );
}

/** The norm of a work not in the book, written in place by whoever keeps norms (stage 3). */
function NormEdit({ job, line, onSaved }: { job: ServiceJob; line: ServiceWorkLine; onSaved: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const [v, setV] = useState('');
  return (
    <span className="wjob-norm">
      <input className="input mono" inputMode="decimal" aria-label={t.wappr.normLabel} value={v} onChange={(e) => setV(e.target.value.replace(/[^\d.,]/g, ''))} />
      <span className="muted">{t.wappr.minUnit}</span>
      <SubmitButton
        small
        type="button"
        state={op.state}
        label={t.wappr.setNorm}
        disabled={normSecFromMinutes(v) == null}
        onClick={async () => {
          const res = await op.run((key) => api.patch(`/api/service/${job.id}/works/${line.id}`, { normMin: v }, { key }));
          if (!res.ok) return;
          toast({ text: t.wappr.normSaved });
          onSaved();
        }}
      />
      {op.failure && <span className="field-err">{op.failure.fieldText ?? op.failure.text}</span>}
    </span>
  );
}

/** A row that reads like a fact and opens a sheet when it may be changed. */
function Choice({ k, v, quiet, onPick }: { k: string; v: string; quiet?: boolean; onPick?: () => void }) {
  if (!onPick) return <Row k={k} v={quiet ? <span className="muted">{v}</span> : v} />;
  return (
    <button type="button" className="sum-row" onClick={onPick}>
      <span className="kv-k">{k}</span>
      <span className={quiet ? 'muted' : undefined}>{v}</span>
      <span className="sum-go" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

/**
 * The workshop that has it: a list the owner keeps, never free text (§8). One
 * taken off the list since is still this repair's, so it is shown first and
 * marked, to be kept or changed — not left unmarked and cleared by accident
 * (owner's decision of 21.10.2026).
 */
function WorkshopSheet({ job, onClose, onSaved }: { job: ServiceJob; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const workshops = useLoad<{ workshops: Workshop[] }>('/api/workshops');
  const initial = job.workshop?.id ?? '';
  const [v, setV] = useState(initial);
  // Until the list has come, nothing is known to be off it.
  const choices = workshops.data ? workshopChoices(workshops.data.workshops, job.workshop) : [];
  return (
    <FormSheet
      title={t.repair.workshopPick}
      onClose={onClose}
      value={v}
      initial={initial}
      label={t.actions.save}
      submit={async (key) => {
        await api.patch(`/api/service/${job.id}`, { workshopId: v || null }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onSaved}
    >
      <div className="chips">
        <button type="button" className={`pill pill-sm ${v === '' ? 'on' : ''}`} onClick={() => setV('')}>
          {t.repair.workshopNone}
        </button>
        {choices.map((w) => (
          <button key={w.id} type="button" className={`pill pill-sm ${v === w.id ? 'on' : ''}`} onClick={() => setV(w.id)}>
            {w.name}
            {w.off && ` · ${t.wshop.archived}`}
          </button>
        ))}
      </div>
    </FormSheet>
  );
}

/** Who pays decides what a part costs on the line (B8-04, crit. 22–23). */
function PayerSheet({ job, onClose, onSaved }: { job: ServiceJob; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const [v, setV] = useState<'company' | 'customer'>(job.payer);
  return (
    <FormSheet
      title={t.repair.payerPick}
      onClose={onClose}
      value={v}
      initial={job.payer}
      label={t.actions.save}
      submit={async (key) => {
        await api.patch(`/api/service/${job.id}`, { payer: v }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onSaved}
    >
      <Field label={t.repair.payer} name="payer">
        <div className="chips">
          {(['company', 'customer'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`pill pill-sm ${v === p ? 'on' : ''}`}
              aria-disabled={p === 'customer' && !job.rental ? true : undefined}
              onClick={() => (p === 'customer' && !job.rental ? undefined : setV(p))}
            >
              {t.repair.payers[p]}
            </button>
          ))}
        </div>
      </Field>
      <p className="hint muted">{v === 'customer' ? t.repair.payerCustomerNote : t.repair.payerCompanyNote}</p>
      {/* Only the person who has the moped can be charged for it (`no_renter`). */}
      {job.rental && <p className="hint muted">{t.repair.rentedNote}</p>}
    </FormSheet>
  );
}

const blankPart = { partId: '', qty: '1', price: '', imei: '', sim: '' };

/** A part off the shelf. Short stock does not refuse it — the count goes red (`service.md`). */
function PartSheet({ job, onClose, onSaved }: { job: ServiceJob; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const parts = useLoad<{ parts: PartRow[] }>('/api/parts');
  const [f, setF] = useState(blankPart);
  const rows = parts.data?.parts ?? [];
  const nameOf = (p: PartRow) => (locale === 'ka' && p.nameKa) || p.name;
  const picked = rows.find((p) => p.id === f.partId) ?? null;
  const qty = Number(f.qty) || 0;
  const typed = f.price.trim() ? parseGel(f.price) : null;

  return (
    <FormSheet
      title={t.repair.partTitle}
      onClose={onClose}
      value={f}
      initial={blankPart}
      onRestore={setF}
      summary={() => picked && nameOf(picked)}
      label={t.repair.partAdd}
      submit={async (key) => {
        const tracker = picked?.isTracker ? { imei: f.imei, sim: f.sim } : {};
        const price = typed != null ? { unitPriceTetri: typed } : {};
        await api.post(`/api/service/${job.id}/parts`, { partId: f.partId, qty: picked?.isTracker ? 1 : qty || 1, ...price, ...tracker }, { key });
        return { toast: { text: t.repair.partAdded } };
      }}
      onDone={onSaved}
    >
      <Field label={t.repair.partPick} name="partId">
        <select className="input" value={f.partId} onChange={(e) => setF({ ...f, partId: e.target.value })} required autoFocus>
          <option value="">{t.common.dash}</option>
          {rows.map((p) => (
            <option key={p.id} value={p.id}>
              {nameOf(p)} · {p.onHand} {t.stock.units[p.unit]}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.repair.partQty} name="qty">
        <input className="input input-amount mono" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} inputMode="numeric" />
      </Field>
      {picked && qty > picked.onHand && <p className="hint hint-bad">{t.repair.partShort(picked.onHand, t.stock.units[picked.unit])}</p>}
      {/* A tracker fitted asks for its IMEI and SIM, on the owners' form too (ADR-0036). */}
      {picked?.isTracker && <TrackerFields imei={f.imei} sim={f.sim} vehicle={job.vehicle.number ?? job.vehicle.model} onChange={(imei, sim) => setF({ ...f, imei, sim })} />}
      {/* The price the API will pick is the shelf's or the retail one; it is
          shown only to whoever may see cost, and overtyped only on purpose. */}
      {can('cost.view') && (
        <Field label={t.repair.partPrice} hint={t.repair.partPriceHint} name="unitPriceTetri">
          <input className="input input-amount mono" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} inputMode="decimal" />
        </Field>
      )}
    </FormSheet>
  );
}

/** Hours at the rate, and the money as it is typed (crit. 24). */
function WorkSheet({ job, onClose, onSaved }: { job: ServiceJob; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const initial = { hours: job.labourMinutes > 0 ? String(hoursFromMinutes(job.labourMinutes)) : '' };
  const [f, setF] = useState(initial);
  const hours = Number(f.hours.replace(',', '.')) || 0;
  const sum = labourFor(minutesFromHours(hours), job.labourRateTetri ?? undefined);
  return (
    <FormSheet
      title={t.repair.workTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.repair.workSave}
      submit={async (key) => {
        await api.patch(`/api/service/${job.id}`, { labourHours: hours }, { key });
        return { toast: { text: t.repair.workSaved } };
      }}
      onDone={onSaved}
    >
      <Field label={t.repair.workHours} hint={t.repair.workRate(formatGel(job.labourRateTetri ?? 0))} name="labourHours">
        <input className="input input-amount mono" value={f.hours} onChange={(e) => setF({ hours: e.target.value })} inputMode="decimal" autoFocus />
      </Field>
      <p className="hint">{t.repair.workWillBe(t.repair.hours(hours), formatGel(job.labourRateTetri ?? 0), formatGel(sum))}</p>
    </FormSheet>
  );
}

/**
 * Closing asks the two things nobody remembers a week later (B5-06, crit. 26):
 * what the odometer read and where the moped ended up. A repair charged to a
 * customer then splits between the deposit and their debt (Q26, crit. 25).
 */
function CloseSheet({ job, onClose, onSaved }: { job: ServiceJob; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const { can } = useSession();
  const locations = useLoad<Locations>(job.movedVehicle ? '/api/locations' : null);
  const mayWithhold = can('deposit.decide') && job.payer === 'customer' && job.rental != null;
  const rental = useLoad<RentalDeposit>(mayWithhold ? `/api/rentals/${job.rental!.id}` : null);
  const initial = { closedOn: todayISO(), odometer: job.odometerKm != null ? String(job.odometerKm) : '', odometerReason: '', locationId: '', withhold: '' };
  const [f, setF] = useState(initial);
  // Below the opening's or the moped's last reading only with the reason
  // (ADR-0038 §4) — or below one read since the sheet opened, which the
  // server names when it refuses: then the reason is asked against that.
  const [refusedKm, setRefusedKm] = useState<number | null>(null);
  const lastKm = lastKmOf(job, refusedKm);
  const km = f.odometer.trim() === '' ? null : Number(f.odometer.replace(/\s/g, ''));
  const below = km != null && lastKm != null && km < lastKm;
  // A mechanic's repair closes with a photo after it (stage 3); one may be on it already.
  const afterHad = job.photos.filter((p) => p.tag === 'after').length;
  const [after, setAfter] = useState<PreparedPhoto[]>([]);

  const deposit = rental.data?.rental.deposit ?? null;
  // The same arithmetic the API does before it agrees: paid in, less what is
  // already kept, less what has gone back out.
  const free = deposit ? deposit.paidTetri - deposit.withholdings.reduce((n, w) => n + w.amountTetri, 0) - deposit.paidOutTetri : null;
  // Closing is an owner's, who sees what the repair cost.
  const total = job.totalTetri ?? 0;
  const withheld = Math.max(0, Math.min(parseGel(f.withhold) ?? 0, total, free ?? total));
  const debt = Math.max(0, total - withheld);

  return (
    <FormSheet
      title={t.repair.closeTitle(job.number)}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={`job-close:${job.id}`}
      onRestore={setF}
      label={t.repair.closeCta}
      submit={async (key) => {
        await api
          .post(
            `/api/service/${job.id}/close`,
            {
              closedOn: f.closedOn,
              odometerKm: f.odometer === '' ? null : Number(f.odometer),
              // A draft from before stage 6 has no reason in it.
              odometerReason: below ? (f.odometerReason ?? '').trim() || null : null,
              locationId: f.locationId || null,
              withheldTetri: parseGel(f.withhold) ?? 0,
              photos: await Promise.all(after.map(async (p) => ({ mimeType: p.mimeType, dataBase64: await toBase64(p.blob) }))),
            },
            { key },
          )
          .catch((e: unknown) => {
            const named = refusedLastKm(e);
            if (named != null) setRefusedKm(named);
            throw e;
          });
        return { toast: { text: t.repair.closed } };
      }}
      onDone={onSaved}
    >
      <div className="kv">
        <span className="kv-k">{t.repair.jobTotal}</span>
        <span className="kv-v mono">{formatGel(total)}</span>
      </div>
      {job.mechanic && afterHad < AFTER_PHOTOS_MAX && (
        <Photos
          photos={after}
          onChange={setAfter}
          label={t.wappr.afterPhotos(afterHad + after.length, AFTER_PHOTOS_MAX)}
          tag={t.wjob.photoTags.after}
          max={AFTER_PHOTOS_MAX - afterHad}
        />
      )}
      <div className="two-col two-col-tight">
        <Field label={t.repair.closedOn} name="closedOn">
          <input className="input mono" type="date" value={f.closedOn} onChange={(e) => setF({ ...f, closedOn: e.target.value })} />
        </Field>
        <Field label={t.repair.odometerKm} name="odometerKm">
          <input className="input input-amount mono" value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value })} inputMode="numeric" />
        </Field>
      </div>
      {below && (
        <>
          <p className="warn-text">{t.repair.odometerBelow(groupDigits(lastKm!))}</p>
          <Field label={t.hand.odometerReason} hint={t.hand.odometerReasonHint} name="odometerReason">
            <input className="input" value={f.odometerReason ?? ''} onChange={(e) => setF({ ...f, odometerReason: e.target.value })} />
          </Field>
        </>
      )}
      {/* A moped that never left the customer keeps no point of ours (§3.7). */}
      {job.movedVehicle && (
        <Field label={t.repair.where} name="locationId">
          <select className="input" value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })} required>
            <option value="">{t.common.dash}</option>
            {(locations.data?.locations ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      {mayWithhold && (
        <>
          <div className="kv">
            <span className="kv-k">{t.repair.depositFree}</span>
            <span className="kv-v mono">{free == null ? t.common.dash : formatGel(free)}</span>
          </div>
          {free === 0 && <p className="hint muted">{t.repair.noDeposit}</p>}
          <Field label={t.repair.withhold} hint={t.repair.withholdHint} name="withheldTetri">
            <input className="input input-amount mono" value={f.withhold} onChange={(e) => setF({ ...f, withhold: e.target.value })} inputMode="decimal" />
          </Field>
        </>
      )}
      {job.payer === 'customer' && debt > 0 && <p className="hint">{t.repair.debtNote(formatGel(debt), job.number)}</p>}
    </FormSheet>
  );
}

/** Cancelling says what goes back on the shelf before it happens (crit. 27). */
function CancelSheet({ job, backCount, names, onClose, onDone }: { job: ServiceJob; backCount: number; names: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <FormSheet
      title={t.repair.cancelTitle(job.number)}
      onClose={onClose}
      value={reason}
      initial=""
      draft={`job-cancel:${job.id}`}
      onRestore={setReason}
      summary={(v) => v}
      label={t.repair.cancelCta}
      submit={async (key) => {
        await api.post(`/api/service/${job.id}/cancel`, { reason }, { key });
        return { toast: { text: t.repair.cancelled } };
      }}
      onDone={onDone}
    >
      <Field label={t.repair.cancelReason} name="reason">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
      </Field>
      {backCount > 0 && <p className="hint">{t.repair.partsBack(backCount, names)}</p>}
    </FormSheet>
  );
}

