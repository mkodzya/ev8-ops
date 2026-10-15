import { addDays, formatGel, monthOf, todayISO, weekOf } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead } from '../components/ui.js';
import '../ds/money/money.css';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useExpenseCategories } from './money/ExpenseAnswers.js';

interface Report {
  from: string;
  to: string;
  categories: { categoryId: string | null; tetri: number; lines: number }[];
  expensesTetri: number;
  depositsBack: number;
  suppliers: number;
  ownTransfers: number;
  otherPaid: number;
  unsorted: number;
  unsortedLines: number;
  totalOutTetri: number;
}

type Span = 'week' | 'month' | 'last_month';

/**
 * «Отчёты → Расходы» (migration 0046; the report of variant 1, Mika
 * 15.10.2026): what left the accounts in a week or a month — the expenses by
 * category, and apart from them what was not spending: deposits handed back,
 * suppliers paid, money between the company's own accounts. What still waits
 * in «Разобрать» is counted, and is one tap away.
 */
export function ExpensesReportPage() {
  const t = useT();
  const [span, setSpan] = useState<Span>('month');
  const today = todayISO();
  const period = span === 'week' ? weekOf(today) : span === 'month' ? monthOf(today) : monthOf(addDays(monthOf(today).from, -1));
  const { data, failure, reload } = useLoad<Report>(`/api/reports/expenses?from=${period.from}&to=${period.to}`);
  const cats = useExpenseCategories(true, true);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  const widest = Math.max(1, ...(data?.categories.map((c) => c.tetri) ?? [1]));
  const notSpending = data
    ? [
        { key: 'deposits', label: t.exp.depositsBack, tetri: data.depositsBack },
        { key: 'suppliers', label: t.exp.suppliers, tetri: data.suppliers },
        { key: 'own', label: t.exp.ownTransfers, tetri: data.ownTransfers },
        { key: 'other', label: t.exp.otherPaid, tetri: data.otherPaid },
      ].filter((r) => r.tetri > 0)
    : [];
  return (
    <>
      <PageHead title={t.exp.reportTitle} sub={t.exp.reportSub(fmtDate(period.from), fmtDate(period.to))} />
      <div className="list-chips" role="tablist">
        {(['week', 'month', 'last_month'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={span === s} className={`list-chip ${span === s ? 'on' : ''}`} onClick={() => setSpan(s)}>
            {t.exp.spans[s]}
          </button>
        ))}
      </div>
      {!data && <Loading />}
      {data && data.totalOutTetri === 0 && <p className="muted">{t.exp.reportEmpty}</p>}
      {data && data.categories.length > 0 && (
        <section className="card">
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.exp.category}</th>
                  <th className="num">{t.exp.sum}</th>
                  <th className="num">{t.exp.lines}</th>
                  <th aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {data.categories.map((c) => (
                  <tr key={c.categoryId ?? 'none'}>
                    <td>{c.categoryId ? cats.nameOf(c.categoryId) : t.exp.noCategory}</td>
                    <td className="num mono">{formatGel(c.tetri)}</td>
                    <td className="num mono">{c.lines}</td>
                    <td>
                      <span className="exp-bar" style={{ width: `${Math.round((100 * c.tetri) / widest)}%` }} />
                    </td>
                  </tr>
                ))}
                <tr className="exp-total">
                  <td>{t.exp.expensesTotal}</td>
                  <td className="num mono">{formatGel(data.expensesTetri)}</td>
                  <td />
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
      {data && (notSpending.length > 0 || data.unsorted > 0) && (
        <section className="card">
          <h2 className="t-h3">{t.exp.notSpending}</h2>
          {notSpending.map((r) => (
            <div key={r.key} className="kv">
              <span className="kv-k">{r.label}</span>
              <span className="mono">{formatGel(r.tetri)}</span>
            </div>
          ))}
          {data.unsorted > 0 && (
            <div className="kv">
              <span className="kv-k">
                {t.exp.unsorted(data.unsortedLines)} · <Link to="/money/sort?d=out">{t.exp.openSort}</Link>
              </span>
              <span className="mono">{formatGel(data.unsorted)}</span>
            </div>
          )}
          <div className="kv exp-total">
            <span className="kv-k">{t.exp.totalOut}</span>
            <span className="mono">{formatGel(data.totalOutTetri)}</span>
          </div>
        </section>
      )}
    </>
  );
}
