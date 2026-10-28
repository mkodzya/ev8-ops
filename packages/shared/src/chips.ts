/**
 * The filter chips over a list (GitHub issue #17, item 2; the director's
 * request of 25.10.2026). «Все» stands last in every row, and a list opened
 * with no choice in its address shows the first chip of its row — «Мопеды»
 * open on «Свободен», not on everything at once. A choice in the address
 * opens as it is, «Все» included: it is written there as `all`, so a link
 * that wants every row says so.
 */
export const ALL_CHIP = 'all';

/**
 * Which chip of `row` a list shows for what its address asks: that chip,
 * null for «Все» (`all`), and the row's first chip when the address names
 * none — or one the row does not hold (a chip a role does not see, an old
 * link). An empty row has nothing to choose: null.
 */
export function chipOnOpen<K extends string>(asked: string | null | undefined, row: readonly K[]): K | null {
  if (asked === ALL_CHIP) return null;
  return row.find((k) => k === asked) ?? row[0] ?? null;
}
