import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

/**
 * Sorting a list by clicking its headings, written once for every list.
 *
 * The fleet learned this first and it should not be learned again per screen:
 * the order lives in the address beside the filters, so a list somebody is
 * looking at is a list they can send; the default order is the *absence* of
 * both parameters, so a clean address means the usual order; and the arrow is
 * drawn only on the column doing the sorting.
 *
 * A column says how to read itself — a number, a string, or nothing — and
 * nothing always sorts last, whichever way the column points: "nobody said"
 * is not a small number and not an early letter.
 */
export type SortValue = string | number | null | undefined;
export interface SortColumn<T> {
  value: (row: T) => SortValue;
  /** Which way the first click reads it. Numbers usually mean "most first". */
  first?: 'asc' | 'desc';
}
export type SortSpec<T> = Record<string, SortColumn<T>>;

export function useSortable<T>(
  rows: T[],
  spec: SortSpec<T>,
  fallback: (a: T, b: T) => number,
  /** The order a clean address means. Without one, that is the order given. */
  byDefault?: string,
) {
  const [params, setParams] = useSearchParams();
  const keys = Object.keys(spec);
  const asked = params.get('sort');
  const sort = asked && keys.includes(asked) ? asked : (byDefault ?? null);
  const dir = params.get('dir') === 'asc' ? 'asc' : params.get('dir') === 'desc' ? 'desc' : sort ? (spec[sort].first ?? 'asc') : 'asc';

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const read = spec[sort].value;
    const sign = dir === 'asc' ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const va = read(a);
      const vb = read(b);
      const ea = va == null || va === '';
      const eb = vb == null || vb === '';
      if (ea || eb) return ea && eb ? fallback(a, b) : ea ? 1 : -1;
      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sign * cmp || fallback(a, b);
    });
    // The spec is rebuilt on every render; the key and direction are what change.
  }, [rows, sort, dir]);

  /** Click the column that is sorting to turn it round; another to start it. */
  const pick = (key: string) => {
    const next = key === sort ? (dir === 'asc' ? 'desc' : 'asc') : (spec[key].first ?? 'asc');
    const keep = Object.fromEntries([...params.entries()].filter(([k]) => k !== 'sort' && k !== 'dir'));
    // The usual order is the absence of both parameters, not a pair spelled
    // out: a clean address means the list is as it always is.
    const usual = byDefault === key && next === (spec[key].first ?? 'asc');
    setParams(usual ? keep : { ...keep, sort: key, dir: next });
  };

  return { rows: sorted, sort, dir, pick };
}

/** A heading that sorts. Nothing is drawn on it until it is the one sorting. */
export function SortHead({
  k,
  label,
  sort,
  dir,
  pick,
}: {
  k: string;
  label: string;
  sort: string | null;
  dir: 'asc' | 'desc';
  pick: (key: string) => void;
}) {
  const on = sort === k;
  return (
    <button type="button" className={`col-sort ${on ? 'on' : ''}`} onClick={() => pick(k)}>
      {label}
      <i className="col-arrow" aria-hidden="true">
        {on ? (dir === 'asc' ? '↑' : '↓') : ''}
      </i>
    </button>
  );
}
