/**
 * The journal (wave 6 §3.8, B9-01, X3): who changed what, and who looked at
 * what.
 *
 * Two kinds of line live in one journal, because "who did this" is not a
 * question that splits into two screens:
 *
 *   * a **change** has a before and an after — money, deposits, prices,
 *     schedules, rental terms, states, roles, settings;
 *   * an **event** has no before at all — a record created, a sign-in, a
 *     failed attempt, a personal number looked at, an export. Its column
 *     "было → стало" is empty and the words in "что" carry the meaning.
 *
 * The rules here decide which filter a line answers to and how the views
 * collapse on screen. They are here, and not in the route, because the
 * screen, the card's history and the CSV must agree about all three.
 */

export const JOURNAL_FILTERS = ['all', 'money', 'deposits', 'states', 'logins'] as const;
export type JournalFilter = (typeof JOURNAL_FILTERS)[number];
export type JournalGroup = Exclude<JournalFilter, 'all'>;

export type JournalKind = 'change' | 'event';

/**
 * Looking at somebody's personal number or documents. Written on every open —
 * otherwise "looked three times" is lost — and folded on screen (Q27).
 */
export const VIEW_ACTIONS = ['customer.personalId.view', 'customer.document.open'] as const;

/** Lines that exist without a before: nothing was changed, something happened. */
const EVENT_ACTIONS = new Set<string>([
  ...VIEW_ACTIONS,
  'auth.login',
  'auth.login.failed',
  'auth.logout',
  'customer.create',
  'location.create',
  'model.create',
  'part.create',
  'purchase.create',
  'rental.whatsapp',
  'sale.create',
  'statement.import',
  'supplier.create',
  'user.create',
  'user.password.change',
  'user.password.reset',
  'user.sessions.closed',
  'vehicle.create',
  'workshop.create',
  'document.sign',
  'act.photo.add',
  'service.photo.add',
  'customer.document.add',
  'journal.export',
]);

const startsWithAny = (action: string, prefixes: readonly string[]) => prefixes.some((p) => action.startsWith(p));

/** Money in the widest sense: what was paid, charged, counted or priced. */
const MONEY_PREFIXES = ['payment.', 'till.', 'statement.', 'purchase.', 'sale.', 'part.', 'settings.', 'service.'] as const;
/** A moped's or a record's state, and who moved it there. */
const STATE_PREFIXES = ['vehicle.', 'rental.', 'service.close', 'service.cancel'] as const;

/**
 * Which filters a line answers to. A line may answer to more than one — a
 * return both moves a state and decides a deposit — and that is the honest
 * answer, not a line filed under one heading and missing from the other.
 */
export function journalGroups(action: string): JournalGroup[] {
  const groups: JournalGroup[] = [];
  if (startsWithAny(action, ['auth.', 'user.']) || (VIEW_ACTIONS as readonly string[]).includes(action)) groups.push('logins');
  if (startsWithAny(action, MONEY_PREFIXES) || action === 'vehicle.cost') groups.push('money');
  if (action.startsWith('deposit.') || action === 'rental.return' || action === 'rental.return.undo') groups.push('deposits');
  if (startsWithAny(action, STATE_PREFIXES)) groups.push('states');
  return groups;
}

export function journalKind(action: string): JournalKind {
  return EVENT_ACTIONS.has(action) ? 'event' : 'change';
}

export function inJournalFilter(action: string, filter: JournalFilter): boolean {
  if (filter === 'all') return true;
  return journalGroups(action).includes(filter);
}

export interface JournalRow {
  id: string;
  at: string; // ISO instant
  action: string;
  actorId: string | null;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  /** What the record is called where a person would recognise it: R-00488, a VIN, a name. */
  number: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
}

export interface JournalLine extends JournalRow {
  kind: JournalKind;
  /** How many times this view happened that day; 1 for everything else. */
  times: number;
}

const dayOf = (at: string) => at.slice(0, 10);

/**
 * What the screen shows. Repeated views by one person of one record on one
 * day become a single line with a counter and the latest time; everything
 * else is left alone. The CSV does not call this — an export is read by
 * somebody counting, and three looks are three rows there (§3.8).
 */
export function collapseViews(rows: readonly JournalRow[]): JournalLine[] {
  const views = new Set<string>(VIEW_ACTIONS);
  const seen = new Map<string, JournalLine>();
  const out: JournalLine[] = [];
  for (const r of rows) {
    const line: JournalLine = { ...r, kind: journalKind(r.action), times: 1 };
    if (!views.has(r.action)) {
      out.push(line);
      continue;
    }
    const key = `${r.action}|${r.actorId ?? ''}|${r.entityId ?? ''}|${dayOf(r.at)}`;
    const already = seen.get(key);
    if (already) {
      already.times++;
      // Rows arrive newest first, so the one already kept holds the latest
      // time; only the count grows.
      if (r.at > already.at) already.at = r.at;
      continue;
    }
    seen.set(key, line);
    out.push(line);
  }
  return out;
}

/** The search box takes a record's number, a VIN or a name — one field, no syntax (§3.8). */
export function looksLikeNumber(query: string): boolean {
  return /^(R|SL|PO|SV)-\d+$/i.test(query.trim());
}
