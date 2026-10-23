import { formatGel } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api.js';
import { LoadError } from '../../components/LoadError.js';
import { RecordHistory } from '../../components/RecordHistory.js';
import { RowMenu } from '../../components/RowMenu.js';
import { Empty, Loading, PageHead } from '../../components/ui.js';
import { Field, Row } from '../../components/Wizard.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { FormSheet } from '../../ds/form/Form.js';
import { useOperation } from '../../ds/form/operation.js';
import { useMoneyForm } from '../../ds/money/MoneyForm.js';
import { fmtDate, fmtDateAt } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import { GoodsPill, buyerName, useItemName, type GoodsState } from './GoodsSalesPage.js';
import './goods.css';

// One goods sale (issue #11, ADR-0045): who bought, what, at what price
// against the shelf's, the money with the VAT inside it, the invoice, and
// what happened. One loud action: «Принять деньги» while money is open,
// «Счёт PDF» once it is paid.

interface BankLine {
  lineId: string;
  bank: string;
  occurredOn: string;
  amountTetri: number;
  grossTetri: number;
  payer: string | null;
  purpose: string | null;
}

interface Card {
  sale: {
    id: string;
    number: string;
    soldOn: string;
    status: 'active' | 'cancelled';
    customer: { id: string; name: string; phone: string | null; kind: string } | null;
    buyer: { name: string | null; phone: string | null } | null;
    promisedChannel: 'acquiring' | 'transfer' | null;
    backdateReason: string | null;
    notes: string | null;
    createdBy: string | null;
    cancelledAt: string | null;
    cancelledBy: string | null;
    cancelReason: string | null;
    /** Undone by its seller at once: no reason of a person's. */
    undone?: boolean;
    totals: { grossTetri: number; netTetri: number; vatTetri: number };
    paidTetri: number;
    openTetri: number;
    state: GoodsState;
    lines: {
      id: string;
      partId: string | null;
      countedItem: string | null;
      spec: string | null;
      name: string;
      nameKa: string | null;
      qty: number;
      unitPriceTetri: number;
      lineTetri: number;
      shelfPriceTetri: number | null;
      priceEdited: boolean;
      stockFrom: 'shelf' | 'count';
      shortReason: string | null;
      unitCostTetri: number | null;
      marginTetri: number | null;
    }[];
  };
  payments: { id: string; occurredOn: string; channel: 'cash' | 'acquiring' | 'transfer'; grossTetri: number; feeTetri: number; fate: string; voidKind: string | null; voidReason: string | null; by: string | null; line: { id: string; bank: string; occurredOn: string; amountTetri: number } | null }[];
  documents: { id: string; docKind: string | null; createdAt: string }[];
  bankLines: BankLine[];
  feed: { at: string; day: string; action: string; by: string | null; note: string | null }[];
  can: { pay: boolean; attach: boolean; cancel: boolean; undo: boolean; edit: boolean; invoice: boolean };
}

export function GoodsSalePage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const named = useItemName();
  const openMoney = useMoneyForm();
  const toast = useToast();
  const op = useOperation();
  const { data, failure, reload } = useLoad<Card>(id ? `/api/goods-sales/${id}` : null);
  const [sheet, setSheet] = useState<'cancel' | 'buyer' | null>(null);

  if (failure?.status === 404) {
    return (
      <section className="card">
        <p>{t.goods.card.notFound}</p>
        <Link className="pill pill-sm" to="/sales/goods">
          {t.goods.card.back}
        </Link>
      </section>
    );
  }
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  const s = data.sale;
  const c = t.goods.card;
  const live = s.status === 'active';
  const who = buyerName(t, s);
  const retail = s.customer == null;
  const invoiceUrl = `/api/goods-sales/${s.id}/invoice.pdf`;
  const takeMoney = () =>
    openMoney({ target: { kind: 'goods', goodsSaleId: s.id, number: s.number, customerId: s.customer?.id, customer: s.customer?.name ?? t.goods.retail, openTetri: s.openTetri } });
  const attach = async (lineId: string) => {
    const res = await op.run((key) => api.post<{ id: string }>(`/api/statement-lines/${lineId}/assign`, { goodsSaleId: s.id }, { key }), lineId);
    if (!res.ok) return;
    toast({ text: t.sort.attached(s.number), undo: () => api.post(`/api/payments/${res.value.id}/undo`) });
    reload();
  };

  const menu = [
    ...(data.can.cancel ? [{ key: 'cancel', label: c.menuCancel, onPick: () => setSheet('cancel') }] : []),
    ...(data.can.edit ? [{ key: 'buyer', label: c.menuBuyer, onPick: () => setSheet('buyer') }] : []),
  ];

  return (
    <>
      <PageHead wrap title={<span className="nobr">{s.number}</span>} sub={`${who} · ${fmtDate(s.soldOn)}`} badge={<GoodsPill state={s.state} openTetri={s.openTetri} />}>
        {live && s.openTetri > 0 && data.can.pay ? (
          <button type="button" className="pill pill-sm pill-accent" onClick={takeMoney}>
            {c.take}
          </button>
        ) : (
          data.can.invoice && (
            <a className={`pill pill-sm ${live ? 'pill-accent' : ''}`} href={invoiceUrl} target="_blank" rel="noreferrer">
              {c.invoice}
            </a>
          )
        )}
        {menu.length > 0 && <RowMenu actions={menu} />}
      </PageHead>

      <div className="num-strip">
        <span className={`num ${s.state === 'owes' ? 'num-crit' : ''}`}>
          <span className="num-v">{s.openTetri > 0 ? c.waits(formatGel(s.openTetri)) : c.paidAll(formatGel(s.paidTetri))}</span>
          <span className="num-l">{s.status === 'cancelled' ? t.goods.states.cancelled : s.openTetri > 0 ? c.open : c.paid}</span>
        </span>
      </div>

      {s.status === 'cancelled' && (
        <section className="card">
          <p className="warn-text">{c.cancelledOn(fmtDateAt(s.cancelledAt), s.cancelledBy ?? '')}</p>
          {(s.cancelReason || s.undone) && <p className="muted">{s.undone ? c.undoneAtOnce : s.cancelReason}</p>}
        </section>
      )}

      <section className="card">
        <div className="queue-head">
          <h2>{c.buyer}</h2>
        </div>
        <Row k={c.buyer} v={s.customer ? <Link to={`/customers/${s.customer.id}`}>{s.customer.name}</Link> : who} />
        {retail && s.buyer?.phone && <Row k={t.goods.edit.phone} v={<a className="mono" href={`tel:${s.buyer.phone}`}>{s.buyer.phone}</a>} />}
        {s.customer?.phone && <Row k={t.goods.edit.phone} v={<a className="mono" href={`tel:${s.customer.phone}`}>{s.customer.phone}</a>} />}
        <Row k={t.goods.wizard.soldOn} v={<span className="mono">{fmtDate(s.soldOn)}</span>} />
        {s.backdateReason && <Row k={t.goods.wizard.backdateReason} v={s.backdateReason} />}
        {s.createdBy && <Row k={t.goods.cols.state} v={c.soldBy(s.createdBy)} />}
        {s.notes && <Row k={c.notes} v={s.notes} />}
      </section>

      <section className="card">
        <div className="queue-head">
          <h2>{c.goods}</h2>
          <span className="muted">{s.lines.length}</span>
        </div>
        <ul className="goods-lines">
          {s.lines.map((l) => (
            <li key={l.id}>
              <div className="goods-line-head">
                <span>
                  {l.partId ? <Link to={`/service/stock/parts/${l.partId}`}>{named(l)}</Link> : named(l)} ×{l.qty}
                </span>
                <span className="mono">{formatGel(l.lineTetri)}</span>
              </div>
              <div className="goods-line-notes">
                {l.priceEdited && l.shelfPriceTetri != null && <span>{c.byShelf(formatGel(l.shelfPriceTetri, { decimals: false }), formatGel(l.unitPriceTetri, { decimals: false }))}</span>}
                {l.stockFrom === 'count' && <span>{c.byCount}</span>}
                {l.shortReason && <span className="warn-text">{c.beyond(l.shortReason)}</span>}
                {can('cost.view') && (l.unitCostTetri != null ? <span>{c.cost(formatGel(l.unitCostTetri))}</span> : <span>{c.noCost}</span>)}
                {l.marginTetri != null && <span className={l.marginTetri < 0 ? 'warn-text' : undefined}>{c.margin(formatGel(l.marginTetri))}</span>}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <div className="queue-head">
          <h2>{c.money}</h2>
        </div>
        <div className="goods-sums">
          <span className="goods-sums-strong">{c.total}</span>
          <span className="mono goods-sums-strong">{formatGel(s.totals.grossTetri)}</span>
          <span className="muted">{c.net}</span>
          <span className="mono muted">{formatGel(s.totals.netTetri)}</span>
          <span className="muted">{c.vat}</span>
          <span className="mono muted">{formatGel(s.totals.vatTetri)}</span>
          <span>{c.paid}</span>
          <span className="mono">{formatGel(s.paidTetri)}</span>
          <span>{c.open}</span>
          <span className={`mono ${s.state === 'owes' ? 'crit-text' : ''}`}>{formatGel(s.openTetri)}</span>
        </div>
        {live && s.openTetri > 0 && s.promisedChannel && <p className="hint muted">{c.promised(c.promisedHow[s.promisedChannel] ?? '')}</p>}
        {data.payments.length === 0 ? (
          <p className="muted">{c.noPayments}</p>
        ) : (
          <ul className="goods-lines">
            {data.payments.map((p) => (
              <li key={p.id}>
                <div className="goods-line-head">
                  <Link to={`/money/payments/${p.id}`}>
                    <span className="mono">{fmtDate(p.occurredOn)}</span> · {t.payments.channels[p.channel]}
                  </Link>
                  <span className={`mono ${p.fate === 'voided' ? 'amt-void' : ''}`}>{formatGel(p.grossTetri)}</span>
                </div>
                <div className="goods-line-notes">
                  <span className={p.fate === 'voided' ? 'warn-text' : p.fate === 'credit' ? undefined : 'ok-text'}>{c.fates[p.fate] ?? p.fate}</span>
                  {p.line && <span>{c.line(t.statements.banks[p.line.bank as 'bog'] ?? p.line.bank, fmtDate(p.line.occurredOn), formatGel(p.line.amountTetri))}</span>}
                  {p.by && <span>{p.by}</span>}
                  {p.voidReason && <span>{p.voidReason}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {live && data.bankLines.length > 0 && data.can.attach && (
        <section className="card">
          <div className="queue-head">
            <h2>{c.bank}</h2>
          </div>
          {data.bankLines.map((l) => (
            <div key={l.lineId} className="money-bank-row">
              <span>
                <span className="mono">{fmtDate(l.occurredOn)}</span> · <span className="mono">{formatGel(l.grossTetri)}</span>
                {(l.payer || l.purpose) && <span className="muted"> · {[l.payer, l.purpose].filter(Boolean).join(' · ')}</span>}
              </span>
              <button type="button" className="pill pill-sm" disabled={op.state === 'busy'} onClick={() => void attach(l.lineId)}>
                {c.attach}
              </button>
            </div>
          ))}
          {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
        </section>
      )}

      <section className="card">
        <div className="queue-head">
          <h2>{c.documents}</h2>
        </div>
        <div className="row-actions">
          <a className="pill pill-sm" href={invoiceUrl} target="_blank" rel="noreferrer">
            {c.invoice}
          </a>
          {data.documents.length > 0 && <span className="muted">{fmtDateAt(data.documents[0]!.createdAt)}</span>}
        </div>
      </section>

      <section className="card">
        <div className="queue-head">
          <h2>{c.feed}</h2>
        </div>
        {data.feed.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <ul className="timeline">
            {data.feed.map((row, i) => (
              <li key={`${row.at}-${i}`}>
                <span className="mono muted">{fmtDate(row.day)}</span>
                <span>
                  <span>{t.feedWords[row.action] ?? (row.action.startsWith('payment.') ? t.feedWords['payment.record'] : row.action)}</span>
                  {row.note && <span className="muted"> · {row.note}</span>}
                  {row.by && <span className="muted"> · {row.by}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <RecordHistory kind="goods_sale" id={s.id} search={s.number} />

      {sheet === 'cancel' && <CancelSheet id={s.id} number={s.number} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet === 'buyer' && <BuyerSheet id={s.id} retail={retail} name={s.buyer?.name ?? ''} phone={s.buyer?.phone ?? ''} notes={s.notes ?? ''} onClose={() => setSheet(null)} onDone={reload} />}
    </>
  );
}

interface CancelPlan {
  number: string;
  refuse: { code: string; paymentId: string; lineId: string | null } | null;
  goods: { name: string; countedItem: string | null; spec: string | null; partId: string | null; qty: number; beforeQty: number; afterQty: number }[];
  payments: { id: string; grossTetri: number; channel: 'cash' | 'acquiring' | 'transfer'; fate: 'credit' | 'void'; by: string | null; line: { id: string; bank: string; occurredOn: string | null; amountTetri: number } | null }[];
  creditCloses: { target: string; amountTetri: number; startsOn?: string | null; endsOn?: string | null; number?: string | null; seq?: number }[];
  creditLeftTetri: number;
}

/** «Отменить продажу»: the reason it must have, and what will come back where, before the owner says so (§10). */
function CancelSheet({ id, number, onClose, onDone }: { id: string; number: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const named = useItemName();
  const plan = useLoad<CancelPlan>(`/api/goods-sales/${id}/cancel-plan`);
  const [reason, setReason] = useState('');
  const k = t.goods.cancel;
  const dm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');
  const credit = (plan.data?.payments ?? []).filter((p) => p.fate === 'credit').reduce((n, p) => n + p.grossTetri, 0);
  const pays = (plan.data?.creditCloses ?? []).map((cl) => (cl.target === 'period' ? t.money.closeWeek(dm(cl.startsOn), dm(cl.endsOn)) : cl.target === 'deposit' ? t.money.closeDeposit : (cl.number ?? ''))).join(', ');
  return (
    <FormSheet
      title={k.title(number)}
      onClose={onClose}
      value={reason}
      initial=""
      label={k.button(number)}
      submit={async (key) => {
        await api.post(`/api/goods-sales/${id}/cancel`, { reason: reason.trim() }, { key });
        return { toast: { text: k.done(number) } };
      }}
      onDone={onDone}
    >
      <Field label={k.reason} name="reason">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      {plan.failure && <LoadError failure={plan.failure} onRetry={plan.reload} />}
      {plan.data?.refuse && <p className="field-err">{k.refuse}</p>}
      {plan.data && (
        <ul className="goods-plan">
          {plan.data.goods.map((g, i) => (
            <li key={i}>{k.back(named({ name: g.name, nameKa: null, countedItem: g.countedItem, spec: g.spec }), g.qty, g.beforeQty, g.afterQty)}</li>
          ))}
          {credit > 0 && (
            <li>
              {k.credit(formatGel(credit))}
              {pays && ` ${k.creditPays(pays)}`}
              {plan.data.creditLeftTetri > 0 && pays && ` · ${k.creditLeft(formatGel(plan.data.creditLeftTetri))}`}
            </li>
          )}
          {plan.data.payments
            .filter((p) => p.fate === 'void')
            .map((p) => (
              <li key={p.id}>
                {k.void(formatGel(p.grossTetri), t.money.how[p.channel])}
                {p.line && `; ${k.lineBack(t.goods.card.line(t.statements.banks[p.line.bank as 'bog'] ?? p.line.bank, fmtDate(p.line.occurredOn), formatGel(p.line.amountTetri)))}`}
                {!p.line && p.channel === 'cash' && p.by && `; ${k.tillOut(p.by)}`}
              </li>
            ))}
        </ul>
      )}
    </FormSheet>
  );
}

/** A retail buyer's name and phone, and the note: an owner's edit; the invoice handed out goes to the archive. */
function BuyerSheet({ id, retail, name, phone, notes, onClose, onDone }: { id: string; retail: boolean; name: string; phone: string; notes: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { name, phone, notes };
  const [f, setF] = useState(initial);
  const e = t.goods.edit;
  return (
    <FormSheet
      title={e.title}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.form.changesSaved}
      submit={async (key) => {
        await api.patch(`/api/goods-sales/${id}`, retail ? { buyerName: f.name, buyerPhone: f.phone, notes: f.notes } : { notes: f.notes }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onDone}
    >
      {retail && (
        <>
          <Field label={e.name} name="buyerName">
            <input className="input" value={f.name} onChange={(ev) => setF({ ...f, name: ev.target.value })} />
          </Field>
          <Field label={e.phone} name="buyerPhone">
            <input className="input mono" inputMode="tel" value={f.phone} onChange={(ev) => setF({ ...f, phone: ev.target.value })} />
          </Field>
          <p className="hint muted">{e.hint}</p>
        </>
      )}
      <Field label={e.notes} name="notes">
        <input className="input" value={f.notes} onChange={(ev) => setF({ ...f, notes: ev.target.value })} />
      </Field>
    </FormSheet>
  );
}
