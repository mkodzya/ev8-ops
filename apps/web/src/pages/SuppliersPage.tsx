import { spellingMatches } from '@ev8/shared';
import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead } from '../components/ui.js';
import { DataList } from '../ds/list/DataList.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { SupplierDrawer, fmtForeign, type Supplier } from './PurchasesPage.js';

// Закупки → Поставщики (Mika, 28.09.2026, option A): the factories as a tab
// next to the orders, the way Fleet has Mopeds · Models. A card opens — and
// can be corrected — before anything has been ordered from it.

export function SuppliersPage() {
  const t = useT();
  const { can } = useSession();
  const navigate = useNavigate();
  const { data, failure, reload } = useLoad<{ suppliers: Supplier[] }>('/api/suppliers');
  const [adding, setAdding] = useState(false);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  // One figure per currency, as on the card: two currencies do not add up.
  const debt = (s: Supplier) => s.debt.filter((d) => d.minor > 0);
  const debtText = (s: Supplier) => debt(s).map((d) => fmtForeign(d.minor, d.currency)).join(' · ');
  const debtCell = (s: Supplier, none: ReactNode) =>
    debt(s).length > 0 ? <span className="mono crit-text">{debtText(s)}</span> : none;

  return (
    <>
      <PageHead wrap title={t.buy.suppliers} sub={t.buy.suppliersCount(data.suppliers.length)}>
        {can('purchases.manage') && (
          <button type="button" className="pill pill-sm pill-accent" onClick={() => setAdding(true)}>
            {t.buy.newSupplier}
          </button>
        )}
      </PageHead>
      {adding && <SupplierDrawer onClose={() => setAdding(false)} onSaved={(s) => navigate(`/purchases/suppliers/${s.id}`)} />}
      <DataList
        rows={data.suppliers}
        rowKey={(s) => s.id}
        href={(s) => `/purchases/suppliers/${s.id}`}
        fallback={(a, b) => a.name.localeCompare(b.name)}
        search={{
          placeholder: t.buy.suppliersSearch,
          match: (s, q) => spellingMatches(q, [s.name, s.country, s.goods, s.contactPerson, s.channel, s.phone]),
        }}
        chips={[{ key: 'debt', label: t.buy.suppliersWithDebt, test: (s) => debt(s).length > 0 }]}
        empty={{ text: t.buy.suppliersNone }}
        card={(s) => ({
          title: s.name,
          sub: [s.country, s.goods, t.supplierCard.ordersCount(s.orders)].filter(Boolean).join(' · '),
          right: debtCell(s, null),
          rightSub: s.lastOrderedOn ? <span className="muted">{fmtDate(s.lastOrderedOn)}</span> : undefined,
        })}
        columns={[
          { key: 'name', label: t.buy.supplierName, cell: (s) => <span>{s.name}</span>, sort: { value: (s) => s.name } },
          { key: 'country', label: t.buy.supplierCountry, cell: (s) => <span className="muted">{s.country ?? t.common.dash}</span>, sort: { value: (s) => s.country } },
          { key: 'orders', label: t.supplierCard.orders, num: true, cell: (s) => <span className="mono">{s.orders}</span>, sort: { value: (s) => s.orders, first: 'desc' } },
          { key: 'debt', label: t.supplierCard.debt, num: true, cell: (s) => debtCell(s, <span className="muted">{t.common.dash}</span>) },
          {
            key: 'lastOrderedOn',
            label: t.supplierCard.lastOrder,
            cell: (s) => <span className="mono">{s.lastOrderedOn ? fmtDate(s.lastOrderedOn) : t.common.dash}</span>,
            sort: { value: (s) => s.lastOrderedOn, first: 'desc' },
          },
        ]}
      />
    </>
  );
}
