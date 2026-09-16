import { todayISO } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading, PageHead } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import type { PartRow } from './StockPage.js';

interface Move {
  id: string;
  kind: 'receipt' | 'issue' | 'adjust';
  qty: number;
  unitCostTetri: number | null;
  occurredOn: string;
  reason: string | null;
  actor: string | null;
  purchase: { id: string; number: string } | null;
  job: { id: string; number: string } | null;
}

/** One part: what is on the shelf and every movement that put it there. */
export function PartPage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<{ part: PartRow; moves: Move[] }>(id ? `/api/parts/${id}` : null);
  const [count, setCount] = useState({ open: false, qty: '', reason: '', on: todayISO() });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const p = data.part;

  const submitCount = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/parts/${p.id}/count`, { countedQty: Number(count.qty), reason: count.reason, occurredOn: count.on });
      setCount({ open: false, qty: '', reason: '', on: todayISO() });
      reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead wrap title={p.name} sub={p.archived ? t.stock.archived : undefined}>
        {can('stock.count') && (
          <button type="button" className="pill pill-sm pill-accent" onClick={() => setCount({ ...count, open: !count.open, qty: String(p.onHand) })}>
            {t.stock.count}
          </button>
        )}
      </PageHead>
      {err && <div className="hint hint-bad">{err}</div>}

      {count.open && (
        <section className="card card-drawer">
          <p className="hint">{t.stock.countHint}</p>
          <Field label={t.stock.countedQty}>
            <input className="input input-amount mono" value={count.qty} onChange={(e) => setCount({ ...count, qty: e.target.value })} inputMode="numeric" autoFocus />
          </Field>
          <Field label={t.stock.countReason}>
            <input className="input" value={count.reason} onChange={(e) => setCount({ ...count, reason: e.target.value })} />
          </Field>
          <Field label={t.payments.date}>
            <input className="input mono" type="date" value={count.on} onChange={(e) => setCount({ ...count, on: e.target.value })} />
          </Field>
          <div className="row-actions">
            <button type="button" className="pill" onClick={() => setCount({ ...count, open: false })}>
              {t.actions.cancel}
            </button>
            <button type="button" className="pill pill-accent" disabled={busy || count.qty === '' || !count.reason.trim()} onClick={() => void submitCount()}>
              {t.actions.confirm}
            </button>
          </div>
        </section>
      )}

      <div className="two-col">
        <section className="card">
          <Row
            k={t.stock.onHand}
            v={
              <span className={`mono ${p.onHand < 0 ? 'crit-text' : p.shortBy > 0 ? 'warn-text' : ''}`}>
                {p.onHand} {t.stock.units[p.unit]}
              </span>
            }
          />
          {p.minQty > 0 && <Row k={t.stock.minQty} v={<span className="mono">{p.minQty}</span>} />}
          <Row k={t.stock.avgCost} v={<span className="mono">{p.avgCostTetri == null ? t.common.dash : formatGel(p.avgCostTetri)}</span>} />
          <Row k={t.stock.value} v={<span className="mono">{formatGel(p.valueTetri)}</span>} />
          {p.onHand < 0 && <p className="hint hint-bad">{t.stock.negativeHint}</p>}
        </section>
        <section className="card">
          {p.sku && <Row k={t.stock.sku} v={<span className="mono">{p.sku}</span>} />}
          {p.nameKa && <Row k={t.stock.nameKa} v={p.nameKa} />}
          <Row k={t.stock.salePrice} v={<span className="mono">{p.salePriceTetri == null ? t.common.dash : formatGel(p.salePriceTetri)}</span>} />
          {p.notes && <Row k={t.stock.notes} v={<span className="pre">{p.notes}</span>} />}
        </section>
      </div>

      <section className="card">
        <h2>{t.stock.ledger}</h2>
        {data.moves.length === 0 ? (
          <Empty text={t.stock.noMoves} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.payments.date}</th>
                  <th>{t.fleet.state}</th>
                  <th className="num">{t.service.qty}</th>
                  <th className="num">{t.stock.avgCost}</th>
                  <th>{t.rental.notes}</th>
                </tr>
              </thead>
              <tbody>
                {data.moves.map((m) => (
                  <tr key={m.id}>
                    <td className="mono">{fmtDate(m.occurredOn)}</td>
                    <td>{t.stock.kinds[m.kind]}</td>
                    <td className={`num mono ${m.qty < 0 ? 'crit-text' : ''}`}>
                      {m.qty > 0 ? '+' : ''}
                      {m.qty}
                    </td>
                    <td className="num mono">{m.unitCostTetri == null ? t.common.dash : formatGel(m.unitCostTetri)}</td>
                    <td className="muted">
                      {m.purchase && (
                        <Link to={`/purchases/${m.purchase.id}`} className="mono">
                          {m.purchase.number}
                        </Link>
                      )}
                      {m.job && (
                        <Link to={`/service/${m.job.id}`} className="mono">
                          {m.job.number}
                        </Link>
                      )}
                      {m.reason && <span> {m.reason}</span>}
                      {m.actor && <span> · {m.actor}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
