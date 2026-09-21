import { Link, useParams } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { Row } from '../components/Wizard.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { NewPurchase, fmtForeign, statusOf, type Purchase, type Supplier } from './PurchasesPage.js';

// Поставщик (wave 5 §3.4, §3.9, crit. 20). A record kind of its own: a
// factory is not looked for among customers, and a customer is not looked for
// here (B3-06). What the card is for is one question — what do we still owe
// them — and it is answered in their currency, not ours.

export function SupplierPage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const suppliers = useLoad<{ suppliers: Supplier[] }>('/api/suppliers');
  const orders = useLoad<{ purchases: Purchase[] }>('/api/purchases');

  const reload = () => {
    suppliers.reload();
    orders.reload();
  };

  if (suppliers.failure) return <LoadError failure={suppliers.failure} onRetry={reload} />;
  if (!suppliers.data) return <Loading />;
  const s = suppliers.data.suppliers.find((x) => x.id === id) ?? null;
  if (!s) return <Empty text={t.supplierCard.notFound} />;

  // The order list is the section's own list, read here through this factory.
  const mine = (orders.data?.purchases ?? []).filter((p) => p.supplier.id === s.id);
  const debt = s.debt.filter((d) => d.minor > 0);

  return (
    <>
      <PageHead wrap title={s.name} sub={s.country ?? undefined}>
        {can('purchases.manage') && <NewPurchase supplier={{ id: s.id, name: s.name }} onDone={reload} />}
      </PageHead>

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
      </div>

      <section className="card">
        <Row k={t.supplierCard.country} v={s.country ?? t.common.dash} />
        <Row k={t.supplierCard.contact} v={s.contact ? <span className="pre">{s.contact}</span> : t.common.dash} />
        <Row
          k={t.supplierCard.phone}
          v={s.phone ? <a className="mono" href={`tel:${s.phone}`}>{s.phone}</a> : t.common.dash}
        />
      </section>

      <section className="card">
        <BlockHead title={t.supplierCard.orders} sub={t.supplierCard.ordersCount(mine.length)} />
        {orders.data == null ? (
          <Loading rows={3} />
        ) : mine.length === 0 ? (
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
    </>
  );
}
