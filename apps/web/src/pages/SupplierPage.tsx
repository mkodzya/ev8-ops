import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { RecordHistory } from '../components/RecordHistory.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { Row } from '../components/Wizard.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { NewPurchase, SupplierDrawer, fmtForeign, statusOf, type Purchase, type Supplier } from './PurchasesPage.js';

// Поставщик (wave 5 §3.4, §3.9, crit. 20). A record kind of its own: a
// factory is not looked for among customers, and a customer is not looked for
// here (B3-06). What the card is for is one question — what do we still owe
// them — and it is answered in their currency, not ours.
//
// Its shape since 28.09.2026 (Mika, option 2 — one text of several lines read
// as "a towel"): what we owe and how much we order; how to reach them — the
// person, the phone, where we agree; about them — what they supply, the
// address, the bank; the notes folded; then the orders and the history.

export function SupplierPage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  // The factory and its orders in one answer: the section's list is capped at
  // the newest two hundred, and a factory's own card must show all of its own.
  const card = useLoad<{ supplier: Supplier; orders: Purchase[] }>(id ? `/api/suppliers/${id}` : null);
  const [editing, setEditing] = useState(false);

  const reload = () => card.reload();

  if (card.failure) return <LoadError failure={card.failure} onRetry={reload} />;
  if (!card.data) return <Loading />;
  const s = card.data.supplier;
  const mine = card.data.orders;
  const debt = s.debt.filter((d) => d.minor > 0);

  return (
    <>
      <PageHead wrap title={s.name} sub={s.country ?? undefined}>
        {s.phone && (
          <a className="pill pill-sm" href={`tel:${s.phone}`}>
            {t.today.call}
          </a>
        )}
        {can('purchases.manage') && (
          <>
            <button type="button" className="pill pill-sm" onClick={() => setEditing(true)}>
              {t.supplierCard.edit}
            </button>
            <NewPurchase supplier={{ id: s.id, name: s.name }} onDone={reload} />
          </>
        )}
      </PageHead>
      {editing && <SupplierDrawer supplier={s} onClose={() => setEditing(false)} onSaved={reload} />}

      <div className="num-strip">
        {debt.length === 0 ? (
          <span className="num">
            <span className="num-v">{t.common.dash}</span>
            <span className="num-l">{t.supplierCard.debtNone}</span>
          </span>
        ) : (
          // One figure per currency: two invoices in two currencies do not add
          // up, and pretending they do is how a debt goes missing (B3-04).
          debt.map((d) => (
            <span className="num num-crit" key={d.currency}>
              <span className="num-v">{fmtForeign(d.minor, d.currency)}</span>
              <span className="num-l">{t.supplierCard.debt}</span>
            </span>
          ))
        )}
        <span className="num">
          <span className="num-v">{s.orders}</span>
          <span className="num-l">{t.supplierCard.orders}</span>
        </span>
        <span className="num">
          <span className="num-v mono">{s.lastOrderedOn ? fmtDate(s.lastOrderedOn) : t.common.dash}</span>
          <span className="num-l">{t.supplierCard.lastOrder}</span>
        </span>
      </div>

      {/* Each thing its own line (option 2): an empty one shows a dash, so it
          is plain what is still to be filled in. */}
      <section className="card">
        <BlockHead title={t.supplierCard.reach} />
        <Row k={t.supplierCard.contactPerson} v={s.contactPerson ?? t.common.dash} />
        <Row k={t.supplierCard.phone} v={s.phone ? <a className="mono" href={`tel:${s.phone}`}>{s.phone}</a> : t.common.dash} />
        <Row k={t.supplierCard.channel} v={s.channel ?? t.common.dash} />
      </section>

      <section className="card">
        <BlockHead title={t.supplierCard.about} />
        <Row k={t.supplierCard.goods} v={s.goods ?? t.common.dash} />
        <Row k={t.supplierCard.address} v={s.address ?? t.common.dash} />
        <Row k={t.supplierCard.bank} v={s.bank ? <span className="pre">{s.bank}</span> : t.common.dash} />
        {/* What is left over — from Odoo, mostly — folded, so the card reads
            as fields and the long text is one tap away. */}
        {s.notes && (
          <details className="supplier-notes">
            <summary>{t.supplierCard.notes}</summary>
            <p className="pre">{s.notes}</p>
          </details>
        )}
      </section>

      <section className="card">
        <BlockHead title={t.supplierCard.orders} sub={t.supplierCard.ordersCount(mine.length)} />
        {mine.length === 0 ? (
          <Empty text={t.supplierCard.none} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table table-heads-wrap">
              <thead>
                <tr>
                  <th>{t.buy.number}</th>
                  <th>{t.buy.invoice}</th>
                  <th>{t.buy.orderedOn}</th>
                  <th className="num">{t.buy.invoiceTotal}</th>
                  <th className="num">{t.buy.paidShare}</th>
                  <th className="num">{t.buy.debt}</th>
                  <th>{t.buy.status}</th>
                </tr>
              </thead>
              <tbody>
                {mine.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link className="mono" to={`/purchases/${p.id}`}>
                        {p.number}
                      </Link>
                    </td>
                    <td className="muted">{p.invoiceNo ?? t.common.dash}</td>
                    <td className="mono">{fmtDate(p.orderedOn)}</td>
                    <td className="num mono">{fmtForeign(p.invoiceMinor, p.currency)}</td>
                    <td className="num mono">{p.paidPercent} %</td>
                    <td className="num mono">
                      {p.debtMinor > 0 && p.status !== 'cancelled' ? <span className="crit-text">{fmtForeign(p.debtMinor, p.currency)}</span> : t.common.dash}
                    </td>
                    <td className="muted">{t.buy.statuses[statusOf(p)]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RecordHistory kind="customer" id={s.id} search={s.name} />
    </>
  );
}
