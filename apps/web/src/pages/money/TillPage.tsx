import { addDays, formatGel, localDateTime, parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { LoadError } from '../../components/LoadError.js';
import { PageHead } from '../../components/ui.js';
import { Field } from '../../components/Wizard.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { FormSheet, SubmitButton } from '../../ds/form/Form.js';
import { useOperation } from '../../ds/form/operation.js';
import { useMoneyForm } from '../../ds/money/MoneyForm.js';
import '../../ds/money/money.css';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { fmtDate } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';

interface TillRow {
  userId: string;
  name: string;
  role: 'owner' | 'manager';
  cashInTetri: number;
  cashInCount: number;
  cashOutTetri: number;
  handedTetri: number;
  acceptedTetri: number;
  bankTetri: number;
  shortTetri: number;
  takenTetri: number;
  onHandTetri: number;
  pendingTetri: number;
  pending: { id: string; amountTetri: number; handedAt: string }[];
}
interface Till {
  from: string;
  to: string;
  owner: boolean;
  me: string;
  rows: TillRow[];
  mine: { id: string; direction: 'in' | 'out'; grossTetri: number; at: string; kind: string; customer: string | null; number: string | null }[];
}

// The company's clock: a hand-over happened when Tbilisi says it did, not
// when the laptop reading about it says (QA-W6-18).
const hhmm = (iso: string) => localDateTime(iso).time;

/** Money → Касса (wave 2 §3.4): by person for an owner, one's own for a manager. */
export function TillPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const week = params.get('p') === 'week';
  const from = week ? addDays(today, -6) : today;
  const { data, failure, reload } = useLoad<Till>(`/api/till?from=${from}&to=${today}`);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  return (
    <>
      <PageHead title={t.shell.tabs.till} sub={data ? t.till.periodOf(fmtDate(data.from), fmtDate(data.to)) : undefined} />
      {data?.owner && (
        <div className="list-chips">
          {(['today', 'week'] as const).map((p) => (
            <button key={p} type="button" className={`list-chip ${(p === 'week') === week ? 'on' : ''}`} onClick={() => setParams(p === 'week' ? { p } : {}, { replace: true })}>
              {t.till[p]}
            </button>
          ))}
        </div>
      )}
      {!data && <Skeleton rows={3} />}
      {data && (data.owner ? <OwnerTill till={data} /> : <ManagerTill till={data} />)}
    </>
  );
}

function OwnerTill({ till }: { till: Till }) {
  const t = useT();
  const [dispute, setDispute] = useState<{ row: TillRow; id: string; amountTetri: number } | null>(null);
  const [bank, setBank] = useState<TillRow | null>(null);
  const others = till.rows.filter((r) => r.userId !== till.me);
  const me = till.rows.find((r) => r.userId === till.me);
  const people = [...others.filter((r) => r.pendingTetri > 0), ...(me ? [me] : []), ...others.filter((r) => r.pendingTetri === 0)];
  return (
    <>
      {people.map((r) => (
        <section key={r.userId} className="till-person">
          <div className="till-person-head">
            <b>{r.name}</b>
            {r.pending[0] && <span className="muted">{t.till.handedAt(hhmm(r.pending[0].handedAt))}</span>}
          </div>
          <Line k={`${t.till.cashIn} · ${r.cashInCount}`} v={r.cashInTetri} />
          {r.cashOutTetri > 0 && <Line k={t.till.cashOut} v={-r.cashOutTetri} />}
          {r.handedTetri > 0 && <Line k={t.till.handed} v={r.handedTetri} />}
          {r.takenTetri > 0 && <Line k={t.till.taken} v={r.takenTetri} />}
          {r.acceptedTetri > 0 && <Line k={t.till.acceptedFrom} v={r.acceptedTetri} />}
          {r.bankTetri > 0 && <Line k={t.till.toBank} v={-r.bankTetri} />}
          {r.shortTetri > 0 && <Line k={t.till.short} v={-r.shortTetri} crit />}
          <Line k={t.till.onHand} v={r.onHandTetri} strong crit={r.onHandTetri < 0} />
          {r.pending.map((h) => (
            <div key={h.id} className="sort-actions">
              <AcceptButton id={h.id} amount={h.amountTetri} />
              <button type="button" className="pill pill-sm" onClick={() => setDispute({ row: r, id: h.id, amountTetri: h.amountTetri })}>
                {t.till.dispute}
              </button>
            </div>
          ))}
          {r.userId === till.me && r.onHandTetri > 0 && (
            <div className="sort-actions">
              <button type="button" className="pill pill-sm" onClick={() => setBank(r)}>
                {t.till.bank}
              </button>
            </div>
          )}
        </section>
      ))}
      {dispute && <DisputeSheet who={dispute.row.name} id={dispute.id} amountTetri={dispute.amountTetri} onClose={() => setDispute(null)} />}
      {bank && <BankSheet row={bank} onClose={() => setBank(null)} />}
    </>
  );
}

function Line({ k, v, strong = false, crit = false }: { k: string; v: number; strong?: boolean; crit?: boolean }) {
  return (
    <div className={`till-row ${crit ? 'crit-text' : ''}`}>
      <span>{k}</span>
      <span className={`mono nowrap ${strong ? 't-money' : ''}`}>{v < 0 ? `−${formatGel(-v)}` : formatGel(v)}</span>
    </div>
  );
}

function AcceptButton({ id, amount }: { id: string; amount: number }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  return (
    <>
      <SubmitButton
        small
        type="button"
        state={op.state}
        label={t.till.accept(formatGel(amount))}
        onClick={async () => {
          const res = await op.run((key) => api.post(`/api/till/handovers/${id}/accept`, {}, { key }));
          if (res.ok) toast({ text: t.till.accepted(formatGel(amount)) });
        }}
      />
      {op.failure && <span className="field-err">{op.failure.text}</span>}
    </>
  );
}

/** "Не сходится": what was counted, and why (§3.4). */
function DisputeSheet({ who, id, amountTetri, onClose }: { who: string; id: string; amountTetri: number; onClose: () => void }) {
  const t = useT();
  const [v, setV] = useState({ counted: '', reason: '' });
  const counted = parseGel(v.counted);
  return (
    <FormSheet
      title={t.till.disputeTitle(who)}
      onClose={onClose}
      value={v}
      initial={{ counted: '', reason: '' }}
      label={t.till.acceptCounted(counted != null ? formatGel(counted) : '')}
      submit={async (key) => {
        await api.post(`/api/till/handovers/${id}/dispute`, { countedTetri: v.counted, reason: v.reason }, { key });
        return { toast: { text: t.till.accepted(counted != null ? formatGel(counted) : '') } };
      }}
    >
      <div className="till-row">
        <span>{t.till.bySystem}</span>
        <span className="mono">{formatGel(amountTetri)}</span>
      </div>
      <Field label={t.till.counted} name="countedTetri">
        <input className="input input-amount mono" inputMode="decimal" value={v.counted} onChange={(e) => setV({ ...v, counted: e.target.value })} autoFocus />
      </Field>
      <Field label={t.till.disputeReason} hint={t.till.disputeHint} name="reason">
        <input className="input" value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/** "Внёс в банк": out of the owner's till, no more than on hand (§3.4). */
function BankSheet({ row, onClose }: { row: TillRow; onClose: () => void }) {
  const t = useT();
  const today = todayISO();
  const [v, setV] = useState({ amount: '', bank: 'bog' as 'bog' | 'tbc' | 'credo', occurredOn: today });
  const amount = parseGel(v.amount);
  return (
    <FormSheet
      title={t.till.bankTitle}
      onClose={onClose}
      value={v}
      initial={{ amount: '', bank: 'bog', occurredOn: today }}
      label={t.money.record(amount != null ? formatGel(amount) : '')}
      submit={async (key) => {
        await api.post('/api/till/bank-deposits', { amountTetri: v.amount, bank: v.bank, occurredOn: v.occurredOn }, { key });
        return { toast: { text: t.till.bankRecorded(amount != null ? formatGel(amount) : '') } };
      }}
    >
      <div className="till-row">
        <span>{t.till.bankOnHand(row.name)}</span>
        <span className="mono">{formatGel(row.onHandTetri)}</span>
      </div>
      <Field label={t.money.amount} hint={t.till.bankAmountHint} name="amountTetri">
        <input className="input input-amount mono" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} autoFocus />
      </Field>
      <Field label={t.statements.bank} name="bank">
        <div className="chips">
          {(['bog', 'tbc', 'credo'] as const).map((b) => (
            <button key={b} type="button" className={`pill pill-sm ${v.bank === b ? 'on' : ''}`} onClick={() => setV({ ...v, bank: b })}>
              {t.statements.banks[b]}
            </button>
          ))}
        </div>
      </Field>
      <Field label={t.money.date} name="occurredOn">
        <input className="input mono" type="date" max={today} value={v.occurredOn} onChange={(e) => setV({ ...v, occurredOn: e.target.value || today })} />
      </Field>
    </FormSheet>
  );
}

/** A manager's till: on hand now, what they took, "Сдал владельцу" (§3.4). */
function ManagerTill({ till }: { till: Till }) {
  const t = useT();
  const toast = useToast();
  const openMoney = useMoneyForm();
  const op = useOperation();
  const me = till.rows[0];
  if (!me) return null;
  const takenToday = till.mine.filter((m) => m.direction === 'in');
  if (takenToday.length === 0 && me.onHandTetri === 0 && me.pendingTetri === 0) {
    return (
      <div className="task-clear">
        <p className="t-h3">{t.till.empty}</p>
        <p className="muted">{t.till.emptyHint}</p>
        <button type="button" className="pill pill-accent" onClick={() => openMoney()}>
          {t.money.takeCash}
        </button>
      </div>
    );
  }
  return (
    <>
      {me.pending.map((h) => (
        <section key={h.id} className="till-person">
          <div className="till-person-head">
            <b>{t.till.handedAt(hhmm(h.handedAt))}</b>
            <span className="muted">{t.till.waiting}</span>
          </div>
          <p className="t-money mono">{formatGel(h.amountTetri)}</p>
        </section>
      ))}
      <p className="t-label">{me.pendingTetri > 0 ? t.till.afterHanding : t.till.onHandToday}</p>
      <p className="till-onhand">{formatGel(me.onHandTetri)}</p>
      {me.shortTetri > 0 && <Line k={t.till.short} v={-me.shortTetri} crit />}
      {takenToday.length > 0 && (
        <section className="card">
          <p className="t-label">
            {t.till.receivedToday} · {takenToday.length}
          </p>
          {takenToday.map((m) => (
            <div key={m.id} className="till-row">
              <span>
                {m.customer ?? ''} {m.number ? `· ${m.number}` : ''} · {hhmm(m.at)}
              </span>
              <span className="mono amt-in nowrap">+{formatGel(m.grossTetri)}</span>
            </div>
          ))}
        </section>
      )}
      {me.onHandTetri > 0 && (
        <div className="till-sticky till-fixed">
          <SubmitButton
            type="button"
            className="pill-grow"
            state={op.state}
            label={t.till.hand(formatGel(me.onHandTetri))}
            onClick={async () => {
              const res = await op.run((key) => api.post('/api/till/handovers', { amountTetri: me.onHandTetri }, { key }));
              if (res.ok) {
                op.reset();
                toast({ text: t.till.handedDone(formatGel(me.onHandTetri)) });
              }
            }}
          />
          {op.failure && <p className="field-err">{op.failure.text}</p>}
        </div>
      )}
    </>
  );
}
