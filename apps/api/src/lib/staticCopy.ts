import { kommoLeadId, todayISO, type ISODate, type VehiclePool } from '@ev8/shared';
import type { Prisma } from '../generated/prisma/client.js';
import type { Actor } from './auth.js';
import { dateFromISO, isoDate } from './dates.js';
import { prisma } from './db.js';
import { env } from './env.js';
import { brief, ownerBy } from './rentalLoader.js';
import { movePool } from './vehicles.js';

// The static part of a stand — models, points, customer cards and, when asked
// for, the list of mopeds — carried from one stand to another (Mika, 08.10.2026: the test
// stand's static data goes to production ahead of the launch). One side
// writes it out as JSON, the other reads it in; between them is a pipe on the
// server, never a file.
//
//   · A row keeps its id. The same card is the same card on both stands, so
//     running it again finds what it brought before, and what points at a row
//     (a moped at its model and its point) needs no translation.
//   · Everything is checked before anything is written; one problem anywhere
//     and nothing is written. All of it is written in one transaction.
//   · What changes by the day is not carried: a moped arrives "available"
//     with no rental — who rides it comes with the rentals. Customers' files
//     and the people who sign in are not carried either.
//   · While the receiving stand has no rentals it follows the sending one: a
//     row that differs is brought up to date. Once it has rentals it is being
//     worked on, and a row that is already there is left as it is.
//
// The report is for the owner, in Russian: counts, and a name only where a
// row is a problem. No phone, personal number or address.

export const STATIC_VERSION = 1;

const NOTE = 'brought over from the test stand';

const MODEL = ['brand', 'name', 'salePriceTetri', 'weeklyRateTetri', 'costTetri', 'forSale', 'forRent', 'photoUrl', 'notes', 'odooSaleProductId', 'odooRentalProductId', 'odooFleetModelId', 'archived'] as const;
const LOCATION = ['name', 'kind', 'note', 'sortOrder', 'archived'] as const;
const CUSTOMER = ['name', 'nameKa', 'nameLat', 'personalId', 'phone', 'email', 'kind', 'recordKind', 'source', 'tags', 'address', 'notes', 'country', 'contactPerson', 'channel', 'goods', 'bank', 'kommoRef', 'odooPartnerId'] as const;
/** A moped's own facts and where it belongs. Its state and its rental are not here. */
const VEHICLE = ['vin', 'modelId', 'color', 'year', 'arrivedOn', 'pool', 'locationId', 'odometerKm', 'notes', 'costTetri', 'odooFleetId', 'odooLotId', 'archived'] as const;

const KINDS = ['models', 'locations', 'customers', 'vehicles'] as const;
export type StaticKind = (typeof KINDS)[number];
const FIELDS: Record<StaticKind, readonly string[]> = { models: MODEL, locations: LOCATION, customers: CUSTOMER, vehicles: VEHICLE };

export type StaticRow = { id: string } & Record<string, unknown>;

export interface StaticSet {
  version: number;
  models: StaticRow[];
  locations: StaticRow[];
  customers: StaticRow[];
  vehicles: StaticRow[];
  /** What the sending stand has and this does not carry — said, so nobody takes silence for "nothing". */
  left: { customerFiles: number; archivedCustomers: number; mergedCustomers: number; vehicleStates: Record<string, number> };
}

const pick = (row: Record<string, unknown>, fields: readonly string[]): StaticRow => {
  const out: StaticRow = { id: String(row.id) };
  for (const f of fields) out[f] = row[f] instanceof Date ? isoDate(row[f] as Date) : (row[f] ?? null);
  return out;
};

/** A stand's static rows as they stand now. Reads only. */
export async function readStatic(): Promise<StaticSet> {
  const [models, locations, customers, vehicles, archivedCustomers, mergedCustomers] = await Promise.all([
    prisma.vehicleModel.findMany({ orderBy: [{ brand: 'asc' }, { name: 'asc' }] }),
    prisma.location.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
    // A card merged into another is that other card; an archived one is nobody's business on a new stand.
    prisma.customer.findMany({ where: { archived: false, mergedIntoId: null }, orderBy: { createdAt: 'asc' } }),
    prisma.vehicle.findMany({ orderBy: { vin: 'asc' } }),
    prisma.customer.count({ where: { archived: true, mergedIntoId: null } }),
    prisma.customer.count({ where: { mergedIntoId: { not: null } } }),
  ]);
  const customerFiles = await prisma.storedFile.count({ where: { customerId: { in: customers.map((c) => c.id) }, archived: false } });
  const vehicleStates: Record<string, number> = {};
  for (const v of vehicles) vehicleStates[v.state] = (vehicleStates[v.state] ?? 0) + 1;
  return {
    version: STATIC_VERSION,
    models: models.map((r) => pick(r, MODEL)),
    locations: locations.map((r) => pick(r, LOCATION)),
    customers: customers.map((r) => pick(r, CUSTOMER)),
    vehicles: vehicles.map((r) => pick(r, VEHICLE)),
    left: { customerFiles, archivedCustomers, mergedCustomers, vehicleStates },
  };
}

/** What arrived as text → the set, or why it cannot be read. */
export function parseStatic(text: string): { set: StaticSet | null; refused: string | null } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { set: null, refused: text.trim() ? 'Данные с тестового стенда не читаются: это не JSON.' : 'С тестового стенда ничего не пришло.' };
  }
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!o || o.version !== STATIC_VERSION) return { set: null, refused: 'Данные с тестового стенда собраны другой версией программы: стенды должны стоять на одной версии.' };
  for (const kind of KINDS) {
    const rows = o[kind];
    if (!Array.isArray(rows)) return { set: null, refused: `В данных с тестового стенда нет раздела ${kind}.` };
    const want = ['id', ...FIELDS[kind]].sort().join();
    for (const r of rows) {
      const ok = r && typeof r === 'object' && typeof (r as StaticRow).id === 'string' && Object.keys(r as object).sort().join() === want;
      // A field one side knows and the other does not would be dropped in silence.
      if (!ok) return { set: null, refused: `Раздел ${kind} собран другой версией программы: стенды должны стоять на одной версии.` };
    }
  }
  const left = (o.left ?? {}) as Partial<StaticSet['left']>;
  return {
    set: {
      version: STATIC_VERSION,
      models: o.models as StaticRow[],
      locations: o.locations as StaticRow[],
      customers: o.customers as StaticRow[],
      vehicles: o.vehicles as StaticRow[],
      left: { customerFiles: left.customerFiles ?? 0, archivedCustomers: left.archivedCustomers ?? 0, mergedCustomers: left.mergedCustomers ?? 0, vehicleStates: left.vehicleStates ?? {} },
    },
    refused: null,
  };
}

export type StaticVerdict = 'create' | 'update' | 'same' | 'kept' | 'problem';

export interface PlanRow {
  kind: StaticKind;
  row: StaticRow;
  /** What a person would call it: a model's name, a point's, a customer's, the end of a VIN. */
  label: string;
  verdict: StaticVerdict;
  /** The fields that differ, for `update` and `kept`. */
  changed: string[];
  before: StaticRow | null;
  problem: string | null;
}

const lower = (v: unknown): string => String(v ?? '').trim().toLowerCase();
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const both = (a: unknown, b: unknown): boolean => a != null && b != null && same(a, b);

function labelOf(kind: StaticKind, r: StaticRow): string {
  if (kind === 'models') return `${String(r.brand)} ${String(r.name)}`;
  if (kind === 'vehicles') return `…${String(r.vin).slice(-6)}`;
  return String(r.name);
}

/** Another row of the receiving stand that is this one under a different id — the reason it cannot simply be added. */
function twinOf(kind: StaticKind, r: StaticRow, others: StaticRow[]): string | null {
  for (const o of others) {
    if (o.id === r.id) continue;
    if (kind === 'models') {
      if (lower(o.brand) === lower(r.brand) && lower(o.name) === lower(r.name)) return 'на этом стенде такая модель уже заведена отдельно';
      if (both(o.odooSaleProductId, r.odooSaleProductId) || both(o.odooRentalProductId, r.odooRentalProductId) || both(o.odooFleetModelId, r.odooFleetModelId)) return 'на этом стенде уже есть модель с тем же номером из старой системы';
    } else if (kind === 'locations') {
      if (lower(o.name) === lower(r.name)) return 'на этом стенде точка с таким названием уже заведена отдельно';
    } else if (kind === 'customers') {
      if (both(o.personalId, r.personalId)) return 'на этом стенде уже есть другая карточка с тем же личным номером';
      if (both(o.odooPartnerId, r.odooPartnerId)) return 'на этом стенде уже есть другая карточка с тем же номером из старой системы';
      const lead = kommoLeadId(r.kommoRef as string | null);
      if (lead && kommoLeadId(o.kommoRef as string | null) === lead) return 'на этом стенде уже есть другая карточка с той же сделкой Kommo';
    } else {
      if (lower(o.vin) === lower(r.vin)) return 'на этом стенде мопед с таким VIN уже заведён отдельно';
      if (both(o.odooFleetId, r.odooFleetId) || both(o.odooLotId, r.odooLotId)) return 'на этом стенде уже есть мопед с тем же номером из старой системы';
    }
  }
  return null;
}

/**
 * What bringing `incoming` to a stand that holds `existing` would do, row by
 * row. Pure: the same answer for the check and for the write.
 * `live`: the stand has rentals — a row already there is not touched.
 */
export function planStatic(incoming: Pick<StaticSet, StaticKind>, existing: Pick<StaticSet, StaticKind>, live: boolean): PlanRow[] {
  const plan: PlanRow[] = [];
  for (const kind of KINDS) {
    const byId = new Map(existing[kind].map((r) => [r.id, r]));
    for (const row of incoming[kind]) {
      const before = byId.get(row.id) ?? null;
      const changed = before ? FIELDS[kind].filter((f) => !same(before[f], row[f])) : [];
      let verdict: StaticVerdict = !before ? 'create' : changed.length === 0 ? 'same' : live ? 'kept' : 'update';
      let problem = verdict === 'create' || verdict === 'update' ? twinOf(kind, row, existing[kind]) : null;
      if (!problem && kind === 'vehicles' && verdict !== 'same' && verdict !== 'kept') {
        // A moped points at its model and its point: both have to come with it or be there.
        const has = (k: 'models' | 'locations', id: unknown) => id == null || incoming[k].some((r) => r.id === id) || existing[k].some((r) => r.id === id);
        if (!has('models', row.modelId)) problem = 'его модели нет ни в переносимых данных, ни на этом стенде';
        else if (!has('locations', row.locationId)) problem = 'его точки нет ни в переносимых данных, ни на этом стенде';
      }
      if (problem) verdict = 'problem';
      plan.push({ kind, row, label: labelOf(kind, row), verdict, changed, before, problem });
    }
  }
  return plan;
}

export interface StaticReport {
  mode: 'check' | 'commit';
  today: ISODate;
  ownerName: string | null;
  refused: string | null;
  /** The receiving stand has rentals: rows already there were left as they are. */
  live: boolean;
  /** The mopeds were asked for too; without that only models, points and cards go. */
  mopeds: boolean;
  plan: PlanRow[];
  left: StaticSet['left'];
  written: boolean;
  failure: string | null;
}

export interface CopyInput {
  /** The sending stand's set, as JSON text. */
  text: string;
  ownerEmail: string | null;
  commit: boolean;
  /** The list of mopeds too. Without it: models, points and cards only. */
  mopeds?: boolean;
  today?: ISODate;
}

async function write(tx: Prisma.TransactionClient, p: PlanRow, actor: Actor, today: ISODate): Promise<void> {
  const r = p.row;
  const { id, ...fields } = r;
  const delta = Object.fromEntries(p.changed.map((f) => [f, r[f]]));
  const was = Object.fromEntries(p.changed.map((f) => [f, p.before?.[f] ?? null]));
  const log = (action: string, entityType: string, before?: object, after?: object) =>
    tx.auditLog.create({ data: { actorId: actor.id, action, entityType, entityId: id, before, after, note: NOTE } });

  if (p.kind === 'models') {
    if (p.verdict === 'create') {
      await tx.vehicleModel.create({ data: { id, ...fields } as Prisma.VehicleModelUncheckedCreateInput });
      await log('model.create', 'vehicle_model', undefined, { brand: r.brand, name: r.name });
    } else {
      await tx.vehicleModel.update({ where: { id }, data: { ...delta, updatedAt: new Date() } as Prisma.VehicleModelUncheckedUpdateInput });
      await log('model.update', 'vehicle_model', was, delta);
    }
  } else if (p.kind === 'locations') {
    if (p.verdict === 'create') {
      await tx.location.create({ data: { id, ...fields, createdById: actor.id } as Prisma.LocationUncheckedCreateInput });
      await log('location.create', 'location', undefined, { name: r.name });
    } else {
      await tx.location.update({ where: { id }, data: { ...delta, updatedAt: new Date() } as Prisma.LocationUncheckedUpdateInput });
      await log('location.update', 'location', was, delta);
    }
  } else if (p.kind === 'customers') {
    const supplier = r.recordKind === 'supplier';
    if (p.verdict === 'create') {
      await tx.customer.create({ data: { id, ...fields } as Prisma.CustomerUncheckedCreateInput });
      await log(supplier ? 'supplier.create' : 'customer.create', 'customer', undefined, { name: r.name });
    } else {
      await tx.customer.update({ where: { id }, data: { ...delta, updatedAt: new Date() } as Prisma.CustomerUncheckedUpdateInput });
      await log(supplier ? 'supplier.update' : 'customer.update', 'customer', was, delta);
    }
  } else {
    // The park is a decision and so an event (ADR-0005): it goes through movePool, not into the row.
    const { pool, arrivedOn, ...own } = fields;
    if (p.verdict === 'create') {
      await tx.vehicle.create({ data: { id, ...own, arrivedOn: dateFromISO(arrivedOn as ISODate | null) } as Prisma.VehicleUncheckedCreateInput });
      await tx.vehicleEvent.create({
        data: { vehicleId: id, kind: 'arrived', occurredOn: dateFromISO((arrivedOn as ISODate | null) ?? today)!, fromState: null, toState: 'available', actorId: actor.id, reason: NOTE },
      });
      await log('vehicle.create', 'vehicle', undefined, { vin: r.vin, arrivedOn });
    } else {
      const data: Record<string, unknown> = Object.fromEntries(p.changed.filter((f) => f !== 'pool' && f !== 'arrivedOn').map((f) => [f, r[f]]));
      if (p.changed.includes('arrivedOn')) data.arrivedOn = dateFromISO(arrivedOn as ISODate | null);
      if (Object.keys(data).length > 0) await tx.vehicle.update({ where: { id }, data: { ...data, updatedAt: new Date() } as Prisma.VehicleUncheckedUpdateInput });
      // Nobody has decided: the park is taken back to "not chosen", which is no event.
      if (p.changed.includes('pool') && pool == null) await tx.vehicle.update({ where: { id }, data: { pool: null, updatedAt: new Date() } });
      await log('vehicle.update', 'vehicle', was, delta);
    }
    if (pool != null && (p.verdict === 'create' || p.changed.includes('pool'))) {
      await movePool(tx, { vehicleId: id, pool: pool as VehiclePool, occurredOn: today, actorId: actor.id, reason: NOTE });
    }
  }
}

export async function copyStatic(input: CopyInput): Promise<StaticReport> {
  const today = input.today ?? todayISO(new Date(), env.TZ);
  const report: StaticReport = {
    mode: input.commit ? 'commit' : 'check',
    today,
    ownerName: null,
    refused: null,
    live: false,
    mopeds: input.mopeds === true,
    plan: [],
    left: { customerFiles: 0, archivedCustomers: 0, mergedCustomers: 0, vehicleStates: {} },
    written: false,
    failure: null,
  };

  const owner = await ownerBy(input.ownerEmail);
  if (!owner.actor) return { ...report, refused: owner.refused };
  report.ownerName = owner.actor.name;

  const parsed = parseStatic(input.text);
  if (!parsed.set) return { ...report, refused: parsed.refused };
  const incoming = report.mopeds ? parsed.set : { ...parsed.set, vehicles: [] };
  report.left = parsed.set.left;

  // Every row of this stand, not only the live ones: an archived card still holds its personal number.
  const [models, locations, customers, vehicles, rentals] = await Promise.all([
    prisma.vehicleModel.findMany(),
    prisma.location.findMany(),
    prisma.customer.findMany(),
    prisma.vehicle.findMany(),
    prisma.rental.count(),
  ]);
  report.live = rentals > 0;
  report.plan = planStatic(
    incoming,
    { models: models.map((r) => pick(r, MODEL)), locations: locations.map((r) => pick(r, LOCATION)), customers: customers.map((r) => pick(r, CUSTOMER)), vehicles: vehicles.map((r) => pick(r, VEHICLE)) },
    report.live,
  );

  const todo = report.plan.filter((p) => p.verdict === 'create' || p.verdict === 'update');
  if (!input.commit || todo.length === 0 || report.plan.some((p) => p.verdict === 'problem')) return report;

  try {
    await prisma.$transaction(
      async (tx) => {
        // In the order they point at each other: a moped needs its model and its point.
        for (const p of todo) await write(tx, p, owner.actor!, today);
      },
      { maxWait: 10_000, timeout: 300_000 },
    );
    report.written = true;
  } catch (e) {
    report.failure = brief(e);
  }
  return report;
}

/** 0 — as asked; 1 — problems, nothing written; 2 — the run did not start; 3 — the write was refused, nothing written. */
export function staticExitCode(r: StaticReport): number {
  if (r.refused) return 2;
  if (r.failure) return 3;
  return r.plan.some((p) => p.verdict === 'problem') ? 1 : 0;
}

const KIND_RU: Record<StaticKind, string> = { models: 'Модели', locations: 'Точки', customers: 'Карточки', vehicles: 'Мопеды' };
const STATE_RU: Record<string, string> = { available: 'свободен', rented: 'в аренде', service: 'в ремонте', out: 'выбыл', sold: 'продан' };

export function formatStaticReport(r: StaticReport): string {
  const out: string[] = [];
  const d = r.today;
  out.push(`Перенос статичных данных с тестового стенда — ${r.mode === 'commit' ? 'запись' : 'проверка, без записи'}. Сегодня ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}.`);
  if (r.refused) return [...out, r.refused, 'Ничего не записано.'].join('\n');
  out.push(`От имени: ${r.ownerName}.`, '');

  const n = (kind: StaticKind, v: StaticVerdict) => r.plan.filter((p) => p.kind === kind && p.verdict === v).length;
  const done = r.written;
  for (const kind of KINDS) {
    if (kind === 'vehicles' && !r.mopeds) {
      out.push(`Мопеды:   в этот раз не переносятся (на тестовом их ${Object.values(r.left.vehicleStates).reduce((a, b) => a + b, 0)}); чтобы перенести и их — добавьте --mopeds.`);
      continue;
    }
    const parts = [
      `${done ? 'добавлено' : 'новых'} ${n(kind, 'create')}`,
      `${done ? 'обновлено' : 'обновить'} ${n(kind, 'update')}`,
      `без изменений ${n(kind, 'same')}`,
      n(kind, 'kept') ? `уже есть и отличаются, не трогаю ${n(kind, 'kept')}` : null,
      n(kind, 'problem') ? `С ПРОБЛЕМОЙ ${n(kind, 'problem')}` : null,
    ].filter(Boolean);
    let line = `${`${KIND_RU[kind]}:`.padEnd(9)} ${parts.join(', ')}`;
    if (kind === 'customers') {
      const cards = r.plan.filter((p) => p.kind === 'customers');
      const suppliers = cards.filter((p) => p.row.recordKind === 'supplier').length;
      line += ` (из ${cards.length}: клиентов и прочих ${cards.length - suppliers}, поставщиков ${suppliers})`;
    }
    out.push(line);
  }
  const problems = r.plan.filter((p) => p.verdict === 'problem');
  if (problems.length) {
    out.push('', 'Проблемы:');
    for (const p of problems) out.push(`  ${KIND_RU[p.kind].toLowerCase()} · ${p.label} — ${p.problem}`);
  }

  out.push('', 'Что не переносится:');
  const states = Object.entries(r.left.vehicleStates).map(([s, c]) => `${STATE_RU[s] ?? s} ${c}`).join(', ');
  if (r.mopeds) out.push(`  состояние мопедов: каждый приходит «свободен», без аренды${states ? ` (на тестовом: ${states})` : ''}; кто на каком ездит, придёт вместе с арендами;`);
  out.push('  аренды, оплаты, залоги, продажи, ремонты, склад, журнал;');
  out.push(`  файлы в карточках клиентов${r.left.customerFiles ? ` — на тестовом их ${r.left.customerFiles}` : ' — на тестовом их нет'};`);
  out.push(`  учётки людей; карточки из архива (${r.left.archivedCustomers}) и слитые с другими (${r.left.mergedCustomers}).`);
  if (r.live) out.push('', 'На этом стенде уже есть аренды — на нём работают, поэтому то, что уже есть, не меняется: добавляется только новое.');

  out.push('');
  const todo = r.plan.filter((p) => p.verdict === 'create' || p.verdict === 'update').length;
  if (r.failure) out.push(`Стенд отказал при записи: ${r.failure}`, 'Не записано ничего: всё пишется вместе или никак.');
  else if (problems.length) out.push('Ничего не записано: пока есть хоть одна проблема, не пишется ничего.');
  else if (r.written) out.push(`Записано: ${todo}.`);
  else if (todo === 0) out.push('На этом стенде уже всё есть. Ничего не записано.');
  else out.push(`Всё в порядке. Ничего не записано — это была проверка; к записи готово: ${todo}.`);
  return out.join('\n');
}
