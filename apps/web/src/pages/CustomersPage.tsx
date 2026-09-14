import type { RentalStatus } from '@ev8/shared';
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { Empty, Loading, RentalBadge } from '../components/ui.js';
import { useT } from '../i18n/index.js';

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
  const [rows, setRows] = useState<Customer[] | null>(null);
  const [q, setQ] = useState('');
  useEffect(() => {
    void api.get<{ customers: Customer[] }>('/api/customers').then((r) => setRows(r.customers));
  }, []);

  const shown = useMemo(() => {
    if (!rows) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((c) => [c.name, c.nameKa, c.nameLat, c.phone].some((s) => s?.toLowerCase().includes(needle)));
  }, [rows, q]);

  if (!rows) return <Loading />;

  return (
    <>
      <header className="page-head">
        <h1>{t.customers.title}</h1>
        <span className="mono muted">{rows.length}</span>
      </header>
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
                <th>{t.customers.name}</th>
                <th>{t.customers.phone}</th>
                <th>{t.customers.personalId}</th>
                <th>{t.customers.tags}</th>
                <th>{t.customers.openRentals}</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td>
                    {c.name}
                    {c.nameLat && c.nameLat !== c.name && <span className="muted"> · {c.nameLat}</span>}
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
                        <span className="mono">{r.number}</span> <RentalBadge status={r.status} />
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
