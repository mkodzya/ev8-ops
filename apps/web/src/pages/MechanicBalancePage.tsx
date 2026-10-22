import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { fmtDayMonth, formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { normText } from '../lib/workBook.js';
import { mopedOf, WorksOf, type PayMechanic, type PayoutRow } from './PayoutsPage.js';
import './workshop-job.css';

// The mechanic's balance (stage 5; prototype mechanic-payouts-options.html,
// variant A, chosen by Mika on 20.10.2026; ADR-0037): its own screen, reached
// by a button on «Ремонт», so the work screen stays about the work. What is
// his to be paid, large; then what waits for approval, what is still in work
// and what waits for a norm; then the repairs and the payouts. Only his own
// money at his own rate — no customer's money, no shelf prices (ADR-0033).

interface Bucket {
  jobs: { id: string; number: string; amountTetri: number | null }[];
  tetri: number;
}

export interface Balance {
  mechanic: { id: string; name: string; rateTetri: number };
  payable: Pick<PayMechanic, 'jobs' | 'otherReceipts' | 'seconds' | 'workTetri' | 'reimburseTetri' | 'totalTetri'> & { rent?: PayMechanic['rent'] };
  waiting: Bucket;
  open: Bucket;
  unnormed: { jobs: { id: string; number: string }[] };
  payouts: PayoutRow[];
}

const FOLD = 3;

export function MechanicBalancePage() {
  const t = useT();
  const { locale } = useLocale();
  const { data, failure, reload } = useLoad<Balance>('/api/service/balance');
  const [open, setOpen] = useState(false);
  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const p = data.payable;
  const receipts = p.jobs.reduce((n, j) => n + j.receipts.length, 0) + p.otherReceipts.length;
  const folded = !open && p.jobs.length > FOLD + 1;
  const shown = folded ? p.jobs.slice(0, FOLD) : p.jobs;
  return (
    <>
      <PageHead title={t.shell.tabs.balance} sub={t.wpay.rate(formatGel(data.mechanic.rateTetri, { decimals: false }))} />
      <section className="wpay-big">
        <span className="muted">{t.wpay.toPay}</span>
        <b className="mono">{formatGel(p.totalTetri)}</b>
        <span className="muted">
          {p.jobs.length > 0 || receipts > 0 ? t.wpay.toPaySub(p.jobs.length, formatGel(p.workTetri), formatGel(p.reimburseTetri)) : t.wpay.nothingYet}
        </span>
        {/* His own rent is paid out of it first (0066): he sees how much, and what he will be handed. */}
        {p.rent && p.rent.offsetTetri > 0 && (
          <span className="muted">
            {t.wpay.rentOffset(p.rent.number, formatGel(p.rent.owedTetri))}: −{formatGel(p.rent.offsetTetri)} · {t.wpay.toHand} {formatGel(p.rent.cashTetri)}
          </span>
        )}
      </section>

      <div className="wpay-tiles">
        <Tile title={t.wpay.waiting} value={formatGel(data.waiting.tetri)} jobs={data.waiting.jobs} quiet={data.waiting.jobs.length === 0} />
        <Tile title={t.wpay.inWork} value={formatGel(data.open.tetri)} note={t.wpay.inWorkNote} jobs={data.open.jobs} quiet={data.open.jobs.length === 0} />
        <Tile
          title={t.wpay.unnormed}
          value={String(data.unnormed.jobs.length)}
          note={t.wpay.unnormedNote}
          jobs={data.unnormed.jobs}
          crit={data.unnormed.jobs.length > 0}
          quiet={data.unnormed.jobs.length === 0}
        />
      </div>

      {p.jobs.length > 0 && (
        <section className="card">
          <BlockHead title={t.wpay.toPay} sub={t.wpay.jobsN(p.jobs.length)} />
          <ul className="wpay-rows wpay-mine">
            {shown.map((j) => {
              const paidBack = j.receipts.reduce((n, r) => n + r.paidTetri, 0);
              return (
                <li key={j.id}>
                  <Link className="mono wpay-n" to={`/service/${j.id}`}>
                    {j.number}
                  </Link>
                  <span className="wpay-t">
                    {mopedOf(j.vehicle)}
                    <small className="muted">
                      <WorksOf j={j} />
                      {paidBack > 0 ? ` · ${t.wpay.payBack(formatGel(paidBack))}` : ''}
                    </small>
                  </span>
                  <span className="mono muted">{t.wjob.min(normText(j.seconds, locale))}</span>
                  <span className="mono wpay-g">{formatGel(j.totalTetri)}</span>
                </li>
              );
            })}
            {folded && (
              <li>
                <button type="button" className="pill pill-sm" onClick={() => setOpen(true)}>
                  {t.wpay.more(p.jobs.length - FOLD)}
                </button>
              </li>
            )}
            {p.otherReceipts.map((r) => (
              <li key={r.id}>
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
        </section>
      )}

      <section className="card">
        <BlockHead title={t.wpay.payoutsHead} />
        {data.payouts.length === 0 ? (
          <Empty text={t.wpay.payoutsNone} />
        ) : (
          <ul className="wpay-rows wpay-mine">
            {data.payouts.map((x) => (
              <li key={x.id} className={x.voided ? 'wpay-void' : ''}>
                <span className="mono wpay-n">{fmtDayMonth(x.paidOn)}</span>
                <span className="wpay-t">
                  {t.wpay.jobsN(x.jobs.length)}
                  <small className="muted">{x.voided ? t.wpay.voided(x.voided.reason) : x.markedBy ? t.wpay.markedBy(x.markedBy.name) : ''}</small>
                </span>
                <span className="mono wpay-g">{formatGel(x.totalTetri)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** One of the three: what waits, what is in work, what has no norm — each repair a link. */
function Tile({ title, value, note, jobs, crit = false, quiet = false }: { title: string; value: string; note?: string; jobs: { id: string; number: string }[]; crit?: boolean; quiet?: boolean }) {
  return (
    <section className={`wpay-tile ${quiet ? 'quiet' : ''}`}>
      <span className="muted">{title}</span>
      <b className={`mono ${crit ? 'crit-text' : ''}`}>{value}</b>
      {note && jobs.length > 0 && <span className="muted">{note}</span>}
      {jobs.length > 0 && (
        <span className="wpay-tile-jobs">
          {jobs.map((j) => (
            <Link key={j.id} className="mono" to={`/service/${j.id}`}>
              {j.number}
            </Link>
          ))}
        </span>
      )}
    </section>
  );
}
