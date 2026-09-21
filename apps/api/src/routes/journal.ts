import { type JournalFilter, type JournalRow, collapseViews, inJournalFilter, looksLikeNumber } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { prisma } from '../lib/db.js';
import { actorOf } from '../lib/guard.js';

// The journal on its own screen (wave 6 §3.8, B9-01, X3).
//
// Every correction has been written to `audit_log` since the first wave; what
// was missing was a place to read it whole. The cards show their own slice,
// which answers "what happened to this rental"; this answers the other
// question — "who did this, and when" — across every record at once.
//
// The rows are never edited or deleted here: `lib/audit.ts` only appends, and
// a deletion in the product is an archive flag, so the line that recorded it
// stays true (crit. 21).

const PAGE = 200;

/** What a record is called where a person would recognise it. */
async function numbersFor(rows: { entityType: string; entityId: string | null }[]): Promise<Map<string, string>> {
  const ids = (type: string) => [...new Set(rows.filter((r) => r.entityType === type && r.entityId).map((r) => r.entityId as string))];
  const out = new Map<string, string>();
  const put = (list: { id: string }[], name: (x: never) => string | null) => {
    for (const x of list) {
      const n = name(x as never);
      if (n) out.set(x.id, n);
    }
  };
  const [rentals, sales, purchases, jobs, vehicles, customers, users, parts, locations] = await Promise.all([
    prisma.rental.findMany({ where: { id: { in: ids('rental') } }, select: { id: true, number: true } }),
    prisma.sale.findMany({ where: { id: { in: ids('sale') } }, select: { id: true, number: true } }),
    prisma.purchase.findMany({ where: { id: { in: ids('purchase') } }, select: { id: true, number: true } }),
    prisma.serviceJob.findMany({ where: { id: { in: ids('service_job') } }, select: { id: true, number: true } }),
    prisma.vehicle.findMany({ where: { id: { in: ids('vehicle') } }, select: { id: true, vin: true } }),
    prisma.customer.findMany({ where: { id: { in: ids('customer') } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: [...ids('user'), ...ids('login')] } }, select: { id: true, name: true } }),
    prisma.part.findMany({ where: { id: { in: ids('part') } }, select: { id: true, name: true } }),
    prisma.location.findMany({ where: { id: { in: ids('location') } }, select: { id: true, name: true } }),
  ]);
  put(rentals, (x: { number: string }) => x.number);
  put(sales, (x: { number: string }) => x.number);
  put(purchases, (x: { number: string }) => x.number);
  put(jobs, (x: { number: string }) => x.number);
  put(vehicles, (x: { vin: string | null }) => x.vin);
  put(customers, (x: { name: string }) => x.name);
  put(users, (x: { name: string }) => x.name);
  put(parts, (x: { name: string }) => x.name);
  put(locations, (x: { name: string }) => x.name);
  return out;
}

/**
 * The search box takes what a person has in front of them: a record's number,
 * a VIN, a customer's or a colleague's name. It answers with the ids those
 * name, and the query then asks for lines about them — an email is matched
 * too, because a failed sign-in has no record at all, only an address.
 */
async function idsMatching(query: string): Promise<{ ids: string[]; emails: string[] }> {
  const q = query.trim();
  if (!q) return { ids: [], emails: [] };
  const like = { contains: q, mode: 'insensitive' as const };
  if (looksLikeNumber(q)) {
    const [r, s, p, j] = await Promise.all([
      prisma.rental.findMany({ where: { number: { equals: q, mode: 'insensitive' } }, select: { id: true } }),
      prisma.sale.findMany({ where: { number: { equals: q, mode: 'insensitive' } }, select: { id: true } }),
      prisma.purchase.findMany({ where: { number: { equals: q, mode: 'insensitive' } }, select: { id: true } }),
      prisma.serviceJob.findMany({ where: { number: { equals: q, mode: 'insensitive' } }, select: { id: true } }),
    ]);
    return { ids: [...r, ...s, ...p, ...j].map((x) => x.id), emails: [] };
  }
  const [vehicles, customers, users] = await Promise.all([
    prisma.vehicle.findMany({ where: { vin: like }, select: { id: true } }),
    prisma.customer.findMany({ where: { name: like }, select: { id: true } }),
    prisma.user.findMany({ where: { OR: [{ name: like }, { email: like }] }, select: { id: true, email: true } }),
  ]);
  return { ids: [...vehicles, ...customers, ...users].map((x) => x.id), emails: users.map((u) => u.email) };
}

async function read(query: { q?: string; filter?: string; from?: string; to?: string }): Promise<JournalRow[]> {
  const filter = ((query.filter ?? 'all') as JournalFilter) ?? 'all';
  const where: Record<string, unknown> = {};
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: new Date(`${query.from}T00:00:00`) } : {}),
      ...(query.to ? { lt: new Date(`${query.to}T23:59:59.999`) } : {}),
    };
  }
  const q = (query.q ?? '').trim();
  if (q) {
    const { ids, emails } = await idsMatching(q);
    // A failed sign-in names an address and no record: it is found by the
    // address or not at all.
    where.OR = [
      ...(ids.length ? [{ entityId: { in: ids } }] : []),
      ...emails.map((e) => ({ AND: [{ entityType: 'login' }, { after: { path: ['email'], equals: e } }] })),
      ...(ids.length === 0 && emails.length === 0 ? [{ entityId: '00000000-0000-0000-0000-000000000000' }] : []),
    ];
  }
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    // The filter is a rule in `@ev8/shared`, not a list of actions in SQL:
    // the screen, the card and the CSV have to agree about it, and a rule
    // with a test is the only way three readers agree.
    take: filter === 'all' ? PAGE : PAGE * 4,
    include: { actor: { select: { name: true } } },
  });
  const kept = rows.filter((r) => inJournalFilter(r.action, filter)).slice(0, PAGE);
  const numbers = await numbersFor(kept);
  return kept.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    action: r.action,
    actorId: r.actorId,
    actorName: r.actor?.name ?? null,
    entityType: r.entityType,
    entityId: r.entityId,
    number: (r.entityId && numbers.get(r.entityId)) ?? ((r.after as { email?: string } | null)?.email ?? null),
    before: r.before,
    after: r.after,
    note: r.note,
  }));
}

const csvCell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function journalRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: { q?: string; filter?: string; from?: string; to?: string } }>(
    '/api/journal',
    { config: { scope: 'users.manage' } },
    async (req) => ({ rows: collapseViews(await read(req.query)) }),
  );

  /**
   * The same lines for somebody counting them, so the views are not folded
   * here: three looks are three rows (§3.8).
   */
  app.get<{ Querystring: { q?: string; filter?: string; from?: string; to?: string } }>(
    '/api/journal.csv',
    { config: { scope: 'users.manage' } },
    async (req, reply) => {
      const rows = await read(req.query);
      const head = ['at', 'actor', 'action', 'entity', 'number', 'before', 'after', 'note'];
      const body = rows.map((r) =>
        [r.at, r.actorName ?? '', r.action, r.entityType, r.number ?? '', JSON.stringify(r.before ?? null), JSON.stringify(r.after ?? null), r.note ?? ''].map(csvCell).join(','),
      );
      await audit({ actorId: actorOf(req).id, action: 'journal.export', entityType: 'journal', after: { rows: rows.length, ...req.query } });
      // Excel on a Georgian laptop opens a CSV as the system's own code page
      // unless the file says otherwise: the BOM is what says otherwise.
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="ev8-journal-${new Date().toISOString().slice(0, 10)}.csv"`)
        .send(`﻿${[head.join(','), ...body].join('\n')}\n`);
    },
  );
}
