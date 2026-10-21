export class ApiError extends Error {
  status: number;
  code: string;
  extra: Record<string, unknown>;
  constructor(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

import { markDown, markUp } from './lib/connection.js';

export const SIGNED_OUT_EVENT = 'ev8:signed-out';

const writeListeners = new Set<() => void>();
/** Called after every successful write; the data layer marks its cache stale. */
export function onWrite(listener: () => void): () => void {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

/**
 * Mark every screen's data stale at once, as a write does. For a batch of
 * writes sent `quiet`: the batch calls this once, at its end.
 */
export function markStale(): void {
  for (const l of writeListeners) l();
}

/** A write's options. `key` is the form's operation key (build plan Р5): the same key on a retry never writes twice. */
export interface WriteOptions {
  key?: string;
  /** A POST that only reads — too much to put in an address — and so marks nothing stale. */
  read?: boolean;
  /**
   * One write of a batch — the photos of an act — that marks nothing stale by
   * itself: the batch calls `markStale` once when it is done. Each photo used
   * to refetch every screen's data, some 40 requests after a swap with 4 + 4
   * photos (QA 21.10.2026).
   */
  quiet?: boolean;
}

async function request<T>(method: string, url: string, body?: unknown, opts: WriteOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (opts.key) headers['idempotency-key'] = opts.key;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    // Never reached the server.
    markDown();
    throw e;
  }
  // A gateway answering for a server that is not there is no connection
  // either: a real one says 502–504, the Vite proxy 500 in plain text. Our
  // API answers every error in JSON, so a 5xx that is not JSON never came
  // from it (QA-W1-01).
  const fromApi = (res.headers.get('content-type') ?? '').includes('application/json');
  const gateway = res.status >= 502 || (res.status >= 500 && !fromApi);
  if (gateway) markDown();
  else markUp();
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    // The session ended somewhere else — expired, signed out on another
    // device, password changed. Whatever screen asked, the answer is the
    // login page and then back here (B1-02). The login call itself and the
    // first "who am I" are expected to meet a 401 and are left alone, and so
    // is a wrong PIN on the workshop tablet (ADR-0033).
    if (res.status === 401 && url !== '/api/auth/login' && url !== '/api/auth/pin' && url !== '/api/me') {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    const { error, message, ...extra } = data as { error?: string; message?: string };
    throw new ApiError(res.status, error ?? 'error', message ?? `Request failed (${res.status})`, extra);
  }
  if (method !== 'GET' && !opts.read && !opts.quiet) markStale();
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown, opts?: WriteOptions) => request<T>('POST', url, body ?? {}, opts),
  patch: <T>(url: string, body?: unknown, opts?: WriteOptions) => request<T>('PATCH', url, body ?? {}, opts),
  del: <T>(url: string, opts?: WriteOptions) => request<T>('DELETE', url, undefined, opts),
  /** Ask with a body and change nothing: every screen's data stays fresh (the translations of typed text, ADR-0042). */
  ask: <T>(url: string, body: unknown) => request<T>('POST', url, body, { read: true }),
};

/**
 * A fresh operation key. crypto.randomUUID exists only in a secure context,
 * and a phone opening the stand by its LAN address is not one — so the random
 * bytes are asked for directly.
 */
export function newOperationKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
