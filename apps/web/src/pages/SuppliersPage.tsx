import { spellingMatches } from '@ev8/shared';
import type { ReactNode } from 'react';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead } from '../components/ui.js';
import { DataList } from '../ds/list/DataList.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { fmtForeign, type Supplier } from './PurchasesPage.js';

// Поставщики (Mika, 28.09.2026): the factories themselves, so a card can be
// opened — and corrected — before anything has been ordered from it. Until now
// the only way in was through an order.

export function SuppliersPage() {
  const t = useT();
  const { data, failure, reload } = useLoad<{ suppliers: Supplier[] }>('/api/suppliers');

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  // One figure per currency, as on the card: two currencies do not add up.
  const debt = (s: Supplier) => s.debt.filter((d) => d.minor > 0);
  const debtText = (s: Supplier) => debt(s).map((d) => fmtForeign(d.minor, d.currency)).join(' · ');
  const debtCell = (s: Supplier, none: ReactNode) =>
    debt(s).length > 0 ? <span className="mono crit-text">{debtText(s)}</span> : none;

  return (
    <>
      <PageHead wrap title={t.buy.suppliers} sub={t.buy.suppliersCount(data.suppliers.length)} />
      <DataList
        rows={data.suppliers}
        rowKey={(s) => s.id}
        href={(s) => `/purchases/suppliers/${s.id}`}
        fallback={(a, b) => a.name.localeCompare(b.name)}
        search={{
          placeholder: t.buy.suppliersSearch,
          match: (s, q) => spellingMatches(q, [s.name, s.country, s.contact, s.phone]),
        }}
        empty={{ text: t.buy.suppliersNone }}
        card={(s) => ({
          title: s.name,
          sub: s.country ?? undefined,
          right: debtCell(s, null),
          rightSub: <span className="muted">{t.supplierCard.ordersCount(s.orders)}</span>,
        })}
        columns={[
          { key: 'name', label: t.buy.supplierName, cell: (s) => <span>{s.name}</span>, sort: { value: (s) => s.name } },
          { key: 'country', label: t.buy.supplierCountry, cell: (s) => <span className="muted">{s.country ?? t.common.dash}</span>, sort: { value: (s) => s.country } },
          { key: 'phone', label: t.buy.supplierPhone, cell: (s) => <span className="mono">{s.phone ?? t.common.dash}</span> },
          { key: 'orders', label: t.supplierCard.orders, num: true, cell: (s) => <span className="mono">{s.orders}</span>, sort: { value: (s) => s.orders, first: 'desc' } },
          {
            key: 'debt',
            label: t.supplierCard.debt,
            num: true,
            cell: (s) => debtCell(s, <span className="muted">{t.common.dash}</span>),
          },
        ]}
      />
    </>
  );
}
