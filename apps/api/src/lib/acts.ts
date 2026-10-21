import type { MopedAct } from '@ev8/shared';
import { isoDate } from './dates.js';

// A rental's acts as the shared rules about its mopeds read them (ADR-0040,
// packages/shared/src/rental-mopeds.ts): the day as a calendar date, and a
// return taken back marked as such. The row itself rides along, so a caller
// reads its mileage or photos off the act the rules chose.

/** The acts that hand a moped out: the hand-over, and the second half of a swap. */
export const HANDS_OUT: ('pickup' | 'swap_in')[] = ['pickup', 'swap_in'];

/** What the rules need of an act; a select that names these can be read. */
export const MOPED_ACT = { kind: true, vehicleId: true, occurredOn: true, createdAt: true, settlement: true } as const;

type ActRow = { kind: string; vehicleId: string | null; occurredOn: Date; createdAt: Date; settlement?: unknown };

export function mopedActOf<T extends ActRow>(row: T): MopedAct & { row: T } {
  return {
    kind: row.kind,
    vehicleId: row.vehicleId,
    occurredOn: isoDate(row.occurredOn)!,
    createdAt: row.createdAt,
    undone: row.kind === 'return' && !!(row.settlement as { undone?: boolean } | null | undefined)?.undone,
    row,
  };
}
