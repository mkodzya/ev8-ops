import { formatGel, SEARCH_MIN } from '@ev8/shared';
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
import { fmtDate } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';

interface Reason {
  code: 'name' | 'card_pickup' | 'amount_week' | 'amount' | 'recorded' | 'bank_deposit';
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
  channel: 'transfer' | 'acquiring';
  payer: string | null;
  purpose: string | null;
  raw: string;
  cashDeposit: boolean;
  group: 'recorded' | 'suggested' | 'none';
  recorded: Suggestion[];
  suggestions: Suggestion[];
}
interface Queue {
  counts: { in: number; out: number };
  byRulesWeek: number;
  lines: SortLine[];
}

/** The reason under a hint, in words (§3.2 "причина словами"). */
export function useReasonText() {
  const t = useT();
  return (r: Reason, line?: { amountTetri: number }): string => {
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
      {data && data.lines.length === 0 && <AllSorted byRules={data.byRulesWeek} />}
      {data &&
        groups.map(
          ({ g, lines }) =>
            lines.length > 0 && (
              <section key={g}>
                <h2 className="sort-group t-h3">
                  {title[g]} <span className="muted mono">{lines.length}</span>
                </h2>
                {lines.map((l) => (
                  <LineCard key={l.id} line={l} onOther={() => setOther(l)} onNotOurs={() => setNotOurs(l)} />
                ))}
              </section>
            ),
        )}
      {data && data.lines.length > 0 && (
        <p className="sort-foot">
          {t.sort.byRules(data.byRulesWeek)} · <Link to="/money/sort/rules">{t.sort.check}</Link>
        </p>
      )}
      {other && <OtherSheet line={other} onClose={() => setOther(null)} />}
      {notOurs && <NotOursSheet line={notOurs} onClose={() => setNotOurs(null)} />}
    </>
  );
}

function AllSorted({ byRules }: { byRules: number }) {
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
      </p>
    </div>
  );
}

/** One line: its amount, day, bank, the bank's words — and the answers (§3.2). */
function LineCard({ line, onOther, onNotOurs }: { line: SortLine; onOther: () => void; onNotOurs: () => void }) {
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
        <RowMenu actions={[{ key: 'not', label: t.sort.notOurs, onPick: onNotOurs }]} />
      </div>
      <p className="sort-line-text">{[line.payer, line.purpose].filter(Boolean).join(' · ') || line.raw}</p>

      {line.group === 'recorded' &&
        line.recorded.map((p) => (
          <div key={p.id} className="sort-actions">
            <p className="sort-reason">
              {(line.direction === 'out' ? t.sort.recordedOut : t.sort.recordedText)(
                [formatGel(p.amountTetri ?? 0), fmtDate(p.occurredOn), p.customer, p.number].filter(Boolean).join(', '),
              )}
            </p>
            <button type="button" className="pill pill-sm pill-accent" disabled={busy} onClick={() => act('link', { paymentId: p.id }, { text: t.sort.linked })}>
              {busy ? t.sort.attaching : line.direction === 'out' ? t.sort.yesShe : t.sort.yes}
            </button>
          </div>
        ))}

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

      {(line.group === 'none' || line.group === 'recorded') && (
        <div className="sort-actions">
          {line.direction === 'in' ? (
            <button type="button" className={`pill pill-sm ${line.group === 'none' ? 'pill-accent' : ''}`} disabled={busy} onClick={onOther}>
              {line.group === 'recorded' ? t.sort.no : t.sort.other}
            </button>
          ) : (
            <button type="button" className="pill pill-sm" disabled={busy} onClick={() => act('expense', {}, { text: t.sort.expenseDone })}>
              {t.sort.expense}
            </button>
          )}
        </div>
      )}
      {line.direction === 'out' && line.group === 'suggested' && (
        <div className="sort-actions">
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => act('expense', {}, { text: t.sort.expenseDone })}>
            {t.sort.expense}
          </button>
        </div>
      )}
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
    </article>
  );
}

interface SearchAnswer {
  groups: {
    customers: { items: { id: string; name: string; phone: string | null }[] };
    rentals: { items: { id: string; number: string; customer: string; status: string }[] };
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
      title={t.sort.whereTo(formatGel(line.amountTetri))}
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

/** "Разобрано правилами": what the rules attached, with why; "Отвязать" puts it back (§3.2, B2-07). */
export function RulesPage() {
  const t = useT();
  const reason = useReasonText();
  const { data, failure, reload } = useLoad<{ days: number; lines: RuleLine[] }>('/api/statement-lines/by-rules');
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  return (
    <>
      <PageHead title={t.sort.rulesTitle} sub={data ? t.sort.rulesSub(data.lines.length) : undefined} />
      {!data && <Skeleton rows={4} />}
      {data?.lines.map((l) => (
        <RuleCard key={l.id} line={l} text={l.reason ? reason(l.reason, l) : l.payment ? t.sort.reason.recorded(l.payment.number ? `, ${l.payment.number}` : '') : ''} />
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
