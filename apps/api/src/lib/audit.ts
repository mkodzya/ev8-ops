import { prisma } from './db.js';

// The change journal (spec §8). Append-only: the API exposes no update or
// delete on audit_log and nothing in the code mutates a written row.
export async function audit(input: {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  note?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      before: input.before === undefined ? undefined : (input.before as object),
      after: input.after === undefined ? undefined : (input.after as object),
      note: input.note ?? null,
    },
  });
}
