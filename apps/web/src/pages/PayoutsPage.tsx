import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { RowMenu } from '../components/RowMenu.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { FormSheet } from '../ds/form/Form.js';
import { fmtDate, fmtDayMonth, formatGel } from '../format.js';
import type { Dict } from '../i18n/en.js';
import { useLocale, useT } from '../i18n/index.js';
import { Typed } from '../lib/typed.js';
import { useLoad } from '../lib/use.js';
import { normText } from '../lib/workBook.js';
import './workshop-job.css';

// «К оплате» (stage 5 of the mechanic plan; prototype
// mechanic-payouts-options.html, variant A, chosen by Mika on 20.10.2026;
// ADR-0037): one screen, a card for each mechanic with the repairs inside, and
// the one button that marks him paid. The figures are the API's, never added
// up here: a repair's work is rounded once on the repair, and the payout is
// the sum of the repairs and the receipts.

export interface PayJob {
  id: string;
  number: string;
  vehicle: { id: string; number: string | null; model: string; vin: string };
  closedOn: string | null;
  seconds: number;
  workTetri: number;
  works: { code: string | null; freeText: string | null; qty: number }[];
  receipts: { id: string; name: string; paidTetri: number }[];
  totalTetri: number;
}

export interface PayMechanic {
  id: string;
  name: string;
  role: string;
  rateTetri: number;
  jobs: PayJob[];
  /** His receipts on another mechanic's repair: paid to whoever paid for the part (ADR-0037). */
  otherReceipts: { id: string; jobId: string; jobNumber: string; name: string; paidTetri: number }[];
  seconds: number;
  workTetri: number;
  reimburseTetri: number;
  totalTetri: number;
  jobIds: string[];
  partIds: string[];
  /** A mechanic who rents a moped (0066): the part of this payout that goes into his rent, and what is handed over. */
  rent: { rentalId: string; number: string; owedTetri: number; offsetTetri: number; cashTetri: number } | null;
}

export interface PayoutRow {
  id: string;
  mechanic: { id: string; name: string };
  paidOn: string;
  labourTetri: number;
  reimburseTetri: number;
  totalTetri: number;
  /** What of it went into the mechanic's rent (0066). */
  offsetTetri: number;
  cashTetri: number;
  /** The rental the offset paid; null with none and once voided, absent while an older API answers. */
  rental?: { id: string; number: string } | null;
  jobs: { id: string; number: string }[];
  receiptsCount: number;
  markedBy: { id: string; name: string } | null;
  markedAt: string;
  voided: { at: string; by: { id: string; name: string } | null; reason: string } | null;
}

interface Payouts {
  mechanics: PayMechanic[];
  held: { id: string; number: string; mechanic: { id: string; name: string }; state: string; amountTetri: number | null }[];
  payouts: PayoutRow[];
  totalTetri: number;
}

/** On a phone the first few repairs show; the rest wait under «ещё N». */
const FOLD = 3;

/** A moped as a repair row says it: its sticker number, else the model and the end of the VIN. */
export function mopedOf(v: PayJob['vehicle']): string {
  return v.number ?? `${v.model} ···${v.vin.slice(-4)}`;
}

/**
 * BR-04 × 2, DG-01 — the codes say what was done; a work not in the book says
 * itself. A code is never broken at its hyphen on a narrow screen.
 */
export function WorksOf({ j }: { j: PayJob }) {
  return (
    <>
      {j.works.map((w, i) => (
        <Fragment key={i}>
          {i > 0 ? ', ' : ''}
          <span className={w.code ? 'wpay-code' : undefined}>
            {/* A work not in the book in the reader's language, as on the approval card (ADR-0042). */}
            {w.code ?? (w.freeText ? <Typed text={w.freeText} /> : '—')}
            {w.qty > 1 ? ` × ${w.qty}` : ''}
          </span>
        </Fragment>
      ))}
    </>
  );
}

export function PayoutsPage() {
  const t = useT();
  const { data, failure, reload } = useLoad<Payouts>('/api/service/payouts');
  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const jobs = data.mechanics.reduce((n, m) => n + m.jobs.length, 0);
  return (
    <>
      <PageHead title={t.shell.tabs.payouts} sub={data.mechanics.length > 0 ? t.wpay.sub(data.mechanics.length, jobs, formatGel(data.totalTetri)) : undefined} />
      {data.mechanics.length === 0 && <Empty text={t.wpay.none} />}
      {data.mechanics.map((m) => (
        <MechanicToPay key={m.id} m={m} onDone={reload} />
      ))}
      {data.held.length > 0 && (
        <section className="wpay-held">
          <BlockHead title={t.wpay.heldHead} sub={t.wpay.jobsN(data.held.length)} />
          <ul className="wpay-rows">
            {data.held.map((h) => (
              <li key={h.id}>
                <Link className="mono wpay-n" to={`/service/${h.id}`}>
                  {h.number}
                </Link>
                <span className="wpay-t">
                  {h.mechanic.name}
                  {h.amountTetri != null && h.state !== 'unnormed' && <span className="mono"> · {formatGel(h.amountTetri)}</span>}
                </span>
                <span className={h.state === 'unnormed' ? 'crit-text wpay-state' : 'muted wpay-state'}>{t.wpay.held[h.state] ?? h.state}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <PayoutHistory rows={data.payouts} onDone={reload} />
    </>
  );
}

/** One mechanic's card: what he is paid for, the sum right above the button. */
function MechanicToPay({ m, onDone }: { m: PayMechanic; onDone: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const folded = !open && m.jobs.length > FOLD + 1;
  const shown = folded ? m.jobs.slice(0, FOLD) : m.jobs;
  const receipts = m.jobs.reduce((n, j) => n + j.receipts.length, 0) + m.otherReceipts.length;
  const rent = m.rent && m.rent.offsetTetri > 0 ? m.rent : null;
  // The button names the cash to hand over, never the whole sum, when part of it pays his rent (QA after issue #7).
  const pay = (
    <button type="button" className="pill pill-accent wpay-pay" onClick={() => setAsking(true)}>
      {payLabel(t, m)}
    </button>
  );
  return (
    <section className="wpay-person">
      <div className="wpay-head">
        <div>
          <b>{m.name}</b>
          <span className="muted">
            {' '}
            {t.wpay.roles[m.role] ?? m.role} · {t.wpay.rate(formatGel(m.rateTetri, { decimals: false }))}
          </span>
        </div>
        <span className="wpay-wide">
          {/* On a laptop the rent lines stand under the table, far from the button: the offset is said beside it too. */}
          {rent && <span className="muted wpay-beside">{t.wpay.offsetInRent(formatGel(rent.offsetTetri), rent.number)}</span>}
          {pay}
        </span>
      </div>

      {/* Phone and tablet: rows, the first few unfolded. */}
      <ul className="wpay-rows wpay-narrow">
        {shown.map((j) => (
          <li key={j.id} className="wpay-job">
            <div className="wpay-line">
              <Link className="mono wpay-n" to={`/service/${j.id}`}>
                {j.number}
              </Link>
              <span className="wpay-t">
                {mopedOf(j.vehicle)} · {t.wjob.min(normText(j.seconds, locale))}
                <small className="muted">
                  {j.closedOn ? `${t.wpay.closed(fmtDayMonth(j.closedOn))} · ` : ''}
                  <WorksOf j={j} />
                </small>
              </span>
              <span className="mono wpay-g">{formatGel(j.workTetri)}</span>
            </div>
            {j.receipts.map((r) => (
              <div key={r.id} className="wpay-line wpay-receipt">
                <span className="wpay-n muted">↳ {t.wpay.receipt}</span>
                <span className="wpay-t muted">
                  {r.name} · {t.wparts.kinds.bought}
                </span>
                <span className="mono wpay-g">{formatGel(r.paidTetri)}</span>
              </div>
            ))}
          </li>
        ))}
        {folded && (
          <li>
            <button type="button" className="pill pill-sm" onClick={() => setOpen(true)}>
              {t.wpay.more(m.jobs.length - FOLD)}
            </button>
          </li>
        )}
        {m.otherReceipts.map((r) => (
          <li key={r.id} className="wpay-line wpay-receipt">
            <Link className="mono wpay-n" to={`/service/${r.jobId}`}>
              {r.jobNumber}
            </Link>
            <span className="wpay-t muted">
              {t.wpay.receipt} · {r.name}
            </span>
            <span className="mono wpay-g">{formatGel(r.paidTetri)}</span>
          </li>
        ))}
      </ul>

      {/* Laptop: every repair, a row each, to check against the bot's report line by line. */}
      <div className="table-wrap table-flat wpay-wide">
        <table className="table">
          <thead>
            <tr>
              <th>{t.repair.cols.number}</th>
              <th>{t.repair.cols.vehicle}</th>
              <th>{t.repair.closedOn}</th>
              <th>{t.wjob.works}</th>
              <th className="num">{t.wappr.minUnit}</th>
              <th className="num">{t.wpay.workCol}</th>
              <th className="num">{t.wpay.receipt}</th>
              <th className="num">{t.wpay.total}</th>
            </tr>
          </thead>
          <tbody>
            {m.jobs.map((j) => {
              const paidBack = j.receipts.reduce((n, r) => n + r.paidTetri, 0);
              return (
                <tr key={j.id}>
                  <td>
                    <Link className="mono" to={`/service/${j.id}`}>
                      {j.number}
                    </Link>
                  </td>
                  <td className="wpay-moped">{mopedOf(j.vehicle)}</td>
                  <td className="mono">{fmtDayMonth(j.closedOn)}</td>
                  <td>
                    <WorksOf j={j} />
                    {j.receipts.length > 0 && <span className="muted"> · {j.receipts.map((r) => r.name).join(', ')}</span>}
                  </td>
                  <td className="num mono">{normText(j.seconds, locale)}</td>
                  <td className="num mono">{formatGel(j.workTetri)}</td>
                  <td className="num mono">{paidBack > 0 ? formatGel(paidBack) : ''}</td>
                  <td className="num mono">{formatGel(j.totalTetri)}</td>
                </tr>
              );
            })}
            {m.otherReceipts.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link className="mono" to={`/service/${r.jobId}`}>
                    {r.jobNumber}
                  </Link>
                </td>
                <td />
                <td />
                <td className="muted">
                  {t.wpay.receipt} · {r.name}
                </td>
                <td />
                <td />
                <td className="num mono">{formatGel(r.paidTetri)}</td>
                <td className="num mono">{formatGel(r.paidTetri)}</td>
              </tr>
            ))}
            <tr className="row-total">
              <td colSpan={4}>{t.wpay.total}</td>
              <td className="num mono">{normText(m.seconds, locale)}</td>
              <td className="num mono">{formatGel(m.workTetri)}</td>
              <td className="num mono">{m.reimburseTetri > 0 ? formatGel(m.reimburseTetri) : ''}</td>
              <td className="num mono">{formatGel(m.totalTetri)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <dl className="wpay-sum wpay-narrow">
        <div>
          <dt>{t.wpay.work(m.jobs.length, t.wjob.min(normText(m.seconds, locale)))}</dt>
          <dd className="mono">{formatGel(m.workTetri)}</dd>
        </div>
        {receipts > 0 && (
          <div>
            <dt>{t.wpay.receipts(receipts)}</dt>
            <dd className="mono">{formatGel(m.reimburseTetri)}</dd>
          </div>
        )}
        <div className="wpay-all">
          <dt>{t.wpay.total}</dt>
          <dd className="mono">{formatGel(m.totalTetri)}</dd>
        </div>
      </dl>
      {rent && <RentLines rent={rent} link />}
      <div className="wpay-narrow">{pay}</div>
      {asking && <PaySheet m={m} receipts={receipts} onClose={() => setAsking(false)} onDone={onDone} />}
    </section>
  );
}

/**
 * «Оплачено · к выдаче 30.50 ₾» when part of the payout pays the mechanic's
 * rent, «Оплачено · 130.50 ₾» when none does: the button says the cash the
 * owner hands over, so the whole sum is never handed over by mistake.
 */
function payLabel(t: Dict, m: PayMechanic): string {
  return m.rent && m.rent.offsetTetri > 0 ? t.wpay.payCash(formatGel(m.rent.cashTetri)) : t.wpay.pay(formatGel(m.totalTetri));
}

/**
 * The rent a payout pays first (director, 22.10.2026; 0066): how much goes
 * into the mechanic's rent and what is handed over. Under the total, on every
 * screen width — and on the mechanic's balance, where the rental is not his
 * to open (`link` off).
 */
export function RentLines({ rent, link = false }: { rent: NonNullable<PayMechanic['rent']>; link?: boolean }) {
  const t = useT();
  const words = t.wpay.rentOffset(rent.number, formatGel(rent.owedTetri));
  return (
    <dl className="wpay-sum wpay-rent">
      <div>
        <dt>
          {link ? (
            <Link className="mono" to={`/rentals/${rent.rentalId}`}>
              {words}
            </Link>
          ) : (
            words
          )}
        </dt>
        <dd className="mono">−{formatGel(rent.offsetTetri)}</dd>
      </div>
      <div className="wpay-all">
        <dt>{t.wpay.toHand}</dt>
        <dd className="mono">{formatGel(rent.cashTetri)}</dd>
      </div>
    </dl>
  );
}

/**
 * «Отметить выплату?» says what will happen before it does (principle 14): the
 * repairs that become «Оплачено» and are not changed any more, and that this is
 * a mark, not money moved. It pays exactly the list on the screen; if the list
 * changed meanwhile, the API refuses and the screen reloads, so the next press
 * pays what is shown then.
 */
function PaySheet({ m, receipts, onClose, onDone }: { m: PayMechanic; receipts: number; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const rent = m.rent && m.rent.offsetTetri > 0 ? m.rent : null;
  // With an offset the title names the cash first and the rent beside it; the button says the cash (QA after issue #7).
  const title = rent
    ? t.wpay.confirmTitleOffset(m.name, formatGel(rent.cashTetri), formatGel(rent.offsetTetri), rent.number)
    : t.wpay.confirmTitle(m.name, formatGel(m.totalTetri));
  return (
    <FormSheet
      title={title}
      onClose={onClose}
      value={m.totalTetri}
      initial={m.totalTetri}
      label={payLabel(t, m)}
      onCancel={onClose}
      submit={async (key) => {
        try {
          await api.post('/api/service/payouts', { mechanicId: m.id, jobIds: m.jobIds, partIds: m.partIds, totalTetri: m.totalTetri, offsetTetri: m.rent?.offsetTetri ?? 0 }, { key });
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) onDone();
          throw e;
        }
        return { toast: { text: rent ? t.wpay.markedOffset(m.name, formatGel(rent.cashTetri), formatGel(rent.offsetTetri)) : t.wpay.marked(m.name, formatGel(m.totalTetri)) } };
      }}
      onDone={onDone}
    >
      <p>{t.wpay.confirmWhat(m.jobs.length, formatGel(m.workTetri), receipts === 0 ? null : formatGel(m.reimburseTetri))}</p>
      {rent ? (
        <>
          <p>{t.wpay.confirmOffset(formatGel(rent.offsetTetri), rent.number, formatGel(rent.cashTetri))}</p>
          {/* The rent payment does appear in «Деньги»: the note says so, and that only the cash handed over is an expense. */}
          <p className="hint">{t.wpay.confirmNoteOffset(rent.number, rent.cashTetri > 0 ? formatGel(rent.cashTetri) : null)}</p>
        </>
      ) : (
        <p className="hint">{t.wpay.confirmNote}</p>
      )}
    </FormSheet>
  );
}

/**
 * « · 100.00 ₾ в аренду R-00511 · выдано 30.50 ₾» after a payout that paid
 * rent (QA after issue #7, 23.10.2026): the same words in the owner's
 * «Выплаты» and in the mechanic's balance, so neither reads the whole sum as
 * handed over. Nothing with no offset.
 */
export function OffsetWords({ p }: { p: PayoutRow }) {
  const t = useT();
  if (p.offsetTetri <= 0) return null;
  const offset = formatGel(p.offsetTetri);
  return (
    <>
      {' · '}
      {p.rental ? t.wpay.offsetInRent(offset, p.rental.number) : t.wpay.offsetIn(offset)} · {t.wpay.handedOut(formatGel(p.cashTetri))}
    </>
  );
}

/** Payouts, newest first; a mistaken one is cancelled with a reason, never deleted. */
function PayoutHistory({ rows, onDone }: { rows: PayoutRow[]; onDone: () => void }) {
  const t = useT();
  const [voiding, setVoiding] = useState<PayoutRow | null>(null);
  return (
    <section className="wpay-history">
      <BlockHead title={t.wpay.payoutsHead} />
      {rows.length === 0 ? (
        <Empty text={t.wpay.payoutsNone} />
      ) : (
        <ul className="wpay-rows">
          {rows.map((p) => (
            <li key={p.id} className={p.voided ? 'wpay-void' : ''}>
              <span className="mono wpay-n">{fmtDayMonth(p.paidOn)}</span>
              <span className="wpay-t">
                {p.mechanic.name} · {t.wpay.jobsN(p.jobs.length)}
                <OffsetWords p={p} />
                <small className="muted">
                  {p.voided ? t.wpay.voided(p.voided.reason) : p.markedBy ? t.wpay.markedBy(p.markedBy.name) : ''}
                </small>
              </span>
              <span className="mono wpay-g">{formatGel(p.totalTetri)}</span>
              {!p.voided && <RowMenu actions={[{ key: 'void', label: t.wpay.void, onPick: () => setVoiding(p) }]} />}
            </li>
          ))}
        </ul>
      )}
      {voiding && <VoidSheet p={voiding} onClose={() => setVoiding(null)} onDone={onDone} />}
    </section>
  );
}

function VoidSheet({ p, onClose, onDone }: { p: PayoutRow; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <FormSheet
      title={t.wpay.voidTitle(fmtDate(p.paidOn), p.mechanic.name, formatGel(p.totalTetri))}
      onClose={onClose}
      value={reason}
      initial=""
      label={t.wpay.void}
      onCancel={onClose}
      submit={async (key) => {
        await api.post(`/api/service/payouts/${p.id}/void`, { reason: reason.trim() }, { key });
        return { toast: { text: t.wpay.voidDone } };
      }}
      onDone={onDone}
    >
      <Field label={t.wpay.voidReason} name="reason">
        <textarea className="input" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} required autoFocus />
      </Field>
      <p className="hint">{t.wpay.voidNote(p.jobs.length)}</p>
      {p.offsetTetri > 0 && <p className="hint">{t.wpay.voidOffset}</p>}
    </FormSheet>
  );
}
