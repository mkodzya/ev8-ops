import { isISODate, parseGel, type ISODate } from '@ev8/shared';
import { badRequest } from './errors.js';

// Small, explicit readers for request bodies. Each says what it needs and
// refuses with a field name; no schema library, no surprises.

type Body = Record<string, unknown>;

export function str(body: Body, key: string, opts: { required?: boolean; max?: number } = {}): string | null {
  const v = body[key];
  if (v == null || v === '') {
    if (opts.required) throw badRequest('missing_field', `${key} is required`, { field: key });
    return null;
  }
  if (typeof v !== 'string') throw badRequest('bad_field', `${key} must be a string`, { field: key });
  const s = v.trim();
  if (opts.max && s.length > opts.max) throw badRequest('bad_field', `${key} is too long`, { field: key });
  return s || null;
}

export function date(body: Body, key: string, opts: { required?: boolean } = {}): ISODate | null {
  const s = str(body, key, opts);
  if (s == null) return null;
  if (!isISODate(s)) throw badRequest('bad_field', `${key} must be YYYY-MM-DD`, { field: key });
  return s;
}

/** Whole tetri from either an integer (tetri) or a GEL string like "150" / "315.20". */
export function tetri(body: Body, key: string, opts: { required?: boolean; min?: number } = {}): number | null {
  const v = body[key];
  if (v == null || v === '') {
    if (opts.required) throw badRequest('missing_field', `${key} is required`, { field: key });
    return null;
  }
  let n: number | null = null;
  if (typeof v === 'number' && Number.isInteger(v)) n = v;
  else if (typeof v === 'string') n = parseGel(v);
  if (n == null) throw badRequest('bad_field', `${key} must be an amount`, { field: key });
  if (opts.min != null && n < opts.min) throw badRequest('bad_field', `${key} is below ${opts.min}`, { field: key });
  return n;
}

export function int(body: Body, key: string, opts: { required?: boolean; min?: number; max?: number } = {}): number | null {
  const v = body[key];
  if (v == null || v === '') {
    if (opts.required) throw badRequest('missing_field', `${key} is required`, { field: key });
    return null;
  }
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw badRequest('bad_field', `${key} must be a whole number`, { field: key });
  if (opts.min != null && n < opts.min) throw badRequest('bad_field', `${key} is below ${opts.min}`, { field: key });
  if (opts.max != null && n > opts.max) throw badRequest('bad_field', `${key} is above ${opts.max}`, { field: key });
  return n;
}

export function oneOf<T extends string>(body: Body, key: string, allowed: readonly T[], opts: { required?: boolean } = {}): T | null {
  const s = str(body, key, opts);
  if (s == null) return null;
  if (!allowed.includes(s as T)) throw badRequest('bad_field', `${key} must be one of ${allowed.join(', ')}`, { field: key });
  return s as T;
}

export function strList(body: Body, key: string): string[] {
  const v = body[key];
  if (v == null) return [];
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw badRequest('bad_field', `${key} must be a list of strings`, { field: key });
  }
  return v.map((x) => x.trim()).filter(Boolean);
}
