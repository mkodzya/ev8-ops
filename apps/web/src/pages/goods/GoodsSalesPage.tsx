import { countedName, numberMatches, phoneMatches, spellingMatches } from '@ev8/shared';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Loading, PageHead } from '../../components/ui.js';
import { DataList } from '../../ds/list/DataList.js';
import { fmtDate, formatGel } from '../../format.js';
import { useLocale, useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';

// «Продажи → Товары» (issue #11, ADR-0045): parts and chargers sold over the
// counter. One line a sale: who bought — a customer, or a retail buyer with no
// card — what, and where its money stands.

export type GoodsState = 'paid' | 'waiting_bank' | 'owes' | 'cancelled';

export interface GoodsItem {
  name: string;
  nameKa: string | null;
  countedItem: string | null;
  spec: string | null;
  partId: string | null;
  qty: number;
}

export interface GoodsRow {
  id: string;
  number: string;
  soldOn: string;
  status: 'active' | 'cancelled';
  customer: { id: string; name: string } | null;
  buyer: { name: string | null; phone: string | null } | null;
  items: GoodsItem[];
  totalTetri: number;
  paidTetri: number;
  openTetri: number;
  state: GoodsState;
}

/** An item as the screen names it: a charger in the screen's language, a part by its name in Georgian when the screen is Georgian. */
export function useItemName() {
  const { locale } = useLocale();
  return (i: { name: string; nameKa: string | null; countedItem: string | null; spec: string | null }): string => {
    if (i.countedItem === 'charger' || i.countedItem === 'battery') return countedName(i.countedItem, i.spec)[locale];
    return locale === 'ka' && i.nameKa ? i.nameKa : i.name;
  };
}

/** «Зарядка 73V6A ×1», and «+2» for the rest. */
export function useItemsText() {
  const t = useT();
  const named = useItemName();
  return (items: GoodsItem[]): string => {
    const first = items[0];
    if (!first) return '';
    const head = `${named(first)} ×${first.qty}`;
    return items.length > 1 ? `${head} · ${t.goods.more(items.length - 1)}` : head;
  };
}

/** The pill of a sale's money: paid, waiting for the bank, owes N, cancelled. */
export function GoodsPill({ state, openTetri }: { state: GoodsState; openTetri: number }) {
  const t = useT();
  const cls = state === 'owes' ? 'crit-text' : state === 'waiting_bank' ? 'warn-text' : state === 'paid' ? 'ok-text' : 'muted';
  return <span className={cls}>{state === 'owes' ? `${t.goods.states.owes} ${formatGel(openTetri, { decimals: false })}` : t.goods.states[state]}</span>;
}

export function buyerName(t: ReturnType<typeof useT>, s: { customer: { name: string } | null; buyer: { name: string | null } | null }): string {
  return s.customer?.name ?? (s.buyer?.name ? `${t.goods.retail} · ${s.buyer.name}` : t.goods.retail);
}

export function GoodsSalesPage() {
  const t = useT();
  const { can } = useSession();
  const items = useItemsText();
  const named = useItemName();
  const { data, failure, reload } = useLoad<{ count: number; openCount: number; openTetri: number; sales: GoodsRow[] }>('/api/goods-sales');

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead wrap title={t.goods.title} sub={t.goods.count(data.count)}>
        {data.openCount > 0 && (
          <Link className="muted mono" to="/sales/goods?f=open">
            {t.goods.awaiting(data.openCount, formatGel(data.openTetri, { decimals: false }))}
          </Link>
        )}
        {can('goods.sell') && (
          <Link className="pill pill-sm pill-accent" to="/sales/goods/new">
            {t.goods.sell}
          </Link>
        )}
      </PageHead>
      <DataList
        rows={data.sales}
        rowKey={(s) => s.id}
        href={(s) => `/sales/goods/${s.id}`}
        fallback={(a, b) => b.soldOn.localeCompare(a.soldOn) || b.number.localeCompare(a.number)}
        search={{
          placeholder: t.goods.search,
          match: (s, q) =>
            numberMatches(q, s.number) ||
            spellingMatches(q, [s.customer?.name, s.buyer?.name, ...s.items.flatMap((i) => [i.name, i.nameKa, i.spec, named(i)])]) ||
            phoneMatches(q, s.buyer?.phone),
        }}
        chips={[
          { key: 'open', label: t.goods.segments.open, test: (s) => s.openTetri > 0 },
          { key: 'cancelled', label: t.goods.segments.cancelled, test: (s) => s.status === 'cancelled' },
        ]}
        empty={{
          text: t.goods.none,
          action: can('goods.sell') ? (
            <Link className="pill pill-sm pill-accent" to="/sales/goods/new">
              {t.goods.sell}
            </Link>
          ) : undefined,
        }}
        card={(s) => ({
          title: buyerName(t, s),
          sub: (
            <>
              <span className="mono">{s.number}</span> · {items(s.items)} · {fmtDate(s.soldOn)}
            </>
          ),
          right: <span className={`t-money ${s.state === 'owes' ? 'crit-text' : ''}`}>{formatGel(s.openTetri || s.totalTetri, { decimals: false })}</span>,
          rightSub: <GoodsPill state={s.state} openTetri={s.openTetri} />,
        })}
        columns={[
          { key: 'number', label: t.goods.cols.number, cell: (s) => <span className="mono">{s.number}</span>, sort: { value: (s) => s.number } },
          { key: 'soldOn', label: t.goods.cols.soldOn, cell: (s) => <span className="mono">{fmtDate(s.soldOn)}</span>, sort: { value: (s) => s.soldOn, first: 'desc' } },
          {
            key: 'buyer',
            label: t.goods.cols.buyer,
            cell: (s) => (s.customer ? <Link to={`/customers/${s.customer.id}`}>{s.customer.name}</Link> : <span className="muted">{buyerName(t, s)}</span>),
            sort: { value: (s) => s.customer?.name ?? s.buyer?.name ?? '' },
          },
          { key: 'items', label: t.goods.cols.items, cell: (s) => items(s.items) },
          { key: 'total', label: t.goods.cols.total, num: true, cell: (s) => <span className="mono">{formatGel(s.totalTetri)}</span>, sort: { value: (s) => s.totalTetri, first: 'desc' } },
          {
            key: 'open',
            label: t.goods.cols.open,
            num: true,
            cell: (s) => <span className={`mono ${s.state === 'owes' ? 'crit-text' : ''}`}>{s.openTetri > 0 ? formatGel(s.openTetri) : t.common.dash}</span>,
            sort: { value: (s) => s.openTetri, first: 'desc' },
          },
          { key: 'state', label: t.goods.cols.state, cell: (s) => <GoodsPill state={s.state} openTetri={s.openTetri} />, sort: { value: (s) => s.state } },
        ]}
      />
    </>
  );
}
