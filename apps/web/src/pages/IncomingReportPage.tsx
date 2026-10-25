import { addDays, formatGel, monthOf, todayISO, weekOf } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead } from '../components/ui.js';
import '../ds/money/money.css';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useIncomeCategories } from './money/IncomeAnswers.js';

interface Report {
  from: string;
  to: string;
  customers: { rent: number; deposits: number; sales: number; goods: number; repairs: number; advance: number };
  customersTetri: number;
  categories: { categoryId: string | null; tetri: number; lines: number }[];
  otherIncomeTetri: number;
  founder: number;
  ownTransfers: number;
  bankDeposits: number;
  other: number;
  unsorted: number;
  unsortedLines: number;
  totalInTetri: number;
}

type Span = 'week' | 'month' | 'last_month';

/**
 * «Отчёты → Поступления» (issue #13 of the director, migration 0069): what
 * came into the accounts in a week or a month — the customers' money by what
 * it paid, the deposits apart (a liability, not revenue), other income by its
 * category, and apart from revenue a founder's contribution, money between the
 * company's own accounts and cash taken to the bank. What still waits in
 * «Разобрать» is counted, and is one tap away. The mirror of «Расходы».
 */
export function IncomingReportPage() {
  const t = useT();
  const r = t.inc.report;
  const [span, setSpan] = useState<Span>('month');
  const today = todayISO();
  const period = span === 'week' ? weekOf(today) : span === 'month' ? monthOf(today) : monthOf(addDays(monthOf(today).from, -1));
  const { data, failure, reload } = useLoad<Report>(`/api/reports/incoming?from=${period.from}&to=${period.to}`);
  const cats = useIncomeCategories(true, true);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  const fromCustomers = data
    ? [
        { key: 'rent', label: r.rent, tetri: data.customers.rent },
        { key: 'deposits', label: r.deposits, tetri: data.customers.deposits },
        { key: 'sales', label: r.sales, tetri: data.customers.sales },
        { key: 'goods', label: r.goods, tetri: data.customers.goods },
        { key: 'repairs', label: r.repairs, tetri: data.customers.repairs },
        { key: 'advance', label: r.advance, tetri: data.customers.advance },
      ].filter((x) => x.tetri > 0)
    : [];
  const apart = data
    ? [
        { key: 'founder', label: r.founder, tetri: data.founder },
        { key: 'own', label: r.ownTransfers, tetri: data.ownTransfers },
        { key: 'bank', label: r.bankDeposits, tetri: data.bankDeposits },
        { key: 'other', label: r.other, tetri: data.other },
      ].filter((x) => x.tetri > 0)
    : [];
  return (
    <>
      <PageHead title={r.title} sub={r.sub(fmtDate(period.from), fmtDate(period.to))} />
      <div className="list-chips" role="tablist">
        {(['week', 'month', 'last_month'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={span === s} className={`list-chip ${span === s ? 'on' : ''}`} onClick={() => setSpan(s)}>
            {t.exp.spans[s]}
          </button>
        ))}
      </div>
      {!data && <Loading />}
      {data && data.totalInTetri === 0 && <p className="muted">{r.empty}</p>}
      {data && fromCustomers.length > 0 && (
        <section className="card">
          <h2 className="t-h3">{r.customers}</h2>
          {fromCustomers.map((x) => (
            <div key={x.key} className="kv">
              <span className="kv-k">{x.label}</span>
              <span className="mono">{formatGel(x.tetri)}</span>
            </div>
          ))}
          <div className="kv exp-total">
            <span className="kv-k">{r.customersTotal}</span>
            <span className="mono">{formatGel(data.customersTetri)}</span>
          </div>
        </section>
      )}
      {data && data.categories.length > 0 && (
        <section className="card">
          <h2 className="t-h3">{r.otherIncome}</h2>
          {data.categories.map((c) => (
            <div key={c.categoryId ?? 'none'} className="kv">
              <span className="kv-k">{c.categoryId ? cats.nameOf(c.categoryId) : r.noCategory}</span>
              <span className="mono">{formatGel(c.tetri)}</span>
            </div>
          ))}
          <div className="kv exp-total">
            <span className="kv-k">{r.otherIncome}</span>
            <span className="mono">{formatGel(data.otherIncomeTetri)}</span>
          </div>
        </section>
      )}
      {data && (apart.length > 0 || data.unsorted > 0) && (
        <section className="card">
          <h2 className="t-h3">{r.notRevenue}</h2>
          {apart.map((x) => (
            <div key={x.key} className="kv">
              <span className="kv-k">{x.label}</span>
              <span className="mono">{formatGel(x.tetri)}</span>
            </div>
          ))}
          {data.unsorted > 0 && (
            <div className="kv">
              <span className="kv-k">
                {r.unsorted(data.unsortedLines)} · <Link to="/money/sort">{r.openSort}</Link>
              </span>
              <span className="mono">{formatGel(data.unsorted)}</span>
            </div>
          )}
        </section>
      )}
      {data && data.totalInTetri > 0 && (
        <section className="card">
          <div className="kv exp-total">
            <span className="kv-k">{r.total}</span>
            <span className="mono">{formatGel(data.totalInTetri)}</span>
          </div>
          <p className="hint muted">{r.net}</p>
        </section>
      )}
    </>
  );
}
