import { ALL_CHIP, chipOnOpen, readQuery, type Query } from '@ev8/shared';
import { ArrowDownUp, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Drawer } from '../../components/Drawer.js';
import { useT } from '../../i18n/index.js';
import { rowClick } from '../../lib/rowLink.js';
import { SortHead, useSortable, type SortColumn } from '../../lib/sortable.js';
import './list.css';

export interface Column<T> {
  key: string;
  label: string;
  cell: (row: T) => ReactNode;
  /** Sortable when given; the same key is offered in the phone's sort sheet. */
  sort?: SortColumn<T>;
  num?: boolean;
  /** A class on the column's heading and cells: a column a narrow laptop hides (Fleet, «Причина»). */
  className?: string;
}

/** The heading's and the cells' classes: a number column's alignment and the column's own. */
const colClass = <T,>(c: Column<T>): string | undefined => [c.num ? 'num' : '', c.className ?? ''].filter(Boolean).join(' ') || undefined;

export interface Card {
  title: ReactNode;
  sub?: ReactNode;
  sub2?: ReactNode;
  right?: ReactNode;
  rightSub?: ReactNode;
}

export interface Chip<T> {
  key: string;
  label: string;
  test: (row: T) => boolean;
}

const PAGE = 50;

/**
 * One list for every section (wave 1 §3.6, ux.md "Правила экранов").
 *
 * Above it: a search of the section, filter chips with counts, and on a phone
 * a sort button whose options are the laptop's sortable columns. Below 900 px
 * each row is a two-line card; from 900 px a table whose headings sort. The
 * search (`q`), the chip (`f`) and the sort (`sort`, `dir`) all live in the
 * address, so the header search's "More N" arrives already filtered and a
 * list somebody is looking at is one they can send. Fifty rows, then "Show
 * more". A record just created is lit for two seconds.
 *
 * «Все» is the last chip of the row, and a list opened with no chip in its
 * address shows the first one (GitHub issue #17, item 2): `chipOnOpen`.
 * «Все» is written in the address as `f=all`, so a link that wants every row
 * — the header search's "More N" — says so.
 */
export function DataList<T>({
  rows,
  rowKey,
  href,
  columns,
  card,
  search,
  chips = [],
  fallback,
  byDefault,
  empty,
}: {
  rows: T[];
  rowKey: (row: T) => string;
  href?: (row: T) => string;
  columns: Column<T>[];
  card: (row: T) => Card;
  /** What was typed, read by the header search's rule (shared/search.ts); one character searches nothing. */
  search?: { placeholder: string; match: (row: T, q: Query) => boolean };
  chips?: Chip<T>[];
  fallback: (a: T, b: T) => number;
  byDefault?: string;
  empty: { text: string; action?: ReactNode };
}) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const opened = chipOnOpen(params.get('f'), chips.map((c) => c.key));
  const chip = chips.find((c) => c.key === opened) ?? null;
  const [limit, setLimit] = useState(PAGE);
  const [sorting, setSorting] = useState(false);
  const [lit, setLit] = useState<string | null>((location.state as { created?: string } | null)?.created ?? null);

  // A form on this page that just created a record says so in the address state.
  const created = (location.state as { created?: string } | null)?.created;
  useEffect(() => {
    if (created) setLit(created);
  }, [created]);

  useEffect(() => {
    if (!lit) return;
    const id = window.setTimeout(() => setLit(null), 2000);
    return () => window.clearTimeout(id);
  }, [lit]);

  // The new record is brought into view: lit below the fold it is not seen at all (QA-W1-06).
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!lit) return;
    const el = [...(root.current?.querySelectorAll<HTMLElement>('.lit') ?? [])].find((e) => e.offsetParent !== null);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [lit, rows]);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
    setLimit(PAGE);
  };

  // «Искать во всех»: a chip that holds nothing widens to «Все» and keeps what
  // was typed — a list opens on its first chip since issue #17, so this is
  // the usual way here, not a rare one. With nothing left to widen, the
  // search lets go. «Все» is written as `f=all`: an address without a chip
  // opens the first one.
  const showAll = () => {
    const next = new URLSearchParams(params);
    if (chip) next.set('f', ALL_CHIP);
    else {
      next.delete('q');
      if (chips.length > 0) next.set('f', ALL_CHIP);
      else next.delete('f');
    }
    setParams(next, { replace: true });
    setLimit(PAGE);
  };

  const query = useMemo(() => readQuery(q), [q]);
  const searched = useMemo(() => (query && search ? rows.filter((r) => search.match(r, query)) : rows), [rows, query, search]);
  const filtered = useMemo(() => (chip ? searched.filter(chip.test) : searched), [searched, chip]);
  const spec = Object.fromEntries(columns.filter((c) => c.sort).map((c) => [c.key, c.sort!]));
  const sorted = useSortable(filtered, spec, fallback, byDefault);
  const shown = sorted.rows.slice(0, limit);
  const sortable = columns.filter((c) => c.sort);

  const counts = useMemo(() => Object.fromEntries(chips.map((c) => [c.key, searched.filter(c.test).length])), [chips, searched]);

  return (
    <div className="datalist" ref={root}>
      {(search || chips.length > 0 || sortable.length > 0) && (
        <div className="list-toolbar">
          {search && (
            <label className="dl-search">
              <Search size={18} strokeWidth={1.75} aria-hidden="true" />
              <input className="dl-search-input" value={q} placeholder={search.placeholder} onChange={(e) => setParam('q', e.target.value || null)} aria-label={search.placeholder} />
            </label>
          )}
          {sortable.length > 0 && (
            <button type="button" className="list-sort-btn" onClick={() => setSorting(true)} aria-label={t.lists.sort}>
              <ArrowDownUp size={20} strokeWidth={1.75} aria-hidden="true" />
            </button>
          )}
          {chips.length > 0 && (
            <div className="list-chips" role="group">
              {/* A chip tapped again lets go of it: everything shows, as «Все» does. */}
              {chips.map((c) => (
                <button key={c.key} type="button" className={`list-chip ${chip?.key === c.key ? 'on' : ''}`} onClick={() => setParam('f', chip?.key === c.key ? ALL_CHIP : c.key)}>
                  {c.label} <span className="n">{counts[c.key]}</span>
                </button>
              ))}
              <button type="button" className={`list-chip ${chip ? '' : 'on'}`} onClick={() => setParam('f', ALL_CHIP)}>
                {t.common.all} <span className="n">{searched.length}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {rows.length === 0 ? (
        <div className="list-empty">
          <p>{empty.text}</p>
          {empty.action}
        </div>
      ) : filtered.length === 0 ? (
        <div className="list-empty">
          <p>{query ? (chip ? t.lists.nothingIn(q, chip.label) : t.lists.nothing(q)) : t.lists.noneIn(chip?.label ?? '')}</p>
          <button type="button" className="pill pill-sm" onClick={showAll}>
            {t.lists.showAll}
          </button>
        </div>
      ) : (
        <>
          {/* Phone: cards. */}
          <ul className="list-cards">
            {shown.map((r) => {
              const c = card(r);
              const key = rowKey(r);
              const body = (
                <>
                  <span className="lc-main">
                    <span className="lc-title">{c.title}</span>
                    {c.sub != null && <span className="lc-sub">{c.sub}</span>}
                    {c.sub2 != null && <span className="lc-sub">{c.sub2}</span>}
                  </span>
                  {(c.right != null || c.rightSub != null) && (
                    <span className="lc-right">
                      {c.right}
                      {c.rightSub != null && <span className="lc-sub">{c.rightSub}</span>}
                    </span>
                  )}
                </>
              );
              return (
                <li key={key}>
                  {href ? (
                    <Link to={href(r)} className={`list-card ${lit === key ? 'lit' : ''}`}>
                      {body}
                    </Link>
                  ) : (
                    <div className={`list-card ${lit === key ? 'lit' : ''}`}>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* Laptop: the table, every heading sorts (U17). */}
          <div className="table-wrap list-table">
            <table className="table">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={colClass(c)}>
                      {c.sort ? <SortHead k={c.key} label={c.label} {...sorted} /> : c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={rowKey(r)} className={`${href ? 'row-go' : ''} ${lit === rowKey(r) ? 'lit' : ''}`} onClick={href ? rowClick(() => navigate(href(r))) : undefined}>
                    {columns.map((c) => (
                      <td key={c.key} className={colClass(c)}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {sorted.rows.length > limit && (
            <button type="button" className="list-more" onClick={() => setLimit((n) => n + PAGE)}>
              {t.lists.showMore(sorted.rows.length - limit)}
            </button>
          )}
        </>
      )}

      {sorting && (
        <Drawer title={t.lists.sort} onClose={() => setSorting(false)}>
          <div className="act-list">
            {sortable.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`act-item sort-item ${sorted.sort === c.key ? 'on' : ''}`}
                onClick={() => {
                  sorted.pick(c.key);
                  setSorting(false);
                }}
              >
                {c.label}
                {sorted.sort === c.key && <span className="sort-dir">{sorted.dir === 'asc' ? '↑' : '↓'}</span>}
              </button>
            ))}
          </div>
        </Drawer>
      )}
    </div>
  );
}
