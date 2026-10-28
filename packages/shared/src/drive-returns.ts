import type { ISODate } from './types.js';

/**
 * A return Drive has while the rental here runs (ADR-0034) — and the owner's
 * answer «Это не возврат» to it (issue #19 of the director, item 3; ADR-0034,
 * addendum 28.10.2026). On 27.10.2026 two such rows stood on "Today" for
 * rentals that were running: an act of 09.09 for the same moped with a digit
 * of the VIN left out, made by mistake, and an undated act of the moped a
 * renter had before. One tap on «Закрыть аренду» would have opened the return
 * of a rental that goes on.
 */

/** What made the row: a return act in the folder, one with no date on it, or only the folder moved among the finished. */
export type DriveReturnWhy = 'act' | 'act_undated' | 'finished';

/**
 * What the row says beside its number. An act with no date is an act, not
 * the folder moved: the row said «папка в Drive — в завершённых» of a folder
 * among the running ones (27.10.2026).
 */
export function driveReturnWhy(act: { returnedOn: ISODate | null } | null): DriveReturnWhy {
  if (!act) return 'finished';
  return act.returnedOn ? 'act' : 'act_undated';
}

/**
 * The things that made a rental's row, one key each: every return act in its
 * folders that counts — the file and the moment Drive last changed it — or,
 * for a folder among the finished with no such act, the folder itself. The
 * owner's answer keeps these keys.
 */
export function driveReturnKeys(folders: readonly { id: string; acts: readonly { id: string; modifiedAt: string }[] }[]): string[] {
  return folders.flatMap((f) => (f.acts.length > 0 ? f.acts.map((a) => `act:${a.id}@${a.modifiedAt}`) : [`folder:${f.id}`]));
}

/**
 * Whether the row stays away: every key that makes it now was answered «Это
 * не возврат». A new act in the folder — or the act there changed — is a key
 * nobody answered, and the row comes back with it.
 */
export function driveReturnAnswered(keys: readonly string[], answered: readonly string[]): boolean {
  return keys.length > 0 && keys.every((k) => answered.includes(k));
}
