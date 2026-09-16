import type { RentalStatus } from '@ev8/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../session.js';
import { api } from '../api.js';
import { CustomerName, Empty, Loading, PageHead, RentalBadge } from '../components/ui.js';
import { useLocale, useT } from '../i18n/index.js';
import { byName, primaryName } from '../lib/names.js';
import { SortHead, useSortable } from '../lib/sortable.js';

interface Customer {
  id: string;
  name: string;
  nameKa: string | null;
  nameLat: string | null;
  personalId: string | null;
  phone: string | null;
  tags: string[];
  openRentals: { id: string; number: string; status: RentalStatus }[];
}

export function CustomersPage() {
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    void api.get<{ customers: Customer[] }>('/api/customers').then((r) => setRows(r.customers));
  }, []);

  const shown = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    // Search every spelling — a name typed in Latin should find the card
    // whose Georgian spelling leads — but order by the one on screen (U14).
    const found = needle ? rows.filter((c) => [c.name, c.nameKa, c.nameLat, c.phone].some((s) => s?.toLowerCase().includes(needle))) : rows;
    return [...found].sort(byName(locale));
  }, [rows, q, locale]);

  // The name order the screen already uses stays the default and the tie-break;
  // the headings only ask for something else.
  const sorted = useSortable(
    shown,
    {
      name: { value: (c) => primaryName(c, locale) },
      phone: { value: (c) => c.phone },
      personalId: { value: (c) => c.personalId },
      tags: { value: (c) => c.tags.join(' ') },
      openRentals: { value: (c) => c.openRentals.length, first: 'desc' },
    },
    byName(locale),
  );

  if (!rows) return <Loading />;

  return (
    <>
      <PageHead title={t.customers.title} sub={t.customers.count(rows.length)}>
        {can('customer.create') && (
          <Link className="pill pill-sm pill-accent" to="/customers/new">
            {t.actions.newCustomer}
          </Link>
        )}
      </PageHead>
      <div className="toolbar">
        <input className="input input-search" placeholder={t.common.search} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {shown.length === 0 ? (
        <Empty text={t.customers.empty} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th><SortHead k="name" label={t.customers.name} {...sorted} /></th>
                <th><SortHead k="phone" label={t.customers.phone} {...sorted} /></th>
                <th><SortHead k="personalId" label={t.customers.personalId} {...sorted} /></th>
                <th><SortHead k="tags" label={t.customers.tags} {...sorted} /></th>
                <th><SortHead k="openRentals" label={t.customers.openRentals} {...sorted} /></th>
              </tr>
            </thead>
            <tbody>
              {sorted.rows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/customers/${c.id}`}>
                      <CustomerName of={c} />
                    </Link>
                  </td>
                  <td className="mono">{c.phone ?? t.common.dash}</td>
                  <td className="mono">{c.personalId ?? t.common.dash}</td>
                  <td>
                    {c.tags.map((tag) => (
                      <span key={tag} className="chip">
                        {tag}
                      </span>
                    ))}
                  </td>
                  <td>
                    {c.openRentals.map((r) => (
                      <span key={r.id} className="inline-rental">
                        <Link to={`/rentals/${r.id}`} className="mono">{r.number}</Link> <RentalBadge status={r.status} />
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
