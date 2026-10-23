import { formatGel, isoWeekday, parseGel, payDayMove, SEARCH_MIN, todayISO, weekDueOn, type PayDayMove } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { LoadError } from '../../components/LoadError.js';
import { RowMenu } from '../../components/RowMenu.js';
import { PageHead } from '../../components/ui.js';
import { Field } from '../../components/Wizard.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { FormSheet, useFieldError } from '../../ds/form/Form.js';
import { useOperation } from '../../ds/form/operation.js';
import '../../ds/money/money.css';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { fmtDate, fmtDayMonth } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { chargeWords } from '../../lib/charges.js';
import { useLoad } from '../../lib/use.js';
import { ExpenseAnswers, ExpenseRuleCard, useExpenseCategories, type Categories, type ExpenseRuleLine } from './ExpenseAnswers.js';

interface Reason {
  /** `goods`: an open goods sale of this sum (ADR-0045). */
  code: 'name' | 'card_pickup' | 'amount_week' | 'amount' | 'recorded' | 'bank_deposit' | 'goods';
  /** The rental under this hint was carried over on or after the line's day: its money may be counted already. */
  transferredOn?: string;
  name?: string;
  number?: string;
  debtTetri?: number;
  grossTetri?: number;
  feeTetri?: number;
  netTetri?: number;
  day?: string;
  /** A goods sale's promised channel, and whether its buyer has no card. */
  channel?: 'acquiring' | 'transfer' | null;
  retail?: boolean;
}
interface Suggestion {
  kind: 'rental' | 'sale' | 'customer' | 'payment' | 'bank_deposit' | 'goods_sale';
  id: string;
  number: string | null;
  customer: string | null;
  customerId?: string;
  amountTetri?: number;
  occurredOn?: string;
  reason: Reason;
}
export interface SortLine {
  id: string;
  bank: 'bog' | 'tbc' | 'credo';
  direction: 'in' | 'out';
  occurredOn: string;
  amountTetri: number;
  grossTetri: number | null;
  feeTetri?: number | null;
  channel: 'transfer' | 'acquiring';
  payer: string | null;
  purpose: string | null;
  raw: string;
  cashDeposit: boolean;
  group: 'recorded' | 'suggested' | 'none';
  recorded: Suggestion[];
  suggestions: Suggestion[];
  /** Money going out (migration 0046): the payee to remember, and how it was sorted last time. */
  payee?: string | null;
  canRemember?: boolean;
  lastCategoryId?: string | null;
  depositHint?: { rentalId: string; number: string } | null;
}
interface Queue {
  counts: { in: number; out: number };
  byRulesWeek: number;
  /** Lines set aside in the last month — absent while an older API answers. */
  asideMonth?: number;
  lines: SortLine[];
}

/** The reason under a hint, in words (§3.2 "причина словами"). */
export function useReasonText() {
  const t = useT();
  const words = (r: Reason, line?: { amountTetri: number }): string => {
    const g = (n?: number) => formatGel(n ?? 0);
    switch (r.code) {
      case 'name':
        return r.number ? t.sort.reason.name(r.name ?? '', g(r.debtTetri), r.number) : t.sort.reason.nameOnly(r.name ?? '');
      case 'card_pickup':
        return t.sort.reason.card_pickup(g(r.netTetri ?? line?.amountTetri), g(r.grossTetri), r.number ?? '', fmtDate(r.day));
      case 'amount_week':
        return t.sort.reason.amount_week(r.number ?? '', g(r.debtTetri));
      case 'amount':
        return t.sort.reason.amount(r.number ?? '', g(r.debtTetri));
      case 'recorded':
        return t.sort.reason.recorded(r.number ? `, ${r.number}` : '');
      case 'bank_deposit':
        return t.sort.reason.bank_deposit;
      case 'goods': {
        // «TS-00001 · Розничный покупатель · ждёт 100 ₾ · продано 08.10 · картой» (ADR-0045 §7).
        const who = r.retail ? [t.goods.retail, r.name].filter(Boolean).join(' · ') : (r.name ?? '');
        return t.goods.sort.reason(r.number ?? '', who, g(r.debtTetri), fmtDayMonth(r.day), r.channel ? t.goods.card.promisedHow[r.channel] ?? '' : '');
      }
    }
  };
  // A line no later than the day the rental was carried over: the reason, and why a person is asked.
  return (r: Reason, line?: { amountTetri: number }): string => (r.transferredOn ? `${words(r, line)} ${t.sort.reason.beforeTransfer(fmtDate(r.transferredOn))}` : words(r, line));
}

/**
 * Money → Разобрать (wave 2 §3.2): the bank lines nobody placed. In and out
 * apart; "already recorded", then hints with their reason, then the rest with
 * the search straight away.
 */
export function SortPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const direction = params.get('d') === 'out' ? 'out' : 'in';
  const { data, failure, reload } = useLoad<Queue>(`/api/statement-lines?direction=${direction}`);
  const [other, setOther] = useState<SortLine | null>(null);
  const [notOurs, setNotOurs] = useState<SortLine | null>(null);
  const [splitting, setSplitting] = useState<SortLine | null>(null);
  const cats = useExpenseCategories(direction === 'out');

  const groups = (['recorded', 'suggested', 'none'] as const).map((g) => ({ g, lines: (data?.lines ?? []).filter((l) => l.group === g) }));
  const title = { recorded: t.sort.recordedGroup, suggested: t.sort.hintsGroup, none: t.sort.noneGroup };

  return (
    <>
      <PageHead title={t.shell.tabs.sort} />
      <div className="list-chips" role="tablist">
        {(['in', 'out'] as const).map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={direction === d}
            className={`list-chip ${direction === d ? 'on' : ''}`}
            onClick={() => setParams(d === 'in' ? {} : { d }, { replace: true })}
          >
            {d === 'in' ? t.sort.incoming : t.sort.outgoing} <span className="n">{data ? data.counts[d] : ''}</span>
          </button>
        ))}
      </div>

      {!data && failure && <LoadError failure={failure} onRetry={reload} />}
      {!data && !failure && <Skeleton rows={4} />}
      {data && data.lines.length === 0 && <AllSorted byRules={data.byRulesWeek} aside={data.asideMonth ?? 0} />}
      {data &&
        groups.map(
          ({ g, lines }) =>
            lines.length > 0 && (
              <section key={g}>
                <h2 className="sort-group t-h3">
                  {title[g]} <span className="muted mono">{lines.length}</span>
                </h2>
                {lines.map((l) => (
                  <LineCard key={l.id} line={l} cats={cats} onOther={() => setOther(l)} onNotOurs={() => setNotOurs(l)} onSplit={() => setSplitting(l)} />
                ))}
              </section>
            ),
        )}
      {data && data.lines.length > 0 && (
        <p className="sort-foot">
          {t.sort.byRules(data.byRulesWeek)} · <Link to="/money/sort/rules">{t.sort.check}</Link>
          <br />
          {t.sort.aside(data.asideMonth ?? 0)} · <Link to="/money/sort/aside">{t.sort.show}</Link>
        </p>
      )}
      {other && (
        <OtherSheet
          line={other}
          onClose={() => setOther(null)}
          onSplit={() => {
            setOther(null);
            setSplitting(other);
          }}
        />
      )}
      {notOurs && <NotOursSheet line={notOurs} onClose={() => setNotOurs(null)} />}
      {splitting && <SplitSheet line={splitting} onClose={() => setSplitting(null)} />}
    </>
  );
}

function AllSorted({ byRules, aside }: { byRules: number; aside: number }) {
  const t = useT();
  const statements = useLoad<{ banks: { bank: 'bog' | 'tbc' | 'credo'; throughOn: string | null; never: boolean }[] }>('/api/statements');
  return (
    <div className="task-clear">
      <p className="t-h3">{t.sort.empty}</p>
      {statements.data && (
        <p className="muted">
          {statements.data.banks
            .filter((b) => !b.never)
            .map((b) => `${t.statements.banks[b.bank]} — ${fmtDate(b.throughOn)}`)
            .join(' · ')}
        </p>
      )}
      <Link className="pill pill-accent" to="/money/statements">
        {t.statements.importCta}
      </Link>
      <p className="sort-foot">
        {t.sort.byRules(byRules)} · <Link to="/money/sort/rules">{t.sort.check}</Link>
        <br />
        {t.sort.aside(aside)} · <Link to="/money/sort/aside">{t.sort.show}</Link>
      </p>
    </div>
  );
}

/** One line: its amount, day, bank, the bank's words — and the answers (§3.2). */
function LineCard({ line, cats, onOther, onNotOurs, onSplit }: { line: SortLine; cats: Categories; onOther: () => void; onNotOurs: () => void; onSplit: () => void }) {
  const t = useT();
  const toast = useToast();
  const reason = useReasonText();
  const op = useOperation();
  const busy = op.state === 'busy';
  const sign = line.direction === 'out' ? '−' : '+';

  /** One tap, one answer: "Привязываем…", a second tap does nothing (B2-02). */
  const act = async (path: string, body: Record<string, unknown>, done: { text: string; undo?: (answer: { id?: string }) => () => Promise<unknown> }) => {
    const res = await op.run((key) => api.post<{ id?: string }>(`/api/statement-lines/${line.id}/${path}`, body, { key }), `${path}:${JSON.stringify(body)}`);
    if (!res.ok) return;
    toast({ text: done.text, undo: done.undo?.(res.value) });
  };
  const undoPayment = (a: { id?: string }) => () => api.post(`/api/payments/${a.id}/undo`);
  const first = line.suggestions[0];
  const rest = line.suggestions.slice(1);

  const attach = (s: Suggestion) => {
    if (s.kind === 'bank_deposit') return act('bank-deposit', { bankDepositId: s.id }, { text: t.sort.linked });
    const body = s.kind === 'rental' ? { rentalId: s.id } : s.kind === 'sale' ? { saleId: s.id } : s.kind === 'goods_sale' ? { goodsSaleId: s.id } : { customerId: s.id };
    return act('assign', body, { text: t.sort.attached(s.number ?? s.customer ?? ''), undo: undoPayment });
  };

  return (
    <article className={`sort-line ${busy ? 'busy' : ''}`} aria-busy={busy}>
      <div className="sort-line-head">
        <span className={`t-money ${line.direction === 'out' ? 'amt-out' : 'amt-in'}`}>
          {sign}
          {formatGel(line.amountTetri)}
        </span>
        <span className="sort-line-meta">
          {fmtDate(line.occurredOn)} · {t.statements.banks[line.bank]}
        </span>
        <RowMenu
          actions={[
            ...(line.direction === 'in' ? [{ key: 'split', label: t.sort.split, onPick: onSplit }] : []),
            // Money coming in from another of the company's accounts (ADR-0028); going out, the answer sits under the line.
            ...(line.direction === 'in'
              ? [{ key: 'own', label: t.exp.ownTransfer, onPick: () => void act('own-transfer', {}, { text: t.exp.ownTransferDone, undo: () => () => api.post(`/api/statement-lines/${line.id}/restore`, {}) }) }]
              : []),
            { key: 'not', label: t.sort.notOurs, onPick: onNotOurs },
          ]}
        />
      </div>
      {/* The sum above is what the bank credited. A card line says what the customer paid — that is what
          attaching it writes — and what the bank kept. */}
      {line.direction === 'in' && line.channel === 'acquiring' && (
        <p className="sort-line-card">
          {line.grossTetri != null ? t.sort.byCard(formatGel(line.grossTetri), formatGel(line.feeTetri ?? line.grossTetri - line.amountTetri)) : t.sort.byCardPlain}
        </p>
      )}
      <p className="sort-line-text">{[line.payer, line.purpose].filter(Boolean).join(' · ') || line.raw}</p>

      {line.group === 'recorded' &&
        line.recorded.map((p, i) => (
          <div key={p.id} className="sort-actions">
            <p className="sort-reason">
              {(line.direction === 'out' ? t.sort.recordedOut : t.sort.recordedText)(
                [formatGel(p.amountTetri ?? 0), fmtDate(p.occurredOn), p.customer, p.number].filter(Boolean).join(', '),
              )}
            </p>
            {/* The first is the main answer, the rest are quiet (§3.2, QA-W2-08). */}
            <button type="button" className={`pill pill-sm ${i === 0 ? 'pill-accent' : ''}`} disabled={busy} onClick={() => act('link', { paymentId: p.id }, { text: t.sort.linked })}>
              {busy ? t.sort.attaching : line.direction === 'out' ? t.sort.yesShe : t.sort.yes}
            </button>
          </div>
        ))}
      {/* Entered by hand, or this other record's money — the person says which (designer's answer 3). */}
      {line.group === 'recorded' && line.suggestions.length > 0 && (
        <div className="sort-actions">
          {line.suggestions.map((s) => (
            <button key={s.id} type="button" className="pill pill-sm" disabled={busy} onClick={() => attach(s)}>
              {t.sort.itsPayment(s.number ?? '')}
            </button>
          ))}
        </div>
      )}

      {line.group === 'suggested' && first && (
        <>
          <p className="sort-reason">{reason(first.reason, line)}</p>
          <div className="sort-actions">
            <button type="button" className="pill pill-sm pill-accent" disabled={busy} onClick={() => attach(first)}>
              {busy ? t.sort.attaching : first.kind === 'bank_deposit' ? t.sort.bankDepositYes : t.sort.attachTo(first.number ?? first.customer ?? '')}
            </button>
            {rest.slice(0, 3).map((s) => (
              <button key={s.id} type="button" className="pill pill-sm" disabled={busy} onClick={() => attach(s)} title={reason(s.reason, line)}>
                {s.number ?? s.customer}
                {s.reason.debtTetri ? ` · ${formatGel(s.reason.debtTetri, { decimals: false })}` : ''}
              </button>
            ))}
            <button type="button" className="pill pill-sm" disabled={busy} onClick={onOther}>
              {t.sort.other}
            </button>
            {line.direction === 'in' && (
              <button type="button" className="pill pill-sm" disabled={busy} onClick={onSplit}>
                {t.sort.split}
              </button>
            )}
          </div>
        </>
      )}

      {line.direction === 'in' && line.cashDeposit && line.group !== 'recorded' && !line.suggestions.some((s) => s.kind === 'bank_deposit') && (
        <div className="sort-actions">
          <p className="sort-reason">{t.sort.bankDeposit}</p>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => act('bank-deposit', {}, { text: t.sort.linked })}>
            {t.sort.bankDepositYes}
          </button>
        </div>
      )}

      {line.direction === 'in' && (line.group === 'none' || line.group === 'recorded') && (
        <div className="sort-actions">
          {line.direction === 'in' ? (
            <>
              <button type="button" className={`pill pill-sm ${line.group === 'none' ? 'pill-accent' : ''}`} disabled={busy} onClick={onOther}>
                {line.group === 'recorded' ? t.sort.no : t.sort.other}
              </button>
              <button type="button" className="pill pill-sm" disabled={busy} onClick={onSplit}>
                {t.sort.split}
              </button>
            </>
          ) : null}
        </div>
      )}
      {/* Money going out: what it is, and for an expense what it was for (migration 0046). */}
      {line.direction === 'out' && <ExpenseAnswers line={line} cats={cats} quiet={line.group === 'recorded'} />}
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
    </article>
  );
}

interface SearchAnswer {
  groups: {
    customers: { items: { id: string; name: string; phone: string | null }[] };
    rentals: { items: { id: string; number: string; customer: string; customerId?: string; status: string }[] };
    sales: { items: { id: string; number: string; customer: string; status: string }[] };
    /** Goods sales (ADR-0045): absent while an older API answers. */
    goods?: { items: { id: string; number: string; status: string; customerId: string | null; buyer: string | null; retail: boolean; openTetri: number }[] };
  };
}

/** What «Другое» may attach to; a goods sale says what it waits for, and whether that is less than the line. */
interface OtherPick {
  body: Record<string, string>;
  label: string;
  /** A goods sale's open sum, and whether the line is bigger: the server refuses that, and the sheet says so first. */
  open?: number;
  short?: boolean;
}

/** "Другое": attach to any record, by number, name or phone — not a cut list (§3.2, B2-05). */
function OtherSheet({ line, onClose, onSplit }: { line: SortLine; onClose: () => void; onSplit: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<OtherPick | null>(null);
  // What attaching writes: a card line the customer's sum, any other line its amount.
  const lineTetri = line.channel === 'acquiring' && line.grossTetri != null ? line.grossTetri : line.amountTetri;
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  useEffect(() => {
    const text = q.trim();
    if (text.length < SEARCH_MIN) {
      setAnswer(null);
      return;
    }
    let live = true;
    const id = window.setTimeout(() => {
      api.get<SearchAnswer>(`/api/search?q=${encodeURIComponent(text)}`).then((a) => live && setAnswer(a)).catch(() => live && setAnswer(null));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [q]);
  const g = answer?.groups;
  const options: (OtherPick & { sub: string })[] = g
    ? [
        ...g.rentals.items.map((r) => ({ body: { rentalId: r.id }, label: r.number, sub: r.customer })),
        ...g.sales.items.filter((x) => x.status === 'active').map((x) => ({ body: { saleId: x.id }, label: x.number, sub: x.customer })),
        // Goods sales with money still open: a retail buyer's included (ADR-0045). One that waits for
        // less than the line says so before it is chosen (QA 23.10.2026): the line goes there only split.
        ...(g.goods?.items ?? [])
          .filter((x) => x.status === 'active' && x.openTetri > 0)
          .map((x) => ({
            body: { goodsSaleId: x.id },
            label: x.number,
            open: x.openTetri,
            short: lineTetri > x.openTetri,
            sub: [x.retail ? t.goods.retail : (x.buyer ?? ''), t.goods.card.waits(formatGel(x.openTetri)), lineTetri > x.openTetri ? t.goods.sort.lessThanLine : ''].filter(Boolean).join(' · '),
          })),
        ...g.customers.items.map((c) => ({ body: { customerId: c.id }, label: `${t.money.toAccount} · ${c.name}`, sub: t.money.toAccountHint })),
      ]
    : [];
  return (
    <FormSheet
      title={t.sort.whereTo(formatGel(lineTetri))}
      onClose={onClose}
      value={pick}
      initial={null}
      // More than the sale waits for is about the sale chosen: the words go under the list, and the button
      // stays as it was — sending it again would be refused again (QA 23.10.2026).
      fieldOf={{ goods_over_open: 'goodsSaleId' }}
      label={pick ? (pick.body.customerId ? pick.label : t.sort.attachTo(pick.label)) : t.sort.other}
      submit={async (key) => {
        if (!pick) throw new Error('nothing picked');
        const r = await api.post<{ id: string }>(`/api/statement-lines/${line.id}/assign`, pick.body, { key });
        return { toast: { text: t.sort.attached(pick.label), undo: () => api.post(`/api/payments/${r.id}/undo`) } };
      }}
    >
      <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.money.whoIn} aria-label={t.money.whoIn} />
      <p className="hint muted">{t.sort.whereHint}</p>
      <ul className="pick-cards">
        {options.map((o) => (
          <li key={JSON.stringify(o.body)}>
            <button type="button" className={`pick-card ${pick?.label === o.label ? 'on' : ''}`} onClick={() => setPick({ body: o.body, label: o.label, open: o.open, short: o.short })}>
              <span className="pick-card-main">
                <span className="pick-card-title">{o.label}</span>
                <span className={`pick-card-sub ${o.short ? 'warn-text' : ''}`}>{o.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {pick?.body.goodsSaleId && <OverOpen pick={pick} lineTetri={lineTetri} onSplit={onSplit} />}
    </FormSheet>
  );
}

/**
 * Under «Куда привязать», for a goods sale chosen: when it waits for less than
 * the line, that it does and how much — before the line is sent — and the way
 * that works, «Разнести»; once the server has refused, its words, which name
 * the sum. The place the refusal is about, so the form shows it here.
 */
function OverOpen({ pick, lineTetri, onSplit }: { pick: OtherPick; lineTetri: number; onSplit: () => void }) {
  const t = useT();
  const refused = useFieldError('goodsSaleId');
  const warn = refused ?? (pick.short && pick.open != null ? t.goods.sort.overOpen(pick.label, formatGel(pick.open), formatGel(lineTetri)) : null);
  return (
    <div className="sort-over" data-field="goodsSaleId">
      {warn && (
        <>
          <p className="field-err" role={refused ? 'alert' : undefined}>
            {warn}
          </p>
          <button type="button" className="pill pill-sm" onClick={onSplit}>
            {t.sort.split}
          </button>
        </>
      )}
    </div>
  );
}

interface Week {
  startsOn: string | null;
  endsOn: string | null;
}
/**
 * A running rental's latest week as «Перенос дня оплаты» reads it (issue #12,
 * ADR-0041 addendum of 23.10.2026): the weekday the rent falls due on now, and
 * — when the move is shown closed — why.
 */
interface PayDayTarget {
  seq: number;
  startsOn: string;
  endsOn: string;
  amountTetri: number;
  paidTetri: number;
  /** ISO 1–7. */
  payDay: number;
  payOffsetDays: number;
  closed: 'older_week_open' | 'week_moved' | null;
}
interface Targets {
  debt: { parts: { kind: 'rent' | 'deposit' | 'charge' | 'sale' | 'service'; id: string; owesTetri: number }[] };
  rentals: {
    id: string;
    number: string;
    status: string;
    model: string | null;
    weeklyRateTetri: number;
    transferredOn?: string | null;
    firstOpenWeek?: Week | null;
    /** None where the latest week cannot be moved; absent while an older API answers. */
    payDayMove?: PayDayTarget | null;
  }[];
  sales: { id: string; number: string; nextTetri: number }[];
  repairs: { id: string; number: string }[];
  /** Goods sold to him and still open (ADR-0045); absent while an older API answers. */
  goods?: { id: string; number: string; openTetri: number }[];
  /** Open fines and other charges, each its own part (ADR-0023). */
  charges?: { id: string; rentalId: string; kind: string; note: string | null; openTetri: number }[];
  /** Weeks carried over as paid with no bank money behind them yet (ADR-0023). */
  carriedWeeks?: { id: string; rentalId: string; seq: number; startsOn: string; endsOn: string; amountTetri: number }[];
}

/** One place the line's money can go — or, «Перенос дня оплаты», what it moves. */
interface SplitPart {
  key: string;
  kind: 'rent' | 'fine' | 'charge' | 'repair' | 'sale' | 'goods' | 'account' | 'payday';
  title: string;
  /** The record's number, in mono beside the title. */
  ref: string;
  body: Record<string, string>;
  /** What the record still owes: the most "the rest" fills in. 0 — no limit. */
  owesTetri: number;
  /** Behind "+ ещё": rarely needed. */
  extra: boolean;
  /** Rent: the week a payment older than the carry-over may be, and the week it goes to otherwise (ADR-0023). */
  carried?: { rentalId: string; week: { id: string; startsOn: string; endsOn: string; amountTetri: number } };
  openWeek?: Week | null;
  /** A new fine on this rental, with what it is for. */
  fineOf?: string;
  /** The rental of a rent or pay-day part. */
  rentalId?: string;
  /** A pay-day part: the latest week it would move, and the weekly rate the suggestion is counted from. */
  move?: PayDayTarget;
  rateTetri?: number;
}
interface SplitValue {
  customer: { id: string; name: string } | null;
  /** «Розничные продажи товаров»: a day's card line split over retail goods sales, no customer (ADR-0045). */
  retail?: boolean;
  amounts: Record<string, string>;
  /** Per rental: the old line's rent is the carried week's money, or new money. */
  choice: Record<string, 'carried' | 'new'>;
  /** Per rental: what a new fine is for. */
  reasons: Record<string, string>;
  /** "+ ещё" opened. */
  more: boolean;
  /**
   * «Перенос дня оплаты» (issue #12): the rental, the weekday chosen (ISO,
   * as text), the sum — the extra, or the discount — and the reason, both
   * filled in and editable. One move per line; none — the day stays.
   */
  move: { rentalId: string; to: string; amount: string; reason: string } | null;
}

const weekText = (w: { startsOn: string | null; endsOn: string | null }) => `${fmtDayMonth(w.startsOn)}–${fmtDayMonth(w.endsOn)}`;

/**
 * "Разделить": one line, several of the customer's records — a rental week
 * and a fine paid in one transfer (meeting of 14.10.2026). Laid out the way
 * an owner says it (Mika, 15.10.2026, variant «В» of
 * docs/redesign/prototypes/split-options.html): rent and a fine per rental,
 * the week asked by its dates when the payment is older than the carry-over,
 * and in words what will be written and what the customer will owe after.
 */
function SplitSheet({ line, onClose }: { line: SortLine; onClose: () => void }) {
  const t = useT();
  const total = line.channel === 'acquiring' && line.grossTetri != null ? line.grossTetri : line.amountTetri;
  const initial: SplitValue = { customer: null, amounts: {}, choice: {}, reasons: {}, more: false, move: null };
  const [value, setValue] = useState<SplitValue>(initial);
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  useEffect(() => {
    const text = q.trim();
    if (value.customer || text.length < SEARCH_MIN) {
      setAnswer(null);
      return;
    }
    let live = true;
    const id = window.setTimeout(() => {
      api.get<SearchAnswer>(`/api/search?q=${encodeURIComponent(text)}`).then((a) => live && setAnswer(a)).catch(() => live && setAnswer(null));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
  }, [q, value.customer]);
  const targets = useLoad<Targets>(value.customer ? `/api/customers/${value.customer.id}/money-targets` : null);
  // Retail goods sales waiting for money: the retail mode's parts, and behind «+ ещё» for a customer.
  const retailGoods = useLoad<{ sales: { id: string; number: string; openTetri: number; buyer: { name: string | null } | null }[] }>(value.customer || value.retail ? '/api/goods-sales?open=1&retail=1' : null);
  const retailParts: SplitPart[] = (retailGoods.data?.sales ?? []).map((x) => ({
    key: `g:${x.id}`,
    kind: 'goods',
    title: x.buyer?.name ? `${t.goods.retail} · ${x.buyer.name}` : t.goods.retail,
    ref: x.number,
    body: { goodsSaleId: x.id },
    owesTetri: x.openTetri,
    extra: !value.retail,
  }));

  const owes = (kinds: string[], id: string) => (targets.data?.debt.parts ?? []).filter((p) => p.id === id && kinds.includes(p.kind)).reduce((n, p) => n + p.owesTetri, 0);
  const numberOf = (rentalId: string) => targets.data?.rentals.find((r) => r.id === rentalId)?.number ?? '';
  // Rent paid no later than the day the rental was carried over may be the
  // week the carry-over already marked paid — or money it did not know of.
  // Only a person knows which (Mika, 15.10.2026; ADR-0018, ADR-0023).
  const carriedWeekOf = (r: Targets['rentals'][number]) =>
    r.transferredOn && line.occurredOn <= r.transferredOn
      ? (targets.data?.carriedWeeks ?? []).find((w) => w.rentalId === r.id && w.startsOn <= line.occurredOn && line.occurredOn <= w.endsOn) ?? null
      : null;
  const shown = (targets.data?.rentals ?? []).filter((r) => owes(['rent', 'deposit'], r.id) > 0 || !['returned', 'cancelled'].includes(r.status));
  const parts: SplitPart[] = targets.data
    ? [
        ...shown.flatMap((r): SplitPart[] => {
          const week = carriedWeekOf(r);
          const asCarried = !!week && value.choice[r.id] === 'carried';
          return [
            {
              key: `r:${r.id}`,
              kind: 'rent',
              title: t.sort.splitRentTitle,
              ref: r.number,
              body: asCarried ? { carriedPeriodId: week!.id } : { rentalId: r.id },
              owesTetri: asCarried ? week!.amountTetri : owes(['rent', 'deposit'], r.id),
              extra: false,
              ...(week ? { carried: { rentalId: r.id, week } } : {}),
              openWeek: r.firstOpenWeek ?? null,
              rentalId: r.id,
            },
            // Beside the rent: the pay day moved with this line (issue #12), on a running rental's latest week.
            ...(r.payDayMove
              ? [{ key: `d:${r.id}`, kind: 'payday' as const, title: t.payDayMove.title, ref: r.number, body: {}, owesTetri: 0, extra: false, rentalId: r.id, move: r.payDayMove, rateTetri: r.weeklyRateTetri }]
              : []),
            { key: `n:${r.id}`, kind: 'fine', title: t.sort.splitFineTitle, ref: r.number, body: { fineRentalId: r.id, fineReason: value.reasons[r.id] ?? '' }, owesTetri: 0, extra: false, fineOf: r.id },
          ];
        }),
        ...(targets.data.charges ?? []).map(
          (c): SplitPart => ({
            key: `f:${c.id}`,
            kind: 'charge',
            title: chargeWords(t, c.kind, c.note),
            ref: numberOf(c.rentalId),
            body: { chargeId: c.id },
            owesTetri: c.openTetri,
            extra: false,
          }),
        ),
        ...targets.data.repairs
          .filter((j) => owes(['service'], j.id) > 0)
          .map((j): SplitPart => ({ key: `j:${j.id}`, kind: 'repair', title: t.money.kinds.service, ref: j.number, body: { serviceJobId: j.id }, owesTetri: owes(['service'], j.id), extra: true })),
        // His goods, seen at once: a week and a charger are often one transfer (ADR-0045 §7).
        ...(targets.data.goods ?? []).map((g): SplitPart => ({ key: `g:${g.id}`, kind: 'goods', title: t.goods.sort.part, ref: g.number, body: { goodsSaleId: g.id }, owesTetri: g.openTetri, extra: false })),
        ...targets.data.sales.map((x): SplitPart => ({ key: `s:${x.id}`, kind: 'sale', title: t.money.kinds.sale, ref: x.number, body: { saleId: x.id }, owesTetri: owes(['sale'], x.id), extra: true })),
        { key: `c:${value.customer!.id}`, kind: 'account', title: t.money.toAccount, ref: '', body: { customerId: value.customer!.id }, owesTetri: 0, extra: true },
        ...retailParts,
      ]
    : value.retail
      ? retailParts
      : [];
  const amountOf = (key: string) => parseGel(value.amounts[key] ?? '') ?? 0;
  // The pay day moved (issue #12): what the latest week becomes, from the same arithmetic the server reads.
  const today = todayISO();
  const lineDay = fmtDayMonth(line.occurredOn);
  const planOf = (p: SplitPart, to: number): PayDayMove =>
    payDayMove({ payDay: p.move!.payDay, to, startsOn: p.move!.startsOn, weeklyRateTetri: p.rateTetri ?? 0, payOffsetDays: p.move!.payOffsetDays, today });
  const moving = value.move ? parts.find((p) => p.kind === 'payday' && p.rentalId === value.move!.rentalId) ?? null : null;
  const chosen = moving && value.move ? planOf(moving, Number(value.move.to)) : null;
  const moveTyped = value.move ? parseGel(value.move.amount) ?? 0 : 0;
  // A longer week's extra is money of the line, a shorter week's discount is not.
  const moveMoney = chosen && chosen.days > 0 ? moveTyped : 0;
  const moveOff = chosen && chosen.days < 0 ? moveTyped : 0;
  const dayWord = (to: number) => t.payDayMove.onDay[to - 1] ?? '';
  const autoOf = (p: SplitPart, to: number) => ({ amount: String(planOf(p, to).plan.suggestedExtraTetri / 100), reason: t.payDayMove.reasonAuto(dayWord(to), lineDay) });
  const chooseDay = (p: SplitPart, to: string) =>
    setValue((v) => {
      // The day he pays on now: no move.
      if (Number(to) === p.move!.payDay) return { ...v, move: null };
      const was = v.move && v.move.rentalId === p.rentalId ? v.move : null;
      const filled = was ? autoOf(p, Number(was.to)) : null;
      const next = autoOf(p, Number(to));
      // What was filled in follows the day; what a person typed stays.
      return {
        ...v,
        move: {
          rentalId: p.rentalId!,
          to,
          amount: !was || was.amount === filled!.amount ? next.amount : was.amount,
          reason: !was || was.reason === filled!.reason ? next.reason : was.reason,
        },
      };
    });
  const placed = parts.reduce((n, p) => n + amountOf(p.key), 0) + moveMoney;
  const left = total - placed;
  // «150 + 20 = 170»: the parts typed, and the move's money of a longer week.
  const placedSums = [...parts.map((p) => amountOf(p.key)).filter((a) => a > 0), ...(moveMoney > 0 ? [moveMoney] : [])];
  const setAmount = (key: string, text: string) => setValue((v) => ({ ...v, amounts: { ...v.amounts, [key]: text } }));
  // An empty sum takes the rest when it is touched, selected so that typing replaces it.
  const takeRest = (p: SplitPart, input: HTMLInputElement) => {
    if ((value.amounts[p.key] ?? '').trim() !== '' || left <= 0) return;
    const take = p.owesTetri > 0 ? Math.min(p.owesTetri, left) : left;
    setAmount(p.key, (take / 100).toFixed(2));
    window.setTimeout(() => input.select(), 0);
  };
  // A goods sale, a repair, a charge: a part above what it waits for is refused by the server — said here
  // before it is sent, not cut quietly from the debt below (QA 23.10.2026).
  const CAPPED: SplitPart['kind'][] = ['goods', 'repair', 'charge'];
  const overBy = (p: SplitPart) => (CAPPED.includes(p.kind) && p.owesTetri > 0 ? Math.max(0, amountOf(p.key) - p.owesTetri) : 0);
  const anyOver = parts.some((p) => overBy(p) > 0);
  const visible = parts.filter((p) => !p.extra || value.more || amountOf(p.key) > 0);
  const hidden = parts.some((p) => p.extra && !visible.includes(p));

  // What will be written, said in words, and what the customer will owe after.
  const used = parts.filter((p) => amountOf(p.key) > 0);
  // The week the rent goes onto, by its days — the new ones when the line moves that very week.
  const rentWeekText = (p: SplitPart): string | null => {
    if (!p.openWeek) return null;
    const m = moving?.move;
    if (m && chosen && p.rentalId === moving!.rentalId && p.openWeek.startsOn === m.startsOn) return weekText({ startsOn: m.startsOn, endsOn: chosen.plan.endsOn });
    return weekText(p.openWeek);
  };
  // The pay day moved, in words (issue #12): «20,00 ₾ — перенос дня оплаты на пятницу (+1 день)»,
  // or, for a shorter week, what it becomes and how much cheaper — no money of the line. A move
  // with 0 typed is written all the same, so it is said all the same, without the sum (review, 23.10.2026).
  const moveWords = (): string | null => {
    if (!moving || !chosen || !value.move) return null;
    const day = dayWord(Number(value.move.to));
    const days = t.payDayMove.days(chosen.days);
    if (chosen.days > 0) return moveMoney > 0 ? t.payDayMove.resLonger(formatGel(moveMoney), day, days, moving.ref) : t.payDayMove.resLongerFree(day, days, moving.ref);
    const week = weekText({ startsOn: moving.move!.startsOn, endsOn: chosen.plan.endsOn });
    return moveOff > 0 ? t.payDayMove.resShorter(day, days, moving.ref, week, formatGel(moveOff)) : t.payDayMove.resShorterFree(day, days, moving.ref, week);
  };
  const said: string[] = [];
  let moveTold = false;
  for (const p of used) {
    const a = formatGel(amountOf(p.key));
    if (p.kind === 'rent' && p.carried && value.choice[p.carried.rentalId] === 'carried') said.push(t.sort.resCarried(a, weekText(p.carried.week), p.ref));
    else if (p.kind === 'rent') {
      const week = rentWeekText(p);
      said.push(week ? t.sort.resRent(a, p.ref, week) : t.sort.resRentAhead(a, p.ref));
      // The move right after the rent of its rental.
      if (moving && p.rentalId === moving.rentalId) {
        const words = moveWords();
        if (words) said.push(words);
        moveTold = true;
      }
    } else if (p.kind === 'fine') said.push(t.sort.resFine(a, (value.reasons[p.fineOf!] ?? '').trim() || '…', p.ref));
    else if (p.kind === 'charge') said.push(t.sort.resCharge(a, p.title, p.ref));
    else if (p.kind === 'repair') said.push(t.sort.resRepair(a, p.ref));
    else if (p.kind === 'sale') said.push(t.sort.resSale(a, p.ref));
    else if (p.kind === 'goods') said.push(t.goods.sort.res(a, p.ref));
    else said.push(t.sort.resAccount(a));
  }
  if (!moveTold) {
    const words = moveWords();
    if (words) said.push(words);
  }
  const before = (targets.data?.debt.parts ?? []).reduce((n, p) => n + p.owesTetri, 0);
  // A longer week's extra is owed and paid by the same line: the debt is as the rent leaves it.
  // A shorter week's discount takes off the debt only when the week is in it — from its pay day on.
  const movedWeek = moving?.move;
  const moveOffOwed =
    movedWeek && moveOff > 0 && weekDueOn(movedWeek.startsOn, movedWeek.payOffsetDays) <= today ? Math.min(moveOff, Math.max(0, movedWeek.amountTetri - movedWeek.paidTetri)) : 0;
  const paidOff =
    used.reduce((n, p) => {
      const a = amountOf(p.key);
      if (p.kind === 'fine' || (p.kind === 'rent' && p.carried && value.choice[p.carried.rentalId] === 'carried')) return n;
      return n + (p.owesTetri > 0 ? Math.min(a, p.owesTetri) : a);
    }, 0) + moveOffOwed;
  const after = Math.max(0, before - paidOff);

  const g = answer?.groups;
  const people: { id: string; name: string; sub: string }[] = g
    ? [
        ...g.customers.items.map((c) => ({ id: c.id, name: c.name, sub: c.phone ?? '' })),
        ...g.rentals.items.filter((r) => r.customerId && !g.customers.items.some((c) => c.id === r.customerId)).map((r) => ({ id: r.customerId!, name: r.customer, sub: r.number })),
      ]
    : [];

  return (
    <FormSheet
      title={t.sort.splitTitle(formatGel(total))}
      onClose={onClose}
      value={value}
      initial={initial}
      label={t.sort.split}
      submit={async (key) => {
        if (used.some((p) => p.carried && !value.choice[p.carried.rentalId])) throw new Error(t.sort.splitOldPick);
        const body = used.map((p) => ({ ...p.body, grossTetri: amountOf(p.key) }));
        // The pay day moved (issue #12): the server moves the week and writes the payments in one go.
        const shift =
          moving && chosen && value.move
            ? { rentalId: value.move.rentalId, seq: moving.move!.seq, days: chosen.days, extraTetri: value.move.amount.trim(), reason: value.move.reason.trim() }
            : null;
        const r = await api.post<{ ids: string[]; shift?: { rentalId: string; seq: number } }>(`/api/statement-lines/${line.id}/split`, { parts: body, ...(shift ? { shift } : {}) }, { key });
        const moved = r.shift;
        return {
          toast: {
            // The weekday as a word on its own, Sunday first: «день оплаты — пятница».
            text: moved && value.move ? t.payDayMove.done(r.ids.length, t.calendar.weekdaysIn[Number(value.move.to) % 7]) : t.sort.splitDone(body.length),
            // «Отменить» takes back what the line wrote: its payments, then the move.
            undo: async () => {
              await api.post(`/api/payments/${r.ids[0]}/undo`);
              if (moved) await api.post(`/api/rentals/${moved.rentalId}/weeks/${moved.seq}/shift`, { days: 0, reason: t.payDayMove.undoReason });
            },
          },
        };
      }}
    >
      <p className="split-from">{t.sort.splitFrom(fmtDate(line.occurredOn), t.statements.banks[line.bank])}</p>
      {!value.customer && !value.retail ? (
        <>
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.money.whoIn} aria-label={t.money.whoIn} />
          {/* A day's TBC card line is several purchases of people with no card (ADR-0045 §7). */}
          <button type="button" className="pick-card pick-card-quiet" onClick={() => setValue({ ...initial, retail: true })}>
            <span className="pick-card-main">
              <span className="pick-card-title">{t.goods.sort.retailMode}</span>
              <span className="pick-card-sub">{t.goods.sort.retailHint}</span>
            </span>
          </button>
          <ul className="pick-cards">
            {people.map((c) => (
              <li key={`${c.id}:${c.sub}`}>
                <button type="button" className="pick-card" onClick={() => setValue({ ...initial, customer: { id: c.id, name: c.name } })}>
                  <span className="pick-card-main">
                    <span className="pick-card-title">{c.name}</span>
                    <span className="pick-card-sub">{c.sub}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <div className="split-body">
          <div className="money-who-row split-who">
            <p className="t-h3">{value.customer?.name ?? t.goods.sort.retailMode}</p>
            <button type="button" className="pill pill-sm" onClick={() => setValue(initial)}>
              {t.sort.splitAnother}
            </button>
          </div>
          {targets.failure && <LoadError failure={targets.failure} onRetry={targets.reload} />}
          {!targets.data && !targets.failure && <Skeleton rows={3} />}
          {targets.data && parts.length === 1 && <p className="hint muted">{t.sort.splitNothing}</p>}
          {value.retail && retailGoods.data && retailParts.length === 0 && <p className="hint muted">{t.goods.sort.retailNone}</p>}
          <div className="split-parts">
          {visible.map((p) =>
            p.kind === 'payday' ? (
              <PayDayPart
                key={p.key}
                part={p}
                move={value.move?.rentalId === p.rentalId ? value.move : null}
                planOf={planOf}
                rateTetri={p.rateTetri ?? 0}
                onDay={(to) => chooseDay(p, to)}
                onChange={(patch) => setValue((v) => (v.move ? { ...v, move: { ...v.move, amount: patch.amount ?? v.move.amount, reason: patch.reason ?? v.move.reason } } : v))}
              />
            ) : (
              <div key={p.key} className="split-part">
                <div className="split-part-top">
                  <label className="split-part-name" htmlFor={`split-${p.key}`}>
                    {p.title} {p.ref && <span className="split-part-ref">{p.ref}</span>}
                  </label>
                  <input
                    id={`split-${p.key}`}
                    name={p.key}
                    className="input mono split-amount"
                    inputMode="decimal"
                    value={value.amounts[p.key] ?? ''}
                    placeholder={left > 0 ? formatGel(p.owesTetri > 0 ? Math.min(p.owesTetri, left) : left, { decimals: false }) : ''}
                    onFocus={(e) => takeRest(p, e.currentTarget)}
                    onChange={(e) => setAmount(p.key, e.target.value)}
                  />
                </div>
                {p.carried && (
                  <fieldset className="split-week">
                    <legend>{t.sort.splitWhichWeek}</legend>
                    {(['carried', 'new'] as const).map((c) => {
                      const on = value.choice[p.carried!.rentalId] === c;
                      return (
                        <label key={c} className={`split-radio ${on ? 'on' : ''}`}>
                          <input type="radio" name={`week-${p.carried!.rentalId}`} checked={on} onChange={() => setValue((v) => ({ ...v, choice: { ...v.choice, [p.carried!.rentalId]: c } }))} />
                          <span>
                            {c === 'carried' ? weekText(p.carried!.week) : p.openWeek ? weekText(p.openWeek) : t.sort.splitWeekNewTitle}
                            <small>{c === 'carried' ? t.sort.splitWeekCarried : p.openWeek ? t.sort.splitWeekOpen : t.sort.splitWeekNewSub}</small>
                          </span>
                        </label>
                      );
                    })}
                  </fieldset>
                )}
                {overBy(p) > 0 && <p className="field-err">{t.goods.sort.partOver(formatGel(p.owesTetri))}</p>}
                {p.fineOf && (
                  <Field label={t.sort.splitFineFor} name="fineReason">
                    <input className="input" value={value.reasons[p.fineOf] ?? ''} onChange={(e) => setValue((v) => ({ ...v, reasons: { ...v.reasons, [p.fineOf!]: e.target.value } }))} />
                  </Field>
                )}
              </div>
            ),
          )}
          </div>
          {hidden && (
            <button type="button" className="pill pill-sm split-more" onClick={() => setValue((v) => ({ ...v, more: true }))}>
              {t.sort.splitMore}
            </button>
          )}
          {(targets.data || value.retail) && (
            <div className="split-sum" aria-live="polite">
              <span className="mono">{placedSums.length > 0 ? `${placedSums.map((a) => formatGel(a, { decimals: false })).join(' + ')} = ${formatGel(placed, { decimals: false })}` : ''}</span>
              {left === 0 ? <span className="split-ok">{t.sort.splitAllPlaced}</span> : left > 0 ? <span>{t.sort.splitLeft(formatGel(left))}</span> : <span className="field-err">{t.sort.splitOver(formatGel(-left))}</span>}
            </div>
          )}
          {(targets.data || value.retail) && said.length > 0 && (
            <div className="split-result">
              <b>{t.sort.resTitle}</b>
              <ul>
                {said.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
                {anyOver ? (
                  <li className="field-err">{t.goods.sort.fixOver}</li>
                ) : (
                  targets.data && <li>{after === before ? t.sort.resDebtSame(formatGel(before)) : t.sort.resDebt(formatGel(before), formatGel(after))}</li>
                )}
              </ul>
            </div>
          )}
        </div>
      )}
    </FormSheet>
  );
}

/**
 * «Перенос дня оплаты» — a part of «Разнести» beside the rent (issue #12 of
 * the director, Mika's «А» of 23.10.2026; ADR-0041, addendum): the weekdays
 * Monday to Sunday, the one he pays on now marked «сейчас»; a later one makes
 * his latest week longer, an earlier one shorter. Under the choice, what the
 * week becomes and when he pays next; then the sum — the extra, money of the
 * line, or the discount — and the reason, both filled in and his to change.
 * Shown closed, with why, when the line pays an older week or the week was
 * moved already.
 */
function PayDayPart({
  part,
  move,
  planOf,
  rateTetri,
  onDay,
  onChange,
}: {
  part: SplitPart;
  move: SplitValue['move'];
  planOf: (p: SplitPart, to: number) => PayDayMove;
  rateTetri: number;
  onDay: (to: string) => void;
  onChange: (patch: { amount?: string; reason?: string }) => void;
}) {
  const t = useT();
  const m = part.move!;
  const closed = m.closed;
  const chosen = move ? planOf(part, Number(move.to)) : null;
  // A weekday inside a sentence, Sunday first.
  const weekday = (date: string) => t.calendar.weekdaysIn[isoWeekday(date) % 7];
  const options = t.payDay.days.map((day, i) => {
    const to = i + 1;
    if (to === m.payDay) return { to, label: t.payDayMove.option(day, t.payDayMove.now), off: false };
    const plan = planOf(part, to);
    // A shorter week never ends before today: in the list, not to be chosen.
    return plan.endsBeforeToday ? { to, label: t.payDayMove.tooEarly(day), off: true } : { to, label: t.payDayMove.option(day, t.payDayMove.days(plan.days)), off: false };
  });
  const rate = formatGel(rateTetri, { decimals: false });
  const why = closed === 'older_week_open' ? t.payDayMove.olderOpen : closed === 'week_moved' ? t.payDayMove.moved : undefined;
  return (
    <div className="split-part">
      <div className="split-part-top">
        <span className="split-part-name">
          {part.title} <span className="split-part-ref">{part.ref}</span>
        </span>
      </div>
      {/* Only the move chosen answers to the server's words about the days, its sum and its reason. */}
      <Field label={t.payDay.label} hint={why} name={move ? 'days' : undefined}>
        <select className="input" disabled={!!closed} value={move ? move.to : String(m.payDay)} onChange={(e) => onDay(e.target.value)}>
          {options.map((o) => (
            <option key={o.to} value={String(o.to)} disabled={o.off}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>
      {move && chosen && (
        <>
          <p className="hint">
            {t.payDayMove.plan(
              weekText({ startsOn: m.startsOn, endsOn: m.endsOn }),
              weekText({ startsOn: m.startsOn, endsOn: chosen.plan.endsOn }),
              t.payDayMove.days(chosen.days),
              weekday(chosen.plan.nextDueOn),
              fmtDayMonth(chosen.plan.nextDueOn),
            )}
          </p>
          <Field
            label={chosen.days > 0 ? t.weekShift.extra : t.weekShift.less}
            hint={(chosen.days > 0 ? t.weekShift.extraHint : t.weekShift.lessHint)(rate, Math.abs(chosen.days), formatGel(chosen.plan.suggestedExtraTetri, { decimals: false }))}
            name="extraTetri"
          >
            <input className="input mono" inputMode="decimal" value={move.amount} onChange={(e) => onChange({ amount: e.target.value })} />
          </Field>
          <Field label={t.weekShift.reason} name="reason">
            <input className="input" value={move.reason} onChange={(e) => onChange({ reason: e.target.value })} />
          </Field>
        </>
      )}
    </div>
  );
}

/** "Это не наше" — out of the queue with a reason it must have (§3.2). */
function NotOursSheet({ line, onClose }: { line: SortLine; onClose: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <FormSheet
      title={t.sort.notOursTitle}
      onClose={onClose}
      value={reason}
      initial=""
      label={t.sort.remove}
      submit={async (key) => {
        await api.post(`/api/statement-lines/${line.id}/ignore`, { reason }, { key });
        return { toast: { text: t.sort.notOursDone } };
      }}
    >
      <p className="sort-line-text">
        {line.direction === 'out' ? '−' : '+'}
        {formatGel(line.amountTetri)} · {fmtDate(line.occurredOn)} · {line.payer ?? line.purpose ?? ''}
      </p>
      <Field label={t.sort.notOursReason} hint={t.sort.notOursHint} name="reason">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </FormSheet>
  );
}

interface RuleLine {
  id: string;
  bank: 'bog' | 'tbc' | 'credo';
  occurredOn: string;
  amountTetri: number;
  payer: string | null;
  purpose: string | null;
  rule: string | null;
  reason: Reason | null;
  payment: { id: string; grossTetri: number; number: string | null; rentalId: string | null; saleId: string | null; goodsSaleId?: string | null; customer: string | null } | null;
}

interface AsideLine {
  id: string;
  bank: 'bog' | 'tbc' | 'credo';
  direction: 'in' | 'out';
  occurredOn: string;
  amountTetri: number;
  payer: string | null;
  purpose: string | null;
  raw: string;
  resolution: 'not_ours' | 'company_expense' | 'own_transfer' | string | null;
  /** The rule that answered when the stand did it itself — `own_transfer_auto` (ADR-0028). */
  rule?: string | null;
  /** An expense split into parts (ADR-0030); absent while an older API answers. */
  parts?: { categoryId: string; amountTetri: number }[];
  /** What an expense was for (migration 0046); absent while an older API answers. */
  categoryId?: string | null;
  reason: string | null;
  by: string | null;
  on: string | null;
}

/** "Отложено": the lines taken out of the queue, each with why and by whom; "Вернуть в очередь" puts one back. */
export function AsidePage() {
  const t = useT();
  const { data, failure, reload } = useLoad<{ days: number; lines: AsideLine[] }>('/api/statement-lines/aside');
  const cats = useExpenseCategories(true, true);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  return (
    <>
      <PageHead title={t.sort.asideTitle} sub={data ? t.sort.asideSub(data.lines.length) : undefined} />
      {!data && <Skeleton rows={4} />}
      {data && data.lines.length === 0 && <p className="muted">{t.sort.asideEmpty}</p>}
      {data?.lines.map((l) => <AsideCard key={l.id} line={l} cats={cats} />)}
    </>
  );
}

function AsideCard({ line, cats }: { line: AsideLine; cats: Categories }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const why =
    line.resolution === 'company_expense'
      ? line.parts && line.parts.length > 0
        ? t.exp.asideSplit(line.parts.map((p) => `${cats.nameOf(p.categoryId)} ${formatGel(p.amountTetri)}`).join(' · '))
        : line.categoryId
        ? t.exp.asideExpense(cats.nameOf(line.categoryId))
        : t.sort.asideExpense
      : line.resolution === 'own_transfer'
        ? line.rule === 'own_transfer_auto'
          ? t.exp.ownAuto(ownWhy(t, line.reason))
          : t.exp.asideOwn
        : line.resolution === 'shareholder'
          ? t.exp.asideShareholder
          : t.sort.asideNotOurs(line.reason ?? '');
  return (
    <article className="sort-line">
      <div className="sort-line-head">
        <span className={`t-money ${line.direction === 'out' ? 'amt-out' : 'amt-in'}`}>
          {line.direction === 'out' ? '−' : '+'}
          {formatGel(line.amountTetri)}
        </span>
        <span className="sort-line-meta">
          {fmtDate(line.occurredOn)} · {t.statements.banks[line.bank]}
        </span>
      </div>
      <p className="sort-line-text">{[line.payer, line.purpose].filter(Boolean).join(' · ') || line.raw}</p>
      <p className="sort-reason">
        {why}
        {line.by && line.on && <span className="muted"> · {t.sort.asideBy(line.by, fmtDate(line.on))}</span>}
      </p>
      <div className="sort-actions">
        <button
          type="button"
          className="pill pill-sm"
          disabled={op.state === 'busy'}
          onClick={async () => {
            const res = await op.run((key) => api.post(`/api/statement-lines/${line.id}/restore`, {}, { key }));
            if (res.ok) toast({ text: t.sort.restored });
          }}
        >
          {t.sort.restore}
        </button>
      </div>
    </article>
  );
}

/** Why the stand found a line to be money between the company's accounts, from the reason it stored (ADR-0028). */
function ownWhy(t: ReturnType<typeof useT>, reason: string | null): string {
  const [kind, a, b] = (reason ?? '').split(':');
  const bank = (code: string | undefined) => t.statements.banks[(code === 'bg' ? 'bog' : code === 'tb' ? 'tbc' : code) as 'bog' | 'tbc'] ?? code ?? '';
  if (kind === 'account') return t.exp.ownWhyAccount(bank(a));
  if (kind === 'pair') return t.exp.ownWhyPair(bank(a), fmtDate(reason!.slice(`pair:${a}:`.length)));
  return t.exp.ownWhyCompany;
}

/** "Разобрано правилами": what the rules attached, with why; "Отвязать" puts it back (§3.2, B2-07). */
export function RulesPage() {
  const t = useT();
  const reason = useReasonText();
  const { data, failure, reload } = useLoad<{ days: number; lines: RuleLine[]; expenses?: ExpenseRuleLine[] }>('/api/statement-lines/by-rules');
  const cats = useExpenseCategories(true, true);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  const expenses = data?.expenses ?? [];
  return (
    <>
      <PageHead title={t.sort.rulesTitle} sub={data ? t.sort.rulesSub(data.lines.length + expenses.length) : undefined} />
      {expenses.length > 0 && (
        <section>
          <h2 className="sort-group t-h3">
            {t.exp.rulesExpenses} <span className="muted mono">{expenses.length}</span>
          </h2>
          {expenses.map((l) => (
            <ExpenseRuleCard key={l.id} line={l} cats={cats} bank={t.statements.banks[l.bank]} onDone={reload} />
          ))}
        </section>
      )}
      {!data && <Skeleton rows={4} />}
      {data?.lines.map((l) => (
        <RuleCard
          key={l.id}
          line={l}
          text={
            l.reason
              ? reason(l.reason, l)
              : l.rule === 'bank_deposit'
                ? t.sort.reason.bank_deposit
                : l.payment
                  ? t.sort.reason.recorded(l.payment.number ? `, ${l.payment.number}` : '')
                  : ''
          }
        />
      ))}
    </>
  );
}

function RuleCard({ line, text }: { line: RuleLine; text: string }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const record = line.payment?.rentalId
    ? `/rentals/${line.payment.rentalId}`
    : line.payment?.saleId
      ? `/sales/${line.payment.saleId}`
      : line.payment?.goodsSaleId
        ? `/sales/goods/${line.payment.goodsSaleId}`
        : null;
  return (
    <article className="sort-line">
      <div className="sort-line-head">
        <span className="t-money amt-in">+{formatGel(line.amountTetri)}</span>
        <span className="sort-line-meta">
          {fmtDate(line.occurredOn)} · {t.statements.banks[line.bank]}
        </span>
      </div>
      <p className="sort-line-text">{[line.payer, line.purpose].filter(Boolean).join(' · ')}</p>
      <p className="sort-reason">{text}</p>
      <div className="sort-actions">
        {line.payment && (
          <Link className="pill pill-sm" to={`/money/payments/${line.payment.id}`}>
            {t.sort.open}
          </Link>
        )}
        {record && (
          <Link className="pill pill-sm" to={record}>
            {line.payment?.number}
          </Link>
        )}
        <button
          type="button"
          className="pill pill-sm"
          disabled={op.state === 'busy'}
          onClick={async () => {
            const res = await op.run((key) => api.post(`/api/statement-lines/${line.id}/unlink`, {}, { key }));
            if (res.ok) toast({ text: t.sort.unlinked });
          }}
        >
          {t.sort.unlink}
        </button>
      </div>
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
    </article>
  );
}
