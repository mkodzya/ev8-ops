import { addDays, formatGel, monthOf, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { LoadError } from '../../components/LoadError.js';
import { BlockHead, Loading } from '../../components/ui.js';
import { Row } from '../../components/Wizard.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';

// «Экономика → Товары» (issue #11, ADR-0045): what goods brought in, the VAT
// inside it, the net, what they cost and the margin — of the lines whose cost
// is known; the rest are counted apart, never folded in at nought. The card
// fee is the company's expense and stays in the week.

interface GoodsEco {
  sales: number;
  qty: number;
  grossTetri: number;
  vatTetri: number;
  netTetri: number;
  costTetri: number;
  marginTetri: number;
  unknownCost: { lines: number; netTetri: number };
  byItem: { key: string; name: string; qty: number; grossTetri: number; netTetri: number; costTetri: number; marginTetri: number; unknownCostNetTetri: number }[];
}

const PERIODS = ['month', 'last', 'all'] as const;
type Period = (typeof PERIODS)[number];

function query(p: Period): string {
  if (p === 'all') return 'all=1';
  const month = monthOf(todayISO());
  const m = p === 'month' ? month : monthOf(addDays(month.from, -1));
  return `from=${m.from}&to=${m.to}`;
}

export function GoodsEconomics() {
  const t = useT();
  const e = t.goods.economics;
  const [period, setPeriod] = useState<Period>('month');
  const { data, failure, reload } = useLoad<GoodsEco>(`/api/economics/goods?${query(period)}`);
  const g = (n: number) => <span className="mono">{formatGel(n, { decimals: false })}</span>;
  return (
    <section className="card">
      <BlockHead title={e.title} sub={data ? e.qty + ' ' + String(data.qty) : undefined} />
      <div className="seg-row" role="radiogroup" aria-label={e.title}>
        {PERIODS.map((p) => (
          <button key={p} type="button" role="radio" aria-checked={period === p} className={`seg ${period === p ? 'on' : ''}`} onClick={() => setPeriod(p)}>
            <span className="seg-lbl">{e.periods[p]}</span>
          </button>
        ))}
      </div>
      {failure && <LoadError failure={failure} onRetry={reload} />}
      {!data && !failure && <Loading rows={3} />}
      {data && data.sales === 0 && <p className="muted">{e.none}</p>}
      {data && data.sales > 0 && (
        <>
          <Row k={e.gross} v={g(data.grossTetri)} />
          <Row k={e.vat} v={g(data.vatTetri)} />
          <Row k={e.net} v={g(data.netTetri)} />
          <Row k={e.cost} v={g(data.costTetri)} />
          <Row k={e.margin} v={<span className={`mono ${data.marginTetri < 0 ? 'crit-text' : 'state-available'}`}>{formatGel(data.marginTetri, { decimals: false })}</span>} />
          {data.unknownCost.lines > 0 && <p className="hint warn-text">{e.unknown(data.unknownCost.lines, formatGel(data.unknownCost.netTetri, { decimals: false }))}</p>}
          <p className="hint muted">{e.fee}</p>
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{e.item}</th>
                  <th className="num">{e.qty}</th>
                  <th className="num">{e.gross}</th>
                  <th className="num">{e.net}</th>
                  <th className="num">{e.cost}</th>
                  <th className="num">{e.margin}</th>
                </tr>
              </thead>
              <tbody>
                {data.byItem.map((r) => (
                  <tr key={r.key}>
                    <td>{r.name}</td>
                    <td className="num mono">{r.qty}</td>
                    <td className="num">{g(r.grossTetri)}</td>
                    <td className="num">{g(r.netTetri)}</td>
                    <td className="num">{r.costTetri > 0 || r.unknownCostNetTetri === 0 ? g(r.costTetri) : <span className="muted">{t.common.dash}</span>}</td>
                    <td className="num">{r.unknownCostNetTetri === r.netTetri ? <span className="muted">{t.common.dash}</span> : g(r.marginTetri)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
