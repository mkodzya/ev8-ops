// A queue request from the public site (mkodzya/ev8-site), sent on as an
// email to the company's mailbox instead of a WhatsApp message the visitor
// has to send by hand (Kardu, 06.10.2026; book register item 71).
//
// Nothing here is stored: the request goes into the email and nowhere else,
// so a courier's name and phone never land in the database or the logs.
//
// The mailbox password is a server secret. It is read from the environment
// and never logged, returned or written anywhere; without it the route says
// so with 503 and the site keeps its WhatsApp button.

import nodemailer from 'nodemailer';

export interface SiteMailConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  to: string;
}

/** Null when any part is missing: the route is then off, not half-working. */
export function siteMailConfig(e: NodeJS.ProcessEnv = process.env): SiteMailConfig | null {
  const host = (e.SITE_MAIL_HOST ?? '').trim();
  const user = (e.SITE_MAIL_USER ?? '').trim();
  const password = e.SITE_MAIL_PASSWORD ?? '';
  if (!host || !user || !password) return null;
  const port = parseInt(e.SITE_MAIL_PORT ?? '465', 10);
  // The mailbox writes to itself unless told otherwise.
  const to = (e.SITE_MAIL_TO ?? '').trim() || user;
  return { host, port: Number.isFinite(port) ? port : 465, user, password, to };
}

export interface QueueRequest {
  name: string;
  phone: string;
  text: string;
  lang: 'ka' | 'en' | 'ru';
  page: string;
}

export type ParseResult = { ok: true; request: QueueRequest } | { ok: false; field: string } | { ok: 'bot' };

export const LIMITS = { name: 80, text: 2000, page: 200, phoneMin: 7, phoneMax: 15 } as const;

// Control characters out, so nothing typed into the form can start a new
// header line in the email.
const oneLine = (s: string): string => s.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
const manyLines = (s: string): string =>
  s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').trim();

export function parseQueueRequest(body: unknown): ParseResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const s = (k: string): string => (typeof b[k] === 'string' ? (b[k] as string) : '');

  // A field no person sees: a form-filling bot fills it, and is told "fine".
  if (s('website').trim() !== '') return { ok: 'bot' };

  const name = oneLine(s('name'));
  if (!name || name.length > LIMITS.name) return { ok: false, field: 'name' };

  const rawPhone = oneLine(s('phone'));
  const digits = rawPhone.replace(/\D/g, '');
  if (!/^\+?[\d\s()-]+$/.test(rawPhone) || digits.length < LIMITS.phoneMin || digits.length > LIMITS.phoneMax) {
    return { ok: false, field: 'phone' };
  }
  const phone = (rawPhone.startsWith('+') ? '+' : '') + digits;

  const text = manyLines(s('text'));
  if (text.length > LIMITS.text) return { ok: false, field: 'text' };

  const page = oneLine(s('page'));
  if (page.length > LIMITS.page) return { ok: false, field: 'page' };

  const lang = s('lang') === 'en' || s('lang') === 'ru' ? (s('lang') as 'en' | 'ru') : 'ka';
  return { ok: true, request: { name, phone, text, lang, page } };
}

export function composeQueueMail(r: QueueRequest, receivedAt: Date): { subject: string; text: string } {
  const when = receivedAt.toLocaleString('en-GB', { timeZone: 'Asia/Tbilisi' });
  const lines = [
    'A queue request from the site.',
    '',
    `Name:     ${r.name}`,
    `Phone:    ${r.phone}`,
    `Language: ${r.lang}`,
    `Page:     ${r.page || '—'}`,
    `Received: ${when} (Tbilisi)`,
  ];
  if (r.text) lines.push('', r.text);
  return { subject: `EV8 site: queue request — ${r.name}`, text: lines.join('\n') + '\n' };
}

/**
 * Counts requests in a sliding hour. Behind the edge every request reaches the
 * API from the same proxy address, so the limit is per phone number and for
 * the mailbox as a whole rather than per visitor.
 */
export class QueueLimiter {
  private readonly seen: { at: number; phone: string }[] = [];
  constructor(
    private readonly perPhone = 3,
    private readonly total = 30,
    private readonly windowMs = 60 * 60 * 1000,
  ) {}

  allow(phone: string, now = Date.now()): boolean {
    while (this.seen.length && now - this.seen[0].at >= this.windowMs) this.seen.shift();
    if (this.seen.length >= this.total) return false;
    if (this.seen.filter((x) => x.phone === phone).length >= this.perPhone) return false;
    this.seen.push({ at: now, phone });
    return true;
  }
}

export type SendMail = (cfg: SiteMailConfig, mail: { subject: string; text: string }) => Promise<void>;

export const smtpSend: SendMail = async (cfg, mail) => {
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.port === 465,
    auth: { user: cfg.user, pass: cfg.password },
  });
  await transport.sendMail({ from: `EV8 site <${cfg.user}>`, to: cfg.to, subject: mail.subject, text: mail.text });
};
