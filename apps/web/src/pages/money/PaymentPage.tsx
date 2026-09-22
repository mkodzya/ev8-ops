import { localDateTime } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { LoadError } from '../../components/LoadError.js';
import { RowMenu } from '../../components/RowMenu.js';
import { BlockHead, Loading, PageHead } from '../../components/ui.js';
import { Field, Row } from '../../components/Wizard.js';
import { FormSheet } from '../../ds/form/Form.js';
import '../../ds/money/money.css';
import { fmtDate, formatGel } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';

type Kind = 'rent' | 'sale' | 'service' | 'on_account' | 'deposit_payout' | 'buyback' | 'supplier';

interface Card {
  payment: {
    id: string;
    occurredOn: string;
    direction: 'in' | 'out';
    kind: Kind;
    channel: 'cash' | 'acquiring' | 'transfer';
    grossTetri: number;
    feeTetri: number;
    netTetri: number;
    customer: { id: string; name: string } | null;
    rental: { id: string; number: string } | null;
    sale: { id: string; number: string } | null;
    purchase: { id: string; number: string; currency: string } | null;
    serviceJob: { id: string; number: string } | null;
    note: string | null;
    paidTo: string | null;
    paidToReason: string | null;
    backdateReason: string | null;
    foreignAmount: number | null;
    foreignCurrency: string | null;
    createdBy: string | null;
    createdAt: string;
    voided: boolean;
    voidKind: string | null;
    voidReason: string | null;
    voidedBy: string | null;
    statementLine: { id: string; bank: 'bog' | 'tbc' | 'credo'; occurredOn: string; amountTetri: number; payer: string | null; purpose: string | null; matchedRule: string | null } | null;
    closed: { target: string; amountTetri: number; seq: number | null; startsOn: string | null; endsOn: string | null; dueOn: string | null }[];
  };
  journal: { at: string; action: string; who: string | null; note: string | null }[];
  canVoid: boolean;
}

const dm = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
// The company's clock: a payment happened when Tbilisi says it did, not
// when the laptop reading about it says (QA-W6-18).
const hhmm = (iso: string) => localDateTime(iso).time;

/** A payment's own page (wave 2 §3.3): what it closed, its bank line, who and when; "⋯ → annul" for an owner. */
export function PaymentPage() {
  const { id } = useParams();
  const t = useT();
  const { data, failure, reload } = useLoad<Card>(id ? `/api/payments/${id}` : null);
  const [voiding, setVoiding] = useState(false);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const p = data.payment;
  const signed = `${p.direction === 'out' ? '−' : '+'}${formatGel(p.grossTetri)}`;
  const record = recordLink(p);

  return (
    <>
      <PageHead title={t.paymentPage.title(signed)} sub={p.voided ? (p.voidKind === 'undo' ? t.paymentPage.undone : t.paymentPage.voided) : t.money.kinds[p.kind]}>
        {data.canVoid && <RowMenu actions={[{ key: 'void', label: t.paymentPage.void, onPick: () => setVoiding(true) }]} />}
      </PageHead>

      <section className="card">
        <p className={`t-display mono ${p.voided ? 'amt-void' : p.direction === 'out' ? 'amt-out' : 'amt-in'}`}>{signed}</p>
        {p.customer && <Row k={t.paymentPage.customer} v={<Link to={`/customers/${p.customer.id}`}>{p.customer.name}</Link>} />}
        {record && <Row k={t.money.kinds[p.kind]} v={<Link to={record.to} className="mono">{record.n}</Link>} />}
        <Row k={t.paymentPage.channel} v={t.payments.channels[p.channel]} />
        {p.channel === 'acquiring' && p.direction === 'in' && (
          <>
            <Row k={t.paymentPage.bankCredited} v={<span className="mono">{formatGel(p.netTetri)}</span>} />
            <Row k={t.paymentPage.feeExpense} v={<span className="mono">{formatGel(p.feeTetri)}</span>} />
          </>
        )}
        {p.foreignAmount != null && (
          <Row k={t.paymentPage.rate} v={<span className="mono">{`${p.foreignAmount} ${p.foreignCurrency ?? ''} · ${(p.grossTetri / 100 / p.foreignAmount).toFixed(5)}`}</span>} />
        )}
        <Row k={t.paymentPage.date} v={<span className="mono">{fmtDate(p.occurredOn)}</span>} />
        {p.backdateReason && <Row k={t.paymentPage.backdate} v={p.backdateReason} />}
        {p.paidTo && <Row k={t.paymentPage.paidTo} v={`${p.paidTo} · ${p.paidToReason ?? ''}`} />}
        <Row k={t.paymentPage.by} v={`${p.createdBy ?? t.common.dash}, ${fmtDate(p.createdAt.slice(0, 10))} ${hhmm(p.createdAt)}`} />
        {p.voided && <Row k={t.paymentPage.voided} v={`${p.voidReason ?? ''}${p.voidedBy ? ` · ${p.voidedBy}` : ''}`} />}
      </section>

      {p.closed.length > 0 && (
        <section className="card">
          <BlockHead title={t.paymentPage.closed} />
          {p.closed.map((c, i) => (
            <Row
              key={i}
              k={c.target === 'deposit' ? t.money.closeDeposit : c.target === 'period' ? t.money.closeWeek(dm(c.startsOn), dm(c.endsOn)) : t.money.closeInstalment(c.seq ?? 0, fmtDate(c.dueOn))}
              v={<span className="mono">{formatGel(c.amountTetri)}</span>}
            />
          ))}
        </section>
      )}

      {p.statementLine && (
        <section className="card">
          <BlockHead title={t.paymentPage.line} />
          <p className="sort-line-text">
            {t.statements.banks[p.statementLine.bank]} · {fmtDate(p.statementLine.occurredOn)} · {[p.statementLine.payer, p.statementLine.purpose].filter(Boolean).join(' · ')} ·{' '}
            {formatGel(p.statementLine.amountTetri)}
          </p>
          <p className="hint muted">
            {p.voided ? t.paymentPage.wasLinked : p.statementLine.matchedRule === 'by_hand' || p.statementLine.matchedRule === 'recorded_by_hand' ? t.paymentPage.byHand : t.paymentPage.byRule}
          </p>
        </section>
      )}

      {data.journal.length > 0 && (
        <section className="card">
          <BlockHead title={t.paymentPage.journal} />
          {data.journal.map((j, i) => (
            <Row key={i} k={`${fmtDate(j.at.slice(0, 10))} ${hhmm(j.at)}`} v={`${j.who ?? ''} · ${actWord(t, j.action)}${j.note ? ` · ${j.note}` : ''}`} />
          ))}
        </section>
      )}

      {voiding && <VoidSheet id={p.id} amount={signed} onClose={() => setVoiding(false)} />}
    </>
  );
}

/** A journal entry in words: written, annulled, undone. */
function actWord(t: ReturnType<typeof useT>, action: string): string {
  if (action === 'payment.void') return t.paymentPage.acts.void;
  if (action === 'payment.undo') return t.paymentPage.acts.undo;
  return t.paymentPage.acts.record;
}

/** The record a payment belongs to, as a link. */
function recordLink(p: Card['payment']): { to: string; n: string } | null {
  if (p.rental) return { to: `/rentals/${p.rental.id}`, n: p.rental.number };
  if (p.sale) return { to: `/sales/${p.sale.id}`, n: p.sale.number };
  if (p.purchase) return { to: `/purchases/${p.purchase.id}`, n: p.purchase.number };
  if (p.serviceJob) return { to: `/service/${p.serviceJob.id}`, n: p.serviceJob.number };
  return null;
}

/** "Аннулировать": an owner, with a reason it must have (§3.3). */
function VoidSheet({ id, amount, onClose }: { id: string; amount: string; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <FormSheet
      title={t.paymentPage.voidTitle(amount)}
      onClose={onClose}
      value={reason}
      initial=""
      label={t.paymentPage.void}
      submit={async (key) => {
        await api.post(`/api/payments/${id}/void`, { reason }, { key });
        return { toast: { text: t.paymentPage.voidedToast } };
      }}
    >
      <Field label={t.paymentPage.voidReason} hint={t.paymentPage.voidHint} name="reason">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </FormSheet>
  );
}
