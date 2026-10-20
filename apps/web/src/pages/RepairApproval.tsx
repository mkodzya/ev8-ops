import { localDateTime, normSecFromMinutes, suggestsCustomerPays, worksTotal } from '@ev8/shared';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Loading } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { groupDigits, nameIn, normText, type WorkBook } from '../lib/workBook.js';
import { useSession } from '../session.js';
import type { ServiceJob, ServiceWorkLine } from './ServicePage.js';
import { WorksStep, type Line } from './WorkshopJobWizard.js';
import './workshop-job.css';

// Approving, refusing and closing the mechanic's repair (stage 3 of the
// mechanic plan; prototype mechanic-approval-options.html, variants A and A,
// chosen by Mika on 20.10.2026): the queue decides in the card itself, a
// refusal always says why, and a work found once the repair is open waits on
// its own while the rest goes on.

/** «сегодня 09:15» or «18.10 09:15»: a moment as the workshop says it, in Tbilisi. */
export function useWhen() {
  const t = useT();
  return (iso: string) => {
    const at = localDateTime(iso);
    const now = localDateTime(new Date());
    return at.date === now.date ? `${t.wappr.today} ${at.time}` : `${at.date.slice(0, 5)} ${at.time}`;
  };
}

/** Minutes from a moment to now. */
function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

/** The lines that wait for the decision now. */
export function waitingLines(job: ServiceJob): ServiceWorkLine[] {
  return job.works.filter((w) => w.state === 'waiting');
}

/** A second round: the repair was approved once, and a work found later waits. */
export function isRepeat(job: ServiceJob): boolean {
  return job.status === 'draft' && job.approved != null;
}

/**
 * The lines of work with where each stands: approved (a quiet tick), waiting
 * (shaded, «new» in the queue), refused (struck through, with the reason). A
 * line not in the book and with no norm takes one in place when `norms` is
 * given — the approver types it there.
 */
export function StatedLines({
  job,
  lines,
  norms,
  onNorm,
  tagWaiting,
  editNorm,
}: {
  job: ServiceJob;
  lines: ServiceWorkLine[];
  norms?: Record<string, string>;
  onNorm?: (id: string, v: string) => void;
  tagWaiting?: string;
  editNorm?: (line: ServiceWorkLine) => ReactNode;
}) {
  const t = useT();
  const { locale } = useLocale();
  const whole = job.rejected != null;
  return (
    <ul className="wjob-lines">
      {lines.map((l) => {
        const typed = norms?.[l.id] ?? '';
        const sec = l.normSec ?? normSecFromMinutes(typed);
        const amount = l.rateTetri != null && sec != null ? Math.round((l.qty * sec * l.rateTetri) / 3600) : null;
        const state = whole ? 'rejected' : l.state;
        // The first time everything waits together: only a later work stands out as waiting.
        const shade = state === 'waiting' && job.approved == null ? '' : `wjob-line-${state}`;
        return (
          <li key={l.id} className={shade}>
            <span className="wjob-code">{l.code ?? '—'}</span>
            <span className="wjob-name">
              {l.code ? nameIn(l, locale) : l.freeText} × {l.qty}
              {state === 'rejected' && !whole && l.rejectReason && <span className="wjob-line-why">{t.wappr.lineRejected(l.rejectReason)}</span>}
            </span>
            {state === 'waiting' && tagWaiting && <span className="wjob-wtag">{tagWaiting}</span>}
            {l.normSec == null && onNorm && state === 'waiting' ? (
              <label className="wjob-norm">
                <input
                  className="input mono"
                  inputMode="decimal"
                  aria-label={t.wappr.normLabel}
                  value={typed}
                  onChange={(e) => onNorm(l.id, e.target.value.replace(/[^\d.,]/g, ''))}
                />
                <span className="muted">{t.wappr.minUnit}</span>
              </label>
            ) : l.normSec == null && editNorm && state !== 'rejected' ? (
              editNorm(l)
            ) : sec != null ? (
              <span className="mono">{t.wjob.min(normText(sec * l.qty, locale))}</span>
            ) : (
              <span className="wjob-nonorm">{t.wjob.noNorm}</span>
            )}
            {l.rateTetri != null && <span className="mono wjob-gel">{amount != null ? formatGel(amount) : '—'}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/** The time and money by the norm of the lines that count — refused ones do not. */
export function NormTotal({ lines, norms }: { lines: ServiceWorkLine[]; norms?: Record<string, string> }) {
  const t = useT();
  const { locale } = useLocale();
  const counted = lines.filter((l) => l.state !== 'rejected');
  const money = counted.every((l) => l.rateTetri != null);
  const total = worksTotal(counted.map((l) => ({ qty: l.qty, normSec: l.normSec ?? normSecFromMinutes(norms?.[l.id] ?? ''), rateTetri: l.rateTetri ?? 0 })));
  return (
    <div className="wjob-total">
      <span>{t.wjob.byNorm}</span>
      <span className="mono">
        {t.wjob.min(normText(total.seconds, locale))}
        {money && counted.length > 0 && ` · ${formatGel(total.tetri)}`}
      </span>
    </div>
  );
}

/**
 * One repair in «Ждут согласования» (variant A): everything the decision
 * needs — the photos, the reason, the mileage, the works with their norm —
 * and the two buttons, so it is decided without opening the card.
 */
export function ApprovalCard({ job, onDone }: { job: ServiceJob; onDone: () => void }) {
  const t = useT();
  const { can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const when = useWhen();
  const op = useOperation();
  const [norms, setNorms] = useState<Record<string, string>>({});
  const [refusing, setRefusing] = useState(false);
  const [open, setOpen] = useState(false);
  const repeat = isRepeat(job);
  const waiting = waitingLines(job);
  // The first time, the whole repair is shown; the second, what was approved
  // stays in sight beside what waits.
  const lines = job.works;
  const folded = !open && lines.length > 4;
  const shown = folded ? lines.slice(0, 3) : lines;
  const photos = job.photos.filter((p) => p.tag !== 'after');
  const since = repeat ? waiting.map((w) => w.addedAt).sort()[0] : job.openedAt;
  const mayNorm = can('service.norms');

  const approve = async () => {
    const typed = Object.entries(norms)
      .filter(([, v]) => normSecFromMinutes(v) != null)
      .map(([workId, v]) => ({ workId, normMin: v }));
    const body = typed.length ? { norms: typed } : undefined;
    const res = await op.run((key) => api.post(`/api/service/${job.id}/approve`, body, { key }));
    if (!res.ok) return;
    toast({ text: repeat ? t.wappr.approvedWork : t.wappr.approved(job.number) });
    // A breakdown nobody carries is an owner's to fill in: the workshop, who pays.
    if (!job.mechanic && can('service.manage')) navigate(`/service/${job.id}`);
    else onDone();
  };

  return (
    <li className="wappr-card">
      <div className="wappr-head">
        <Link to={`/service/${job.id}`}>
          <b>
            {job.number} · {job.vehicle.number ? `${job.vehicle.number} · ` : ''}
            {job.vehicle.model}
          </b>
        </Link>
        <span className="muted">
          {job.mechanic?.name ?? t.repair.fromManager}
          {repeat && waiting[0] ? ` · ${t.wappr.addedAt(when(waiting[0].addedAt))}` : job.openedAt ? ` · ${when(job.openedAt)}` : ''}
          {since ? `, ${t.wappr.waited(minutesSince(since))}` : ''}
        </span>
      </div>
      {!repeat && (
        <p className="wappr-why">
          {job.reasonKind ? `${t.wjob.reasons[job.reasonKind] ?? job.reasonKind} — ` : ''}
          {job.reason}
          {job.openedOdometerKm != null && <span className="mono"> · {t.wappr.km(groupDigits(job.openedOdometerKm))}</span>}
          {job.odometerReason && <span className="muted"> ({job.odometerReason})</span>}
        </p>
      )}
      {!repeat && photos.length > 0 && (
        <div className="thumbs">
          {photos.map((p) => (
            <a key={p.id} className="thumb wjob-thumb wappr-thumb" href={`/api/files/${p.id}`} target="_blank" rel="noreferrer">
              <img src={`/api/files/${p.id}`} alt="" loading="lazy" />
              {p.tag && <span className="wjob-tag">{t.wjob.photoTags[p.tag] ?? p.tag}</span>}
            </a>
          ))}
        </div>
      )}
      {can('service.manage') && suggestsCustomerPays(job) && job.rental && (
        <p className="hint">
          <Link to={`/service/${job.id}`}>{t.wappr.queueSuggest(job.rental.number)}</Link>
        </p>
      )}
      {lines.length > 0 && (
        <>
          <StatedLines job={job} lines={shown} norms={norms} onNorm={mayNorm ? (id, v) => setNorms((n) => ({ ...n, [id]: v })) : undefined} tagWaiting={repeat ? t.wappr.newTag : undefined} />
          {folded && (
            <button type="button" className="pill pill-sm" onClick={() => setOpen(true)}>
              {t.wappr.more(lines.length - 3)}
            </button>
          )}
          {!repeat && <NormTotal lines={lines} norms={norms} />}
        </>
      )}
      {op.failure && (
        <p className="field-err" role="alert">
          {op.failure.fieldText ?? op.failure.text}
        </p>
      )}
      <div className="wappr-acts">
        <button type="button" className="pill" onClick={() => setRefusing(true)}>
          {repeat ? t.wappr.rejectWork(waiting.length) : t.wappr.reject}
        </button>
        <SubmitButton type="button" state={op.state} label={repeat ? t.wappr.approveWork(waiting.length) : t.wappr.approve} onClick={() => void approve()} />
      </div>
      {refusing && <RejectSheet job={job} onClose={() => setRefusing(false)} onDone={onDone} />}
    </li>
  );
}

/**
 * Refusing always says why, and says what will happen before it does
 * (principle 14): the whole repair the first time — the moped back to the
 * fleet, nobody paid — or only the works that wait.
 */
export function RejectSheet({ job, onClose, onDone }: { job: ServiceJob; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  const repeat = isRepeat(job);
  const n = waitingLines(job).length;
  const moped = job.vehicle.number ?? job.vehicle.model;
  return (
    <FormSheet
      title={repeat ? t.wappr.rejectWorkTitle(n) : t.wappr.rejectTitle(job.number)}
      onClose={onClose}
      value={reason}
      initial=""
      label={repeat ? t.wappr.rejectWork(n) : t.wappr.reject}
      submit={async (key) => {
        await api.post(`/api/service/${job.id}/reject`, { reason: reason.trim() }, { key });
        return { toast: { text: repeat ? t.wappr.rejectedWork : t.wappr.rejected(job.number) } };
      }}
      onDone={onDone}
    >
      <Field label={t.wappr.reason} hint={t.wappr.reasonHint} name="reason">
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
      </Field>
      <p className="hint">{repeat ? t.wappr.rejectWorkNote : job.movedVehicle ? t.wappr.rejectMoved(moped) : t.wappr.rejectRented}</p>
    </FormSheet>
  );
}

/**
 * A work found once the repair is open (spec, «нашлась ещё работа»): the same
 * book and the same words-for-a-missing-one as in «Новая заявка». It waits
 * for approval on its own; the chief mechanic's goes in at once.
 */
export function AddWorkSheet({ job, onClose, onDone }: { job: ServiceJob; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { can } = useSession();
  const book = useLoad<WorkBook>('/api/work-book');
  const [lines, setLines] = useState<Line[]>([]);
  const at = job.status === 'open' && can('service.approve');
  return (
    <FormSheet
      title={t.wappr.addWorkTitle}
      onClose={onClose}
      value={lines}
      initial={[]}
      label={at ? t.wappr.addWorkAdd : t.wappr.addWorkSend}
      submit={async (key) => {
        await api.post(`/api/service/${job.id}/works`, { works: lines }, { key });
        return { toast: { text: at ? t.wappr.workAdded : t.wappr.workSent } };
      }}
      onDone={onDone}
    >
      {book.data ? <WorksStep book={book.data} lines={lines} update={(fn) => setLines((now) => fn(now))} /> : <Loading />}
      {!at && <p className="hint muted">{t.wappr.addWorkNote}</p>}
    </FormSheet>
  );
}

/**
 * The owner is offered «за счёт клиента» when a renter is to blame for a
 * moped out on their rental; an accident is not offered (Mika, 20.10.2026;
 * register #110). The button opens the choice of who pays that exists.
 */
export function SuggestCustomer({ job, onPick }: { job: ServiceJob; onPick: () => void }) {
  const t = useT();
  const { can } = useSession();
  if (!can('service.manage') || !suggestsCustomerPays(job) || !job.rental) return null;
  return (
    <section className="wappr-suggest">
      <p>
        <b>{t.wappr.suggest(job.rental.number)}</b>
      </p>
      <p className="muted">{t.wappr.suggestNote}</p>
      <button type="button" className="pill pill-sm" onClick={onPick}>
        {t.wappr.suggestCta}
      </button>
    </section>
  );
}
