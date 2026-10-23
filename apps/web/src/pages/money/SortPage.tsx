import { formatGel, parseGel, SEARCH_MIN } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { LoadError } from '../../components/LoadError.js';
import { RowMenu } from '../../components/RowMenu.js';
import { PageHead } from '../../components/ui.js';
import { Field } from '../../components/Wizard.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { FormSheet } from '../../ds/form/Form.js';
import { useOperation } from '../../ds/form/operation.js';
import '../../ds/money/money.css';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { fmtDate, fmtDayMonth } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { chargeWords } from '../../lib/charges.js';
import { useLoad } from '../../lib/use.js';
import { ExpenseAnswers, ExpenseRuleCard, useExpenseCategories, type Categories, type ExpenseRuleLine } from './ExpenseAnswers.js';

interface Reason {
  code: 'name' | 'card_pickup' | 'amount_week' | 'amount' | 'recorded' | 'bank_deposit';
  /** The rental under this hint was carried over on or after the line's day: its money may be counted already. */
  transferredOn?: string;
  name?: string;
  number?: string;
  debtTetri?: number;
  grossTetri?: number;
  feeTetri?: number;
  netTetri?: number;
  day?: string;
}
interface Suggestion {
  kind: 'rental' | 'sale' | 'customer' | 'payment' | 'bank_deposit';
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
      {other && <OtherSheet line={other} onClose={() => setOther(null)} />}
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
    const body = s.kind === 'rental' ? { rentalId: s.id } : s.kind === 'sale' ? { saleId: s.id } : { customerId: s.id };
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
  };
}

/** "Другое": attach to any record, by number, name or phone — not a cut list (§3.2, B2-05). */
function OtherSheet({ line, onClose }: { line: SortLine; onClose: () => void }) {
  const t = useT();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState<{ body: Record<string, string>; label: string } | null>(null);
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
  const options: { body: Record<string, string>; label: string; sub: string }[] = g
    ? [
        ...g.rentals.items.map((r) => ({ body: { rentalId: r.id }, label: r.number, sub: r.customer })),
        ...g.sales.items.filter((x) => x.status === 'active').map((x) => ({ body: { saleId: x.id }, label: x.number, sub: x.customer })),
        ...g.customers.items.map((c) => ({ body: { customerId: c.id }, label: `${t.money.toAccount} · ${c.name}`, sub: t.money.toAccountHint })),
      ]
    : [];
  return (
    <FormSheet
      title={t.sort.whereTo(formatGel(line.channel === 'acquiring' && line.grossTetri != null ? line.grossTetri : line.amountTetri))}
      onClose={onClose}
      value={pick}
      initial={null}
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
            <button type="button" className={`pick-card ${pick?.label === o.label ? 'on' : ''}`} onClick={() => setPick({ body: o.body, label: o.label })}>
              <span className="pick-card-main">
                <span className="pick-card-title">{o.label}</span>
                <span className="pick-card-sub">{o.sub}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </FormSheet>
  );
}

interface Week {
  startsOn: string | null;
  endsOn: string | null;
}
interface Targets {
  debt: { parts: { kind: 'rent' | 'deposit' | 'charge' | 'sale' | 'service'; id: string; owesTetri: number }[] };
  rentals: { id: string; number: string; status: string; model: string | null; transferredOn?: string | null; firstOpenWeek?: Week | null }[];
  sales: { id: string; number: string; nextTetri: number }[];
  repairs: { id: string; number: string }[];
  /** Open fines and other charges, each its own part (ADR-0023). */
  charges?: { id: string; rentalId: string; kind: string; note: string | null; openTetri: number }[];
  /** Weeks carried over as paid with no bank money behind them yet (ADR-0023). */
  carriedWeeks?: { id: string; rentalId: string; seq: number; startsOn: string; endsOn: string; amountTetri: number }[];
}

/** One place the line's money can go. */
interface SplitPart {
  key: string;
  kind: 'rent' | 'fine' | 'charge' | 'repair' | 'sale' | 'account';
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
}
interface SplitValue {
  customer: { id: string; name: string } | null;
  amounts: Record<string, string>;
  /** Per rental: the old line's rent is the carried week's money, or new money. */
  choice: Record<string, 'carried' | 'new'>;
  /** Per rental: what a new fine is for. */
  reasons: Record<string, string>;
  /** "+ ещё" opened. */
  more: boolean;
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
  const initial: SplitValue = { customer: null, amounts: {}, choice: {}, reasons: {}, more: false };
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
            },
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
        ...targets.data.sales.map((x): SplitPart => ({ key: `s:${x.id}`, kind: 'sale', title: t.money.kinds.sale, ref: x.number, body: { saleId: x.id }, owesTetri: owes(['sale'], x.id), extra: true })),
        { key: `c:${value.customer!.id}`, kind: 'account', title: t.money.toAccount, ref: '', body: { customerId: value.customer!.id }, owesTetri: 0, extra: true },
      ]
    : [];
  const amountOf = (key: string) => parseGel(value.amounts[key] ?? '') ?? 0;
  const placed = parts.reduce((n, p) => n + amountOf(p.key), 0);
  const left = total - placed;
  const setAmount = (key: string, text: string) => setValue((v) => ({ ...v, amounts: { ...v.amounts, [key]: text } }));
  // An empty sum takes the rest when it is touched, selected so that typing replaces it.
  const takeRest = (p: SplitPart, input: HTMLInputElement) => {
    if ((value.amounts[p.key] ?? '').trim() !== '' || left <= 0) return;
    const take = p.owesTetri > 0 ? Math.min(p.owesTetri, left) : left;
    setAmount(p.key, (take / 100).toFixed(2));
    window.setTimeout(() => input.select(), 0);
  };
  const visible = parts.filter((p) => !p.extra || value.more || amountOf(p.key) > 0);
  const hidden = parts.some((p) => p.extra && !visible.includes(p));

  // What will be written, said in words, and what the customer will owe after.
  const used = parts.filter((p) => amountOf(p.key) > 0);
  const said = used.map((p) => {
    const a = formatGel(amountOf(p.key));
    if (p.kind === 'rent' && p.carried && value.choice[p.carried.rentalId] === 'carried') return t.sort.resCarried(a, weekText(p.carried.week), p.ref);
    if (p.kind === 'rent') return p.openWeek ? t.sort.resRent(a, p.ref, weekText(p.openWeek)) : t.sort.resRentAhead(a, p.ref);
    if (p.kind === 'fine') return t.sort.resFine(a, (value.reasons[p.fineOf!] ?? '').trim() || '…', p.ref);
    if (p.kind === 'charge') return t.sort.resCharge(a, p.title, p.ref);
    if (p.kind === 'repair') return t.sort.resRepair(a, p.ref);
    if (p.kind === 'sale') return t.sort.resSale(a, p.ref);
    return t.sort.resAccount(a);
  });
  const before = (targets.data?.debt.parts ?? []).reduce((n, p) => n + p.owesTetri, 0);
  const paidOff = used.reduce((n, p) => {
    const a = amountOf(p.key);
    if (p.kind === 'fine' || (p.kind === 'rent' && p.carried && value.choice[p.carried.rentalId] === 'carried')) return n;
    return n + (p.owesTetri > 0 ? Math.min(a, p.owesTetri) : a);
  }, 0);
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
        const r = await api.post<{ ids: string[] }>(`/api/statement-lines/${line.id}/split`, { parts: body }, { key });
        return { toast: { text: t.sort.splitDone(body.length), undo: () => api.post(`/api/payments/${r.ids[0]}/undo`) } };
      }}
    >
      <p className="split-from">{t.sort.splitFrom(fmtDate(line.occurredOn), t.statements.banks[line.bank])}</p>
      {!value.customer ? (
        <>
          <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.money.whoIn} aria-label={t.money.whoIn} />
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
            <p className="t-h3">{value.customer.name}</p>
            <button type="button" className="pill pill-sm" onClick={() => setValue(initial)}>
              {t.sort.splitAnother}
            </button>
          </div>
          {targets.failure && <LoadError failure={targets.failure} onRetry={targets.reload} />}
          {!targets.data && !targets.failure && <Skeleton rows={3} />}
          {targets.data && parts.length === 1 && <p className="hint muted">{t.sort.splitNothing}</p>}
          <div className="split-parts">
          {visible.map((p) => (
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
              {p.fineOf && (
                <Field label={t.sort.splitFineFor} name="fineReason">
                  <input className="input" value={value.reasons[p.fineOf] ?? ''} onChange={(e) => setValue((v) => ({ ...v, reasons: { ...v.reasons, [p.fineOf!]: e.target.value } }))} />
                </Field>
              )}
            </div>
          ))}
          </div>
          {hidden && (
            <button type="button" className="pill pill-sm split-more" onClick={() => setValue((v) => ({ ...v, more: true }))}>
              {t.sort.splitMore}
            </button>
          )}
          {targets.data && (
            <div className="split-sum" aria-live="polite">
              <span className="mono">{used.length > 0 ? `${used.map((p) => formatGel(amountOf(p.key), { decimals: false })).join(' + ')} = ${formatGel(placed, { decimals: false })}` : ''}</span>
              {left === 0 ? <span className="split-ok">{t.sort.splitAllPlaced}</span> : left > 0 ? <span>{t.sort.splitLeft(formatGel(left))}</span> : <span className="field-err">{t.sort.splitOver(formatGel(-left))}</span>}
            </div>
          )}
          {targets.data && said.length > 0 && (
            <div className="split-result">
              <b>{t.sort.resTitle}</b>
              <ul>
                {said.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
                <li>{after === before ? t.sort.resDebtSame(formatGel(before)) : t.sort.resDebt(formatGel(before), formatGel(after))}</li>
              </ul>
            </div>
          )}
        </div>
      )}
    </FormSheet>
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
  payment: { id: string; grossTetri: number; number: string | null; rentalId: string | null; saleId: string | null; customer: string | null } | null;
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
  const record = line.payment?.rentalId ? `/rentals/${line.payment.rentalId}` : line.payment?.saleId ? `/sales/${line.payment.saleId}` : null;
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
