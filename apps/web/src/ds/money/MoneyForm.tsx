import { formatGel, parseGel, SEARCH_MIN, todayISO } from '@ev8/shared';
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../../api.js';
import { Field } from '../../components/Wizard.js';
import { fmtDate } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import { FormSheet, useFieldError } from '../form/Form.js';
import './money.css';

// One form for every kind of money (wave 2 §3.1). Opened from the "+", from
// a record's card, from "Deposits → hand back" — the same sheet on a phone,
// the same panel on a laptop. Before anything is written it says what the
// payment will close and what "paid through" becomes; after, a message with
// "Undo" for ten seconds.

export type MoneyKind = 'rent' | 'sale' | 'service' | 'on_account' | 'deposit_payout' | 'buyback' | 'supplier';
type Channel = 'cash' | 'acquiring' | 'transfer';

/** What the money is for, when the form is opened already knowing it. */
export interface MoneyTarget {
  kind: MoneyKind;
  rentalId?: string;
  saleId?: string;
  serviceJobId?: string;
  purchaseId?: string;
  customerId?: string;
  /** R-00491, SL-00171, PO-00115 — for the title and the "closes" lines. */
  number?: string;
  customer?: string;
}

interface Opening {
  target?: MoneyTarget;
  direction?: 'in' | 'out';
}

const Ctx = createContext<(o?: Opening) => void>(() => {});

/** Open the money form: `open()` from the "+", `open({ target })` from a card. */
export const useMoneyForm = () => useContext(Ctx);

/**
 * Holds the one money sheet of the app. `?take=1` in any address opens it —
 * that is how the "+" reaches it (wave 2 §3.0) — and the parameter is taken
 * off again so Back does not reopen it.
 */
export function MoneyProvider({ children }: { children: ReactNode }) {
  const [opening, setOpening] = useState<Opening | null>(null);
  const { search, pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get('take') !== '1') return;
    setOpening({});
    params.delete('take');
    navigate({ pathname, search: params.toString() }, { replace: true });
  }, [search, pathname, navigate]);
  return (
    <Ctx.Provider value={(o) => setOpening(o ?? {})}>
      {children}
      {opening && <MoneySheet opening={opening} onClose={() => setOpening(null)} />}
    </Ctx.Provider>
  );
}

interface State {
  direction: 'in' | 'out';
  target: MoneyTarget | null;
  amount: string;
  /** Null on the way out: money leaving is said out loud, never assumed (wave 2 §3.2, расхождение 1). */
  channel: Channel | null;
  occurredOn: string;
  backdateReason: string;
  toOther: boolean;
  paidTo: string;
  paidToReason: string;
  foreignAmount: string;
  bankFee: string;
  toState: 'available' | 'service';
  /** A deposit handed back in cash beyond what is in the till: said and agreed to (designer's answer 1). */
  minusOk: boolean;
  /** The bank has sent this sum already (B11-03): the line waiting in «Разобрать» to attach instead. */
  bankChoice: string | null;
}

interface Closes {
  target: 'deposit' | 'period' | 'instalment' | 'service' | 'sale' | 'purchase';
  amountTetri: number;
  fullTetri: number;
  openTetri: number;
  seq?: number;
  startsOn?: string | null;
  endsOn?: string | null;
  dueOn?: string | null;
  number?: string | null;
}
/** A bank line this money may already be (B11-03): waiting in «Разобрать», or already the customer's payment. */
interface InBank {
  lineId: string;
  occurredOn: string;
  amountTetri: number;
  grossTetri: number;
  payer: string | null;
  purpose: string | null;
  payment: { id: string; number: string | null; grossTetri: number } | null;
}
interface Plan {
  direction: 'in' | 'out';
  grossTetri: number;
  feeTetri: number;
  netTetri: number;
  closes: Closes[];
  leftoverTetri: number;
  paidThroughBefore: string | null;
  paidThroughAfter: string | null;
  limitTetri: number | null;
  rate: number | null;
  /** An owner's preview only. */
  inBank?: InBank[];
}

interface Debt {
  owesTetri: number;
  /** Of owesTetri: awaited today and not late (ADR-0017). */
  dueTodayTetri: number;
  /** The same by rental id, before the customer's credit: a part of that rental's debt. */
  dueTodayBy: Record<string, number>;
  creditTetri: number;
  aheadTetri: number;
  depositHeldTetri: number;
  parts: { kind: 'rent' | 'deposit' | 'sale' | 'service'; id: string; number: string; owesTetri: number }[];
}
interface Targets {
  debt: Debt;
  rentals: { id: string; number: string; status: string; weeklyRateTetri: number; vin: string | null; model: string | null }[];
  sales: { id: string; number: string; nextTetri: number; nextDueOn: string | null; overdue: boolean }[];
  repairs: { id: string; number: string }[];
}

const OUT: readonly MoneyKind[] = ['deposit_payout', 'buyback', 'supplier'];
const dm = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}` : '');

function MoneySheet({ opening, onClose }: { opening: Opening; onClose: () => void }) {
  const t = useT();
  const { can } = useSession();
  const owner = can('payments.reconcile');
  const today = todayISO();
  const fixed = !!opening.target;
  const start: State = useMemo(
    () => ({
      direction: opening.target ? (OUT.includes(opening.target.kind) ? 'out' : 'in') : opening.direction ?? 'in',
      target: opening.target ?? null,
      amount: '',
      // Cash is the commonest way money comes in, so it is chosen in
      // advance. Money going out leaves the till or the account, and which
      // of the two is the thing a person must say — nothing is chosen for
      // them (уточнено 21.09.2026, расхождение 1). A manager has cash and no
      // field at all (wave 2 §3.2), so there is nothing for them to choose
      // and nothing to leave empty.
      channel: owner && opening.target && OUT.includes(opening.target.kind) ? null : 'cash',
      occurredOn: today,
      backdateReason: '',
      toOther: false,
      paidTo: '',
      paidToReason: '',
      foreignAmount: '',
      bankFee: '',
      toState: 'available',
      minusOk: false,
      bankChoice: null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [s, setS] = useState<State>(start);
  const set = (patch: Partial<State>) => setS((prev) => ({ ...prev, ...patch }));

  const kind = s.target?.kind ?? null;
  const tetri = parseGel(s.amount);
  const plan = usePlan(s, tetri);
  const awaitedTetri = useAwaitedTetri(s.target);
  const inBank = useInBank(s, plan, (bankChoice) => set({ bankChoice }));
  // Mika, 15.10.2026, variant «А»: a line waiting in «Разобрать» makes the
  // main button «Привязать эту строку», with «Это другой перевод — записать»
  // beside it; lines already recorded only make the main button the latter.
  const waiting = inBank.lines.filter((l) => !l.payment);
  const attaching = waiting.length > 0;
  const anotherTransfer = inBank.lines.length > 0 && !attaching;
  /** Up only while the button beside the main one submits the form. */
  const asAnother = useRef(false);
  const till = useLoad<{ me: string; rows: { userId: string; onHandTetri: number }[] }>(kind === 'deposit_payout' && owner ? '/api/till' : null);
  const tillOnHand = till.data?.rows.find((r) => r.userId === till.data!.me)?.onHandTetri ?? null;
  const amountText = tetri ? formatGel(tetri) : '';

  const title = !s.target
    ? owner
      ? t.money.take
      : t.money.takeCash
    : titleFor(t, s.target);
  const label = attaching
    ? t.inBank.attach
    : anotherTransfer
      ? t.inBank.another
      : kind === 'deposit_payout'
      ? t.money.payOut(amountText)
      : kind === 'supplier'
        ? t.money.recordSupplier
        : kind === 'buyback'
          ? t.money.buyBackFor(amountText)
          : t.money.record(amountText);

  const channels: Channel[] = !owner ? ['cash'] : kind === 'deposit_payout' ? ['cash', 'transfer'] : kind === 'supplier' ? ['transfer', 'cash'] : ['cash', 'acquiring', 'transfer'];

  return (
    <FormSheet
      title={title}
      onClose={onClose}
      value={s}
      initial={start}
      label={label}
      submit={async (key) => {
        if (!s.target) throw new Error('no target');
        if (!s.channel) {
          throw new ApiError(400, 'missing_field', 'Say where the money goes from.', { field: 'channel', fieldText: t.money.channelNeeded });
        }
        if (s.target.kind === 'deposit_payout' && s.channel === 'cash' && tetri != null && tetri > (tillOnHand ?? Infinity) && !s.minusOk) {
          throw new ApiError(400, 'missing_field', 'Confirm the till going below zero.', { field: 'minusOk', fieldText: t.money.tillMinusNeed });
        }
        // The bank has sent this sum already (B11-03): its line becomes the
        // payment, or the person says this is another transfer.
        const another = asAnother.current;
        asAnother.current = false;
        if (attaching && !another) {
          const line = waiting.find((l) => l.lineId === s.bankChoice);
          if (!line) throw new ApiError(400, 'missing_field', 'Choose the bank line to attach.', { field: 'notBankLines', fieldText: t.inBank.choose });
          const target = s.target;
          const what =
            target.kind === 'rent' ? { rentalId: target.rentalId } : target.kind === 'sale' ? { saleId: target.saleId } : target.kind === 'service' ? { serviceJobId: target.serviceJobId } : { customerId: target.customerId };
          const { id } = await api.post<{ id: string }>(`/api/statement-lines/${line.lineId}/assign`, what, { key });
          return {
            toast: {
              text: t.inBank.attached(formatGel(line.grossTetri), target.number ?? target.customer ?? ''),
              open: `/money/payments/${id}`,
              undo: () => api.post(`/api/payments/${id}/undo`),
            },
          };
        }
        const body = {
          kind: s.target.kind,
          rentalId: s.target.rentalId,
          saleId: s.target.saleId,
          serviceJobId: s.target.serviceJobId,
          purchaseId: s.target.purchaseId,
          customerId: s.target.customerId,
          amountTetri: s.amount,
          channel: s.channel,
          occurredOn: owner && s.occurredOn !== today ? s.occurredOn : undefined,
          backdateReason: owner && s.occurredOn !== today ? s.backdateReason : undefined,
          paidTo: s.toOther ? s.paidTo : undefined,
          paidToReason: s.toOther ? s.paidToReason : undefined,
          foreignAmount: s.foreignAmount || undefined,
          foreignCurrency: s.foreignAmount ? plan.purchase?.currency : undefined,
          bankFeeTetri: s.bankFee || undefined,
          toState: s.target.kind === 'buyback' ? s.toState : undefined,
          // Whatever the bank sent and was shown: the person said this is not it.
          notBankLines: inBank.lines.length > 0 ? inBank.lines.map((l) => l.lineId) : undefined,
        };
        const { id } = await api.post<{ id: string }>('/api/money', body, { key }).catch((e: unknown) => {
          // A line came in after the preview: shown now, and asked about again.
          if (e instanceof ApiError && e.code === 'bank_line_exists') inBank.refusedWith(e.extra.lines);
          throw e;
        });
        const how = t.money.how[s.channel];
        // «Returned» is the deposit's word (issue #9, item 5); a supplier paid or a
        // moped bought back is recorded like any other payment.
        const text = s.target.kind === 'deposit_payout' ? t.money.paidOut(amountText, how) : t.money.recorded(amountText, how);
        return {
          toast: {
            text,
            open: owner ? `/money/payments/${id}` : undefined,
            undo: s.target.kind === 'buyback' ? undefined : () => api.post(`/api/payments/${id}/undo`),
          },
        };
      }}
      actions={
        attaching ? (
          <button
            type="button"
            className="pill money-another"
            onClick={(e) => {
              // Not a submit button: Enter in a field presses the form's first one, and that must stay «Привязать».
              // The submit reads the flag before its first await, so it is down again whatever happened.
              asAnother.current = true;
              e.currentTarget.form?.requestSubmit();
              asAnother.current = false;
            }}
          >
            {t.inBank.another}
          </button>
        ) : undefined
      }
    >
      {owner && !fixed && (
        <div className="seg-row" role="radiogroup" aria-label={t.money.in}>
          {(['in', 'out'] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={s.direction === d}
              className={`seg ${s.direction === d ? 'on' : ''}`}
              onClick={() => set({ direction: d, target: null, amount: '', channel: owner && d === 'out' ? null : 'cash' })}
            >
              <span className="seg-lbl">{d === 'in' ? t.money.in : t.money.out}</span>
            </button>
          ))}
        </div>
      )}

      {!s.target ? (
        <WhoPicker direction={s.direction} onPick={(target) => set({ target, channel: owner && OUT.includes(target.kind) ? null : s.channel })} />
      ) : (
        <>
          <TargetHead s={s} fixed={fixed} onChange={() => set({ target: null, amount: '' })} onPick={(target) => set({ target, amount: '' })} />
          {kind === 'deposit_payout' && <DepositFacts rentalId={s.target.rentalId!} />}
          {kind === 'supplier' && <PurchaseFacts info={plan.purchase} />}

          <Field label={owner ? (s.direction === 'in' ? t.money.customerPaid : t.money.amount) : t.money.amountCash} name="amountTetri">
            <input className="input input-amount mono" inputMode="decimal" value={s.amount} onChange={(e) => set({ amount: e.target.value })} autoFocus={fixed} />
          </Field>
          <AmountChips s={s} onPick={(v) => set({ amount: v })} />

          {kind === 'supplier' && (
            <>
              <Field label={t.money.inCurrency(plan.purchase?.currency ?? '')} name="foreignAmount">
                <input className="input input-amount mono" inputMode="decimal" value={s.foreignAmount} onChange={(e) => set({ foreignAmount: e.target.value })} />
              </Field>
              {plan.data?.rate != null && <p className="hint muted">{t.money.rate(String(plan.data.rate).replace('.', ','), plan.purchase?.currency ?? '')}</p>}
              <Field label={t.money.bankFee} hint={t.money.bankFeeHint} name="bankFeeTetri">
                <input className="input input-amount mono" inputMode="decimal" value={s.bankFee} onChange={(e) => set({ bankFee: e.target.value })} />
              </Field>
            </>
          )}

          {owner && channels.length > 1 && (
            <Field label={kind === 'deposit_payout' ? t.money.howBack : t.payments.channel} name="channel">
              <div className="chips">
                {channels.map((c) => (
                  <button key={c} type="button" className={`pill pill-sm ${s.channel === c ? 'on' : ''}`} onClick={() => set({ channel: c })}>
                    {t.payments.channels[c]}
                  </button>
                ))}
              </div>
            </Field>
          )}
          {s.channel === 'acquiring' && plan.data && (
            <p className="money-note">{t.money.card(formatGel(plan.data.netTetri), formatGel(plan.data.feeTetri))}</p>
          )}
          {s.channel === 'transfer' && s.direction === 'in' && inBank.lines.length === 0 && <p className="hint muted">{t.money.transferHint}</p>}

          {kind === 'deposit_payout' && (
            <>
              <Field label={t.money.to} name="toOther">
                <div className="chips">
                  <button type="button" className={`pill pill-sm ${!s.toOther ? 'on' : ''}`} onClick={() => set({ toOther: false })}>
                    {t.money.payer(s.target.customer ?? '')}
                  </button>
                  <button type="button" className={`pill pill-sm ${s.toOther ? 'on' : ''}`} onClick={() => set({ toOther: true })}>
                    {t.money.other}
                  </button>
                </div>
              </Field>
              {/* Each in a field of its own: a refusal lands under the one it is about (QA-W2-03). */}
              {s.toOther && (
                <>
                  <Field label={t.money.otherName} name="paidTo">
                    <input className="input" value={s.paidTo} onChange={(e) => set({ paidTo: e.target.value })} />
                  </Field>
                  <Field label={t.money.otherReason} hint={t.money.otherHint} name="paidToReason">
                    <input className="input" value={s.paidToReason} onChange={(e) => set({ paidToReason: e.target.value })} />
                  </Field>
                </>
              )}
              {s.channel === 'cash' && <TillMinus amountTetri={tetri} confirmed={s.minusOk} onConfirm={(v) => set({ minusOk: v })} />}
            </>
          )}
          {kind === 'buyback' && (
            <Field label={t.money.toState} name="toState">
              <div className="chips">
                {(['available', 'service'] as const).map((st) => (
                  <button key={st} type="button" className={`pill pill-sm ${s.toState === st ? 'on' : ''}`} onClick={() => set({ toState: st })}>
                    {t.states[st]}
                  </button>
                ))}
              </div>
            </Field>
          )}

          {owner ? (
            <>
              <Field label={t.money.date} name="occurredOn">
                <input className="input mono" type="date" max={today} value={s.occurredOn} onChange={(e) => set({ occurredOn: e.target.value || today })} />
              </Field>
              {s.occurredOn < today && (
                <Field label={t.money.backdateReason} name="backdateReason">
                  <input className="input" value={s.backdateReason} onChange={(e) => set({ backdateReason: e.target.value })} />
                </Field>
              )}
            </>
          ) : (
            <p className="hint muted">{t.money.managerDay(fmtDate(today))}</p>
          )}

          {inBank.lines.length > 0 && <InBankLines lines={inBank.lines} choice={s.bankChoice} onChoose={(bankChoice) => set({ bankChoice })} onOpen={onClose} />}

          <Closing plan={plan.data} awaitedTetri={awaitedTetri} />
        </>
      )}
    </FormSheet>
  );
}

function titleFor(t: ReturnType<typeof useT>, target: MoneyTarget): string {
  const n = target.number ?? target.customer ?? '';
  switch (target.kind) {
    case 'deposit_payout':
      return t.money.payOutFor(n);
    case 'sale':
      return t.money.payInstalment(n);
    case 'supplier':
      return t.money.paySupplier(n);
    case 'service':
      return t.money.payService(n);
    case 'buyback':
      return t.money.buyBack(n);
    default:
      return t.money.takeFor(n);
  }
}

/** The plan from the API, a moment after the amount stops changing — and the order the supplier is paid for. */
function usePlan(s: State, tetri: number | null) {
  const [answer, setAnswer] = useState<{ key: string; plan: Plan } | null>(null);
  const purchase = useLoad<{ purchase: { number: string; currency: string; totalMinor?: number; paidTetri?: number } }>(
    s.target?.kind === 'supplier' && s.target.purchaseId ? `/api/purchases/${s.target.purchaseId}` : null,
  );
  const key = JSON.stringify([s.target, tetri, s.channel, s.foreignAmount, s.bankFee, s.occurredOn]);
  useEffect(() => {
    if (!s.target || !tetri) {
      setAnswer(null);
      return;
    }
    let live = true;
    const id = window.setTimeout(() => {
      api
        .post<Plan>('/api/money/preview', {
          kind: s.target!.kind,
          rentalId: s.target!.rentalId,
          saleId: s.target!.saleId,
          serviceJobId: s.target!.serviceJobId,
          purchaseId: s.target!.purchaseId,
          customerId: s.target!.customerId,
          amountTetri: tetri,
          channel: s.channel,
          foreignAmount: s.foreignAmount || undefined,
          bankFeeTetri: s.bankFee || undefined,
          // The bank lines it may already be are looked for around this day.
          occurredOn: s.occurredOn,
        })
        .then((p) => live && setAnswer({ key, plan: p }))
        .catch(() => live && setAnswer(null));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const data = answer?.plan ?? null;
  return { data, purchase: purchase.data?.purchase ?? null, key, fresh: answer?.key === key };
}

/**
 * The bank lines this money may already be (B11-03), from a preview of
 * exactly what is in the form now — a line of the sum typed a moment ago is
 * never offered for this one — and from a refusal, when a line came in after
 * the preview. The line to attach follows the lines: the first one waiting in
 * «Разобрать» is chosen in advance, so attaching it is one tap.
 */
function useInBank(s: State, plan: ReturnType<typeof usePlan>, choose: (choice: string | null) => void) {
  const [refused, setRefused] = useState<{ key: string; lines: InBank[] } | null>(null);
  const bankMoney = s.direction === 'in' && (s.channel === 'transfer' || s.channel === 'acquiring');
  const all = bankMoney ? [...(plan.fresh ? plan.data?.inBank ?? [] : []), ...(refused?.key === plan.key ? refused.lines : [])] : [];
  const lines = all.filter((l, i) => all.findIndex((x) => x.lineId === l.lineId) === i);
  const shape = lines.map((l) => `${l.lineId}${l.payment ? '+' : ''}`).join(',');
  useEffect(() => {
    const waiting = lines.filter((l) => !l.payment).map((l) => l.lineId);
    if (!(s.bankChoice != null && waiting.includes(s.bankChoice)) && (waiting[0] ?? null) !== s.bankChoice) choose(waiting[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shape]);
  return {
    lines,
    refusedWith: (more: unknown) => {
      if (!Array.isArray(more)) return;
      setRefused({ key: plan.key, lines: more as InBank[] });
      choose(null);
    },
  };
}

/**
 * «Банк уже прислал эту сумму»: each line with its day, sum and payer; one
 * waiting in «Разобрать» is what the main button attaches (with several, the
 * person picks which), one already recorded names its payment with a way to
 * it. Not a <label>: a click on a line's words would press the first button
 * inside.
 */
function InBankLines({ lines, choice, onChoose, onOpen }: { lines: InBank[]; choice: string | null; onChoose: (choice: string) => void; onOpen: () => void }) {
  const t = useT();
  const error = useFieldError('notBankLines');
  const several = lines.filter((l) => !l.payment).length > 1;
  return (
    <div className={`field money-bank ${error ? 'field-bad' : ''}`} data-field="notBankLines" role="group" aria-label={t.inBank.title}>
      <span className="lbl">{t.inBank.title}</span>
      {lines.map((l) => (
        <div key={l.lineId} className="money-bank-line">
          <p className="money-bank-head">
            <span className="mono">{dm(l.occurredOn)}</span> · <span className="mono">{formatGel(l.grossTetri)}</span>
            {l.amountTetri !== l.grossTetri && <span className="muted"> · {t.inBank.credited(formatGel(l.amountTetri))}</span>}
          </p>
          {(l.payer || l.purpose) && <p className="sort-line-text">{[l.payer, l.purpose].filter(Boolean).join(' · ')}</p>}
          {l.payment ? (
            <div className="money-bank-row">
              <span>{l.payment.number ? t.inBank.paidAs(l.payment.number) : t.inBank.paidAsPlain}</span>
              <Link className="pill pill-sm" to={`/money/payments/${l.payment.id}`} onClick={onOpen}>
                {t.sort.open}
              </Link>
            </div>
          ) : (
            <div className="money-bank-row">
              <span className="muted">{t.inBank.waits}</span>
              {several && (
                <button type="button" className={`pill pill-sm ${choice === l.lineId ? 'on' : ''}`} aria-pressed={choice === l.lineId} onClick={() => onChoose(l.lineId)}>
                  {t.inBank.pick}
                </button>
              )}
            </div>
          )}
        </div>
      ))}
      {error && <span className="field-err">{error}</span>}
    </div>
  );
}

/**
 * Of what this money is for: how much of the debt is awaited today and not
 * late (ADR-0017). For a rental — its own awaited part. For money "on
 * account" — everything, when the customer's whole figure is awaited: the
 * head of the sheet says «due today» then, and what stays after a part
 * payment must say the same; a mixed figure is a debt as a whole. Nought for
 * any other target. The same two addresses the head and the amount chips
 * read, so it costs no request of its own.
 */
function useAwaitedTetri(target: MoneyTarget | null): number {
  const rentalId = target?.kind === 'rent' ? target.rentalId ?? null : null;
  const onAccount = target?.kind === 'on_account';
  const rental = useLoad<{ rental: { customer: { id: string } } }>(rentalId ? `/api/rentals/${rentalId}` : null);
  const cid = target?.customerId ?? rental.data?.rental.customer.id ?? null;
  const targets = useLoad<Targets>((rentalId || onAccount) && cid ? `/api/customers/${cid}/money-targets` : null);
  const debt = targets.data?.debt;
  if (onAccount) return debt && debt.owesTetri > 0 && (debt.dueTodayTetri ?? 0) >= debt.owesTetri ? Number.POSITIVE_INFINITY : 0;
  return rentalId ? debt?.dueTodayBy?.[rentalId] ?? 0 : 0;
}

/**
 * "Закроет": what the payment takes, and the new "paid through" (§3.1).
 * What stays after a part payment is still «due today», in ink, while all of
 * it is money awaited today (`awaitedTetri`); anything older in it — a debt,
 * in red, as before.
 */
function Closing({ plan, awaitedTetri }: { plan: Plan | null; awaitedTetri: number }) {
  const t = useT();
  if (!plan || plan.closes.length === 0) return null;
  const owed = plan.closes.reduce((n, c) => n + Math.max(0, c.openTetri - c.amountTetri), 0);
  return (
    <section className="money-closes" aria-live="polite">
      <h3 className="t-overline">{t.money.closes}</h3>
      <ul>
        {plan.closes.map((c, i) => (
          <li key={i}>
            <span>{closeLabel(t, c)}</span>
            <span className={`mono ${c.amountTetri === 0 && c.target !== 'sale' ? 'muted' : ''}`}>
              {c.target === 'sale' ? '' : c.amountTetri < c.openTetri ? t.money.ofFull(formatGel(c.amountTetri), formatGel(c.openTetri, { decimals: false })) : formatGel(c.amountTetri)}
            </span>
          </li>
        ))}
      </ul>
      {plan.paidThroughAfter && plan.paidThroughAfter !== plan.paidThroughBefore && <p className="money-after">{t.money.paidThroughAfter(fmtDate(plan.paidThroughAfter))}</p>}
      {plan.leftoverTetri > 0 && <p className="money-after">{t.money.leftover(formatGel(plan.leftoverTetri))}</p>}
      {owed > 0 &&
        plan.direction === 'in' &&
        plan.closes.some((c) => c.target !== 'purchase') &&
        (owed <= awaitedTetri ? <p className="money-after">{t.money.leftDueToday(formatGel(owed))}</p> : <p className="money-after crit-text">{t.money.leftDebt(formatGel(owed))}</p>)}
    </section>
  );
}

function closeLabel(t: ReturnType<typeof useT>, c: Closes): string {
  switch (c.target) {
    case 'deposit':
      return t.money.closeDeposit;
    case 'period':
      return t.money.closeWeek(dm(c.startsOn), dm(c.endsOn));
    case 'instalment':
      return t.money.closeInstalment(c.seq ?? 0, fmtDate(c.dueOn));
    case 'service':
      return t.money.closeService(c.number ?? '');
    case 'purchase':
      return t.money.closePurchase(c.number ?? '');
    case 'sale':
      return t.money.closeSale(c.number ?? '');
  }
}

interface SearchAnswer {
  groups: {
    customers: { items: { id: string; name: string; phone: string | null }[] };
    rentals: { items: { id: string; number: string; customer: string; status: string }[] };
    sales: { items: { id: string; number: string; customer: string; status: string }[] };
    purchases: { items: { id: string; number: string; supplier: string }[] } | null;
  };
}

/** "От кого / кому": a customer or a record, by name, phone or number (§3.1). */
function WhoPicker({ direction, onPick }: { direction: 'in' | 'out'; onPick: (t: MoneyTarget) => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  useEffect(() => {
    const text = q.trim();
    if (text.length < SEARCH_MIN) {
      setAnswer(null);
      return;
    }
    let live = true;
    const id = window.setTimeout(() => {
      api
        .get<SearchAnswer>(`/api/search?q=${encodeURIComponent(text)}`)
        .then((a) => live && setAnswer(a))
        .catch(() => live && setAnswer(null));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [q]);
  const g = answer?.groups;
  return (
    <div className="money-who">
      <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={direction === 'in' ? t.money.whoIn : t.money.whoOut} aria-label={t.money.whoIn} />
      {!g && <p className="hint muted">{t.money.whoHint}</p>}
      {g && (
        <ul className="pick-cards">
          {direction === 'in' &&
            g.customers.items.map((c) => (
              <li key={c.id}>
                <button type="button" className="pick-card" onClick={() => onPick({ kind: 'on_account', customerId: c.id, customer: c.name })}>
                  <span className="pick-card-main">
                    <span className="pick-card-title">{c.name}</span>
                    <span className="pick-card-sub mono">{c.phone ?? ''}</span>
                  </span>
                </button>
              </li>
            ))}
          {g.rentals.items.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="pick-card"
                onClick={() => onPick({ kind: direction === 'in' ? 'rent' : 'deposit_payout', rentalId: r.id, number: r.number, customer: r.customer })}
              >
                <span className="pick-card-main">
                  <span className="pick-card-title">{r.number}</span>
                  <span className="pick-card-sub">{r.customer}</span>
                </span>
              </button>
            </li>
          ))}
          {g.sales.items
            .filter((x) => x.status === 'active')
            .map((x) => (
              <li key={x.id}>
                <button type="button" className="pick-card" onClick={() => onPick({ kind: direction === 'in' ? 'sale' : 'buyback', saleId: x.id, number: x.number, customer: x.customer })}>
                  <span className="pick-card-main">
                    <span className="pick-card-title">{x.number}</span>
                    <span className="pick-card-sub">{x.customer}</span>
                  </span>
                </button>
              </li>
            ))}
          {direction === 'out' &&
            (g.purchases?.items ?? []).map((p) => (
              <li key={p.id}>
                <button type="button" className="pick-card" onClick={() => onPick({ kind: 'supplier', purchaseId: p.id, number: p.number, customer: p.supplier })}>
                  <span className="pick-card-main">
                    <span className="pick-card-title">{p.number}</span>
                    <span className="pick-card-sub">{p.supplier}</span>
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Who it is, the one debt figure (§3.7), and — for a customer — which of
 * their records the money is for.
 */
function TargetHead({ s, fixed, onChange, onPick }: { s: State; fixed: boolean; onChange: () => void; onPick: (t: MoneyTarget) => void }) {
  const t = useT();
  const target = s.target!;
  const customerId = target.customerId ?? null;
  const rental = useLoad<{ rental: { customer: { id: string; name: string } } }>(!customerId && target.rentalId && target.kind === 'rent' ? `/api/rentals/${target.rentalId}` : null);
  const cid = customerId ?? rental.data?.rental.customer.id ?? null;
  const targets = useLoad<Targets>(cid && s.direction === 'in' ? `/api/customers/${cid}/money-targets` : null);
  const debt = targets.data?.debt ?? null;
  // The whole figure is awaited today: «К оплате сегодня» in ink, not «Должен» in red (ADR-0017).
  const awaited = !!debt && debt.owesTetri > 0 && (debt.dueTodayTetri ?? 0) >= debt.owesTetri;
  const name = target.customer ?? rental.data?.rental.customer.name ?? '';
  return (
    <section className="money-who-head">
      <div className="money-who-row">
        <div>
          <p className="t-h3">{name || target.number}</p>
          {debt && (
            <p className={awaited ? undefined : debt.owesTetri > 0 ? 'crit-text' : 'muted'}>
              {awaited ? t.money.dueToday(formatGel(debt.owesTetri)) : debt.owesTetri > 0 ? t.money.owes(formatGel(debt.owesTetri)) : debt.creditTetri > 0 ? t.money.onAccount(formatGel(debt.creditTetri)) : t.money.noDebt}
              {debt.parts.length > 0 && <span className="muted"> · {debt.parts.map((p) => `${p.number}${p.kind === 'deposit' ? ` ${t.money.closeDeposit.toLowerCase()}` : ''} ${formatGel(p.owesTetri, { decimals: false })}`).join(', ')}</span>}
            </p>
          )}
        </div>
        {!fixed && (
          <button type="button" className="pill pill-sm" onClick={onChange}>
            {t.money.change}
          </button>
        )}
      </div>
      {target.kind === 'on_account' && targets.data && <RecordChoice targets={targets.data} customer={target} onPick={onPick} />}
    </section>
  );
}

/** A customer picked: their records with a debt first, and "on account" (§3.1 "Основание"). */
function RecordChoice({ targets, customer, onPick }: { targets: Targets; customer: MoneyTarget; onPick: (t: MoneyTarget) => void }) {
  const t = useT();
  const owedOn = (id: string) => targets.debt.parts.filter((p) => p.id === id).reduce((n, p) => n + p.owesTetri, 0);
  const rentals = [...targets.rentals].sort((a, b) => owedOn(b.id) - owedOn(a.id));
  return (
    <div className="money-records">
      <p className="t-label">{t.money.whatFor}</p>
      <ul className="pick-cards">
        {rentals.slice(0, 4).map((r) => (
          <li key={r.id}>
            <button type="button" className="pick-card" onClick={() => onPick({ kind: 'rent', rentalId: r.id, number: r.number, customerId: customer.customerId, customer: customer.customer })}>
              <span className="pick-card-main">
                <span className="pick-card-title">{r.number}</span>
                <span className="pick-card-sub">{[r.model, r.vin ? `···${r.vin.slice(-4)}` : null].filter(Boolean).join(' ')}</span>
              </span>
              <span className="mono">{formatGel(owedOn(r.id), { decimals: false })}</span>
            </button>
          </li>
        ))}
        {targets.sales.map((x) => (
          <li key={x.id}>
            <button type="button" className="pick-card" onClick={() => onPick({ kind: 'sale', saleId: x.id, number: x.number, customerId: customer.customerId, customer: customer.customer })}>
              <span className="pick-card-main">
                <span className="pick-card-title">{x.number}</span>
                <span className="pick-card-sub">{x.nextDueOn ? `${t.money.chipInstalment} ${fmtDate(x.nextDueOn)}` : ''}</span>
              </span>
              <span className={`mono ${x.overdue ? 'crit-text' : ''}`}>{formatGel(x.nextTetri, { decimals: false })}</span>
            </button>
          </li>
        ))}
        {targets.repairs.map((j) => (
          <li key={j.id}>
            <button type="button" className="pick-card" onClick={() => onPick({ kind: 'service', serviceJobId: j.id, number: j.number, customerId: customer.customerId, customer: customer.customer })}>
              <span className="pick-card-main">
                <span className="pick-card-title">{j.number}</span>
              </span>
              <span className="mono">{formatGel(owedOn(j.id), { decimals: false })}</span>
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="pick-card pick-card-quiet" onClick={() => onPick({ ...customer, kind: 'on_account' })} aria-pressed="true">
            <span className="pick-card-main">
              <span className="pick-card-title">{t.money.toAccount}</span>
              <span className="pick-card-sub">{t.money.toAccountHint}</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  );
}

/** Suggested amounts as chips (§3.1 "Сумма"). */
function AmountChips({ s, onPick }: { s: State; onPick: (v: string) => void }) {
  const t = useT();
  const target = s.target!;
  const rental = useLoad<{ rental: { customer: { id: string }; weeklyRateTetri: number; storedStatus?: string } }>(target.kind === 'rent' && target.rentalId ? `/api/rentals/${target.rentalId}` : null);
  const cid = target.customerId ?? rental.data?.rental.customer.id ?? null;
  const targets = useLoad<Targets>(cid && (target.kind === 'rent' || target.kind === 'sale' || target.kind === 'service') ? `/api/customers/${cid}/money-targets` : null);
  const deposits = useLoad<{ deposits: { rentalId: string; heldTetri: number; toHandBackTetri: number }[] }>(target.kind === 'deposit_payout' ? '/api/deposits' : null);

  const chips: { tetri: number; label: string }[] = [];
  const owedOn = (id: string) => (targets.data?.debt.parts ?? []).filter((p) => p.id === id).reduce((n, p) => n + p.owesTetri, 0);
  if (target.kind === 'rent' && target.rentalId) {
    // Never more than the customer's one figure: money on their account comes off it.
    const owed = Math.min(owedOn(target.rentalId), targets.data?.debt.owesTetri ?? Infinity);
    const week = rental.data?.rental.weeklyRateTetri ?? 0;
    // «due today» when all this rental asks for is awaited today; «owed» when anything in it is older (ADR-0017).
    const awaited = (targets.data?.debt.dueTodayBy?.[target.rentalId] ?? 0) >= owedOn(target.rentalId);
    if (owed > 0) chips.push({ tetri: owed, label: awaited ? t.money.chipDueToday : t.money.chipDebt });
    // A returned rental has no next week to pay ahead for (QA-W3-10).
    if (week > 0 && rental.data?.rental.storedStatus !== 'returned') chips.push({ tetri: owed + week, label: t.money.chipWeek });
  }
  if (target.kind === 'sale' && target.saleId) {
    const sale = targets.data?.sales.find((x) => x.id === target.saleId);
    const owed = owedOn(target.saleId);
    if (owed > 0) chips.push({ tetri: owed, label: t.money.chipDebt });
    if (sale && sale.nextTetri > 0 && sale.nextTetri !== owed) chips.push({ tetri: sale.nextTetri, label: t.money.chipInstalment });
  }
  if (target.kind === 'service' && target.serviceJobId) {
    const owed = owedOn(target.serviceJobId);
    if (owed > 0) chips.push({ tetri: owed, label: t.money.chipDebt });
  }
  if (target.kind === 'deposit_payout' && target.rentalId) {
    const d = deposits.data?.deposits.find((x) => x.rentalId === target.rentalId);
    if (d && d.toHandBackTetri > 0) chips.push({ tetri: d.toHandBackTetri, label: t.money.chipToHandBack });
    else if (d && d.heldTetri > 0) chips.push({ tetri: d.heldTetri, label: t.money.chipHeld });
  }
  if (chips.length === 0) return null;
  return (
    <div className="chips money-chips">
      {chips.map((c) => (
        <button key={c.label} type="button" className={`pill pill-sm ${parseGel(s.amount) === c.tetri ? 'on' : ''}`} onClick={() => onPick(String(c.tetri / 100))}>
          <span className="mono">{formatGel(c.tetri, { decimals: false })}</span> · {c.label}
        </button>
      ))}
    </div>
  );
}

/** The deposit as the money says (§3.1 "Выдать залог"). */
function DepositFacts({ rentalId }: { rentalId: string }) {
  const t = useT();
  const deposits = useLoad<{ deposits: { rentalId: string; paidTetri: number; withheldTetri: number; heldTetri: number; toHandBackTetri: number }[] }>('/api/deposits');
  const d = deposits.data?.deposits.find((x) => x.rentalId === rentalId);
  if (!d) return null;
  return (
    <dl className="money-facts">
      <div>
        <dt>{t.money.received}</dt>
        <dd className="mono">{formatGel(d.paidTetri)}</dd>
      </div>
      <div>
        <dt>{t.money.withheld}</dt>
        <dd className="mono">{formatGel(d.withheldTetri)}</dd>
      </div>
      <div>
        <dt>{t.money.toHandBack}</dt>
        <dd className="mono t-money">{formatGel(d.toHandBackTetri || d.heldTetri)}</dd>
      </div>
    </dl>
  );
}

function PurchaseFacts({ info }: { info: { currency: string } | null }) {
  const t = useT();
  if (!info) return null;
  return (
    <dl className="money-facts">
      <div>
        <dt>{t.money.invoice}</dt>
        <dd className="mono">{info.currency}</dd>
      </div>
    </dl>
  );
}

/**
 * A deposit handed back in cash with less than that in the till: allowed —
 * the customer gets their money, the cash may come from elsewhere — but said,
 * and agreed to (designer's answer 1 to wave 2 round 1).
 */
function TillMinus({ amountTetri, confirmed, onConfirm }: { amountTetri: number | null; confirmed: boolean; onConfirm: (v: boolean) => void }) {
  const t = useT();
  const till = useLoad<{ me: string; rows: { userId: string; onHandTetri: number }[] }>('/api/till');
  const onHand = till.data?.rows.find((r) => r.userId === till.data!.me)?.onHandTetri;
  if (onHand == null || amountTetri == null || amountTetri <= onHand) return null;
  return (
    <Field label={t.money.tillMinus(formatGel(onHand), formatGel(amountTetri - onHand))} name="minusOk">
      <label className="check">
        <input type="checkbox" checked={confirmed} onChange={(e) => onConfirm(e.target.checked)} />
        <span>{t.money.tillMinusOk}</span>
      </label>
    </Field>
  );
}
