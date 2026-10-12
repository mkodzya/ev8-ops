import { phoneMatches, spellingMatches, type RentalStatus } from '@ev8/shared';
import { Link } from 'react-router-dom';
import { useSession } from '../session.js';
import { LoadError } from '../components/LoadError.js';
import { useLoad } from '../lib/use.js';
import { CustomerName, Loading, PageHead, RentalBadge } from '../components/ui.js';
import { DataList } from '../ds/list/DataList.js';
import { formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { byName, primaryName, secondName } from '../lib/names.js';

interface Customer {
  id: string;
  name: string;
  nameKa: string | null;
  nameLat: string | null;
  personalId: string | null;
  phone: string | null;
  tags: string[];
  openRentals: { id: string; number: string; status: RentalStatus }[];
  rentals: number;
  debtTetri: number;
  /** Of debtTetri: awaited today and not late (ADR-0017). */
  dueTodayTetri: number;
  buyer: boolean;
}

// One figure, two names (ADR-0017). A debtor has something in it older than
// what is awaited today — red, under the chip «owing». A figure that is all
// awaited today is ink, with the calendar's word under it: never colour alone.
// An answer without the field (an older API in the seconds of a deploy) reads
// as a debt: nobody turns calm because a number did not arrive.
const isDebtor = (c: Customer) => c.debtTetri - (c.dueTodayTetri ?? 0) > 0;
const isAwaited = (c: Customer) => c.debtTetri > 0 && !isDebtor(c);

export function CustomersPage() {
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<{ customers: Customer[] }>('/api/customers');
  const rows = data?.customers ?? null;

  if (!rows && failure) return <LoadError failure={failure} onRetry={reload} />;
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
      <DataList
        rows={rows}
        rowKey={(c) => c.id}
        href={(c) => `/customers/${c.id}`}
        // Search every spelling — a name typed in Latin should find the card
        // whose Georgian spelling leads — but order by the one on screen (U14).
        fallback={byName(locale)}
        search={{
          placeholder: t.lists.customersSearch,
          match: (c, q) => spellingMatches(q, [c.name, c.nameKa, c.nameLat]) || phoneMatches(q, c.phone),
        }}
        chips={[
          { key: 'renting', label: t.lists.chips.withRental, test: (c) => c.openRentals.length > 0 },
          { key: 'owing', label: t.lists.chips.owing, test: isDebtor },
          { key: 'buyers', label: t.lists.chips.buyers, test: (c) => c.buyer },
        ]}
        empty={{
          text: t.customers.empty,
          action: can('customer.create') ? (
            <Link className="pill pill-sm pill-accent" to="/customers/new">
              {t.actions.newCustomer}
            </Link>
          ) : undefined,
        }}
        card={(c) => {
          const other = secondName(c, locale);
          return {
            title: primaryName(c, locale),
            sub: (
              <>
                {c.phone && <span className="mono">{c.phone}</span>}
                {c.phone && other && ' · '}
                {other}
              </>
            ),
            right: c.debtTetri > 0 ? <span className={`t-money ${isDebtor(c) ? 'crit-text' : ''}`}>{formatGel(c.debtTetri, { decimals: false })}</span> : undefined,
            rightSub: isAwaited(c) ? t.calendar.said.due_today : c.rentals > 0 ? t.lists.rentalsCount(c.rentals) : undefined,
          };
        }}
        columns={[
          { key: 'name', label: t.customers.name, cell: (c) => <CustomerName of={c} />, sort: { value: (c) => primaryName(c, locale) } },
          { key: 'phone', label: t.customers.phone, cell: (c) => <span className="mono">{c.phone ?? t.common.dash}</span>, sort: { value: (c) => c.phone } },
          { key: 'personalId', label: t.customers.personalId, cell: (c) => <span className="mono">{c.personalId ?? t.common.dash}</span>, sort: { value: (c) => c.personalId } },
          {
            key: 'tags',
            label: t.customers.tags,
            cell: (c) =>
              c.tags.map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              )),
            sort: { value: (c) => c.tags.join(' ') },
          },
          {
            key: 'openRentals',
            label: t.customers.openRentals,
            cell: (c) =>
              c.openRentals.map((r) => (
                <span key={r.id} className="inline-rental">
                  <Link to={`/rentals/${r.id}`} className="mono">
                    {r.number}
                  </Link>{' '}
                  <RentalBadge status={r.status} />
                </span>
              )),
            sort: { value: (c) => c.openRentals.length, first: 'desc' },
          },
          {
            key: 'debt',
            label: t.lists.debt,
            num: true,
            cell: (c) =>
              isAwaited(c) ? (
                <span className="debt-awaited">
                  <span className="mono">{formatGel(c.debtTetri, { decimals: false })}</span>
                  <span className="muted">{t.calendar.said.due_today}</span>
                </span>
              ) : (
                <span className={`mono ${c.debtTetri > 0 ? 'crit-text' : 'muted'}`}>{c.debtTetri > 0 ? formatGel(c.debtTetri, { decimals: false }) : t.common.dash}</span>
              ),
            sort: { value: (c) => c.debtTetri, first: 'desc' },
          },
        ]}
      />
    </>
  );
}
