import { type JournalFilter, type JournalRow, collapseViews, inJournalFilter, looksLikeNumber } from '@ev8/shared';
import type { FastifyInstance } from 'fastify';
import { audit } from '../lib/audit.js';
import { dayOf } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { badRequest } from '../lib/errors.js';
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
  const [rentals, sales, purchases, jobs, vehicles, customers, users, parts, locations, workshops, deposits, payments, acts] = await Promise.all([
    prisma.rental.findMany({ where: { id: { in: ids('rental') } }, select: { id: true, number: true } }),
    prisma.sale.findMany({ where: { id: { in: ids('sale') } }, select: { id: true, number: true } }),
    prisma.purchase.findMany({ where: { id: { in: ids('purchase') } }, select: { id: true, number: true } }),
    prisma.serviceJob.findMany({ where: { id: { in: ids('service_job') } }, select: { id: true, number: true } }),
    prisma.vehicle.findMany({ where: { id: { in: ids('vehicle') } }, select: { id: true, vin: true } }),
    prisma.customer.findMany({ where: { id: { in: ids('customer') } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: [...ids('user'), ...ids('login')] } }, select: { id: true, name: true } }),
    prisma.part.findMany({ where: { id: { in: ids('part') } }, select: { id: true, name: true } }),
    prisma.location.findMany({ where: { id: { in: ids('location') } }, select: { id: true, name: true } }),
    // «Мастерская изменена» said which one only in its JSON (owner's decision of 21.10.2026).
    prisma.workshop.findMany({ where: { id: { in: ids('workshop') } }, select: { id: true, name: true } }),
    // A deposit, a payment and an act are written under ids of their own.
    // In the journal they answer for the record they belong to, or the
    // column "запись" reads "—" beside a line about R-00504 (QA-W6-10).
    prisma.deposit.findMany({ where: { id: { in: ids('deposit') } }, select: { id: true, rental: { select: { number: true } } } }),
    prisma.payment.findMany({
      where: { id: { in: ids('payment') } },
      select: { id: true, rental: { select: { number: true } }, sale: { select: { number: true } }, purchase: { select: { number: true } }, serviceJob: { select: { number: true } } },
    }),
    prisma.act.findMany({ where: { id: { in: ids('act') } }, select: { id: true, rental: { select: { number: true } } } }),
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
  put(workshops, (x: { name: string }) => x.name);
  put(deposits, (x: { rental: { number: string } }) => x.rental.number);
  put(payments, (x: { rental: { number: string } | null; sale: { number: string } | null; purchase: { number: string } | null; serviceJob: { number: string } | null }) =>
    x.rental?.number ?? x.sale?.number ?? x.purchase?.number ?? x.serviceJob?.number ?? null,
  );
  put(acts, (x: { rental: { number: string } }) => x.rental.number);
  return out;
}

/**
 * The search box takes what a person has in front of them: a record's number,
 * a VIN, a customer's or a colleague's name. It answers with the ids those
 * name, and the query then asks for lines about them — an email is matched
 * too, because a failed sign-in has no record at all, only an address.
 */
/** The records a journal slice can be asked for by id. */
export const RECORD_KINDS = ['rental', 'sale', 'purchase', 'service_job', 'vehicle', 'customer'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

/**
 * A record and the parts of it that carry their own id (§3.8, уточнено
 * 22.09.2026).
 *
 * A deposit decision is written on the deposit, a week's correction on the
 * period, a signature on the act, an allocation on the allocation — but the
 * person did all of it inside the rental and looks for it there. A slice that
 * loses those answers "кто это сделал" with an untruth: by `R-00509` the
 * journal gave three lines and the card two.
 */
async function withParts(kind: RecordKind, id: string): Promise<string[]> {
  const one = [id];
  if (kind === 'rental') {
    const [deposits, payments, acts] = await Promise.all([
      prisma.deposit.findMany({ where: { rentalId: id }, select: { id: true } }),
      prisma.payment.findMany({ where: { rentalId: id }, select: { id: true } }),
      prisma.act.findMany({ where: { rentalId: id }, select: { id: true } }),
    ]);
    return [...one, ...deposits, ...payments, ...acts].map((x) => (typeof x === 'string' ? x : x.id));
  }
  if (kind === 'sale' || kind === 'purchase' || kind === 'service_job') {
    const where = kind === 'sale' ? { saleId: id } : kind === 'purchase' ? { purchaseId: id } : { serviceJobId: id };
    const payments = await prisma.payment.findMany({ where, select: { id: true } });
    return [...one, ...payments.map((x) => x.id)];
  }
  // A moped and a customer are written on directly; their rentals and sales
  // are records of their own and keep their own history.
  return one;
}

async function idsMatching(query: string): Promise<{ ids: string[]; emails: string[] }> {
  const q = query.trim();
  if (!q) return { ids: [], emails: [] };
  const like = { contains: q, mode: 'insensitive' as const };
  if (looksLikeNumber(q)) {
    const number = { equals: q, mode: 'insensitive' as const };
    const [r, s, p, j] = await Promise.all([
      prisma.rental.findMany({ where: { number }, select: { id: true } }),
      prisma.sale.findMany({ where: { number }, select: { id: true } }),
      prisma.purchase.findMany({ where: { number }, select: { id: true } }),
      prisma.serviceJob.findMany({ where: { number }, select: { id: true } }),
    ]);
    const rentalIds = r.map((x) => x.id);
    const saleIds = s.map((x) => x.id);
    const purchaseIds = p.map((x) => x.id);
    const jobIds = j.map((x) => x.id);
    // What belongs to the record answers for it (crit. 20, QA-W6-10) — the
    // same rule the card's own slice uses, so a number typed into the search
    // and a card opened by hand cannot give different answers.
    const parts = await Promise.all([
      ...rentalIds.map((id) => withParts('rental', id)),
      ...saleIds.map((id) => withParts('sale', id)),
      ...purchaseIds.map((id) => withParts('purchase', id)),
      ...jobIds.map((id) => withParts('service_job', id)),
    ]);
    return { ids: parts.flat(), emails: [] };
  }
  const [vehicles, customers, users, workshops] = await Promise.all([
    prisma.vehicle.findMany({ where: { vin: like }, select: { id: true } }),
    prisma.customer.findMany({ where: { name: like }, select: { id: true } }),
    prisma.user.findMany({ where: { OR: [{ name: like }, { email: like }] }, select: { id: true, email: true } }),
    // A workshop is named in the «запись» column, so its name finds it too.
    prisma.workshop.findMany({ where: { name: like }, select: { id: true } }),
  ]);
  return { ids: [...vehicles, ...customers, ...users, ...workshops].map((x) => x.id), emails: users.flatMap((u) => (u.email ? [u.email] : [])) };
}

async function read(query: { q?: string; filter?: string; from?: string; to?: string; record?: string }): Promise<JournalRow[]> {
  const filter = ((query.filter ?? 'all') as JournalFilter) ?? 'all';
  const where: Record<string, unknown> = {};
  if (query.from || query.to) {
    where.createdAt = {
      ...(query.from ? { gte: new Date(`${query.from}T00:00:00`) } : {}),
      ...(query.to ? { lt: new Date(`${query.to}T23:59:59.999`) } : {}),
    };
  }
  // A card asks by id, the search box by words. Both land on `withParts`.
  const record = (query.record ?? '').trim();
  if (record) {
    const [kind, id] = record.split(':');
    if (!(RECORD_KINDS as readonly string[]).includes(kind) || !id) throw badRequest('bad_field', 'record must be <kind>:<id>', { field: 'record' });
    where.entityId = { in: await withParts(kind as RecordKind, id) };
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
  app.get<{ Querystring: { q?: string; filter?: string; from?: string; to?: string; record?: string } }>(
    '/api/journal',
    { config: { scope: 'users.manage' } },
    async (req) => ({ rows: collapseViews(await read(req.query)) }),
  );

  /**
   * The same lines for somebody counting them, so the views are not folded
   * here: three looks are three rows (§3.8).
   */
  app.get<{ Querystring: { q?: string; filter?: string; from?: string; to?: string; record?: string } }>(
    '/api/journal.csv',
    { config: { scope: 'users.manage' } },
    async (req, reply) => {
      const rows = await read(req.query);
      const head = ['at', 'actor', 'action', 'entity', 'number', 'before', 'after', 'note'];
      // A cell for something that does not exist is empty, not the word
      // "null": a spreadsheet reads `null` as a value somebody wrote.
      const side = (v: unknown) => (v == null ? '' : JSON.stringify(v));
      const body = rows.map((r) => [r.at, r.actorName ?? '', r.action, r.entityType, r.number ?? '', side(r.before), side(r.after), r.note ?? ''].map(csvCell).join(','));
      await audit({ actorId: actorOf(req).id, action: 'journal.export', entityType: 'journal', after: { rows: rows.length, ...req.query } });
      // Excel on a Georgian laptop opens a CSV as the system's own code page
      // unless the file says otherwise: the BOM is what says otherwise.
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="ev8-journal-${dayOf(new Date())}.csv"`)
        .send(`﻿${[head.join(','), ...body].join('\n')}\n`);
    },
  );
}
