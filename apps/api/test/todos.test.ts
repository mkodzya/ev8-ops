// «Задачи» (GitHub issue #18 of the director, part A; Mika's «А» of
// 28.10.2026; ADR-0050). Who gives a task to whom, who reads and closes it,
// a photo or a file before «Сделано», a repeat that makes every late
// occurrence and the next one once, a record that ends closing the tasks
// about it, and a mechanic's own «Сегодня». Every task and name here is
// invented; the suites share one database, so each works with its own people
// and its own tasks.
import { TODO_ENDED_RENTAL, TODO_ENDED_VEHICLE, addDays, fleetNumber, nextTodoDue, todayISO, type TodoView } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, login, makeUser, uniq } from './helpers.js';

// A 1×1 PNG.
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

const today = () => todayISO();
const date = (day: string) => new Date(`${day}T00:00:00Z`);
const digits = () => uniq().replace(/\D/g, '');

interface List {
  today: string;
  todos: TodoView[];
  done: TodoView[];
  doneTotal: number;
  people: { id: string; name: string; role: string; open: number }[] | null;
}

async function person(role: 'owner' | 'manager' | 'mechanic' | 'chief_mechanic') {
  const u = await makeUser(role);
  return { id: u.id, cookie: await login(u.email) };
}

const list = async (cookie: string, who = 'mine') => json<List>(await call(cookie, 'GET', `/api/todos?who=${who}`));

async function set(cookie: string, body: Record<string, unknown>): Promise<string> {
  const res = await call(cookie, 'POST', '/api/todos', { dueOn: today(), ...body });
  expect(res.statusCode, res.body).toBe(201);
  return json<{ id: string }>(res).id;
}

async function rentalFixture(status: 'active' | 'returned' = 'active') {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Todo ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTT${digits().slice(-12).padStart(12, '0')}`, modelId: model.id, pool: 'rent' } });
  const customer = await prisma.customer.create({ data: { name: `ТЕСТ Задача ${uniq()}` } });
  const rental = await prisma.rental.create({ data: { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 15000, status, pickedUpOn: date(addDays(today(), -10)) } });
  return { prisma, vehicle, customer, rental };
}

describe('the records that end a task, without a database', () => {
  it('reads the end of a record as the shared rule does: a rental returned, a moped sold, written off or off the list', async () => {
    const { ENDED_RECORD } = await import('../src/lib/todos.js');
    expect(ENDED_RECORD).toEqual({ OR: [{ rental: { status: TODO_ENDED_RENTAL[0] } }, { vehicle: { OR: [{ state: { in: [...TODO_ENDED_VEHICLE] } }, { archived: true }] } }] });
    expect(TODO_ENDED_RENTAL).toEqual(['returned']);
  });
});

describe.skipIf(!HAS_DB)('«Задачи» (issue #18 A, ADR-0050)', () => {
  it('lets an owner set a task to a manager, who reads and closes it; the owner reads it under the manager’s name', async () => {
    const owner = await person('owner');
    const manager = await person('manager');
    const id = await set(owner.cookie, { text: 'Подать декларацию (пример)', assigneeId: manager.id, note: 'Скрин подтверждения (пример)' });

    const his = await list(manager.cookie);
    const mine = his.todos.find((t) => t.id === id);
    expect(mine).toMatchObject({ text: 'Подать декларацию (пример)', assignee: { id: manager.id }, setBy: { id: owner.id }, may: { close: true, edit: false, reopen: false } });
    expect((await list(owner.cookie)).todos.map((t) => t.id)).not.toContain(id);
    expect((await list(owner.cookie, manager.id)).todos.find((t) => t.id === id)?.may).toEqual({ close: false, edit: true, reopen: false });
    const all = await list(owner.cookie, 'all');
    expect(all.todos.map((t) => t.id)).toContain(id);
    // The chips: the owner himself first, then whoever has tasks open.
    expect(all.people?.[0]?.id).toBe(owner.id);
    expect(all.people?.find((p) => p.id === manager.id)?.open).toBe(1);

    // A manager reads his own and nobody else's; neither does the other's part.
    const others = await call(manager.cookie, 'GET', '/api/todos?who=all');
    expect(others.statusCode).toBe(403);
    expect(json<{ error: string }>(others).error).toBe('todos_not_yours');
    expect(json<{ error: string }>(await call(manager.cookie, 'PATCH', `/api/todos/${id}`, { text: 'Иначе' })).error).toBe('todo_not_yours');
    expect(json<{ error: string }>(await call(owner.cookie, 'POST', `/api/todos/${id}/close`, {})).error).toBe('todo_not_yours');

    const closed = await call(manager.cookie, 'POST', `/api/todos/${id}/close`, { note: 'Подано (пример)' });
    expect(closed.statusCode, closed.body).toBe(200);
    expect(json<{ error: string }>(await call(manager.cookie, 'POST', `/api/todos/${id}/close`, {})).error).toBe('todo_closed');
    const seen = (await list(owner.cookie, manager.id)).done.find((t) => t.id === id);
    expect(seen).toMatchObject({ closedBy: { id: manager.id }, closeNote: 'Подано (пример)', closedByRecord: false, may: { reopen: true } });
    expect(seen?.closedAt).toBeTruthy();

    // «Отменить»: open again, by whose it is.
    expect((await call(manager.cookie, 'POST', `/api/todos/${id}/reopen`)).statusCode).toBe(200);
    expect((await list(manager.cookie)).todos.find((t) => t.id === id)?.closedAt).toBeNull();
  });

  it('gives a task to oneself only, unless an owner gives it to a manager or the chief mechanic', async () => {
    const owner = await person('owner');
    const other = await person('owner');
    const manager = await person('manager');
    const mechanic = await person('mechanic');
    const chief = await person('chief_mechanic');
    const refused = async (cookie: string, assigneeId: string) => {
      const res = await call(cookie, 'POST', '/api/todos', { text: 'Пример', dueOn: today(), assigneeId });
      expect(res.statusCode, res.body).toBe(403);
      expect(json<{ error: string; field: string }>(res)).toMatchObject({ error: 'todo_assignee_refused', field: 'assigneeId' });
    };
    await refused(manager.cookie, owner.id);
    await refused(manager.cookie, chief.id);
    await refused(chief.cookie, manager.id);
    await refused(owner.cookie, mechanic.id);
    await refused(owner.cookie, other.id);
    await set(owner.cookie, { text: 'Обход парковки (пример)', assigneeId: chief.id });
    await set(owner.cookie, { text: 'Сверить кассу (пример)' });
    await set(chief.cookie, { text: 'Заказать колодки (пример)' });
    await set(mechanic.cookie, { text: 'Убрать в мастерской (пример)' });
    expect((await list(mechanic.cookie)).todos).toHaveLength(1);

    // The form's list: himself, and for an owner the managers and chief mechanics.
    const forOwner = json<{ mayLink: boolean; assignees: { id: string; self: boolean; role: string; linkKinds: string[] }[] }>(await call(owner.cookie, 'GET', '/api/todos/assignees'));
    expect(forOwner.mayLink).toBe(true);
    expect(forOwner.assignees[0]).toMatchObject({ id: owner.id, self: true });
    expect(forOwner.assignees.find((a) => a.id === chief.id)?.linkKinds).toEqual(['vehicle']);
    expect(forOwner.assignees.map((a) => a.id)).not.toContain(mechanic.id);
    expect(forOwner.assignees.map((a) => a.id)).not.toContain(other.id);
    const forChief = json<{ mayLink: boolean; assignees: { id: string }[] }>(await call(chief.cookie, 'GET', '/api/todos/assignees'));
    expect(forChief).toMatchObject({ mayLink: false, assignees: [{ id: chief.id }] });
  });

  it('sends a mechanic a moped and never a customer, and links only for whoever reads the fleet', async () => {
    const owner = await person('owner');
    const manager = await person('manager');
    const chief = await person('chief_mechanic');
    const { vehicle, customer, rental } = await rentalFixture();
    for (const link of [{ kind: 'rental', id: rental.id }, { kind: 'customer', id: customer.id }]) {
      const res = await call(owner.cookie, 'POST', '/api/todos', { text: 'Пример', dueOn: today(), assigneeId: chief.id, link });
      expect(json<{ error: string }>(res).error, link.kind).toBe('todo_link_refused');
    }
    const id = await set(owner.cookie, { text: 'Посмотреть тормоза (пример)', assigneeId: chief.id, link: { kind: 'vehicle', id: vehicle.id } });
    const his = (await list(chief.cookie)).todos.find((t) => t.id === id);
    // He reads the moped's number and model, and opens no card: he reads no fleet.
    expect(his?.link).toMatchObject({ kind: 'vehicle', id: vehicle.id, sub: expect.stringMatching(/^Test Todo /), open: false });
    const self = await call(chief.cookie, 'POST', '/api/todos', { text: 'Пример', dueOn: today(), link: { kind: 'vehicle', id: vehicle.id } });
    expect(json<{ error: string }>(self).error).toBe('todo_link_refused');

    const r = await set(owner.cookie, { text: 'Позвонить по договору (пример)', assigneeId: manager.id, link: { kind: 'rental', id: rental.id } });
    expect((await list(manager.cookie)).todos.find((t) => t.id === r)?.link).toMatchObject({ kind: 'rental', label: rental.number, open: true });
    // Given to the chief mechanic afterwards, the rental would go with it: refused.
    const moved = await call(owner.cookie, 'PATCH', `/api/todos/${r}`, { assigneeId: chief.id });
    expect(json<{ error: string }>(moved).error).toBe('todo_link_refused');
  });

  it('does not close a task that asks for a photo or a file without one, and shows the file only to the task’s people', async () => {
    const owner = await person('owner');
    const manager = await person('manager');
    const stranger = await person('manager');
    const id = await set(owner.cookie, { text: 'Сфотографировать парковку (пример)', assigneeId: manager.id, needsFile: true });
    const early = await call(manager.cookie, 'POST', `/api/todos/${id}/close`, {});
    expect(early.statusCode).toBe(409);
    expect(json<{ error: string }>(early).error).toBe('todo_needs_file');
    // Only whose it is adds the file.
    expect((await call(owner.cookie, 'POST', `/api/todos/${id}/files`, { mimeType: 'image/png', label: 'p.png', dataBase64: PNG })).statusCode).toBe(403);
    const up = await call(manager.cookie, 'POST', `/api/todos/${id}/files`, { mimeType: 'image/png', label: 'parking.png', dataBase64: PNG });
    expect(up.statusCode, up.body).toBe(201);
    const fileId = json<{ id: string }>(up).id;
    expect((await call(manager.cookie, 'GET', `/api/files/${fileId}`)).statusCode).toBe(200);
    expect((await call(owner.cookie, 'GET', `/api/files/${fileId}`)).statusCode).toBe(200);
    expect((await call(stranger.cookie, 'GET', `/api/files/${fileId}`)).statusCode).toBe(403);
    expect((await call(manager.cookie, 'POST', `/api/todos/${id}/close`, {})).statusCode).toBe(200);
    expect((await list(owner.cookie, manager.id)).done.find((t) => t.id === id)?.files.map((f) => f.id)).toEqual([fileId]);
  });

  it('makes every late occurrence of a repeat and today’s, once however often it is read, and counts them for the menu', async () => {
    const owner = await person('owner');
    const { prisma } = await import('../src/lib/db.js');
    const id = await set(owner.cookie, { text: 'Обход парковки по неделям (пример)', repeat: 'weekly' });
    // Two weeks ago, as if made then.
    const back = addDays(today(), -14);
    const row = await prisma.todo.findUniqueOrThrow({ where: { id }, select: { seriesId: true } });
    await prisma.todo.update({ where: { id }, data: { dueOn: date(back), seriesOn: date(back) } });
    await prisma.todoSeries.update({ where: { id: row.seriesId! }, data: { lastOn: date(back) } });

    await list(owner.cookie);
    const mine = (await list(owner.cookie)).todos.filter((t) => t.text === 'Обход парковки по неделям (пример)');
    expect(mine.map((t) => t.dueOn)).toEqual([back, addDays(today(), -7), today()]);
    expect(mine.every((t) => t.repeat === 'weekly')).toBe(true);
    const counts = json<{ todos: { late: number; today: number } }>(await call(owner.cookie, 'GET', '/api/nav/counts')).todos;
    expect(counts).toEqual({ late: 2, today: 1 });

    // «Повтор: нет» on today's: the repeat stops, the tasks made stay.
    const todays = mine.find((t) => t.dueOn === today())!;
    expect((await call(owner.cookie, 'PATCH', `/api/todos/${todays.id}`, { repeat: 'none' })).statusCode).toBe(200);
    const after = (await list(owner.cookie)).todos.filter((t) => t.text === 'Обход парковки по неделям (пример)');
    expect(after).toHaveLength(3);
    expect(after.every((t) => t.repeat === 'none')).toBe(true);
  });

  it('takes back a task without deleting it, and with «не повторять» the ones its repeat made ahead', async () => {
    const owner = await person('owner');
    const manager = await person('manager');
    const { prisma } = await import('../src/lib/db.js');
    const id = await set(owner.cookie, { text: 'Каждую неделю (пример)', assigneeId: manager.id, repeat: 'weekly' });
    // The occurrence a week on, as the next day's reading would make it.
    const t = await prisma.todo.findUniqueOrThrow({ where: { id } });
    const next = addDays(today(), 7);
    const ahead = await prisma.todo.create({
      data: { text: t.text, dueOn: date(next), assigneeId: t.assigneeId, createdById: t.createdById, seriesId: t.seriesId, seriesOn: date(next) },
    });
    await prisma.todoSeries.update({ where: { id: t.seriesId! }, data: { lastOn: date(next) } });

    expect(json<{ error: string }>(await call(manager.cookie, 'DELETE', `/api/todos/${id}?stop=1`)).error).toBe('todo_not_yours');
    expect((await call(owner.cookie, 'DELETE', `/api/todos/${id}?stop=1`)).statusCode).toBe(200);
    const left = (await list(manager.cookie)).todos.map((x) => x.id);
    expect(left).not.toContain(id);
    expect(left).not.toContain(ahead.id);
    const kept = await prisma.todo.findUniqueOrThrow({ where: { id }, select: { deletedAt: true, deletedById: true } });
    expect(kept.deletedById).toBe(owner.id);
    expect((await prisma.todoSeries.findUniqueOrThrow({ where: { id: t.seriesId! } })).stoppedById).toBe(owner.id);
  });

  it('starts a repeat of another kind anew from the task changed: the old one stops and takes back what it made ahead', async () => {
    const owner = await person('owner');
    const { prisma } = await import('../src/lib/db.js');
    const text = `Сверка по неделям (пример) ${uniq()}`;
    const id = await set(owner.cookie, { text, repeat: 'weekly' });
    // A week ago, as if made then: reading makes today's from it.
    const back = addDays(today(), -7);
    const old = (await prisma.todo.findUniqueOrThrow({ where: { id }, select: { seriesId: true } })).seriesId!;
    await prisma.todo.update({ where: { id }, data: { dueOn: date(back), seriesOn: date(back) } });
    await prisma.todoSeries.update({ where: { id: old }, data: { lastOn: date(back) } });
    const made = (await list(owner.cookie)).todos.filter((t) => t.text === text);
    expect(made.map((t) => t.dueOn)).toEqual([back, today()]);

    // The late one becomes monthly: today's, of the weekly rule, is taken back,
    // and the next comes a month after the late one's day — once.
    expect((await call(owner.cookie, 'PATCH', `/api/todos/${id}`, { repeat: 'monthly' })).statusCode).toBe(200);
    await list(owner.cookie);
    const now = (await list(owner.cookie)).todos.filter((t) => t.text === text);
    const day = Number(back.slice(8, 10));
    const next = nextTodoDue('monthly', day, back);
    expect(now.map((t) => t.dueOn)).toEqual([back, next]);
    expect(now.every((t) => t.repeat === 'monthly' && t.repeatDay === day)).toBe(true);
    const todays = made.find((t) => t.dueOn === today())!;
    expect((await prisma.todo.findUniqueOrThrow({ where: { id: todays.id } })).deletedById).toBe(owner.id);
    expect((await prisma.todoSeries.findUniqueOrThrow({ where: { id: old } })).stoppedAt).not.toBeNull();
    const changed = await prisma.todo.findUniqueOrThrow({ where: { id }, include: { series: true } });
    expect(changed.seriesId).not.toBe(old);
    expect(changed.series).toMatchObject({ repeat: 'monthly', repeatDay: day, lastOn: date(next), stoppedAt: null });
  });

  it('writes in the journal which record a task moved to, not only its kind', async () => {
    const owner = await person('owner');
    const { prisma, vehicle } = await rentalFixture();
    const other = await prisma.vehicle.create({ data: { vin: `TESTT${digits().slice(-12).padStart(12, '0')}`, modelId: vehicle.modelId, pool: 'rent' } });
    const id = await set(owner.cookie, { text: 'Проверить фару (пример)', link: { kind: 'vehicle', id: vehicle.id } });
    expect((await call(owner.cookie, 'PATCH', `/api/todos/${id}`, { link: { kind: 'vehicle', id: other.id } })).statusCode).toBe(200);
    const line = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: 'todo.update' } });
    expect(line.before).toEqual({ link: { kind: 'vehicle', label: fleetNumber(vehicle.fleetNo) } });
    expect(line.after).toEqual({ link: { kind: 'vehicle', label: fleetNumber(other.fleetNo) } });
  });

  it('closes a task about a rental when the rental is returned, keeps it closed, and takes no task about an ended record', async () => {
    const owner = await person('owner');
    const manager = await person('manager');
    const { prisma, rental } = await rentalFixture();
    const id = await set(owner.cookie, { text: 'Забрать второй ключ (пример)', assigneeId: manager.id, link: { kind: 'rental', id: rental.id } });
    await prisma.rental.update({ where: { id: rental.id }, data: { status: 'returned', returnedOn: date(today()) } });

    const his = await list(manager.cookie);
    expect(his.todos.map((t) => t.id)).not.toContain(id);
    expect(his.done.find((t) => t.id === id)).toMatchObject({ closedByRecord: true, closedBy: null });
    const again = await call(manager.cookie, 'POST', `/api/todos/${id}/reopen`);
    expect(json<{ error: string }>(again).error).toBe('todo_record_ended');
    const late = await call(owner.cookie, 'POST', '/api/todos', { text: 'Пример', dueOn: today(), assigneeId: manager.id, link: { kind: 'rental', id: rental.id } });
    expect(json<{ error: string }>(late).error).toBe('todo_link_ended');
  });

  it('refuses a task without words or with a day gone, naming the field', async () => {
    const owner = await person('owner');
    const empty = await call(owner.cookie, 'POST', '/api/todos', { text: '  ', dueOn: today() });
    expect(json<{ error: string; field: string }>(empty)).toMatchObject({ error: 'todo_text_missing', field: 'text' });
    const past = await call(owner.cookie, 'POST', '/api/todos', { text: 'Пример', dueOn: addDays(today(), -1) });
    expect(json<{ error: string; field: string }>(past)).toMatchObject({ error: 'todo_due_past', field: 'dueOn' });
    const repeat = await call(owner.cookie, 'POST', '/api/todos', { text: 'Пример', dueOn: today(), repeat: 'daily' });
    expect(json<{ field: string }>(repeat).field).toBe('repeat');
  });

  it('gives a mechanic his own day — his repairs and his payout, the maintenance to whoever sees every repair — and no manager reads it', async () => {
    const mechanic = await person('mechanic');
    const chief = await person('chief_mechanic');
    const manager = await person('manager');
    type Day = { repairs: { waiting: number; open: number }; toApprove: number | null; maintenance: { due: number; late: number } | null; payoutTetri: number };
    const his = json<Day>(await call(mechanic.cookie, 'GET', '/api/today/workshop'));
    expect(his).toMatchObject({ repairs: { waiting: 0, open: 0 }, toApprove: null, maintenance: null, payoutTetri: 0 });
    const chiefs = json<Day>(await call(chief.cookie, 'GET', '/api/today/workshop'));
    expect(typeof chiefs.toApprove).toBe('number');
    expect(chiefs.maintenance).not.toBeNull();
    expect((await call(manager.cookie, 'GET', '/api/today/workshop')).statusCode).toBe(403);
    // His menu counts his tasks, and nothing of the front office.
    const counts = json<{ todos: unknown; schedule: unknown; sort: unknown; till: unknown; migration: unknown }>(await call(mechanic.cookie, 'GET', '/api/nav/counts'));
    expect(counts).toMatchObject({ todos: { late: 0, today: 0 }, schedule: null, sort: null, till: null, migration: null });
  });
});
