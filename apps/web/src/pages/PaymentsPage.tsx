import { addDays, paymentMatches, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead } from '../components/ui.js';
import { DataList } from '../ds/list/DataList.js';
import { QueueItem, type QueueLine } from './StatementsPage.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { useSession } from '../session.js';

const CHANNELS = ['transfer', 'acquiring', 'cash'] as const;

export interface PaymentRow {
  id: string;
  occurredOn: string;
  channel: 'transfer' | 'acquiring' | 'cash';
  grossTetri: number;
  feeTetri: number;
  netTetri: number;
  customer: { id: string; name: string } | null;
  rental: { id: string; number: string } | null;
  bankText: string | null;
  note: string | null;
  allocatedTetri: number;
  voided: boolean;
  voidReason: string | null;
  createdBy: string | null;
}

/**
 * Money → Payments for the owners; with `till`, the manager's "Till" until
 * wave 2 builds the real one (wave 1 §3.2): the cash they took themselves
 * today. The API already gives a manager only their own cash.
 */
export function PaymentsPage({ till = false }: { till?: boolean } = {}) {
  const t = useT();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<{ payments: PaymentRow[] }>('/api/payments');
  const today = todayISO();
  const rows = till ? (data?.payments ?? []).filter((p) => p.channel === 'cash' && p.occurredOn === today) : (data?.payments ?? []);
  // The queue belongs on this screen, not two clicks away under Statements:
  // an unsorted bank line is a payment that has not found its rental yet.
  const queue = useLoad<{ lines: QueueLine[] }>(can('payments.reconcile') ? '/api/statement-lines' : null);
  const [tab, setTab] = useState<'queue' | 'all' | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  const waiting = queue.data?.lines.length ?? 0;
  // Unsorted first while anything is unsorted — that is the work. Once the
  // queue is empty the screen opens on the payments themselves.
  const view = tab ?? (waiting > 0 ? 'queue' : 'all');

  return (
    <>
      <PageHead title={till ? t.nav.cash : t.payments.title} sub={t.payments.count(rows.length)} />
      {can('payments.reconcile') && (
        <div className="seg-row tabs">
          <button type="button" className={`seg ${view === 'queue' ? 'on' : ''}`} onClick={() => setTab('queue')}>
            <span className="seg-lbl">{t.statements.queue}</span>
            <span className="seg-num">{waiting}</span>
          </button>
          {/* The payments themselves; how many is the list's own "Все" chip, not said twice (QA-W1 расхождение 4). */}
          <button type="button" className={`seg ${view === 'all' ? 'on' : ''}`} onClick={() => setTab('all')}>
            <span className="seg-lbl">{t.payments.title}</span>
          </button>
        </div>
      )}
      {err && <div className="hint hint-bad">{err}</div>}
      {view === 'queue' && (
        <section className="card">
          {!queue.data ? (
            queue.failure ? <LoadError failure={queue.failure} onRetry={queue.reload} /> : <Loading />
          ) : queue.data.lines.length === 0 ? (
            <div className="task-clear">
              <p className="t-h3">{t.statements.queueNone}</p>
              <Link className="pill pill-accent" to="/money/statements">
                {t.statements.importCta}
              </Link>
            </div>
          ) : (
            <ul className="queue">
              {queue.data.lines.map((l) => (
                <QueueItem
                  key={l.id}
                  line={l}
                  onDone={() => {
                    queue.reload();
                    reload();
                  }}
                />
              ))}
            </ul>
          )}
        </section>
      )}
      {view === 'all' && (
        <>
      <DataList
        rows={rows}
        rowKey={(p) => p.id}
        fallback={(a, b) => b.occurredOn.localeCompare(a.occurredOn) || a.id.localeCompare(b.id)}
        search={{
          placeholder: t.lists.paymentsSearch,
          match: (p, q) =>
            paymentMatches(q, { grossTetri: p.grossTetri, customer: p.customer?.name, bankText: p.bankText, note: p.note, createdBy: p.createdBy, rentalNumber: p.rental?.number }),
        }}
        chips={[
          { key: 'today', label: t.lists.chips.today, test: (p) => p.occurredOn === today },
          { key: 'week', label: t.lists.chips.week, test: (p) => p.occurredOn > addDays(today, -7) },
          ...(till ? [] : CHANNELS.map((c) => ({ key: c, label: t.payments.channels[c], test: (p: PaymentRow) => p.channel === c }))),
        ]}
        empty={{ text: t.payments.none }}
        card={(p) => ({
          title: p.customer?.name ?? p.bankText ?? t.payments.channels[p.channel],
          sub: (
            <>
              {p.rental ? <span className="mono">{p.rental.number}</span> : (p.note ?? t.common.dash)}
              {p.voided && <span className="muted"> · {t.payments.voided}</span>}
            </>
          ),
          sub2: (
            <>
              {fmtDate(p.occurredOn)}
              {p.createdBy && <> · {p.createdBy}</>}
            </>
          ),
          right: <span className={`t-money ${p.voided ? 'muted strike' : ''}`}>{formatGel(p.grossTetri)}</span>,
          rightSub: t.payments.channels[p.channel],
        })}
        columns={[
          { key: 'date', label: t.payments.date, cell: (p) => <span className="mono">{fmtDate(p.occurredOn)}</span>, sort: { value: (p) => p.occurredOn, first: 'desc' } },
          { key: 'channel', label: t.payments.channel, cell: (p) => t.payments.channels[p.channel], sort: { value: (p) => p.channel } },
          { key: 'gross', label: t.payments.gross, num: true, cell: (p) => <span className={`mono ${p.voided ? 'muted strike' : ''}`}>{formatGel(p.grossTetri)}</span>, sort: { value: (p) => p.grossTetri, first: 'desc' } },
          { key: 'fee', label: t.payments.fee, num: true, cell: (p) => <span className="mono">{p.feeTetri > 0 ? formatGel(p.feeTetri) : t.common.dash}</span>, sort: { value: (p) => p.feeTetri, first: 'desc' } },
          { key: 'allocated', label: t.payments.allocated, num: true, cell: (p) => <span className="mono">{formatGel(p.allocatedTetri)}</span>, sort: { value: (p) => p.allocatedTetri, first: 'desc' } },
          { key: 'customer', label: t.payments.customer, cell: (p) => (p.customer ? <Link to={`/customers/${p.customer.id}`}>{p.customer.name}</Link> : t.common.dash), sort: { value: (p) => p.customer?.name } },
          {
            key: 'rental',
            label: t.payments.forRental,
            cell: (p) =>
              p.rental ? (
                <Link to={`/rentals/${p.rental.id}`} className="mono">
                  {p.rental.number}
                </Link>
              ) : (
                t.common.dash
              ),
            sort: { value: (p) => p.rental?.number },
          },
          { key: 'bankText', label: t.payments.bankText, cell: (p) => <span className="muted">{p.bankText ?? p.note ?? t.common.dash}</span>, sort: { value: (p) => p.bankText } },
          {
            key: 'void',
            label: '',
            num: true,
            cell: (p) =>
              p.voided ? (
                <span className="muted">
                  {t.payments.voided}
                  {p.voidReason ? ` · ${p.voidReason}` : ''}
                </span>
              ) : (
                can('payments.reconcile') && <VoidPayment id={p.id} onDone={reload} />
              ),
          },
        ]}
      />
        </>
      )}
    </>
  );
}

/** Nothing is deleted: a payment entered by mistake is voided with a reason. */
export function VoidPayment({ id, onDone }: { id: string; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  if (!open) {
    return (
      <button type="button" className="pill pill-sm" onClick={() => setOpen(true)}>
        {t.payments.void}
      </button>
    );
  }
  return (
    <span className="inline-form">
      <input className="input input-inline" placeholder={t.payments.voidReason} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      <SubmitButton
        small
        type="button"
        state={op.state}
        label={t.actions.confirm}
        onClick={async () => {
          const res = await op.run((key) => api.post(`/api/payments/${id}/void`, { reason }, { key }));
          if (!res.ok) return;
          setOpen(false);
          setReason('');
          op.reset();
          toast({ text: t.payments.voidedToast });
          onDone();
        }}
      />
      {/* The refusal belongs to this row, not to the page (QA-1-06). */}
      {op.failure && <span className="field-err">{op.failure.fieldText ?? op.failure.text}</span>}
    </span>
  );
}
