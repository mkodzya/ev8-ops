// The workshops that do the repairs: a list the owner keeps in Settings →
// Repair (`service.md`; owner's decision of 21.10.2026). A workshop is never
// deleted. Taken off the list it leaves the pickers and stays named on every
// repair that had it, and it can be put back (ADR-0011, «Скрыть, а не удалить»).

export interface WorkshopRef {
  id: string;
  name: string;
}

/** Why a repair may not be given a workshop. The codes are the API's own. */
export type WorkshopRefusal = 'workshop_not_found' | 'workshop_archived';

/**
 * Whether a repair may be given this workshop. One that does not exist is
 * not found. One taken off the list is not offered any more, so a repair is
 * not given it anew. A repair that already had it may keep it: saving the
 * card again must not fail because the list changed under it.
 */
export function workshopRefusal(found: { archived: boolean } | null, alreadyOnTheRepair: boolean): WorkshopRefusal | null {
  if (alreadyOnTheRepair) return null;
  if (!found) return 'workshop_not_found';
  return found.archived ? 'workshop_archived' : null;
}

export interface WorkshopChoice extends WorkshopRef {
  /** Taken off the list: offered only because the repair already has it. */
  off: boolean;
}

/**
 * What a repair's workshop can be changed to: the live list in the owner's
 * order, and the repair's own workshop first when it has been taken off the
 * list. The owner then sees which one the repair has and can keep it or move
 * to a live one. Without it nothing would be marked, and clearing it by
 * accident would be the easy mistake.
 */
export function workshopChoices(live: readonly WorkshopRef[], current: WorkshopRef | null | undefined): WorkshopChoice[] {
  const out: WorkshopChoice[] = live.map((w) => ({ id: w.id, name: w.name, off: false }));
  if (current && !live.some((w) => w.id === current.id)) out.unshift({ id: current.id, name: current.name, off: true });
  return out;
}

/** A new workshop goes to the end of the list, after those the owner already ordered. */
export function nextWorkshopOrder(maxSortOrder: number | null | undefined): number {
  return (maxSortOrder ?? 0) + 1;
}
