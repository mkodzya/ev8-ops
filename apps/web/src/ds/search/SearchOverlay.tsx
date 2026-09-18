import { SEARCH_MIN, formatGel } from '@ev8/shared';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, Clock, Search, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { fmtDate, vinParts } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useConnection } from '../../lib/connection.js';
import { errorText } from '../../lib/use.js';
import { useSession } from '../../session.js';
import { forgetRecent, readRecent, rememberRecent, type Recent } from './recent.js';
import './search.css';

type Kind = 'customers' | 'vehicles' | 'rentals' | 'sales' | 'payments' | 'purchases' | 'jobs';
interface Group<T> {
  total: number;
  items: T[];
}
interface Answer {
  q: string | null;
  groups: {
    customers: Group<{ id: string; name: string; nameKa: string | null; nameLat: string | null; phone: string | null; debtTetri: number }>;
    vehicles: Group<{ id: string; vin: string; state: string; model: string }>;
    rentals: Group<{ id: string; number: string; status: string; customer: string; vin: string | null; debtTetri: number }>;
    sales: Group<{ id: string; number: string; status: string; customer: string; vin: string | null }>;
    payments: Group<{ id: string; grossTetri: number; occurredOn: string; channel: string; voided: boolean; customer: string | null; rental: { id: string; number: string } | null; sale: { id: string; number: string } | null }>;
    purchases: Group<{ id: string; number: string; status: string; supplier: string; invoiceNo: string | null }> | null;
    jobs: Group<{ id: string; number: string; status: string; reason: string; vin: string; model: string }>;
  } | null;
}

interface Row {
  key: string;
  title: ReactNode;
  sub: ReactNode;
  href: string;
  recent: Omit<Recent, 'at'>;
}

const ORDER: Kind[] = ['customers', 'vehicles', 'rentals', 'sales', 'payments', 'purchases', 'jobs'];

/** The last characters of a VIN on lime, the way every list shows them. */
const Tail = ({ vin }: { vin: string }) => <span className="mono">···{vinParts(vin).tail}</span>;

/**
 * The search in the header (wave 1 §3.5): a full screen on a phone, a box
 * over the page on a laptop. From the second character, 250 ms after typing
 * stops. Empty field — the last records opened from here. No connection —
 * those records only, and it says so.
 */
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const { can } = useSession();
  const { online } = useConnection();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setQ(text.trim()), 250);
    return () => window.clearTimeout(id);
  }, [text]);

  useEffect(() => {
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, [onClose]);

  const ready = q.length >= SEARCH_MIN;
  const answer = useQuery<Answer>({
    queryKey: ['/api/search', q],
    queryFn: () => api.get<Answer>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: ready && online,
    staleTime: 10_000,
  });

  const recent = readRecent();
  const recentMatches = useMemo(() => {
    if (!ready) return recent;
    const needle = q.toLowerCase();
    return recent.filter((r) => `${r.title} ${r.sub}`.toLowerCase().includes(needle));
  }, [recent, ready, q]);

  const groups = answer.data?.groups ?? null;
  const moreHref: Record<Kind, string> = {
    customers: '/customers',
    vehicles: '/fleet',
    rentals: '/rentals',
    sales: '/sales',
    payments: can('payments.view') ? '/money/payments' : '/money/cash',
    purchases: '/purchases',
    jobs: '/service',
  };

  const rows: Partial<Record<Kind, Row[]>> = {};
  if (groups) {
    rows.customers = groups.customers.items.map((c) => ({
      key: `c-${c.id}`,
      title: c.name,
      // The one debt figure, as on the card (wave 2 §3.7).
      sub: [c.nameKa !== c.name ? c.nameKa : c.nameLat, c.phone, c.debtTetri > 0 ? t.money.owes(formatGel(c.debtTetri)) : null].filter(Boolean).join(' · '),
      href: `/customers/${c.id}`,
      recent: { href: `/customers/${c.id}`, title: c.name, sub: c.phone ?? '' },
    }));
    rows.vehicles = groups.vehicles.items.map((v) => ({
      key: `v-${v.id}`,
      title: (
        <>
          <Lit text={v.model} q={q} /> <Tail vin={v.vin} />
        </>
      ),
      sub: t.states[v.state as keyof typeof t.states] ?? v.state,
      href: `/fleet/${v.id}`,
      recent: { href: `/fleet/${v.id}`, title: `${v.model} ···${vinParts(v.vin).tail}`, sub: v.vin },
    }));
    rows.rentals = groups.rentals.items.map((r) => ({
      key: `r-${r.id}`,
      title: `${r.number} · ${r.customer}`,
      sub: (
        <>
          {r.vin ? <Tail vin={r.vin} /> : null}
          {r.debtTetri > 0 && <span className="crit-text"> {t.money.owes(formatGel(r.debtTetri))}</span>}
        </>
      ),
      href: `/rentals/${r.id}`,
      recent: { href: `/rentals/${r.id}`, title: `${r.number} · ${r.customer}`, sub: r.vin ?? '' },
    }));
    rows.sales = groups.sales.items.map((s) => ({
      key: `s-${s.id}`,
      title: `${s.number} · ${s.customer}`,
      sub: s.vin ? <Tail vin={s.vin} /> : '',
      href: `/sales/${s.id}`,
      recent: { href: `/sales/${s.id}`, title: `${s.number} · ${s.customer}`, sub: s.vin ?? '' },
    }));
    rows.payments = groups.payments.items.map((p) => {
      const href = p.rental ? `/rentals/${p.rental.id}` : p.sale ? `/sales/${p.sale.id}` : `${moreHref.payments}?q=${encodeURIComponent(q)}`;
      const title = `${formatGel(p.grossTetri)} · ${t.payments.channels[p.channel as keyof typeof t.payments.channels] ?? p.channel}`;
      const sub = [fmtDate(p.occurredOn), p.rental?.number ?? p.sale?.number, p.customer].filter(Boolean).join(' · ');
      return { key: `p-${p.id}`, title, sub, href, recent: { href, title, sub } };
    });
    if (groups.purchases) {
      rows.purchases = groups.purchases.items.map((p) => ({
        key: `po-${p.id}`,
        title: `${p.number} · ${p.supplier}`,
        sub: p.invoiceNo ?? '',
        href: `/purchases/${p.id}`,
        recent: { href: `/purchases/${p.id}`, title: `${p.number} · ${p.supplier}`, sub: p.invoiceNo ?? '' },
      }));
    }
    rows.jobs = groups.jobs.items.map((j) => ({
      key: `j-${j.id}`,
      title: (
        <>
          {j.number} · {j.model} <Tail vin={j.vin} />
        </>
      ),
      sub: j.reason,
      href: `/service/${j.id}`,
      recent: { href: `/service/${j.id}`, title: `${j.number} · ${j.model} ···${vinParts(j.vin).tail}`, sub: j.reason },
    }));
  }
  const flat = ORDER.flatMap((k) => rows[k] ?? []);

  const open = (href: string, remember?: Omit<Recent, 'at'>) => {
    if (remember) rememberRecent(remember);
    onClose();
    navigate(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const list = flat.length ? flat : !ready ? recentMatches.map((r) => ({ href: r.href, recent: r })) : [];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, Math.max(0, list.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && list[active]) {
      e.preventDefault();
      open(list[active].href, 'recent' in list[active] ? list[active].recent : undefined);
    }
  };

  const digits = q.replace(/\D/g, '');
  const nothing = ready && groups && flat.length === 0;
  const total = (k: Kind) => (groups?.[k] as Group<unknown> | null)?.total ?? 0;
  let index = -1;

  const body = !online ? (
    <>
      <p className="search-note">{t.searchUi.offline}</p>
      <RecentList items={recentMatches} onOpen={open} empty={t.searchUi.recentNone} />
    </>
  ) : !ready ? (
    <>
      {recent.length > 0 && <h3 className="search-group">{t.searchUi.recent}</h3>}
      <RecentList items={recent} onOpen={open} active={active} empty={null} />
      <p className="search-note">{t.searchUi.hint}</p>
    </>
  ) : answer.isError && !groups ? (
    <div className="search-failed">
      <p>{t.searchUi.failed}</p>
      <p className="search-note">{errorText(answer.error)}</p>
      <button type="button" className="pill pill-sm" onClick={() => void answer.refetch()}>
        {t.errors.retry}
      </button>
    </div>
  ) : !groups ? (
    <div className="search-skeleton" aria-busy="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton-row">
          <span className="skel skel-a" />
          <span className="skel skel-b" />
        </div>
      ))}
    </div>
  ) : nothing ? (
    <div className="search-nothing">
      <p className="search-nothing-title">{t.searchUi.nothing(q)}</p>
      <p className="search-note">{t.searchUi.hint}</p>
      {digits.length >= 6 && can('customer.create') && (
        <button type="button" className="pill pill-sm" onClick={() => open(`/customers/new?phone=${encodeURIComponent(digits)}`)}>
          <UserPlus size={16} strokeWidth={1.75} aria-hidden="true" /> {t.searchUi.newCustomerWith(digits)}
        </button>
      )}
    </div>
  ) : (
    ORDER.map((k) => {
      const list = rows[k];
      if (!list || list.length === 0) return null;
      return (
        <section key={k} className="search-section">
          <h3 className="search-group">
            {t.searchUi.groups[k]} <span className="search-count">{total(k)}</span>
          </h3>
          {list.map((r) => {
            index++;
            const i = index;
            return (
              <button key={r.key} type="button" className={`search-row ${i === active ? 'on' : ''}`} onMouseEnter={() => setActive(i)} onClick={() => open(r.href, r.recent)}>
                <span className="search-row-title">
                  <Lit text={r.title} q={q} />
                </span>
                {r.sub && (
                  <span className="search-row-sub">
                    <Lit text={r.sub} q={q} />
                  </span>
                )}
              </button>
            );
          })}
          {total(k) > list.length && (
            <button type="button" className="search-more" onClick={() => open(`${moreHref[k]}?q=${encodeURIComponent(q)}`)}>
              {t.searchUi.more(total(k) - list.length)}
            </button>
          )}
        </section>
      );
    })
  );

  return createPortal(
    <div className="search-scrim" role="presentation" onClick={onClose}>
      <div className="search-box" role="dialog" aria-modal="true" aria-label={t.shell.search} onClick={(e) => e.stopPropagation()}>
        <div className="search-field">
          <button type="button" className="icon-btn search-back" onClick={onClose} aria-label={t.shell.back}>
            <ChevronLeft size={24} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <Search className="search-icon" size={18} strokeWidth={1.75} aria-hidden="true" />
          <input
            ref={input}
            className="search-input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={t.searchUi.placeholder}
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
          />
        </div>
        <div className="search-body">{body}</div>
      </div>
    </div>,
    document.body,
  );
}

function RecentList({ items, onOpen, active = -1, empty }: { items: Recent[]; onOpen: (href: string, r: Omit<Recent, 'at'>) => void; active?: number; empty: string | null }) {
  if (items.length === 0) return empty ? <p className="search-note">{empty}</p> : null;
  return (
    <>
      {items.map((r, i) => (
        <button key={r.href} type="button" className={`search-row ${i === active ? 'on' : ''}`} onClick={() => onOpen(r.href, r)}>
          <span className="search-row-title">
            <Clock size={14} strokeWidth={1.75} aria-hidden="true" /> {r.title}
          </span>
          {r.sub && <span className="search-row-sub">{r.sub}</span>}
        </button>
      ))}
    </>
  );
}

export { forgetRecent };

/**
 * What was typed, in bold where it occurs (wave 1 §3.5, "Совпадение
 * подсвечено"). Only plain text is marked: a VIN tail or a formatted amount is
 * already the part that matched.
 */
function Lit({ text, q }: { text: React.ReactNode; q: string }) {
  if (typeof text !== 'string' || !q) return <>{text}</>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <>{text}</>;
  // One span: the row title is a flex line, and bare pieces would be spaced apart.
  return (
    <span>
      {text.slice(0, at)}
      <mark className="search-hit">{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </span>
  );
}
