import { formatGel, SEARCH_MIN } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { LoadError } from '../../components/LoadError.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { FormSheet, useFieldError } from '../../ds/form/Form.js';
import { useOperation } from '../../ds/form/operation.js';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { fmtDate, fmtDayMonth } from '../../format.js';
import { useLocale, useT } from '../../i18n/index.js';
import { chargeWords } from '../../lib/charges.js';
import { useLoad } from '../../lib/use.js';
import type { Categories, ExpenseCategory } from './ExpenseAnswers.js';

// Money coming in, answered by its kind first (issue #13 of the director,
// 25.10.2026; ADR-0046) — the way money going out has been since ADR-0027.
// Under a line, the kinds: the customers' money (rent, a deposit, a moped
// sale, goods, a repair or a charge, an advance), then what is no customer's
// (between own accounts, a founder's contribution, cash to the bank, other
// income ▸), «Не наше», and «Несколько услуг». No answer is offered above the
// kinds in one tap: a kind that holds records opens the panel beside the line,
// its probable records first — the payer's name, or the payer remembered —
// then the rest, and the choice is the person's. Under the choice, what will
// be written and the customer's debt before and after.

export type IncomeKind = 'rental' | 'deposit' | 'sale' | 'goods' | 'repair' | 'customer' | 'bank_deposit';

export interface InLine {
  id: string;
  bank: 'bog' | 'tbc' | 'credo';
  occurredOn: string;
  amountTetri: number;
  grossTetri: number | null;
  channel: 'transfer' | 'acquiring';
  /** The payer as «Запомнить для „…“» says him; absent while an older API answers. */
  payerLabel?: string | null;
  canRemember?: boolean;
  /** The payer is his name with the account he sends from (the Bank of Georgia): another account is another payer. */
  payerByAccount?: boolean;
  /** `namesAnother`: the line names another customer than the one remembered — the rule kept quiet over it. */
  remembered?: {
    kind: 'customer' | 'own_transfer' | 'founder_equity' | 'other_income';
    customerId: string | null;
    customerName?: string | null;
    categoryId: string | null;
    namesAnother?: boolean;
  } | null;
}

/** The categories of other income (migration 0069), each one's name in the screen's language. */
export function useIncomeCategories(load: boolean, all = false): Categories {
  const { locale } = useLocale();
  const { data } = useLoad<{ categories: ExpenseCategory[] }>(load ? `/api/income-categories${all ? '?all=1' : ''}` : null);
  const rows = data?.categories ?? [];
  const byId = new Map(rows.map((c) => [c.id, c]));
  const name = (c: ExpenseCategory) => (locale === 'ka' ? c.nameKa : locale === 'en' ? c.nameEn : null) || c.nameRu;
  return {
    list: rows.filter((c) => !c.archived),
    nameOf: (id) => {
      const c = id ? byId.get(id) : undefined;
      return c ? name(c) : '';
    },
  };
}

/** What the line stands for: a card line the customer's sum, any other line its amount. */
export const lineSum = (l: { channel: string; grossTetri: number | null; amountTetri: number }) => (l.channel === 'acquiring' && l.grossTetri != null ? l.grossTetri : l.amountTetri);

/** The kinds that hold records, and so open the panel; customers' money first. */
const PANEL: IncomeKind[] = ['rental', 'deposit', 'sale', 'goods', 'repair', 'customer'];
/** Where «Запомнить» means «this payer is this customer». */
const REMEMBERS_CUSTOMER = new Set<IncomeKind>(['rental', 'deposit', 'customer']);

/** The answers under a line coming in. */
export function IncomeAnswers({ line, cats, onSplit, onNotOurs }: { line: InLine; cats: Categories; onSplit: () => void; onNotOurs: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const busy = op.state === 'busy';
  const [sheet, setSheet] = useState<IncomeKind | null>(null);
  const [other, setOther] = useState(false);
  const [pick, setPick] = useState<string | null>(line.remembered?.kind === 'other_income' ? line.remembered.categoryId : null);
  const canRemember = !!line.canRemember && !!line.payerLabel;
  const [remember, setRemember] = useState(false);
  const kindWords: Record<IncomeKind, string> = {
    rental: t.inc.kinds.rental,
    deposit: t.inc.kinds.deposit,
    sale: t.inc.kinds.sale,
    goods: t.inc.kinds.goods,
    repair: t.inc.kinds.repair,
    customer: t.inc.kinds.customer,
    bank_deposit: t.inc.kinds.bank,
  };
  const restore = () => api.post(`/api/statement-lines/${line.id}/restore`, {});
  /**
   * One tap, one answer: a second tap does nothing (B2-02). Undone, the rule
   * remembered with it goes too, with the lines this tap sorted — no others.
   */
  const answer = async (path: string, body: Record<string, unknown>, text: (also: number) => string) => {
    const res = await op.run((key) => api.post<{ ruleId?: string; alsoSorted?: string[] }>(`/api/statement-lines/${line.id}/${path}`, body, { key }), `${path}:${JSON.stringify(body)}`);
    if (!res.ok) return;
    const ruleId = res.value.ruleId;
    const sorted = res.value.alsoSorted ?? [];
    toast({
      text: text(sorted.length),
      undo: async () => {
        await restore();
        if (ruleId) await api.post(`/api/payer-rules/${ruleId}/undo`, { lines: sorted });
      },
    });
  };
  const keep = remember && canRemember;
  return (
    <>
      {/* Two rows: the customers' money, then what is no customer's and «Несколько услуг». */}
      <div className="inc-kinds">
        <div className="sort-actions">
          {PANEL.map((k) => (
            <button key={k} type="button" className="pill pill-sm" disabled={busy} onClick={() => setSheet(k)}>
              {kindWords[k]}
            </button>
          ))}
        </div>
        <div className="sort-actions">
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => void answer('own-transfer', { remember: keep }, (n) => t.exp.ownTransferDone + t.inc.alsoSorted(n))}>
            {t.inc.kinds.own}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => void answer('founder-equity', { remember: keep }, (n) => t.inc.founderDone + t.inc.alsoSorted(n))}>
            {t.inc.kinds.founder}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => setSheet('bank_deposit')}>
            {t.inc.kinds.bank}
          </button>
          <button type="button" className={`pill pill-sm ${other ? 'on' : ''}`} disabled={busy} onClick={() => setOther(!other)} aria-expanded={other}>
            {t.inc.kinds.other} {other ? '▾' : '▸'}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={onNotOurs}>
            {t.sort.notOurs}
          </button>
          <button type="button" className="pill pill-sm inc-several" disabled={busy} onClick={onSplit}>
            {t.inc.several}
          </button>
        </div>
      </div>
      {canRemember && (
        <label className="check-row check-row-quiet">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          <span>{t.inc.remember(line.payerLabel!)}</span>
        </label>
      )}
      {keep && line.payerByAccount && <p className="hint muted">{t.inc.rememberAccount}</p>}
      {other && (
        <div className="exp-panel">
          <p className="hint muted">{t.inc.otherWhat}</p>
          <div className="chips" role="radiogroup" aria-label={t.inc.otherWhat}>
            {cats.list.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={pick === c.id} className={`pill pill-sm ${pick === c.id ? 'on' : ''}`} onClick={() => setPick(c.id)}>
                {cats.nameOf(c.id)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pill pill-sm pill-accent pill-wide"
            disabled={busy || !pick}
            onClick={() => pick && void answer('other-income', { categoryId: pick, remember: keep }, (n) => t.inc.otherDone(cats.nameOf(pick)) + t.inc.alsoSorted(n))}
          >
            {pick ? t.inc.otherSave(cats.nameOf(pick)) : t.exp.chooseFirst}
          </button>
        </div>
      )}
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
      {sheet && (
        <KindSheet
          line={line}
          kind={sheet}
          title={kindWords[sheet]}
          remember={REMEMBERS_CUSTOMER.has(sheet) && keep}
          canRemember={REMEMBERS_CUSTOMER.has(sheet) && canRemember}
          onClose={() => setSheet(null)}
          onSplit={() => {
            setSheet(null);
            onSplit();
          }}
        />
      )}
    </>
  );
}

/** One record the panel offers (`/api/statement-lines/:id/options`). */
interface Option {
  key: string;
  target: Record<string, string>;
  number: string | null;
  title: string;
  facts: string[];
  customerId: string | null;
  status: string | null;
  owesTetri: number;
  customerDebtTetri: number | null;
  probable: 'name' | 'rule' | null;
  fits: boolean;
  plan?: ({ kind: 'deposit'; tetri: number } | { kind: 'week'; tetri: number; startsOn: string; endsOn: string; full: boolean } | { kind: 'charge'; tetri: number; charge: string } | { kind: 'ahead'; tetri: number })[];
  payDay?: number | null;
  transferredOn?: string | null;
  extraTetri?: number;
  day?: string | null;
  retail?: boolean;
  charge?: { kind: string; note: string | null };
}

/** «Сдача в банк» with nothing entered before: a new «Внёс в банк» made of the line. */
const NEW_DEPOSIT = '__new';

/**
 * The panel beside the line once its kind is chosen: a search, the probable
 * records with why, then the rest; under the choice, what will be written and
 * the customer's debt before and after.
 */
function KindSheet({
  line,
  kind,
  title,
  remember,
  canRemember,
  onClose,
  onSplit,
}: {
  line: InLine;
  kind: IncomeKind;
  title: string;
  remember: boolean;
  canRemember: boolean;
  onClose: () => void;
  onSplit: () => void;
}) {
  const t = useT();
  const sum = lineSum(line);
  const [q, setQ] = useState('');
  const [asked, setAsked] = useState('');
  const [pick, setPick] = useState<Option | null>(null);
  const [keep, setKeep] = useState(remember);
  useEffect(() => {
    const text = q.trim();
    const id = window.setTimeout(() => setAsked(text.length >= SEARCH_MIN ? text : ''), 250);
    return () => window.clearTimeout(id);
  }, [q]);
  const { data, failure, reload } = useLoad<{ options: Option[] }>(`/api/statement-lines/${line.id}/options?kind=${kind}${asked ? `&q=${encodeURIComponent(asked)}` : ''}`);
  const options = data?.options ?? [];
  const probable = options.filter((o) => o.probable);
  const rest = options.filter((o) => !o.probable);
  const g = (n: number) => formatGel(n);
  const weekday = (iso: number) => t.calendar.weekdaysIn[iso % 7];
  // A goods sale, a repair or a charge takes no more than it waits for: the
  // server refuses the rest (ADR-0045 §7; review of 25.10.2026), so the card
  // and the panel say so before the line is sent.
  const capped = kind === 'goods' || kind === 'repair';
  const waitsLess = (o: Option) => capped && sum > o.owesTetri;
  const less = (o: Option) => (waitsLess(o) ? t.goods.sort.lessThanLine : null);

  const subOf = (o: Option): string => {
    const owes = o.owesTetri > 0 ? t.inc.owes(g(o.owesTetri)) : t.inc.noDebt;
    switch (kind) {
      case 'rental':
        return [...o.facts, owes, o.payDay ? t.inc.payDay(weekday(o.payDay)) : null].filter(Boolean).join(' · ');
      case 'deposit':
        return [...o.facts, t.inc.depositLeft(g(o.extraTetri ?? 0))].join(' · ');
      case 'sale':
        return [...o.facts, o.extraTetri ? t.inc.nextPayment(g(o.extraTetri), fmtDayMonth(o.day)) : null, owes].filter(Boolean).join(' · ');
      case 'goods':
        return [o.retail ? t.goods.retail : null, ...o.facts, t.goods.card.waits(g(o.owesTetri)), o.day ? t.inc.soldOn(fmtDayMonth(o.day)) : null, less(o)].filter(Boolean).join(' · ');
      case 'repair':
        return o.charge
          ? [chargeWords(t, o.charge.kind, o.charge.note), ...o.facts, owes, o.day ? t.inc.chargeFrom(fmtDayMonth(o.day)) : null, less(o)].filter(Boolean).join(' · ')
          : [t.money.kinds.service, ...o.facts, owes, o.day ? t.inc.repairDone(fmtDayMonth(o.day)) : null, less(o)].filter(Boolean).join(' · ');
      case 'customer':
        return [o.facts.length ? o.facts.join(' · ') : null, o.customerDebtTetri ? t.inc.owes(g(o.customerDebtTetri)) : t.inc.noDebt].filter(Boolean).join(' · ');
      case 'bank_deposit':
        return [t.statements.banks[o.facts[0] as 'bog' | 'tbc' | 'credo'] ?? o.facts[0], t.inc.bankDepositBy(o.title, fmtDate(o.day))].join(' · ');
    }
  };
  const titleOf = (o: Option) => (kind === 'bank_deposit' ? g(o.extraTetri ?? 0) : [o.number, o.title || (o.retail ? t.goods.retail : '')].filter(Boolean).join(' · '));
  const label = (o: Option) => o.number ?? o.title;

  // What will be written, in words.
  const said: string[] = [];
  if (pick) {
    const a = g(sum);
    const r = pick.number ?? '';
    if ((kind === 'rental' || kind === 'deposit') && pick.plan) {
      for (const p of pick.plan) {
        if (p.kind === 'deposit') said.push(t.inc.res.deposit(g(p.tetri), r));
        else if (p.kind === 'week') said.push((p.full ? t.inc.res.week : t.inc.res.weekPart)(g(p.tetri), r, `${fmtDayMonth(p.startsOn)}–${fmtDayMonth(p.endsOn)}`));
        else if (p.kind === 'charge') said.push(t.inc.res.charge(g(p.tetri), r));
        else said.push(t.inc.res.ahead(g(p.tetri), r));
      }
    } else if (kind === 'sale') said.push(t.sort.resSale(a, r));
    else if (kind === 'goods') said.push(t.goods.sort.res(a, r));
    else if (kind === 'repair') said.push(pick.charge ? t.sort.resCharge(a, chargeWords(t, pick.charge.kind, pick.charge.note), r) : t.sort.resRepair(a, r));
    else if (kind === 'customer') said.push(t.sort.resAccount(a));
    else if (kind === 'bank_deposit') said.push(t.inc.res.bank(a));
  }
  const before = pick?.customerDebtTetri ?? null;
  const paidOff = pick ? (kind === 'customer' ? sum : Math.min(sum, pick.owesTetri)) : 0;
  const after = before != null ? Math.max(0, before - paidOff) : null;
  const over = !!pick && waitsLess(pick);
  // The record in the warning: a charge by its words and its rental.
  const overWhat = pick ? (pick.charge ? [chargeWords(t, pick.charge.kind, pick.charge.note), pick.number].filter(Boolean).join(' · ') : (pick.number ?? '')) : '';

  const card = (o: Option) => (
    <li key={o.key}>
      <button type="button" className={`pick-card ${pick?.key === o.key ? 'on' : ''}`} onClick={() => setPick(o)}>
        <span className="pick-card-main">
          <span className="pick-card-title">
            {titleOf(o)}
            {o.probable && <span className="inc-why"> · {o.probable === 'rule' ? t.inc.whyRule(line.payerLabel ?? '') : t.inc.whyName}</span>}
          </span>
          <span className={`pick-card-sub ${waitsLess(o) ? 'warn-text' : ''}`}>{subOf(o)}</span>
        </span>
      </button>
    </li>
  );

  return (
    <FormSheet
      title={t.inc.panelTitle(title, g(sum))}
      onClose={onClose}
      value={pick?.key ?? null}
      initial={null}
      fieldOf={{ goods_over_open: 'goodsSaleId', charge_over_open: 'chargeId', over_open: 'serviceJobId' }}
      label={pick ? (pick.key === NEW_DEPOSIT ? t.inc.newBankDeposit : t.inc.attach(label(pick))) : t.inc.choose}
      submit={async (key) => {
        if (!pick) throw new Error(t.inc.choose);
        if (kind === 'bank_deposit') {
          await api.post(`/api/statement-lines/${line.id}/bank-deposit`, pick.key === NEW_DEPOSIT ? {} : { bankDepositId: pick.target.bankDepositId }, { key });
          return { toast: { text: t.sort.linked } };
        }
        const r = await api.post<{ id: string; ruleId?: string; alsoSorted?: string[] }>(`/api/statement-lines/${line.id}/assign`, { ...pick.target, ...(keep && canRemember ? { remember: true } : {}) }, { key });
        return {
          toast: {
            text: t.sort.attached(label(pick)) + t.inc.alsoSorted(r.alsoSorted?.length ?? 0),
            undo: async () => {
              await api.post(`/api/payments/${r.id}/undo`);
              // The rule goes with the lines this tap sorted, no others.
              if (r.ruleId) await api.post(`/api/payer-rules/${r.ruleId}/undo`, { lines: r.alsoSorted ?? [] });
            },
          },
        };
      }}
    >
      {kind !== 'bank_deposit' && (
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.inc.search[kind]} aria-label={t.inc.search[kind]} />
      )}
      {failure && <LoadError failure={failure} onRetry={reload} />}
      {!data && !failure && <Skeleton rows={3} />}
      {data && options.length === 0 && kind !== 'bank_deposit' && <p className="hint muted">{t.inc.empty}</p>}
      {probable.length > 0 && (
        <>
          <p className="inc-group">{t.inc.probable}</p>
          <ul className="pick-cards inc-pick">{probable.map(card)}</ul>
        </>
      )}
      {rest.length > 0 && (
        <>
          {probable.length > 0 && <p className="inc-group">{t.inc.rest}</p>}
          <ul className="pick-cards inc-pick">{rest.map(card)}</ul>
        </>
      )}
      {kind === 'bank_deposit' && (
        <ul className="pick-cards inc-pick">
          <li>
            <button
              type="button"
              className={`pick-card pick-card-quiet ${pick?.key === NEW_DEPOSIT ? 'on' : ''}`}
              onClick={() => setPick({ key: NEW_DEPOSIT, target: {}, number: null, title: '', facts: [], customerId: null, status: null, owesTetri: 0, customerDebtTetri: null, probable: null, fits: false })}
            >
              <span className="pick-card-main">
                <span className="pick-card-title">{t.inc.newBankDeposit}</span>
                <span className="pick-card-sub">{t.inc.newBankDepositSub}</span>
              </span>
            </button>
          </li>
        </ul>
      )}
      {kind === 'goods' && (
        <p className="hint">
          <Link to="/sales/goods/new">{t.inc.newGoods}</Link> <span className="muted">· {t.inc.newGoodsSub}</span>
        </p>
      )}
      {pick?.transferredOn && <p className="hint warn-text">{t.sort.reason.beforeTransfer(fmtDate(pick.transferredOn))}</p>}
      {pick && capped && <OverOpen pick={pick} what={overWhat} sum={sum} over={over} onSplit={onSplit} />}
      {canRemember && pick && pick.key !== NEW_DEPOSIT && (
        <label className="check-row">
          <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} />
          <span>{t.inc.remember(line.payerLabel ?? '')}</span>
        </label>
      )}
      {canRemember && keep && pick && (
        <p className="hint muted">
          {t.inc.rememberHint}
          {line.payerByAccount && <> {t.inc.rememberAccount}</>}
        </p>
      )}
      {pick && said.length > 0 && !over && (
        <div className="split-result">
          <b>{t.sort.resTitle}</b>
          <ul>
            {said.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
            {before != null && after != null && <li>{after === before ? t.sort.resDebtSame(g(before)) : t.sort.resDebt(g(before), g(after))}</li>}
          </ul>
        </div>
      )}
    </FormSheet>
  );
}

/** The field a refusal of a record's open sum is about: the record chosen. */
const overField = (o: Option) => (o.target.goodsSaleId ? 'goodsSaleId' : o.target.chargeId ? 'chargeId' : 'serviceJobId');

/**
 * A goods sale, a repair or a charge chosen that waits for less than the line:
 * said before the line is sent, with the way that works — «Несколько услуг»;
 * once the server has refused, its words. Nothing of «Что запишется» is
 * promised meanwhile (review of 25.10.2026).
 */
function OverOpen({ pick, what, sum, over, onSplit }: { pick: Option; what: string; sum: number; over: boolean; onSplit: () => void }) {
  const t = useT();
  const field = overField(pick);
  const refused = useFieldError(field);
  const warn = refused ?? (over ? t.goods.sort.overOpen(what, formatGel(pick.owesTetri), formatGel(sum)) : null);
  if (!warn) return null;
  return (
    <div className="sort-over" data-field={field}>
      <p className="field-err" role={refused ? 'alert' : undefined}>
        {warn}
      </p>
      <button type="button" className="pill pill-sm" onClick={onSplit}>
        {t.inc.several}
      </button>
    </div>
  );
}
