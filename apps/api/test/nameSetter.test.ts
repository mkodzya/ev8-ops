// One form of a name on every card, from a list (lib/nameSetter.ts), and the
// transcript a card gets by itself. Needs a *_test database. The repository is
// public: every name here is invented.
import { describe, expect, it } from 'vitest';
import { formatNamesReport, namesExitCode, setNames, type NamesReport } from '../src/lib/nameSetter.js';
import { HAS_DB, call, json, loginAs, makeUser, uniq } from './helpers.js';

const digits = () => uniq().replace(/\D/g, '');

/** A card that names a Kommo deal, spelt the way the cards came: whatever somebody typed. */
async function card(data: { name: string; nameKa?: string | null; nameLat?: string | null }) {
  const { prisma } = await import('../src/lib/db.js');
  const lead = `7${digits().slice(-9)}`;
  const c = await prisma.customer.create({ data: { ...data, kommoRef: `https://ev8mopeds.kommo.com/leads/detail/${lead}` } });
  return { id: c.id, lead };
}

/** The list is written in the name of one owner: with several on a stand it has to be named. */
async function owner(): Promise<string> {
  const u = await makeUser('owner');
  return u.email;
}

const run = (rows: unknown, ownerEmail: string, commit = false): Promise<NamesReport> => setNames({ text: JSON.stringify(rows), ownerEmail, commit });

describe.skipIf(!HAS_DB)('one form of a name on every card, from a list', () => {
  it('checks without writing, then writes all together: Latin first name first, Georgian beside it, and the journal says so', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const who = await owner();
    // Family name first, Latin only — as most cards came.
    const a = await card({ name: 'Tushidze Nino' });
    // Georgian in the main field and in its own, family name first.
    const b = await card({ name: 'ჯაფარაძე ჟუჟუნა', nameKa: 'ჯაფარაძე ჟუჟუნა' });
    // Typed with a q where the transcript has a k; the Georgian is on the card already and the row gives none.
    const c = await card({ name: 'Qeti Tsereteli', nameKa: 'ქეთი წერეთელი' });
    const rows = [
      { label: '№1', rental: 'R-00001', kommoLead: a.lead, nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidze', kaSource: 'a document', check: null },
      { label: '№2', kommoLead: b.lead, nameKa: 'ჟუჟუნა ჯაფარაძე', nameLat: 'Zhuzhuna Japaradze' },
      { label: '№3', kommoLead: c.lead, nameKa: null, nameLat: 'Keti Tsereteli' },
    ];

    const checked = await run(rows, who);
    expect(checked.rows.map((r) => r.verdict)).toEqual(['ready', 'ready', 'ready']);
    expect([checked.written, namesExitCode(checked)]).toEqual([0, 0]);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ name: 'Tushidze Nino', nameKa: null, nameLat: null });
    const said = formatNamesReport(checked);
    expect(said).toContain('проверка, без записи');
    expect(said).toContain('№1  R-00001  станет: Nino Tushidze · ნინო თუშიძე   (сейчас: Tushidze Nino)');
    expect(said).toContain('к записи готово: 3');

    const written = await run(rows, who, true);
    expect(written.rows.map((r) => r.verdict)).toEqual(['written', 'written', 'written']);
    expect([written.written, namesExitCode(written)]).toEqual([3, 0]);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ name: 'Nino Tushidze', nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidze' });
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ name: 'Zhuzhuna Japaradze', nameKa: 'ჟუჟუნა ჯაფარაძე', nameLat: 'Zhuzhuna Japaradze' });
    // No Georgian in the row: the card's own stays.
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ name: 'Keti Tsereteli', nameKa: 'ქეთი წერეთელი', nameLat: 'Keti Tsereteli' });

    const log = await prisma.auditLog.findMany({ where: { entityId: a.id, action: 'customer.update' } });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ before: { name: 'Tushidze Nino', nameKa: null, nameLat: null }, after: { name: 'Nino Tushidze', nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidze' } });
    expect(log[0]!.actorId).toBeTruthy();

    // The same list again changes nothing and writes nothing into the journal.
    const again = await run(rows, who, true);
    expect(again.rows.map((r) => r.verdict)).toEqual(['same', 'same', 'same']);
    expect(formatNamesReport(again)).toContain('Все карточки из списка уже в этом виде. Ничего не записано.');
    expect(await prisma.auditLog.count({ where: { entityId: a.id, action: 'customer.update' } })).toBe(1);
  });

  it('one problem anywhere and nothing is written', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const who = await owner();
    const good = await card({ name: 'Tushidze Nino' });
    const twin = await card({ name: 'Kharadze Chabuka' });
    await prisma.customer.create({ data: { name: 'Kharadze Chabuka the second', kommoRef: `#${twin.lead}` } });
    const report = await run(
      [
        { label: 'good', kommoLead: good.lead, nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidze' },
        { label: 'no card', kommoLead: `9${digits().slice(-9)}`, nameKa: null, nameLat: 'Nobody Here' },
        { label: 'two cards', kommoLead: twin.lead, nameKa: null, nameLat: 'Chabuka Kharadze' },
        { label: 'cyrillic', kommoLead: good.lead, nameKa: null, nameLat: 'Нино Тушидзе' },
        { label: 'latin in georgian', kommoLead: `8${digits().slice(-9)}`, nameKa: 'Nino', nameLat: 'Nino Tushidze' },
        { label: 'one word', kommoLead: `8${digits().slice(-9)}`, nameKa: null, nameLat: 'Nino' },
        { label: 'typo', kommoLead: `8${digits().slice(-9)}`, nameKa: null, nameLat: 'Nino Tushidze', nameLatin: 'x' },
      ],
      who,
      true,
    );
    const why = Object.fromEntries(report.rows.map((r) => [r.label, r.problems.join(' | ')]));
    expect(why['no card']).toContain('карточки клиента со сделкой Kommo');
    expect(why['two cards']).toContain('больше одной карточки');
    expect(why['cyrillic']).toContain('только латинские буквы');
    expect(why['latin in georgian']).toContain('только грузинские буквы');
    expect(why['one word']).toContain('имя и фамилия');
    expect(why['typo']).toContain('незнакомые поля: nameLatin');
    // The good row's deal stands in the list twice.
    expect(why['good']).toContain('больше одного раза');
    expect([report.written, namesExitCode(report)]).toEqual([0, 1]);
    expect(formatNamesReport(report)).toContain('Ничего не записано: пока в списке есть хоть одна проблема');
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: good.id } })).toMatchObject({ name: 'Tushidze Nino', nameKa: null, nameLat: null });
  });

  it('a name the two alphabets do not spell alike is written, with a line asking a person to look', async () => {
    const who = await owner();
    // A foreign name: a bank's Georgian rendering does not read back letter for letter.
    const foreign = await card({ name: 'Yusuf Ahmed' });
    const none = await card({ name: 'Omar Haddad' });
    const report = await run(
      [
        { label: 'f', kommoLead: foreign.lead, nameKa: 'აჰმედ იუსუფ', nameLat: 'Ahmed Yusuf' },
        { label: 'n', kommoLead: none.lead, nameKa: null, nameLat: 'Omar Haddad' },
      ],
      who,
    );
    expect(report.rows.map((r) => r.verdict)).toEqual(['ready', 'ready']);
    expect(report.rows[0]!.notes.join(' ')).toContain('не сводятся одно к другому');
    expect(report.rows[1]!.notes.join(' ')).toContain('грузинского написания нет');
    expect(report.rows[1]!.becomes).toEqual({ name: 'Omar Haddad', nameKa: null, nameLat: 'Omar Haddad' });
  });

  it('does not start without a list, with a broken one, or in the name of somebody who is not an owner', async () => {
    const who = await owner();
    const manager = await makeUser('manager');
    for (const [text, ownerEmail, says] of [
      ['', who, 'Список пуст'],
      ['{', who, 'это не JSON'],
      ['{}', who, 'в квадратных скобках'],
      ['[]', who, 'нет ни одной записи'],
      ['[{}]', manager.email, 'Имена в карточках списком меняет только владелец'],
      ['[{}]', `nobody.${uniq()}@test.ev8`, 'на стенде нет'],
    ] as const) {
      const report = await setNames({ text, ownerEmail, commit: true });
      expect(report.refused).toContain(says);
      expect(namesExitCode(report)).toBe(2);
    }
  });
});

describe.skipIf(!HAS_DB)('a card gets the spelling it lacks by itself (Mika, 13.10.2026)', () => {
  it('a new card typed in Georgian has its Georgian field and its Latin transcript; a typed transcript is kept', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const made = json<{ id: string }>(await call(owner, 'POST', '/api/customers', { name: `ნინო თუშიძე`, phone: `+9955${digits().slice(-8)}` }));
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: made.id } })).toMatchObject({ name: 'ნინო თუშიძე', nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidze' });

    const typed = json<{ id: string }>(await call(owner, 'POST', '/api/customers', { name: 'Tushidse Nino', nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidse', phone: `+9955${digits().slice(-8)}` }));
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: typed.id } })).toMatchObject({ nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidse' });

    // Latin only: no Georgian is made up, and the Latin field is not a copy of the name.
    const latin = json<{ id: string }>(await call(owner, 'POST', '/api/customers', { name: 'Omar Haddad', phone: `+9955${digits().slice(-8)}` }));
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: latin.id } })).toMatchObject({ nameKa: null, nameLat: null });
  });

  it('adding the Georgian name to a card fills the Latin one; changing the phone alone touches no name', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const owner = await loginAs('owner');
    const c = await prisma.customer.create({ data: { name: 'Tushidze Nino' } });
    expect((await call(owner, 'PATCH', `/api/customers/${c.id}`, { phone: `+9955${digits().slice(-8)}` })).statusCode).toBe(200);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ nameKa: null, nameLat: null });

    expect((await call(owner, 'PATCH', `/api/customers/${c.id}`, { nameKa: 'ნინო თუშიძე' })).statusCode).toBe(200);
    expect(await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ name: 'Tushidze Nino', nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidze' });

    // The form sends all three fields: an emptied Latin one comes back as the transcript, a typed one stays.
    expect((await call(owner, 'PATCH', `/api/customers/${c.id}`, { name: 'Nino Tushidze', nameKa: 'ნინო თუშიძე', nameLat: null })).statusCode).toBe(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).nameLat).toBe('Nino Tushidze');
    expect((await call(owner, 'PATCH', `/api/customers/${c.id}`, { nameLat: 'Nino Tushidse' })).statusCode).toBe(200);
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).nameLat).toBe('Nino Tushidse');
  });
});
