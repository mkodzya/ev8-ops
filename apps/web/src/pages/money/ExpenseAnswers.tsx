import { formatGel } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../../api.js';
import { useToast } from '../../ds/feedback/Toast.js';
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
  group: 'recorded' | 'suggested' | 'none';
  payee?: string | null;
  canRemember?: boolean;
  lastCategoryId?: string | null;
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
  const last = line.lastCategoryId ? cats.nameOf(line.lastCategoryId) : '';

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
  const ownTransfer = async () => {
    const res = await op.run((key) => api.post(`/api/statement-lines/${line.id}/own-transfer`, {}, { key }), 'own');
    if (res.ok) toast({ text: t.exp.ownTransferDone, undo: () => api.post(`/api/statement-lines/${line.id}/restore`, {}) });
  };

  return (
    <>
      {!open && last && !quiet && (
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
      {(open || !last || quiet) && (
        <div className="sort-actions">
          <button type="button" className={`pill pill-sm ${open ? 'on' : quiet ? '' : 'pill-accent'}`} disabled={busy} onClick={() => setOpen(!open)} aria-expanded={open}>
            {t.exp.spend} {open ? '▾' : '▸'}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={() => void ownTransfer()}>
            {t.exp.ownTransfer}
          </button>
        </div>
      )}
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
        </div>
      )}
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
    </>
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
