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

export const SIGNED_OUT_EVENT = 'ev8:signed-out';

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
    // first "who am I" are expected to meet a 401 and are left alone.
    if (res.status === 401 && url !== '/api/auth/login' && url !== '/api/me') {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    }
    const { error, message, ...extra } = data as { error?: string; message?: string };
    throw new ApiError(res.status, error ?? 'error', message ?? `Request failed (${res.status})`, extra);
  }
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  patch: <T>(url: string, body?: unknown) => request<T>('PATCH', url, body ?? {}),
  del: <T>(url: string) => request<T>('DELETE', url),
};
