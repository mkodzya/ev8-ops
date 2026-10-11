import { todayISO, type ISODate } from '@ev8/shared';
import { prisma } from './db.js';
import { dateFromISO, isoDate } from './dates.js';
import { env } from './env.js';

// The site's own anonymous counter (migration 0036). The site says what
// happened — a visit, a page, a WhatsApp button, the quiz's answers — and
// this keeps one number per day for it. Nothing that could tell one person
// from another is read, let alone kept: no address, no cookie, no time.
//
// What the site may report is a closed list. A page that is not on it, a
// language the site does not speak, an answer outside its question's options
// is refused, so the table cannot be filled with whatever somebody posts.

/** The pages of ev8.ge, as the site names them (its `path`); '' is the home page. */
export const SITE_PAGES = ['', 'models/', 'subscription/', 'stations/', 'am-licence/', 'how-it-works/', 'faq/', 'contacts/'] as const;
export type SitePage = (typeof SITE_PAGES)[number];

export const SITE_LANGS = ['ka', 'en', 'ru'] as const;
export type SiteLang = (typeof SITE_LANGS)[number];

/**
 * The quiz (`Ask.astro` in mkodzya/ev8-site), by the number of options each
 * question has: q1 works as a courier (yes · not yet), q2 rides now (petrol
 * moped · car · electric moped · nothing), q3 licence (none · AM · A or B).
 */
export const QUIZ_OPTIONS = [2, 4, 3] as const;

/** Who the answers say this is — the site's own rule, so both sides agree. */
export const SEGMENTS = ['petrol', 'car', 'electric', 'other', 'novice'] as const;
export type Segment = (typeof SEGMENTS)[number];
export function segmentOf(a: readonly number[]): Segment {
  if (a[0] === 1) return 'novice';
  return (['petrol', 'car', 'electric', 'other'] as const)[a[1] ?? 3] ?? 'other';
}

export type SiteMetric = 'visit' | 'view' | 'whatsapp' | 'request' | 'answers';
export interface Hit {
  metric: SiteMetric;
  key: string;
}

const isLang = (v: unknown): v is SiteLang => typeof v === 'string' && (SITE_LANGS as readonly string[]).includes(v);
const isPage = (v: unknown): v is SitePage => typeof v === 'string' && (SITE_PAGES as readonly string[]).includes(v);

/**
 * What the site posted, or null when it is not something the site can say.
 * `request` is not taken from the browser: the API counts it itself when the
 * mail went out, so a request counted is a request received.
 */
export function parseHit(body: unknown): Hit | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!isLang(b.l)) return null;
  switch (b.e) {
    case 'visit':
      return { metric: 'visit', key: b.l };
    case 'view':
    case 'whatsapp':
      return isPage(b.p) ? { metric: b.e, key: `${b.l}:${b.p}` } : null;
    case 'answers': {
      const a = b.a;
      if (!Array.isArray(a) || a.length !== QUIZ_OPTIONS.length) return null;
      const ok = a.every((x, i) => Number.isInteger(x) && x >= 0 && x < QUIZ_OPTIONS[i]!);
      return ok ? { metric: 'answers', key: a.join('.') } : null;
    }
    default:
      return null;
  }
}

/**
 * A ceiling on how fast the counter fills, for everybody at once: the site is
 * a few hundred visits a day, and a loop posting thousands a minute should
 * cost a few rows, not the database. Over the ceiling a hit is dropped.
 */
export class HitLimiter {
  private window = 0;
  private count = 0;
  constructor(
    private readonly perMinute = 600,
    private readonly now: () => number = Date.now,
  ) {}
  allow(): boolean {
    const minute = Math.floor(this.now() / 60_000);
    if (minute !== this.window) {
      this.window = minute;
      this.count = 0;
    }
    this.count += 1;
    return this.count <= this.perMinute;
  }
}

/** Add one to today's tally (Tbilisi's day). */
export async function countHit(hit: Hit, now: Date = new Date()): Promise<void> {
  const day = dateFromISO(todayISO(now, env.TZ))!;
  await prisma.siteCount.upsert({
    where: { day_metric_key: { day, metric: hit.metric, key: hit.key } },
    create: { day, metric: hit.metric, key: hit.key, n: 1 },
    update: { n: { increment: 1 } },
  });
}

export interface SiteReport {
  from: ISODate;
  to: ISODate;
  /** Nothing at all was counted over the period. */
  empty: boolean;
  visits: { total: number; byLang: Record<SiteLang, number> };
  /** Every page of the site, in the site's order, opened how many times. */
  pages: { page: SitePage; views: number; whatsapp: number }[];
  whatsapp: number;
  requests: { total: number; byLang: Record<SiteLang, number> };
  /** How many finished the quiz, and how many chose each option of each question. */
  answers: { total: number; questions: number[][]; segments: Record<Segment, number> };
  /** One line per day that has anything, oldest first. */
  days: { day: ISODate; visits: number; views: number; whatsapp: number; requests: number }[];
}

const zeroLangs = (): Record<SiteLang, number> => ({ ka: 0, en: 0, ru: 0 });

/** The counter over a period, both ends included. */
export async function siteReport(from: ISODate, to: ISODate): Promise<SiteReport> {
  const rows = await prisma.siteCount.findMany({
    where: { day: { gte: dateFromISO(from)!, lte: dateFromISO(to)! } },
    orderBy: [{ day: 'asc' }],
  });

  const visits = { total: 0, byLang: zeroLangs() };
  const requests = { total: 0, byLang: zeroLangs() };
  const pages = new Map<SitePage, { views: number; whatsapp: number }>(SITE_PAGES.map((p) => [p, { views: 0, whatsapp: 0 }]));
  const questions = QUIZ_OPTIONS.map((n) => Array.from({ length: n }, () => 0));
  const segments = Object.fromEntries(SEGMENTS.map((s) => [s, 0])) as Record<Segment, number>;
  let whatsapp = 0;
  let answered = 0;
  const days = new Map<ISODate, { visits: number; views: number; whatsapp: number; requests: number }>();

  for (const r of rows) {
    const day = isoDate(r.day)!;
    const d = days.get(day) ?? { visits: 0, views: 0, whatsapp: 0, requests: 0 };
    days.set(day, d);
    // Keys are checked on the way in; a row this code no longer understands
    // (a page the site has since dropped) is left out rather than guessed at.
    const [lang, page] = r.key.split(':') as [string, string | undefined];
    switch (r.metric) {
      case 'visit':
        if (!isLang(lang)) break;
        visits.total += r.n;
        visits.byLang[lang] += r.n;
        d.visits += r.n;
        break;
      case 'request':
        if (!isLang(lang)) break;
        requests.total += r.n;
        requests.byLang[lang] += r.n;
        d.requests += r.n;
        break;
      case 'view':
      case 'whatsapp': {
        if (!isPage(page)) break;
        const p = pages.get(page)!;
        if (r.metric === 'view') {
          p.views += r.n;
          d.views += r.n;
        } else {
          p.whatsapp += r.n;
          whatsapp += r.n;
          d.whatsapp += r.n;
        }
        break;
      }
      case 'answers': {
        const a = r.key.split('.').map(Number);
        if (a.length !== QUIZ_OPTIONS.length || a.some((x, i) => !Number.isInteger(x) || x < 0 || x >= QUIZ_OPTIONS[i]!)) break;
        answered += r.n;
        a.forEach((x, i) => (questions[i]![x]! += r.n));
        segments[segmentOf(a)] += r.n;
        break;
      }
    }
  }

  return {
    from,
    to,
    empty: rows.length === 0,
    visits,
    pages: SITE_PAGES.map((page) => ({ page, ...pages.get(page)! })),
    whatsapp,
    requests,
    answers: { total: answered, questions, segments },
    days: [...days.entries()].map(([day, d]) => ({ day, ...d })),
  };
}
