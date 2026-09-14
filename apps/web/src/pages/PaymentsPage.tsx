import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading } from '../components/ui.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

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

export function PaymentsPage() {
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<{ payments: PaymentRow[] }>('/api/payments');
  const [err, setErr] = useState<string | null>(null);
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <header className="page-head">
        <h1>{t.payments.title}</h1>
        <span className="mono muted">{data.payments.length}</span>
      </header>
      {err && <div className="hint hint-bad">{err}</div>}
      {data.payments.length === 0 ? (
        <Empty text={t.payments.none} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.payments.date}</th>
                <th>{t.payments.channel}</th>
                <th className="num">{t.payments.gross}</th>
                <th className="num">{t.payments.fee}</th>
                <th className="num">{t.payments.allocated}</th>
                <th>{t.payments.customer}</th>
                <th>{t.payments.forRental}</th>
                <th>{t.payments.bankText}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id} className={p.voided ? 'row-off' : ''}>
                  <td className="mono">{fmtDate(p.occurredOn)}</td>
                  <td>{t.payments.channels[p.channel]}</td>
                  <td className="num mono">{formatGel(p.grossTetri)}</td>
                  <td className="num mono">{p.feeTetri > 0 ? formatGel(p.feeTetri) : t.common.dash}</td>
                  <td className="num mono">{formatGel(p.allocatedTetri)}</td>
                  <td>{p.customer ? <Link to={`/customers/${p.customer.id}`}>{p.customer.name}</Link> : t.common.dash}</td>
                  <td>{p.rental ? <Link to={`/rentals/${p.rental.id}`} className="mono">{p.rental.number}</Link> : t.common.dash}</td>
                  <td className="muted">{p.bankText ?? p.note ?? t.common.dash}</td>
                  <td className="num">
                    {p.voided ? (
                      <span className="muted">
                        {t.payments.voided}
                        {p.voidReason ? ` · ${p.voidReason}` : ''}
                      </span>
                    ) : (
                      can('payments.reconcile') && <VoidPayment id={p.id} onDone={reload} onError={setErr} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** Nothing is deleted: a payment entered by mistake is voided with a reason. */
export function VoidPayment({ id, onDone, onError }: { id: string; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
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
      <button
        type="button"
        className="pill pill-sm pill-accent"
        disabled={!reason.trim()}
        onClick={async () => {
          try {
            await api.post(`/api/payments/${id}/void`, { reason });
            setOpen(false);
            setReason('');
            onDone();
          } catch (e) {
            onError(errorText(e));
          }
        }}
      >
        {t.actions.confirm}
      </button>
    </span>
  );
}
