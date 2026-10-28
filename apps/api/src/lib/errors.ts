export class ApiError extends Error {
  statusCode: number;
  code: string;
  extra?: Record<string, unknown>;

  constructor(statusCode: number, code: string, message: string, extra?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.extra = extra;
  }
}

export const badRequest = (code: string, msg: string, extra?: Record<string, unknown>) =>
  new ApiError(400, code, msg, extra);
export const forbidden = (code: string, msg: string, extra?: Record<string, unknown>) =>
  new ApiError(403, code, msg, extra);
export const notFound = (code: string, msg: string) => new ApiError(404, code, msg);
export const conflict = (code: string, msg: string, extra?: Record<string, unknown>) =>
  new ApiError(409, code, msg, extra);
export const unprocessable = (code: string, msg: string, extra?: Record<string, unknown>) =>
  new ApiError(422, code, msg, extra);

/** A unique index refusing a duplicate: Prisma P2002 or SQLSTATE 23505. */
export function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'P2002' || code === '23505';
}

/**
 * A foreign key refusing a delete: Prisma P2003 or SQLSTATE 23503 — a row
 * somewhere still points at what was to go (issue #17: a person to whom
 * something is recorded is not deleted, whichever table records it).
 */
export function isForeignKeyViolation(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'P2003' || code === '23503';
}
