/**
 * The last records opened from the search, on this device (wave 1 §3.5).
 * With no connection the search looks only here. Names and phones are
 * personal data on what may be a shared phone, so signing out forgets them
 * along with the drafts (session.tsx).
 */
export interface Recent {
  href: string;
  title: string;
  sub: string;
  at: number;
}

const KEY = 'ev8-recent';
const LIMIT = 5;

export function readRecent(): Recent[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as Recent[]) : [];
    return Array.isArray(list) ? list.slice(0, LIMIT) : [];
  } catch {
    return [];
  }
}

export function rememberRecent(item: Omit<Recent, 'at'>): void {
  try {
    const list = [{ ...item, at: Date.now() }, ...readRecent().filter((r) => r.href !== item.href)].slice(0, LIMIT);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* private mode: nothing remembered */
  }
}

export function forgetRecent(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to forget */
  }
}
