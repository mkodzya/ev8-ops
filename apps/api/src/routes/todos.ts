import {
  ALL_CHIP,
  TODO_ASSIGNEE_ROLES,
  TODO_LINK_KINDS,
  TODO_MINE,
  TODO_NOTE_MAX,
  TODO_REPEATS,
  fleetNumber,
  mayGiveTodo,
  mayLinkTodo,
  repeatDayOf,
  todayISO,
  todoFault,
  todoLinkKindsFor,
  todoRecordEnded,
  type ISODate,
  type Permission,
  type Role,
  type TodoLinkKind,
  type TodoRepeat,
  type TodoFault,
  type TodoRepeatKind,
} from '@ev8/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Prisma } from '../generated/prisma/client.js';
import { audit } from '../lib/audit.js';
import { permissionsOf, type Actor } from '../lib/auth.js';
import { dateFromISO, isoDate } from '../lib/dates.js';
import { prisma } from '../lib/db.js';
import { env } from '../lib/env.js';
import { badRequest, conflict, forbidden, notFound, type ApiError } from '../lib/errors.js';
import { actorOf, mayView } from '../lib/guard.js';
import { TODO_SELECT, doneSince, keepTodos, todoView, type TodoReader } from '../lib/todos.js';
import { oneOf, str } from '../lib/validate.js';
import { BODY_LIMIT, readUpload, sha } from './files.js';

// «Задачи» (GitHub issue #18 of the director, part A; Mika's «А» of
// 28.10.2026; ADR-0050). Every route is `todos.own` — every role keeps his own
// tasks — and asks inside it what this person may do to this task: whose it
// is closes it, who set it changes it, an owner (`todos.assign`) gives one to
// a manager or the chief mechanic and reads everybody's. A refusal says so in
// words; the screen does not offer what the server would refuse.

type Body = Record<string, unknown>;

/** Open: neither closed nor taken back. */
const OPEN = { closedAt: null, deletedAt: null } as const;

const reader = (req: FastifyRequest): TodoReader => {
  const a = actorOf(req);
  return { id: a.id, permissions: permissionsOf(a.role, a.via) };
};

const today = (): ISODate => todayISO(new Date(), env.TZ);

/** The fields of a task as the body brings them; checked by `todoFault`, the form's own rule. */
function fieldsOf(b: Body, was?: { text: string; note: string | null; dueOn: string; leadDays: number; needsFile: boolean }) {
  const text = typeof b.text === 'string' ? b.text.trim() : (was?.text ?? '');
  const note = 'note' in b ? (typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null) : (was?.note ?? null);
  const dueOn = typeof b.dueOn === 'string' ? b.dueOn.trim() : (was?.dueOn ?? '');
  const leadDays = b.leadDays == null || b.leadDays === '' ? (was?.leadDays ?? 0) : Number(b.leadDays);
  const needsFile = typeof b.needsFile === 'boolean' ? b.needsFile : (was?.needsFile ?? false);
  return { text, note, dueOn, leadDays, needsFile };
}

/**
 * A task's field refused by `todoFault`, the form's own rule, with the field
 * named. Each code written out: the dictionaries' guard reads them here.
 */
function refusal(fault: TodoFault): ApiError {
  const field = { field: fault.field };
  switch (fault.code) {
    case 'todo_text_missing':
      return badRequest('todo_text_missing', 'Write what to do.', field);
    case 'todo_text_long':
      return badRequest('todo_text_long', 'Up to 300 characters; the rest goes in the comment.', field);
    case 'todo_note_long':
      return badRequest('todo_note_long', 'The comment is up to 2,000 characters.', field);
    case 'todo_due_bad':
      return badRequest('todo_due_bad', 'The due day is a date, YYYY-MM-DD.', field);
    case 'todo_due_past':
      return badRequest('todo_due_past', 'The due day has passed.', field);
    case 'todo_lead_bad':
      return badRequest('todo_lead_bad', 'Shown ahead by 0 to 30 days.', field);
  }
}

/** Whom the task goes to — himself, or for an owner a manager or the chief mechanic (`mayGiveTodo`). */
async function assigneeOf(actor: Actor, permissions: readonly Permission[], id: string): Promise<{ id: string; name: string; role: Role }> {
  const u = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, role: true, active: true } });
  if (!u) throw notFound('user_not_found', 'No such person.');
  if (!mayGiveTodo(permissions, actor.id, { id: u.id, role: u.role as Role, active: u.active })) {
    throw forbidden('todo_assignee_refused', 'A task is set to oneself; an owner sets one to a manager or the chief mechanic.', { field: 'assigneeId' });
  }
  return { id: u.id, name: u.name, role: u.role as Role };
}

interface LinkIds {
  vehicleId: string | null;
  rentalId: string | null;
  customerId: string | null;
}
const NO_LINK: LinkIds = { vehicleId: null, rentalId: null, customerId: null };

const kindOf = (l: LinkIds): TodoLinkKind | null => (l.vehicleId ? 'vehicle' : l.rentalId ? 'rental' : l.customerId ? 'customer' : null);

const sameLink = (a: LinkIds, b: LinkIds): boolean => a.vehicleId === b.vehicleId && a.rentalId === b.rentalId && a.customerId === b.customerId;

/**
 * The record a task is about, for the journal: its kind and what a person
 * knows it by — a moped's fleet number, a rental's number, a customer's name.
 * By kind alone a task moved from one moped to another wrote nothing.
 */
async function linkWord(l: LinkIds): Promise<{ kind: TodoLinkKind; label: string | null } | null> {
  if (l.vehicleId) {
    const v = await prisma.vehicle.findUnique({ where: { id: l.vehicleId }, select: { vin: true, fleetNo: true } });
    return { kind: 'vehicle', label: v ? (fleetNumber(v.fleetNo) ?? `···${v.vin.slice(-4)}`) : null };
  }
  if (l.rentalId) {
    const r = await prisma.rental.findUnique({ where: { id: l.rentalId }, select: { number: true } });
    return { kind: 'rental', label: r?.number ?? null };
  }
  if (l.customerId) {
    const c = await prisma.customer.findUnique({ where: { id: l.customerId }, select: { name: true } });
    return { kind: 'customer', label: c?.name ?? null };
  }
  return null;
}

/**
 * The record a task is about, as the body names it: `{ kind, id }`, or null
 * for none. Whoever reads the fleet finds it, and only a record the assignee
 * reads — a mechanic is sent a moped, never a customer (`mayLinkTodo`). A
 * record that has ended takes no task: the task would close at once.
 */
async function linkOf(permissions: readonly Permission[], assignee: Role, raw: unknown): Promise<LinkIds> {
  if (raw == null) return NO_LINK;
  const link = raw as { kind?: unknown; id?: unknown };
  const kind = link.kind as TodoLinkKind;
  if (typeof raw !== 'object' || !TODO_LINK_KINDS.includes(kind) || typeof link.id !== 'string' || !link.id) {
    throw badRequest('bad_field', 'link is { kind, id }', { field: 'link' });
  }
  if (!mayLinkTodo(permissions, assignee, kind)) throw forbidden('todo_link_refused', 'A task given to a mechanic is about a moped only.', { field: 'link' });
  const id = link.id;
  if (kind === 'vehicle') {
    const v = await prisma.vehicle.findUnique({ where: { id }, select: { id: true, state: true, archived: true } });
    if (!v) throw notFound('todo_link_not_found', 'No such record.');
    if (todoRecordEnded({ kind, vehicleState: v.state, vehicleArchived: v.archived })) throw conflict('todo_link_ended', 'That moped has left the fleet.', { field: 'link' });
    return { ...NO_LINK, vehicleId: v.id };
  }
  if (kind === 'rental') {
    const r = await prisma.rental.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!r) throw notFound('todo_link_not_found', 'No such record.');
    if (todoRecordEnded({ kind, rentalStatus: r.status })) throw conflict('todo_link_ended', 'That rental is returned.', { field: 'link' });
    return { ...NO_LINK, rentalId: r.id };
  }
  const c = await prisma.customer.findUnique({ where: { id }, select: { id: true, archived: true } });
  if (!c) throw notFound('todo_link_not_found', 'No such record.');
  if (c.archived) throw conflict('customer_archived', 'This card was merged into another one; add it there.', { field: 'link' });
  return { ...NO_LINK, customerId: c.id };
}

/** The task as stored, for a write: refused with words when it is not there. */
async function stored(id: string) {
  const row = await prisma.todo.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      text: true,
      note: true,
      dueOn: true,
      leadDays: true,
      needsFile: true,
      assigneeId: true,
      createdById: true,
      vehicleId: true,
      rentalId: true,
      customerId: true,
      seriesId: true,
      seriesOn: true,
      closedAt: true,
      closedById: true,
      closeNote: true,
      closedByRecord: true,
      assignee: { select: { role: true, name: true } },
      series: { select: { id: true, repeat: true, repeatDay: true, stoppedAt: true, lastOn: true } },
      rental: { select: { status: true } },
      vehicle: { select: { state: true, archived: true } },
      _count: { select: { files: { where: { archived: false } } } },
    },
  });
  if (!row) throw notFound('todo_not_found', 'No such task.');
  return row;
}

/**
 * Stop a repeat, and take back the occurrences it already made after this one
 * that nobody has closed — «не повторять» means none to come. Inside the
 * caller's transaction.
 */
async function stopSeries(tx: Prisma.TransactionClient, seriesId: string, after: Date, actorId: string): Promise<number> {
  const at = new Date();
  await tx.todoSeries.update({ where: { id: seriesId }, data: { stoppedAt: at, stoppedById: actorId } });
  const { count } = await tx.todo.updateMany({
    where: { seriesId, seriesOn: { gt: after }, ...OPEN },
    data: { deletedAt: at, deletedById: actorId, updatedAt: at },
  });
  return count;
}

export function todoRoutes(app: FastifyInstance): void {
  /**
   * The list: open tasks, oldest day first, and what was closed in the last
   * seven days. `who` — `mine` (the first chip), a person's id or `all`; only
   * an owner reads anybody's but his own. An owner also gets the people the
   * chips are made of, each with his open tasks.
   */
  app.get<{ Querystring: { who?: string } }>('/api/todos', { config: { scope: 'todos.own' } }, async (req) => {
    const me = reader(req);
    const day = today();
    await keepTodos(day);
    const everybody = mayView(req, 'todos.assign');
    const who = req.query.who || TODO_MINE;
    if (!everybody && who !== TODO_MINE && who !== me.id) throw forbidden('todos_not_yours', 'Only your own tasks.');
    const whose: Prisma.TodoWhereInput = who === ALL_CHIP ? {} : { assigneeId: who === TODO_MINE ? me.id : who };
    const since = doneSince(day);
    const [open, done, doneTotal, groups] = await Promise.all([
      prisma.todo.findMany({ where: { ...whose, ...OPEN }, orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }], select: TODO_SELECT }),
      prisma.todo.findMany({ where: { ...whose, deletedAt: null, closedAt: { gte: since } }, orderBy: { closedAt: 'desc' }, take: 50, select: TODO_SELECT }),
      prisma.todo.count({ where: { ...whose, deletedAt: null, closedAt: { gte: since } } }),
      everybody ? prisma.todo.groupBy({ by: ['assigneeId'], where: OPEN, _count: { _all: true } }) : null,
    ]);
    // The chips of an owner: himself first («Мои»), then whoever has tasks open, by name.
    let people: { id: string; name: string; role: Role; open: number }[] | null = null;
    if (groups) {
      const ids = [...new Set([me.id, ...groups.map((g) => g.assigneeId)])];
      const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } });
      const count = new Map(groups.map((g) => [g.assigneeId, g._count._all]));
      people = users
        .map((u) => ({ id: u.id, name: u.name, role: u.role as Role, open: count.get(u.id) ?? 0 }))
        .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name)));
    }
    return { today: day, todos: open.map((t) => todoView(t, me)), done: done.map((t) => todoView(t, me)), doneTotal, people };
  });

  /**
   * Whom this person may give a task to, and what each may be sent about —
   * for the form. Himself, and for an owner the managers and the chief
   * mechanics who are not switched off.
   */
  app.get('/api/todos/assignees', { config: { scope: 'todos.own' } }, async (req) => {
    const actor = actorOf(req);
    const others = mayView(req, 'todos.assign')
      ? await prisma.user.findMany({ where: { active: true, role: { in: [...TODO_ASSIGNEE_ROLES] }, id: { not: actor.id } }, select: { id: true, name: true, role: true }, orderBy: { name: 'asc' } })
      : [];
    const self = { id: actor.id, name: actor.name, role: actor.role };
    return {
      // Linking is for whoever reads the fleet: a mechanic sets himself a task about nothing.
      mayLink: mayView(req, 'fleet.view'),
      assignees: [self, ...others].map((u) => ({ id: u.id, name: u.name, role: u.role as Role, self: u.id === actor.id, linkKinds: todoLinkKindsFor(u.role as Role) })),
    };
  });

  /** A new task, and with «Повтор» its series — the first occurrence is this one. */
  app.post<{ Body: Body }>('/api/todos', { config: { scope: 'todos.own' } }, async (req, reply) => {
    const actor = actorOf(req);
    const me = reader(req);
    const b = req.body ?? {};
    const f = fieldsOf(b);
    const fault = todoFault({ ...f, today: today() });
    if (fault) throw refusal(fault);
    const repeat: TodoRepeat = oneOf(b, 'repeat', TODO_REPEATS) ?? 'none';
    const assignee = await assigneeOf(actor, me.permissions, str(b, 'assigneeId') ?? actor.id);
    const link = await linkOf(me.permissions, assignee.role, b.link);
    const dueOn = dateFromISO(f.dueOn)!;
    const common = { text: f.text, note: f.note, leadDays: f.leadDays, needsFile: f.needsFile, assigneeId: assignee.id, createdById: actor.id, ...link };
    const id = await prisma.$transaction(async (tx) => {
      const series = repeat === 'none' ? null : await tx.todoSeries.create({ data: { ...common, repeat, repeatDay: repeatDayOf(repeat, f.dueOn), lastOn: dueOn }, select: { id: true } });
      const t = await tx.todo.create({ data: { ...common, dueOn, seriesId: series?.id ?? null, seriesOn: series ? dueOn : null }, select: { id: true } });
      return t.id;
    });
    await audit({
      actorId: actor.id,
      action: 'todo.create',
      entityType: 'todo',
      entityId: id,
      after: { text: f.text, dueOn: f.dueOn, assignee: assignee.name, repeat, leadDays: f.leadDays, needsFile: f.needsFile, link: kindOf(link) ?? undefined },
    });
    return reply.code(201).send({ id });
  });

  /**
   * Change a task — whoever set it, while it is open. A task of a repeat
   * changes the ones after it too (its words, whose, «нужно фото», the
   * record), never their days. `repeat`: «Нет» stops the repeat and takes back
   * the occurrences it made ahead; another kind does the same and starts a
   * repeat of its own from this task, its day read from this task's due day.
   */
  app.patch<{ Params: { id: string }; Body: Body }>('/api/todos/:id', { config: { scope: 'todos.own' } }, async (req) => {
    const actor = actorOf(req);
    const me = reader(req);
    const b = req.body ?? {};
    const row = await stored(req.params.id);
    if (row.createdById !== actor.id) throw forbidden('todo_not_yours', 'A task is changed by whoever set it.');
    if (row.closedAt) throw conflict('todo_closed', 'This task is closed; open it again first.');
    const was = { text: row.text, note: row.note, dueOn: isoDate(row.dueOn)!, leadDays: row.leadDays, needsFile: row.needsFile };
    const f = fieldsOf(b, was);
    const fault = todoFault({ ...f, today: today(), dueChanged: f.dueOn !== was.dueOn });
    if (fault) throw refusal(fault);

    const assigneeId = str(b, 'assigneeId') ?? row.assigneeId;
    const assignee = assigneeId === row.assigneeId ? { id: row.assigneeId, name: row.assignee.name, role: row.assignee.role as Role } : await assigneeOf(actor, me.permissions, assigneeId);
    const wasLink: LinkIds = { vehicleId: row.vehicleId, rentalId: row.rentalId, customerId: row.customerId };
    let link = wasLink;
    if ('link' in b) link = await linkOf(me.permissions, assignee.role, b.link);
    else {
      // The record stays — and has to be one the new assignee reads.
      const kind = kindOf(wasLink);
      if (kind && !todoLinkKindsFor(assignee.role).includes(kind)) throw forbidden('todo_link_refused', 'A task given to a mechanic is about a moped only.', { field: 'link' });
    }

    const running = row.series && row.series.stoppedAt == null ? row.series : null;
    const asked = oneOf(b, 'repeat', TODO_REPEATS);
    const repeat: TodoRepeat = asked ?? (running ? (running.repeat as TodoRepeatKind) : 'none');
    const dueOn = dateFromISO(f.dueOn)!;
    const common = { text: f.text, note: f.note, leadDays: f.leadDays, needsFile: f.needsFile, assigneeId: assignee.id, ...link };

    const taken = await prisma.$transaction(async (tx) => {
      const at = new Date();
      let seriesId = row.seriesId;
      let seriesOn = row.seriesOn;
      let takenBack = 0;
      if (running && repeat === 'none') {
        takenBack = await stopSeries(tx, running.id, row.seriesOn!, actor.id);
      } else if (running && repeat === running.repeat) {
        // The repeat goes on as it was: what it makes from, never its days.
        await tx.todoSeries.update({ where: { id: running.id }, data: common });
        await tx.todo.updateMany({ where: { seriesId: running.id, seriesOn: { gt: row.seriesOn! }, ...OPEN }, data: { ...common, updatedAt: at } });
      } else if (repeat !== 'none') {
        // A repeat from this task on: its first occurrence is this one. A
        // repeat of another kind starts so too — the old one stops and takes
        // back what it made ahead. Changed in place it kept the old rule's
        // last day and occurrences: a second task on the new rule's day, or
        // the old rule's days going on before the new one began.
        if (running) takenBack = await stopSeries(tx, running.id, row.seriesOn!, actor.id);
        const s = await tx.todoSeries.create({ data: { ...common, createdById: row.createdById, repeat, repeatDay: repeatDayOf(repeat, f.dueOn), lastOn: dueOn }, select: { id: true } });
        seriesId = s.id;
        seriesOn = dueOn;
      }
      await tx.todo.update({ where: { id: row.id }, data: { ...common, dueOn, seriesId, seriesOn, updatedAt: at } });
      return takenBack;
    });

    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const note = (k: string, from: unknown, to: unknown) => {
      if (from === to) return;
      before[k] = from;
      after[k] = to;
    };
    note('text', was.text, f.text);
    note('note', was.note, f.note);
    note('dueOn', was.dueOn, f.dueOn);
    note('leadDays', was.leadDays, f.leadDays);
    note('needsFile', was.needsFile, f.needsFile);
    if (row.assigneeId !== assignee.id) {
      before.assignee = row.assignee.name;
      after.assignee = assignee.name;
    }
    if (!sameLink(wasLink, link)) {
      // By the record, not its kind: from one moped to another is a change too.
      before.link = await linkWord(wasLink);
      after.link = await linkWord(link);
    }
    note('repeat', running ? running.repeat : 'none', repeat);
    if (taken > 0 && repeat !== 'none') after.takenBack = taken;
    if (Object.keys(after).length > 0) await audit({ actorId: actor.id, action: 'todo.update', entityType: 'todo', entityId: row.id, before, after });
    if (running && repeat === 'none') await audit({ actorId: actor.id, action: 'todo.repeat.stop', entityType: 'todo_series', entityId: running.id, after: { takenBack: taken } });
    return { ok: true };
  });

  /**
   * Take a task back — whoever set it, while it is open. The row stays with
   * who and when; `stop=1` stops its repeat too and takes back the occurrences
   * it made ahead. Without it the repeat goes on: the next one comes.
   */
  app.delete<{ Params: { id: string }; Querystring: { stop?: string } }>('/api/todos/:id', { config: { scope: 'todos.own' } }, async (req) => {
    const actor = actorOf(req);
    const row = await stored(req.params.id);
    if (row.createdById !== actor.id) throw forbidden('todo_not_yours', 'A task is taken back by whoever set it.');
    if (row.closedAt) throw conflict('todo_closed', 'This task is closed; it stays in the list of what was done.');
    const running = row.series && row.series.stoppedAt == null ? row.series : null;
    const stop = req.query.stop === '1' && running != null;
    const taken = await prisma.$transaction(async (tx) => {
      const at = new Date();
      const { count } = await tx.todo.updateMany({ where: { id: row.id, ...OPEN }, data: { deletedAt: at, deletedById: actor.id, updatedAt: at } });
      if (count === 0) throw conflict('todo_closed', 'This task is closed; it stays in the list of what was done.');
      return stop ? stopSeries(tx, running!.id, row.seriesOn!, actor.id) : 0;
    });
    await audit({ actorId: actor.id, action: 'todo.delete', entityType: 'todo', entityId: row.id, before: { text: row.text, dueOn: isoDate(row.dueOn) } });
    if (stop) await audit({ actorId: actor.id, action: 'todo.repeat.stop', entityType: 'todo_series', entityId: running!.id, after: { takenBack: taken } });
    return { ok: true };
  });

  /** A photo or a file to the task — whose it is, while it is open; «нужно фото или файл» asks for one before «Сделано». */
  app.post<{ Params: { id: string }; Body: Body }>('/api/todos/:id/files', { config: { scope: 'todos.own' }, bodyLimit: BODY_LIMIT }, async (req, reply) => {
    const actor = actorOf(req);
    const row = await stored(req.params.id);
    if (row.assigneeId !== actor.id) throw forbidden('todo_not_yours', 'A task is closed by whoever it was given to.');
    if (row.closedAt) throw conflict('todo_closed', 'This task is closed; open it again first.');
    const { bytes, mime, label } = readUpload(req.body ?? {});
    const f = await prisma.storedFile.create({
      data: { kind: 'todo_file', todoId: row.id, label, mimeType: mime, sizeBytes: bytes.length, sha256: sha(bytes), bytes: new Uint8Array(bytes), uploadedById: actor.id },
      select: { id: true },
    });
    await audit({ actorId: actor.id, action: 'todo.file.add', entityType: 'todo', entityId: row.id, after: { fileId: f.id, sizeBytes: bytes.length } });
    return reply.code(201).send({ id: f.id });
  });

  /** «Сделано» — whose it is, with a comment if he wants; with «нужно фото или файл» not without one. */
  app.post<{ Params: { id: string }; Body: Body }>('/api/todos/:id/close', { config: { scope: 'todos.own' } }, async (req) => {
    const actor = actorOf(req);
    const row = await stored(req.params.id);
    if (row.assigneeId !== actor.id) throw forbidden('todo_not_yours', 'A task is closed by whoever it was given to.');
    if (row.closedAt) throw conflict('todo_closed', 'This task is closed already.');
    if (row.needsFile && row._count.files === 0) throw conflict('todo_needs_file', 'This task closes with a photo or a file.', { field: 'files' });
    const closeNote = str(req.body ?? {}, 'note', { max: TODO_NOTE_MAX });
    const at = new Date();
    const { count } = await prisma.todo.updateMany({ where: { id: row.id, ...OPEN }, data: { closedAt: at, closedById: actor.id, closeNote, updatedAt: at } });
    if (count === 0) throw conflict('todo_closed', 'This task is closed already.');
    await audit({ actorId: actor.id, action: 'todo.close', entityType: 'todo', entityId: row.id, after: { files: row._count.files }, note: closeNote });
    return { ok: true };
  });

  /**
   * Open a closed task again — whose it is or who set it: «Сделано» pressed by
   * mistake, the «Отменить» of its message. One its record closed stays closed
   * while the record is ended: it would close again at the next look.
   */
  app.post<{ Params: { id: string } }>('/api/todos/:id/reopen', { config: { scope: 'todos.own' } }, async (req) => {
    const actor = actorOf(req);
    const row = await stored(req.params.id);
    if (row.assigneeId !== actor.id && row.createdById !== actor.id) throw forbidden('todo_not_yours', 'A task is opened again by whoever it was given to or whoever set it.');
    if (!row.closedAt) return { ok: true };
    const ended =
      (row.rentalId != null && todoRecordEnded({ kind: 'rental', rentalStatus: row.rental?.status })) ||
      (row.vehicleId != null && todoRecordEnded({ kind: 'vehicle', vehicleState: row.vehicle?.state, vehicleArchived: row.vehicle?.archived }));
    if (ended) throw conflict('todo_record_ended', 'The record this task is about has ended; set a new task.');
    const at = new Date();
    await prisma.todo.update({ where: { id: row.id }, data: { closedAt: null, closedById: null, closeNote: null, closedByRecord: false, updatedAt: at } });
    await audit({
      actorId: actor.id,
      action: 'todo.reopen',
      entityType: 'todo',
      entityId: row.id,
      before: { closedAt: row.closedAt.toISOString(), closedBy: row.closedById, closedByRecord: row.closedByRecord, closeNote: row.closeNote },
    });
    return { ok: true };
  });
}
