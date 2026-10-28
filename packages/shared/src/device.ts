/**
 * What a person leaves on a shared device — the showroom phone, the workshop
 * tablet: the drafts of forms and wizards (wave 1 §3.7) and the last records
 * opened from the search (wave 1 §3.5). They are his, not the device's, and
 * the next person must not find them (ADR-0033 §9).
 *
 * «Выйти» forgets them (B1-01), and so do a PIN sign-in and a PIN session
 * ended on the server. A session that ended without «Выйти» — idle for a
 * week, its thirty days run out, the cookies cleared — left them for whoever
 * signed in next by password, and a task's draft came back with somebody
 * else's words and assignee (QA before 1.17.0). So a sign-in asks who signed
 * in last on this device, and another person finds nothing of the last one's.
 *
 * The rules are here so they can be tested; the browser's storage is the web
 * app's (`session.tsx`), which reads and writes it and survives its refusals.
 */

/** A form's or a wizard's draft: `ev8-draft:<form>`. */
export const DRAFT_PREFIX = 'ev8-draft:';
/** The records last opened from the search. */
export const RECENT_SEARCH_KEY = 'ev8-recent';
/** Who signed in last on this device: his id, nothing else. */
export const LAST_PERSON_KEY = 'ev8-last-person';

/** One of a person's leftovers: a draft or the recent searches. The language, the last person and a sign-out still owed to the server are the device's. */
export function isDeviceLeftover(key: string): boolean {
  return key.startsWith(DRAFT_PREFIX) || key === RECENT_SEARCH_KEY;
}

/**
 * The keys a sign-in forgets: every leftover when the person who signed in is
 * not the one who signed in last here, or nobody is known to have; none when
 * he is the same — his own draft waits for him.
 */
export function leftoversToForget(keys: readonly string[], lastPerson: string | null, person: string): string[] {
  if (lastPerson === person) return [];
  return keys.filter(isDeviceLeftover);
}
