import { numberMatches, parseGel, spellingMatches, todayISO, vinMatches } from '@ev8/shared';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Loading, PageHead, Vin } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { DataList } from '../ds/list/DataList.js';
import { FormSheet } from '../ds/form/Form.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

export type SaleStatus = 'active' | 'cancelled' | 'bought_back';

export interface Sale {
  id: string;
  number: string;
  soldOn: string;
  priceTetri: number;
  paidTetri: number;
  outstandingTetri: number;
  overdueTetri: number;
  extras: string | null;
  warrantyUntil: string | null;
  status: SaleStatus;
  boughtBackOn: string | null;
  notes: string | null;
  customer: { id: string; name: string; phone?: string | null };
  vehicle: { id: string; vin: string; model: string } | null;
  vinNote: string | null;
  aheadTetri: number;
  lateDays: number;
  instalments: { id: string; seq: number; dueOn: string; amountTetri: number; paidTetri: number; payStatus: 'unpaid' | 'partial' | 'paid'; overdue: boolean; state: 'paid' | 'overdue' | 'ahead'; days: number }[];
}

interface FleetVehicle {
  id: string;
  vin: string;
  model: string;
  state: 'available' | 'rented' | 'service' | 'out' | 'sold';
}

export function SalesPage() {
  const t = useT();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<{ overdueTetri: number; sales: Sale[] }>('/api/sales');

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead wrap title={t.sales.title} sub={t.sales.count(data.sales.length)}>
        {data.overdueTetri > 0 && (
          <span className="crit-text mono">
            {t.sales.overdue}: {formatGel(data.overdueTetri, { decimals: false })}
          </span>
        )}
        {can('sales.manage') && (
          <Link className="pill pill-sm pill-accent" to="/sales/new">
            {t.sales.newSale}
          </Link>
        )}
      </PageHead>
      <DataList
        rows={data.sales}
        rowKey={(s) => s.id}
        href={(s) => `/sales/${s.id}`}
        fallback={(a, b) => b.soldOn.localeCompare(a.soldOn) || a.number.localeCompare(b.number)}
        search={{
          placeholder: t.lists.salesSearch,
          match: (s, q) => numberMatches(q, s.number) || spellingMatches(q, [s.customer.name, s.vehicle?.model, s.vinNote]) || vinMatches(q, s.vehicle?.vin),
        }}
        chips={[
          { key: 'instalments', label: t.lists.chips.withInstalments, test: (s) => s.instalments.length > 0 },
          { key: 'overdue', label: t.lists.chips.instalmentOverdue, test: (s) => s.overdueTetri > 0 },
          { key: 'boughtBack', label: t.sales.statuses.bought_back, test: (s) => s.status === 'bought_back' },
        ]}
        empty={{ text: t.sales.none }}
        card={(s) => {
          const paidInstalments = s.instalments.filter((i) => i.payStatus === 'paid').length;
          return {
            title: s.customer.name,
            sub: (
              <>
                {s.number}
                {s.vehicle && (
                  <>
                    {' · '}
                    {s.vehicle.model} <span className="mono">···{s.vehicle.vin.slice(-4)}</span>
                  </>
                )}
              </>
            ),
            sub2: (
              <>
                {fmtDate(s.soldOn)}
                {s.instalments.length > 0 && <> · {t.lists.instalmentOf(paidInstalments, s.instalments.length)}</>}
              </>
            ),
            right:
              s.overdueTetri > 0 ? (
                <span className="t-money crit-text">{formatGel(s.overdueTetri, { decimals: false })}</span>
              ) : (
                <span className="t-money">{formatGel(s.outstandingTetri, { decimals: false })}</span>
              ),
            rightSub: t.sales.statuses[s.status],
          };
        }}
        columns={[
          { key: 'number', label: t.sales.number, cell: (s) => <span className="mono">{s.number}</span>, sort: { value: (s) => s.number } },
          { key: 'soldOn', label: t.sales.soldOn, cell: (s) => <span className="mono">{fmtDate(s.soldOn)}</span>, sort: { value: (s) => s.soldOn, first: 'desc' } },
          { key: 'buyer', label: t.sales.buyer, cell: (s) => <Link to={`/customers/${s.customer.id}`}>{s.customer.name}</Link>, sort: { value: (s) => s.customer.name } },
          {
            key: 'vehicle',
            label: t.sales.vehicle,
            cell: (s) =>
              s.vehicle ? (
                <Link to={`/fleet/${s.vehicle.id}`}>
                  <Vin vin={s.vehicle.vin} />
                </Link>
              ) : (
                <span className="muted">{s.vinNote}</span>
              ),
            sort: { value: (s) => s.vehicle?.vin ?? s.vinNote },
          },
          { key: 'price', label: t.sales.price, num: true, cell: (s) => <span className="mono">{formatGel(s.priceTetri, { decimals: false })}</span>, sort: { value: (s) => s.priceTetri, first: 'desc' } },
          { key: 'paid', label: t.sales.paid, num: true, cell: (s) => <span className="mono">{formatGel(s.paidTetri, { decimals: false })}</span>, sort: { value: (s) => s.paidTetri, first: 'desc' } },
          { key: 'outstanding', label: t.sales.outstanding, num: true, cell: (s) => <span className="mono">{formatGel(s.outstandingTetri, { decimals: false })}</span>, sort: { value: (s) => s.outstandingTetri, first: 'desc' } },
          {
            key: 'overdue',
            label: t.sales.overdue,
            num: true,
            cell: (s) => <span className={`mono ${s.overdueTetri > 0 ? 'crit-text' : ''}`}>{s.overdueTetri > 0 ? formatGel(s.overdueTetri, { decimals: false }) : t.common.dash}</span>,
            sort: { value: (s) => s.overdueTetri, first: 'desc' },
          },
          { key: 'status', label: t.fleet.state, cell: (s) => <span className="muted">{t.sales.statuses[s.status]}</span>, sort: { value: (s) => s.status } },
        ]}
      />
    </>
  );
}
