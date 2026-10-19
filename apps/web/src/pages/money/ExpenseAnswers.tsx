import { formatGel, parseGel } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { FormSheet } from '../../ds/form/Form.js';
import { useOperation } from '../../ds/form/operation.js';
import { fmtDate } from '../../format.js';
import { useLocale, useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';

// Money going out, and what it was for (migration 0046; Mika's variant 1 of
// `docs/redesign/prototypes/expense-sort-options.html`, 15.10.2026): under a
// line, what it is — an expense, money between the company's own accounts —
// and for an expense the category, inside the card, with "remember the payee"
// ticked; a payee sorted before is one tap, "как в прошлый раз".

export interface ExpenseCategory {
  id: string;
  nameRu: string;
  nameKa: string | null;
  nameEn: string | null;
  archived: boolean;
}

export interface Categories {
  list: ExpenseCategory[];
  nameOf: (id: string | null | undefined) => string;
}

/** The live categories and each one's name in the screen's language. */
export function useExpenseCategories(load: boolean, all = false): Categories {
  const { locale } = useLocale();
  const { data } = useLoad<{ categories: ExpenseCategory[] }>(load ? `/api/expense-categories${all ? '?all=1' : ''}` : null);
  const all_ = data?.categories ?? [];
  const byId = new Map(all_.map((c) => [c.id, c]));
  const name = (c: ExpenseCategory) => (locale === 'ka' ? c.nameKa : locale === 'en' ? c.nameEn : null) || c.nameRu;
  return {
    // What a line can be sorted into; an archived one only names what it already holds.
    list: all_.filter((c) => !c.archived),
    nameOf: (id) => {
      const c = id ? byId.get(id) : undefined;
      return c ? name(c) : '';
    },
  };
}

export interface OutLine {
  id: string;
  amountTetri: number;
  group: 'recorded' | 'suggested' | 'none';
  payee?: string | null;
  canRemember?: boolean;
  lastCategoryId?: string | null;
  /** A deposit we owe back of exactly this sum; absent while an older API answers. */
  depositHint?: { rentalId: string; number: string } | null;
}

/** The answers under a line going out; `quiet` when a payment entered by hand is offered first. */
export function ExpenseAnswers({ line, cats, quiet }: { line: OutLine; cats: Categories; quiet?: boolean }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const busy = op.state === 'busy';
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(line.lastCategoryId ?? null);
  const [remember, setRemember] = useState(!!line.canRemember);
  const [sheet, setSheet] = useState<null | 'deposit' | 'supplier' | 'split'>(null);
  const last = line.lastCategoryId ? cats.nameOf(line.lastCategoryId) : '';
  const hint = line.depositHint ?? null;

  const save = async (categoryId: string, keep: boolean) => {
    const name = cats.nameOf(categoryId);
    const res = await op.run(
      (key) => api.post<{ ruleId: string | null; alsoSorted: string[] }>(`/api/statement-lines/${line.id}/expense`, { categoryId, remember: keep }, { key }),
      `expense:${categoryId}:${keep}`,
    );
    if (!res.ok) return;
    const { ruleId, alsoSorted } = res.value;
    toast({ text: t.exp.saved(name, alsoSorted.length), undo: () => api.post(`/api/statement-lines/${line.id}/expense-undo`, { ruleId }) });
  };
  const payOut = async (body: { kind: 'deposit_payout'; rentalId: string } | { kind: 'supplier'; purchaseId: string }, text: string) => {
    const res = await op.run((key) => api.post<{ id: string }>(`/api/statement-lines/${line.id}/pay-out`, body, { key }), `payout:${JSON.stringify(body)}`);
    if (res.ok) toast({ text, undo: () => api.post(`/api/payments/${res.value.id}/undo`) });
  };
  /** «Акционеру» (ADR-0029): taken out by a shareholder — left the accounts, not spent. */
  const shareholder = async () => {
    const res = await op.run((key) => api.post(`/api/statement-lines/${line.id}/shareholder`, {}, { key }), 'shareholder');
    if (res.ok) toast({ text: t.exp.shareholderDone, undo: () => api.post(`/api/statement-lines/${line.id}/restore`, {}) });
  };
  const ownTransfer = async () => {
    const res = await op.run((key) => api.post(`/api/statement-lines/${line.id}/own-transfer`, {}, { key }), 'own');
    if (res.ok) toast({ text: t.exp.ownTransferDone, undo: () => api.post(`/api/statement-lines/${line.id}/restore`, {}) });
  };

  return (
    <>
      {!open && hint && !quiet && (
        <>
          <p className="sort-reason">{t.exp.looksLikeDeposit(formatGel(line.amountTetri), hint.number)}</p>
          <div className="sort-actions">
            <button type="button" className="pill pill-sm pill-accent" disabled={busy} onClick={() => void payOut({ kind: 'deposit_payout', rentalId: hint.rentalId }, t.exp.depositDone(hint.number))}>
              {t.exp.depositYes(hint.number)}
            </button>
            <button type="button" className="pill pill-sm" disabled={busy} onClick={() => setOpen(true)}>
              {t.sort.other}
            </button>
          </div>
        </>
      )}
      {!open && !hint && last && !quiet && (
        <>
          <p className="sort-reason">{t.exp.lastTime(last)}</p>
          <div className="sort-actions">
            <button type="button" className="pill pill-sm pill-accent" disabled={busy} onClick={() => void save(line.lastCategoryId!, !!line.canRemember)}>
              {t.exp.yes(last)}
            </button>
            <button type="button" className="pill pill-sm" disabled={busy} onClick={() => setOpen(true)}>
              {t.sort.other}
            </button>
          </div>
        </>
      )}
      {(open || (!last && !hint) || quiet) && (
        <div className="sort-actions">
          <button type="button" className={`pill pill-sm ${open ? 'on' : quiet ? '' : 'pill-accent'}`} disabled={busy} onClick={() => setOpen(!open)} aria-expanded={open}>
            {t.exp.spend} {open ? '▾' : '▸'}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => setSheet('deposit')}>
            {t.exp.deposit}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => setSheet('supplier')}>
            {t.exp.supplier}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => void ownTransfer()}>
            {t.exp.ownTransfer}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => void shareholder()}>
            {t.exp.shareholder}
          </button>
        </div>
      )}
      {sheet === 'deposit' && <DepositSheet line={line} onClose={() => setSheet(null)} />}
      {sheet === 'supplier' && <SupplierSheet line={line} onClose={() => setSheet(null)} />}
      {sheet === 'split' && <ExpenseSplitSheet line={line} cats={cats} onClose={() => setSheet(null)} />}
      {open && (
        <div className="exp-panel">
          <p className="hint muted">{t.exp.forWhat}</p>
          <div className="chips" role="radiogroup" aria-label={t.exp.forWhat}>
            {cats.list.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={pick === c.id} className={`pill pill-sm ${pick === c.id ? 'on' : ''}`} onClick={() => setPick(c.id)}>
                {cats.nameOf(c.id)}
              </button>
            ))}
          </div>
          {line.canRemember && line.payee && (
            <label className="check-row">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              <span>{t.exp.remember(line.payee)}</span>
            </label>
          )}
          <button type="button" className="pill pill-sm pill-accent pill-wide" disabled={busy || !pick} onClick={() => pick && void save(pick, remember && !!line.canRemember)}>
            {pick ? t.exp.save(cats.nameOf(pick)) : t.exp.chooseFirst}
          </button>
          {/* Several things paid at once: each part its category (ADR-0030). */}
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => setSheet('split')}>
            {t.sort.split}
          </button>
        </div>
      )}
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
    </>
  );
}

/** One outgoing line as several expenses, each with its category and sum (ADR-0030). */
function ExpenseSplitSheet({ line, cats, onClose }: { line: OutLine; cats: Categories; onClose: () => void }) {
  const t = useT();
  const initial = { rows: [{ categoryId: '', amount: '' }, { categoryId: '', amount: '' }] };
  const [f, setF] = useState(initial);
  const amountOf = (text: string) => parseGel(text) ?? 0;
  const placed = f.rows.reduce((n, r) => n + amountOf(r.amount), 0);
  const left = line.amountTetri - placed;
  const setRow = (i: number, patch: Partial<(typeof initial.rows)[number]>) => setF((v) => ({ rows: v.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  // An empty sum takes what is left when it is touched.
  const takeRest = (i: number) => {
    if (f.rows[i].amount.trim() !== '' || left <= 0) return;
    setRow(i, { amount: (left / 100).toFixed(2) });
  };
  const used = f.rows.filter((r) => r.categoryId && amountOf(r.amount) > 0);
  return (
    <FormSheet
      title={t.sort.splitTitle(formatGel(line.amountTetri))}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.sort.split}
      submit={async (key) => {
        const parts = used.map((r) => ({ categoryId: r.categoryId, amountTetri: amountOf(r.amount) }));
        await api.post(`/api/statement-lines/${line.id}/expense-split`, { parts }, { key });
        return { toast: { text: t.sort.splitDone(parts.length), undo: () => api.post(`/api/statement-lines/${line.id}/restore`, {}) } };
      }}
    >
      <p className="hint muted">{t.exp.splitHint}</p>
      <div className="split-parts">
        {f.rows.map((r, i) => (
          <div key={i} className="split-part">
            <div className="split-part-top">
              <select className="input" aria-label={t.exp.partCategory} value={r.categoryId} onChange={(e) => setRow(i, { categoryId: e.target.value })}>
                <option value="">{t.exp.partCategory}</option>
                {cats.list.map((c) => (
                  <option key={c.id} value={c.id} disabled={c.id !== r.categoryId && f.rows.some((x) => x.categoryId === c.id)}>
                    {cats.nameOf(c.id)}
                  </option>
                ))}
              </select>
              <input
                className="input mono split-amount"
                inputMode="decimal"
                aria-label={t.exp.partAmount}
                value={r.amount}
                placeholder={left > 0 ? formatGel(left, { decimals: false }) : ''}
                onFocus={() => takeRest(i)}
                onChange={(e) => setRow(i, { amount: e.target.value })}
              />
              {f.rows.length > 2 && (
                <button type="button" className="pill pill-sm" aria-label={t.exp.removePart} onClick={() => setF((v) => ({ rows: v.rows.filter((_, j) => j !== i) }))}>
                  ×
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {f.rows.length < 9 && (
        <button type="button" className="pill pill-sm split-more" onClick={() => setF((v) => ({ rows: [...v.rows, { categoryId: '', amount: '' }] }))}>
          {t.exp.addPart}
        </button>
      )}
      <div className="split-sum" aria-live="polite">
        <span className="mono">{used.length > 0 ? `${used.map((r) => formatGel(amountOf(r.amount), { decimals: false })).join(' + ')} = ${formatGel(placed, { decimals: false })}` : ''}</span>
        {left === 0 ? <span className="split-ok">{t.sort.splitAllPlaced}</span> : left > 0 ? <span>{t.sort.splitLeft(formatGel(left))}</span> : <span className="field-err">{t.sort.splitOver(formatGel(-left))}</span>}
      </div>
    </FormSheet>
  );
}

export interface ExpenseRuleLine {
  id: string;
  bank: 'bog' | 'tbc' | 'credo';
  occurredOn: string;
  amountTetri: number;
  payee: string | null;
  categoryId: string | null;
  rule: { id: string; since: string; live: boolean } | null;
}

/** A line a remembered payee sorted: put it back, or forget the payee (§ «Разобрано правилами»). */
export function ExpenseRuleCard({ line, cats, bank, onDone }: { line: ExpenseRuleLine; cats: Categories; bank: string; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const busy = op.state === 'busy';
  return (
    <article className="sort-line">
      <div className="sort-line-head">
        <span className="t-money amt-out">−{formatGel(line.amountTetri)}</span>
        <span className="sort-line-meta">
          {fmtDate(line.occurredOn)} · {bank}
        </span>
      </div>
      <p className="sort-reason">
        {cats.nameOf(line.categoryId)} — {line.rule ? (line.rule.live ? t.exp.ruleSince(line.payee ?? '', fmtDate(line.rule.since)) : t.exp.ruleForgotten) : ''}
      </p>
      <div className="sort-actions">
        <button
          type="button"
          className="pill pill-sm"
          disabled={busy}
          onClick={async () => {
            const res = await op.run((key) => api.post(`/api/statement-lines/${line.id}/restore`, {}, { key }), 'restore');
            if (res.ok) {
              toast({ text: t.sort.unlinked });
              onDone();
            }
          }}
        >
          {t.sort.unlink}
        </button>
        {line.rule?.live && (
          <button
            type="button"
            className="pill pill-sm"
            disabled={busy}
            onClick={async () => {
              const res = await op.run((key) => api.post(`/api/expense-rules/${line.rule!.id}/forget`, {}, { key }), 'forget');
              if (res.ok) {
                toast({ text: t.exp.forgotten });
                onDone();
              }
            }}
          >
            {t.exp.forget}
          </button>
        )}
      </div>
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
    </article>
  );
}

interface DepositRow {
  rentalId: string;
  number: string;
  customer: { name: string } | null;
  toHandBackTetri: number;
  returnedOn: string | null;
}

/** «Возврат залога»: the deposits we owe back; the one of this line's sum first. */
function DepositSheet({ line, onClose }: { line: OutLine; onClose: () => void }) {
  const t = useT();
  const { data } = useLoad<{ deposits: DepositRow[] }>('/api/deposits');
  const [pick, setPick] = useState<DepositRow | null>(null);
  const rows = (data?.deposits ?? []).filter((d) => d.toHandBackTetri > 0).sort((a, b) => Number(b.toHandBackTetri === line.amountTetri) - Number(a.toHandBackTetri === line.amountTetri));
  return (
    <FormSheet
      title={t.exp.depositTitle(formatGel(line.amountTetri))}
      onClose={onClose}
      value={pick?.rentalId ?? null}
      initial={null}
      label={pick ? t.exp.depositYes(pick.number) : t.exp.deposit}
      submit={async (key) => {
        if (!pick) throw new Error('nothing picked');
        const r = await api.post<{ id: string }>(`/api/statement-lines/${line.id}/pay-out`, { kind: 'deposit_payout', rentalId: pick.rentalId }, { key });
        return { toast: { text: t.exp.depositDone(pick.number), undo: () => api.post(`/api/payments/${r.id}/undo`) } };
      }}
    >
      <p className="hint muted">{t.exp.depositHint}</p>
      {data && rows.length === 0 && <p className="muted">{t.exp.depositNone}</p>}
      <ul className="pick-cards">
        {rows.map((d) => (
          <li key={d.rentalId}>
            <button type="button" className={`pick-card ${pick?.rentalId === d.rentalId ? 'on' : ''}`} onClick={() => setPick(d)}>
              <span className="pick-card-main">
                <span className="pick-card-title mono">{d.number}</span>
                <span className="pick-card-sub">
                  {[d.customer?.name, t.exp.toHandBack(formatGel(d.toHandBackTetri)), d.returnedOn ? fmtDate(d.returnedOn) : null].filter(Boolean).join(' · ')}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </FormSheet>
  );
}

interface PurchaseRow {
  id: string;
  number: string;
  status: string;
  supplier: { name: string } | null;
  paidPercent: number | null;
}

/** «Поставщику»: the orders not paid in full. */
function SupplierSheet({ line, onClose }: { line: OutLine; onClose: () => void }) {
  const t = useT();
  const { data } = useLoad<{ purchases: PurchaseRow[] }>('/api/purchases');
  const [pick, setPick] = useState<PurchaseRow | null>(null);
  const rows = (data?.purchases ?? []).filter((p) => p.status !== 'cancelled' && (p.paidPercent ?? 0) < 100);
  return (
    <FormSheet
      title={t.exp.supplierTitle(formatGel(line.amountTetri))}
      onClose={onClose}
      value={pick?.id ?? null}
      initial={null}
      label={pick ? `${t.exp.supplier} · ${pick.number}` : t.exp.supplier}
      submit={async (key) => {
        if (!pick) throw new Error('nothing picked');
        const r = await api.post<{ id: string }>(`/api/statement-lines/${line.id}/pay-out`, { kind: 'supplier', purchaseId: pick.id }, { key });
        return { toast: { text: t.exp.supplierDone(pick.number), undo: () => api.post(`/api/payments/${r.id}/undo`) } };
      }}
    >
      <p className="hint muted">{t.exp.supplierHint}</p>
      {data && rows.length === 0 && <p className="muted">{t.exp.supplierNone}</p>}
      <ul className="pick-cards">
        {rows.map((p) => (
          <li key={p.id}>
            <button type="button" className={`pick-card ${pick?.id === p.id ? 'on' : ''}`} onClick={() => setPick(p)}>
              <span className="pick-card-main">
                <span className="pick-card-title mono">{p.number}</span>
                <span className="pick-card-sub">{[p.supplier?.name, p.paidPercent != null ? t.exp.paidPercent(p.paidPercent) : null].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </FormSheet>
  );
}
