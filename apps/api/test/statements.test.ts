// Loading a statement and letting it settle what it can (PAY-01, PAY-02, PAY-03).
//
// The CSV fragments below are the real shapes of the two exports this
// company gets — the column layout, the date formats, the transliterated
// payer inside a Bank of Georgia line, the way a card payment states its
// commission — with the people and the amounts made up for the test.
import { describe, expect, it } from 'vitest';
import { acquiringGross } from '@ev8/shared';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const BOG_HEADER = [
  ',,,"angariSis mflobeli: Sps e-mouSen moTors",,,,',
  ',,,"angariSis #:GE00BG0000000000000954GEL (000000001)",,,,',
  ',,,,,,,',
  '"centraluri filiali",,,"naerTi amonaweri piradi angariSidan",,,,',
  '"gagarinis q. #29 a",,,"periodi: 01.09.26-30.09.26",,,,',
  '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
  '"01.09.2024","sawyisi naSTi","","GEL","0","1","0",""',
].join('\n');

const bogRow = (date: string, credit: string, content: string, doc = '0017') =>
  `"${date}","${doc}","GE00TB0000000000000952","","${credit}","1","${credit}","${content}"`;

const BOG_SUMMARY = ['"brunva","","","0","320","1","",""', '"naSTi","","","","320.00","1","320.00",""'].join('\n');

const TBC_HEADER = [
  '"თარიღი","დანიშნულება","ტრანზაქციის ტიპი","თანხა","ვალუტა","ანგარიშის ნომერი","ანგარიშის დასახელება","დამატებითი ინფორმაცია","საბუთის თარიღი","საბუთის №","პარტნიორის ანგარიში","პარტნიორი","პარტნიორის საგადასახადო კოდი","პარტნიორის ბანკის კოდი","პარტნიორის ბანკი","შუამავალი ბანკის კოდი","შუამავალი ბანკი","ხარჯის ტიპი","გადასახადის გადამხდელის კოდი","გადასახადის გადამხდელის დასახელება","სახაზინო კოდი","ოპ.კოდი","დამატებითი დანიშნულება","ტრანზაქციის ID"',
  '"Date","Description","Transaction Type","Amount","Currency","Account Number","Account Name","Additional Information","Document Date","Document Number","Partner\'s Account","Partner\'s Name","Partner\'s Tax Code","Partner\'s Bank Code","Partner\'s Bank","Intermediary Bank Code","Intermediary Bank","Charge Details","Taxpayer Code","Taxpayer Name","Treasury Code","Op.Code","Additional Description","Transaction ID"',
].join('\n');

const tbcRow = (date: string, amount: string, partner: string, txn: string, desc = 'Rent') =>
  `"${date}","${desc}","Income","${amount}","GEL","GE00TB0000000000000953","ე-მოუშენ მოთორს","","${date}","589041","GE00BG0000000000000951","${partner}","","BAGAGE22","სს ბანკი","","","","","","","BULK","","${txn}"`;

/**
 * A Georgian surname nobody else in the database has.
 *
 * The payer rule matches a name against every open rental, so two customers
 * with the same name make the rule refuse — correctly. A suite must not
 * depend on being the only one who ever used a name, so each one gets a tag
 * that goes into both the customer and the bank line.
 */
function tagged(base: { ru: string; ka: string }): { ru: string; ka: string; tag: string } {
  const tag = `t${uniq().replace(/\D/g, '').slice(-9)}`;
  return { ru: `${base.ru} ${tag}`, ka: `${base.ka} ${tag}`, tag };
}

async function rentalFor(name: { ru: string; ka: string }, opts: { rate?: number; pickedUpOn?: string } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTS${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: name.ru, nameKa: name.ka } });
  const owner = await loginAs('owner');
  const { id } = json<{ id: string }>(
    await call(owner, 'POST', '/api/rentals', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      weeklyRateTetri: opts.rate ?? 14000,
      pickedUpOn: opts.pickedUpOn ?? '2026-09-01',
    }),
  );
  return { prisma, owner, customer, rentalId: id };
}

describe.skipIf(!HAS_DB)('reading a Bank of Georgia export', () => {
  it('skips the preamble and the balance rows, and finds the payer inside the text', async () => {
    const who = tagged({ ru: 'Важа Тестовый', ka: 'ვაჟა ტესტიძე' });
    const { owner, rentalId } = await rentalFor(who);
    const text = [
      BOG_HEADER,
      bogRow(
        '05.09.2026',
        '320.0',
        `Private Transfer: Caricxva - Tanxa: GEL320.00; gadmomricxavi: testiZe vaJa ${who.tag}; angariSi: GE00BG0000000000000951GEL; daniSnuleba: qira`,
      ),
      BOG_SUMMARY,
    ].join('\n');

    const res = await call(owner, 'POST', '/api/statements', { fileName: 'StatementExport.csv', text });
    expect(res.statusCode, res.body).toBe(201);
    const result = json<{ bank: string; lineCount: number; newLines: number; matched: number }>(res);
    expect(result.bank).toBe('bog');
    expect(result.lineCount).toBe(1); // the opening balance and the summaries are not transactions
    expect(result.matched).toBe(1);

    const card = json<{ rental: { paidThrough: string | null }; deposit: { paidTetri: number } }>(
      await call(owner, 'GET', `/api/rentals/${rentalId}`),
    );
    expect(card.deposit.paidTetri).toBe(18000);
    expect(card.rental.paidThrough).toBe('2026-09-07');
  });

  it('reads a card line for what the customer paid, not what the bank credited (PAY-04)', async () => {
    const who = tagged({ ru: 'Нино Картовна', ka: 'ნინო ბარათიძე' });
    const { owner, rentalId } = await rentalFor(who, { rate: 14000, pickedUpOn: '2026-09-03' });
    const text = [
      BOG_HEADER,
      bogRow(
        '03.09.2026',
        '315.20',
        `Caricxva - Tanxa GEL315.20; gadmomricxavi: baraTiZe nino ${who.tag}; gadaxda - TariRi: 03/09/2026 18:21:14; Tanxa:GEL 320; sakomisio: GEL 4.80; terminalis ID: POS30LTG`,
      ),
    ].join('\n');
    const res = await call(owner, 'POST', '/api/statements', { fileName: 'StatementExport.csv', text });
    expect(res.statusCode, res.body).toBe(201);
    expect(json<{ matched: number }>(res).matched).toBe(1);

    const { prisma } = await import('../src/lib/db.js');
    const p = await prisma.payment.findFirstOrThrow({ where: { rentalId } });
    expect(p.channel).toBe('acquiring');
    expect(p.grossTetri).toBe(32000); // what the customer paid closes the debt
    expect(p.feeTetri).toBe(480); // the acquirer's, a company expense
    expect(p.netTetri).toBe(31520); // what the account received
  });

  it('loading the same file twice adds nothing the second time (PAY-01)', async () => {
    const tag = uniq();
    const who = tagged({ ru: 'Давид Двойной', ka: 'დავით ორმაგიძე' });
    const { owner, prisma } = await rentalFor(who);
    // The week and the deposit, from the renter by name: the rule attaches it the first time.
    const text = [BOG_HEADER, bogRow('06.09.2026', '320.0', `Caricxva: gadmomricxavi: ormagiZe daviT ${who.tag}; daniSnuleba: qira ${tag}`)].join('\n');

    const first = json<{ newLines: number; matched: number }>(await call(owner, 'POST', '/api/statements', { fileName: 'a.csv', text }));
    expect(first.newLines).toBe(1);
    const second = json<{ lineCount: number; newLines: number; matched: number }>(
      await call(owner, 'POST', '/api/statements', { fileName: 'a.csv', text }),
    );
    expect(second.lineCount).toBe(1);
    expect(second.newLines).toBe(0);
    expect(second.matched).toBe(0);
    expect(await prisma.payment.count({ where: { bankText: { contains: tag } } })).toBe(1);
  });

  it('money leaving the account waits under "Списания", never as a customer payment (wave 2 §3.2)', async () => {
    const { owner, rentalId } = await rentalFor({ ru: 'Лука Расходов', ka: 'ლუკა ხარჯიძე' });
    const text = [
      BOG_HEADER,
      `"09.09.2026","0018","GE00BG0000000000000955GEL","95.0","","1","95.0","my auto.ge: gadaricxva - Tanxa: GEL95.00; mimRebi: TNET LLC ${uniq()}"`,
    ].join('\n');
    const res = json<{ outgoing: number; unmatched: number; matched: number }>(await call(owner, 'POST', '/api/statements', { fileName: 'out.csv', text }));
    expect(res.outgoing).toBe(1);
    expect(res.matched).toBe(0);
    const queue = json<{ lines: { id: string; direction: string; raw: string }[] }>(await call(owner, 'GET', '/api/statement-lines?direction=out'));
    const line = queue.lines.find((l) => l.raw.includes('TNET LLC'))!;
    expect(line.direction).toBe('out');
    // A customer's record cannot take it; "company expense" puts it away in one tap.
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId })).statusCode).toBe(409);
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/expense`, {})).statusCode).toBe(200);
  });
});

describe.skipIf(!HAS_DB)('a Bank of Georgia export as the bank words it since autumn 2026', () => {
  // The first statement loaded on production (12.10.2026): the same headers, lines worded in English, and an
  // opening balance that is not nought.
  const NEW_HEADER = [
    ',,,"angariSis mflobeli: Sps e-mouSen moTors",,,,',
    ',,,"angariSis #:GE00BG0000000000000954GEL (000000001)",,,,',
    '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
    '"05.10.2026","sawyisi naSTi","","GEL","352.05","1","352.05",""',
  ].join('\n');
  const incoming = (who: string, sum: string) =>
    `tankhis gadaritskhva: \r\n\t  Incoming Transfer - Amount: GEL${sum}; Sender: ${who}; Account: GE38BG0000000000000001GEL; Bank: JSC Bank of Georgia BAGAGE22; Details: tankhis gadaritskhva`;
  const outgoing = (who: string, sum: string) =>
    `FOUNDER'S EQUITY: \r\n\t  Outgoing Transfer - Amount: GEL${sum}; Beneficiary: ${who}; Account: GE38BG0000000000000002GEL; Bank: JSC Bank of Georgia BAGAGE22; Details: FOUNDER'S EQUITY`;

  it('the opening balance is not money received; the payer and the purpose are read from the English wording', async () => {
    const who = tagged({ ru: 'Гела Новиков', ka: 'გელა ნოვიკაძე' });
    const { prisma, owner, rentalId } = await rentalFor(who);
    const text = [
      NEW_HEADER,
      // The sender as people type Georgian in Latin letters: the card holds the Georgian spelling.
      bogRow('08.10.2026', '320', incoming(`novikadze gela ${who.tag}`, '320.00'), '110000001'),
      `"09.10.2026","0362","GE38BG0000000000000002GEL","350.0","","1","350.0","${outgoing(`SOMEBODY ELSE ${who.tag}`, '350.00')}"`,
      BOG_SUMMARY,
    ].join('\n');
    const res = json<{ lineCount: number; incoming: number; outgoing: number; matched: number }>(await call(owner, 'POST', '/api/statements', { fileName: 'StatementExport.csv', text }));
    expect([res.lineCount, res.incoming, res.outgoing]).toEqual([2, 1, 1]);
    expect(await prisma.statementLine.count({ where: { raw: { contains: 'sawyisi naSTi' }, amountTetri: 35205 } })).toBe(0);

    const lines = await prisma.statementLine.findMany({ where: { raw: { contains: who.tag } }, orderBy: { occurredOn: 'asc' } });
    expect(lines.map((l) => [l.direction, l.payer, l.purpose])).toEqual([
      ['in', `novikadze gela ${who.tag}`, 'tankhis gadaritskhva'],
      ['out', `SOMEBODY ELSE ${who.tag}`, "FOUNDER'S EQUITY"],
    ]);
    // Name and debt agree: the rule attaches it, as it does for the older wording.
    expect(res.matched).toBe(1);
    expect(await prisma.payment.count({ where: { rentalId, source: 'statement' } })).toBe(1);
  });
});

describe.skipIf(!HAS_DB)('reading a TBC export', () => {
  it('matches a payer written in Georgian and keeps the bank’s own transaction id', async () => {
    const who = tagged({ ru: 'Георгий Тбисиев', ka: 'გიორგი თბისიძე' });
    const { owner, rentalId } = await rentalFor(who);
    const txn = `1532697${uniq().replace(/\D/g, '').slice(-8)}.20`;
    const text = [TBC_HEADER, tbcRow('04/09/2026', '320.0', `თბისიძე გიორგი ${who.tag}`, txn)].join('\n');

    const res = json<{ bank: string; matched: number }>(await call(owner, 'POST', '/api/statements', { fileName: 'transactions_history.csv', text }));
    expect(res.bank).toBe('tbc');
    expect(res.matched).toBe(1);

    const card = json<{ rental: { paidThrough: string | null } }>(await call(owner, 'GET', `/api/rentals/${rentalId}`));
    expect(card.rental.paidThrough).toBe('2026-09-07');

    // The same transaction id in a second file is the same transaction.
    const again = json<{ newLines: number }>(await call(owner, 'POST', '/api/statements', { fileName: 'overlap.csv', text }));
    expect(again.newLines).toBe(0);
  });
});

describe.skipIf(!HAS_DB)('a TBC terminal settlement is a card payment (12.10.2026)', () => {
  // The first TBC statement on production carried two such lines; both came in
  // as transfers of 197 and 98.50. The wording below is theirs.
  const PARTNER = 'Wallet/domestic/საერთაშორისო ბარათებით თიბისის სავაჭრო ობიექტებში შესრ';
  const desc = (paid: string, tag: string) => `08/10/2026_ის ტრანზაქციის თანხები 281000111 E MOTION MOTORS LLC, TBC BANK, Visa, ${paid}, SH074829,,V ${tag}`;
  const txnId = () => `1599${uniq().replace(/\D/g, '').slice(-10)}.20`;

  it('what was paid by card is read from the line, and the fee is the bank’s', async () => {
    const who = tagged({ ru: 'Нино Терминалова', ka: 'ნინო ტერმინალოვა' });
    const { prisma, owner, rentalId } = await rentalFor(who);
    const text = [TBC_HEADER, tbcRow('08/10/2026', '197.0', PARTNER, txnId(), desc('200.00', who.tag))].join('\n');
    const res = json<{ matched: number; unmatched: number }>(await call(owner, 'POST', '/api/statements', { fileName: 'transactions_history.csv', text }));
    expect([res.matched, res.unmatched]).toEqual([0, 1]);

    const row = await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: who.tag } } });
    expect(row).toMatchObject({ amountTetri: 19700, grossTetri: 20000, feeTetri: 300 });
    const shown = json<{ line: { channel: string; grossTetri: number | null } }>(await call(owner, 'GET', `/api/statement-lines/${row.id}`));
    expect(shown.line).toMatchObject({ channel: 'acquiring', grossTetri: 20000 });

    // Attached by hand, the customer is credited what they paid; the fee is the company's.
    expect((await call(owner, 'POST', `/api/statement-lines/${row.id}/assign`, { rentalId })).statusCode).toBe(200);
    expect(await prisma.payment.findFirstOrThrow({ where: { statementLineId: row.id } })).toMatchObject({ channel: 'acquiring', grossTetri: 20000, feeTetri: 300, netTetri: 19700 });
  });

  it('a line stored before the wording was known is read the same way', async () => {
    const who = tagged({ ru: 'Лия Прежняя', ka: 'ლია ძველაძე' });
    const { prisma, owner, rentalId } = await rentalFor(who);
    // As the parser wrote it until today: a transfer, no gross, no fee.
    await call(owner, 'POST', '/api/statements', { fileName: 't.csv', text: [TBC_HEADER, tbcRow('08/10/2026', '10.0', `სხვა ვინმე ${who.tag}`, txnId())].join('\n') });
    const sibling = await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: who.tag } } });
    const old = await prisma.statementLine.create({
      data: {
        statementId: sibling.statementId,
        bank: 'tbc',
        naturalKey: `txn:${txnId()}`,
        occurredOn: new Date('2026-10-08T00:00:00Z'),
        direction: 'in',
        amountTetri: 9850,
        grossTetri: null,
        feeTetri: null,
        payer: PARTNER,
        purpose: desc('100.00', who.tag).replace('Visa', 'MasterCard'),
        raw: ['08/10/2026', desc('100.00', who.tag).replace('Visa', 'MasterCard'), '98.5', PARTNER, 'x'].join(' | '),
        status: 'unmatched',
      },
    });
    const shown = json<{ line: { channel: string; grossTetri: number | null } }>(await call(owner, 'GET', `/api/statement-lines/${old.id}`));
    expect(shown.line).toMatchObject({ channel: 'acquiring', grossTetri: 10000 });
    expect((await call(owner, 'POST', `/api/statement-lines/${old.id}/assign`, { rentalId })).statusCode).toBe(200);
    expect(await prisma.payment.findFirstOrThrow({ where: { statementLineId: old.id } })).toMatchObject({ channel: 'acquiring', grossTetri: 10000, feeTetri: 150, netTetri: 9850 });
  });

  it('a stated sum that is not the credited sum plus a fee is not believed: the net and 1.5 % decide', async () => {
    const who = tagged({ ru: 'Тея Странная', ka: 'თეა უცნაურიძე' });
    const { prisma, owner } = await rentalFor(who);
    // 985.00 credited is 1 000 paid; the line "states" 20.00 — some other number, not the gross.
    await call(owner, 'POST', '/api/statements', { fileName: 't.csv', text: [TBC_HEADER, tbcRow('08/10/2026', '985.0', PARTNER, txnId(), desc('20.00', who.tag))].join('\n') });
    const row = await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: who.tag } } });
    expect(row).toMatchObject({ amountTetri: 98500, grossTetri: null, feeTetri: null });
    const shown = json<{ line: { channel: string } }>(await call(owner, 'GET', `/api/statement-lines/${row.id}`));
    expect(shown.line.channel).toBe('acquiring');
  });

  it('an ordinary TBC transfer stays a transfer', async () => {
    const who = tagged({ ru: 'Гия Переводов', ka: 'გია გადარიცხვაძე' });
    const { prisma, owner } = await rentalFor(who, { rate: 15000, pickedUpOn: '2026-08-02' });
    await call(owner, 'POST', '/api/statements', { fileName: 't.csv', text: [TBC_HEADER, tbcRow('08/10/2026', '77.0', `ვიღაც სხვა ${who.tag}`, txnId())].join('\n') });
    const row = await prisma.statementLine.findFirstOrThrow({ where: { raw: { contains: who.tag } } });
    expect(row).toMatchObject({ grossTetri: null, feeTetri: null });
    expect(json<{ line: { channel: string } }>(await call(owner, 'GET', `/api/statement-lines/${row.id}`)).line.channel).toBe('transfer');
  });
});

describe.skipIf(!HAS_DB)('the queue of lines nobody could place (PAY-03)', () => {
  it('holds a line with no name and no matching amount, and offers hints', async () => {
    const { owner } = await rentalFor({ ru: 'Тамара Безымянная', ka: 'თამარ უსახელოძე' }, { rate: 15000, pickedUpOn: '2026-08-02' });
    const tag = uniq();
    const text = [BOG_HEADER, bogRow('20.09.2026', '77.77', `Caricxva - Tanxa GEL77.77; Wallet/domestic MC cards ${tag}`)].join('\n');
    const res = json<{ unmatched: number; matched: number }>(await call(owner, 'POST', '/api/statements', { fileName: 'q.csv', text }));
    expect(res.matched).toBe(0);
    expect(res.unmatched).toBe(1);

    const queue = json<{ lines: { id: string; amountTetri: number; raw: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
    const mine = queue.lines.find((l) => l.raw.includes(tag));
    expect(mine).toBeTruthy();
    expect(mine!.amountTetri).toBe(7777);

    // An amount nobody's debt fits and no name: no hint to invent — the search, straight away (§3.2).
    const detail = json<{ line: { id: string }; group: string }>(await call(owner, 'GET', `/api/statement-lines/${mine!.id}`));
    expect(detail.group).toBe('none');
  });

  it('assigning a line to a rental makes the payment and takes it out of the queue', async () => {
    const { owner, rentalId } = await rentalFor({ ru: 'Лаша Неопознанный', ka: 'ლაშა უცნობიძე' }, { rate: 15000 });
    const tag = uniq();
    const text = [BOG_HEADER, bogRow('21.09.2026', '99.99', `Caricxva - Tanxa GEL99.99; Wallet/domestic MC cards ${tag}`)].join('\n');
    await call(owner, 'POST', '/api/statements', { fileName: 'q2.csv', text });
    const queue = json<{ lines: { id: string; raw: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
    const line = queue.lines.find((l) => l.raw.includes(tag))!;

    const assigned = await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId });
    expect(assigned.statusCode, assigned.body).toBe(200);

    const after = json<{ lines: { id: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
    expect(after.lines.find((l) => l.id === line.id)).toBeUndefined();

    const { prisma } = await import('../src/lib/db.js');
    const p = await prisma.payment.findFirstOrThrow({ where: { rentalId, source: 'statement' } });
    // "Wallet/domestic MC cards" is a card (B2-06): 99.99 credited is the net of what the customer paid.
    expect(p.channel).toBe('acquiring');
    expect(p.grossTetri).toBe(acquiringGross(9999));
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId })).statusCode).toBe(409);
  });

  it('a line that is not a customer payment is put aside with a reason', async () => {
    const { owner } = await rentalFor({ ru: 'Отложенный Тест', ka: 'ტესტ გადადებული' });
    const tag = uniq();
    const text = [BOG_HEADER, bogRow('22.09.2026', '5.0', `Caricxva - Tanxa GEL5.00; Business Package S paketis momsaxurebis sakomisio ${tag}`)].join('\n');
    await call(owner, 'POST', '/api/statements', { fileName: 'q3.csv', text });
    const queue = json<{ lines: { id: string; raw: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
    const line = queue.lines.find((l) => l.raw.includes(tag))!;
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/ignore`, {})).statusCode).toBe(400);
    expect((await call(owner, 'POST', `/api/statement-lines/${line.id}/ignore`, { reason: 'bank package fee' })).statusCode).toBe(200);
    const after = json<{ lines: { id: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
    expect(after.lines.find((l) => l.id === line.id)).toBeUndefined();
  });
});

describe.skipIf(!HAS_DB)('who may load a statement', () => {
  it('a manager may not, and an unreadable file is refused with a sentence that says why', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/statements', { fileName: 'x.csv', text: 'anything' })).statusCode).toBe(403);
    const owner = await loginAs('owner');
    const bad = await call(owner, 'POST', '/api/statements', { fileName: 'x.csv', text: 'name,amount\nfoo,1' });
    expect(bad.statusCode).toBe(400);
    expect(json<{ error: string; message: string }>(bad).error).toBe('unreadable_statement');
    expect(json<{ message: string }>(bad).message).toMatch(/Bank of Georgia|TBC/);
  });

  // The company's dollar account at Bank of Georgia (29.10.2026): its export has
  // the columns of the lari one, and its cents would go in as tetri.
  it('a Bank of Georgia statement of an account not in lari is refused in its own words, and nothing of it is kept', async () => {
    const owner = await loginAs('owner');
    for (const currency of ['USD', 'eur']) {
      const tag = uniq();
      const header = BOG_HEADER.replace(/angariSis #:[A-Z0-9]+/, `angariSis #:GE00BG0000000000000001${currency}`); // invented
      const text = [header, bogRow('07.09.2026', '150.00', `tankhis gadaritskhva: Incoming Transfer; Details: TEST ${tag}`), BOG_SUMMARY].join('\n');
      for (const url of ['/api/statements/preview', '/api/statements']) {
        const res = await call(owner, 'POST', url, { fileName: 'StatementExport.csv', text });
        expect(res.statusCode, res.body).toBe(400);
        expect(json<{ error: string }>(res).error).toBe('foreign_statement');
        expect(json<{ message: string }>(res).message).toContain(currency.toUpperCase());
        expect(res.body).not.toContain('GE00BG0000000000000001');
      }
      const { prisma } = await import('../src/lib/db.js');
      expect(await prisma.statementLine.count({ where: { raw: { contains: tag } } })).toBe(0);
    }

    // The account in lari, with its currency written or without it, is read as before.
    for (const account of ['GE00BG0000000000000001GEL', 'GE00BG0000000000000001']) {
      const tag = uniq();
      const header = BOG_HEADER.replace(/angariSis #:[A-Z0-9]+/, `angariSis #:${account}`);
      const text = [header, bogRow('07.09.2026', '150.00', `tankhis gadaritskhva: Incoming Transfer; Details: TEST ${tag}`), BOG_SUMMARY].join('\n');
      const res = await call(owner, 'POST', '/api/statements/preview', { fileName: 'StatementExport.csv', text });
      expect(res.statusCode, res.body).toBe(200);
    }
  });
});

describe.skipIf(!HAS_DB)('one bank line for several records (meeting of 14.10.2026)', () => {
  /** A rental, a customer repair on its moped, and one transfer of `amount` waiting in the queue. */
  async function rentAndRepair(amount: string, raw: string) {
    const who = tagged({ ru: 'Разнос Тестовый', ka: 'გაყოფა ტესტიძე' });
    const { prisma, owner, customer, rentalId } = await rentalFor(who, { rate: 15000, pickedUpOn: '2026-09-01' });
    const { vehicleId } = await prisma.rental.findUniqueOrThrow({ where: { id: rentalId }, select: { vehicleId: true } });
    const job = json<{ id: string }>(await call(owner, 'POST', '/api/service', { vehicleId, reason: 'brake cable', payer: 'customer', labourTetri: '200' }));
    expect((await call(owner, 'POST', `/api/service/${job.id}/close`, {})).statusCode).toBe(200);
    const tag = uniq();
    await call(owner, 'POST', '/api/statements', { fileName: `split-${tag}.csv`, text: [BOG_HEADER, bogRow('06.10.2026', amount, `${raw} ${tag}`)].join('\n') });
    const queue = json<{ lines: { id: string; raw: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
    const line = queue.lines.find((l) => l.raw.includes(tag))!;
    expect(line).toBeTruthy();
    return { prisma, owner, customer, rentalId, jobId: job.id, lineId: line.id };
  }

  it('a transfer pays a rental week and a repair: two payments, the line leaves the queue', async () => {
    const { prisma, owner, rentalId, jobId, lineId } = await rentAndRepair('350.0', 'Caricxva - Tanxa GEL350.00; gadmomricxavi: unknown sender');

    // The parts must make the whole line, one record each, never the same record twice.
    const short = await call(owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ rentalId, grossTetri: 15000 }, { serviceJobId: jobId, grossTetri: 10000 }] });
    expect(short.statusCode).toBe(400);
    expect(json<{ error: string }>(short).error).toBe('split_sum');
    const twice = await call(owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ rentalId, grossTetri: 15000 }, { rentalId, grossTetri: 20000 }] });
    expect(json<{ error: string }>(twice).error).toBe('split_same_target');
    const one = await call(owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ rentalId, grossTetri: 35000 }] });
    expect(json<{ error: string }>(one).error).toBe('split_needs_two');
    const over = await call(owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ rentalId, grossTetri: 10000 }, { serviceJobId: jobId, grossTetri: 25000 }] });
    expect(json<{ error: string }>(over).error).toBe('split_over_repair');

    const res = await call(owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ rentalId, grossTetri: '150' }, { serviceJobId: jobId, grossTetri: '200' }] });
    expect(res.statusCode, res.body).toBe(200);
    const { ids } = json<{ ids: string[] }>(res);
    expect(ids).toHaveLength(2);

    const made = await prisma.payment.findMany({ where: { statementLineId: lineId, voidedAt: null }, orderBy: { statementPart: 'asc' } });
    expect(made.map((p) => [p.statementPart, p.kind, p.grossTetri, p.channel])).toEqual([
      [1, 'rent', 15000, 'transfer'],
      [2, 'service', 20000, 'transfer'],
    ]);
    expect(made[0].rentalId).toBe(rentalId);
    expect(made[1].serviceJobId).toBe(jobId);
    const { job } = json<{ job: { status: string } }>(await call(owner, 'GET', `/api/service/${jobId}`));
    expect(job.status).toBe('done');

    const after = json<{ lines: { id: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
    expect(after.lines.find((l) => l.id === lineId)).toBeUndefined();
    // A second answer for the same line finds it taken, whole or split.
    expect((await call(owner, 'POST', `/api/statement-lines/${lineId}/assign`, { rentalId })).statusCode).toBe(409);
    expect((await call(owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ rentalId, grossTetri: 15000 }, { serviceJobId: jobId, grossTetri: 20000 }] })).statusCode).toBe(409);

    // The payment's page names the other part.
    const page = json<{ payment: { splitWith: { id: string; grossTetri: number }[] } }>(await call(owner, 'GET', `/api/payments/${ids[0]}`));
    expect(page.payment.splitWith).toEqual([expect.objectContaining({ id: ids[1], grossTetri: 20000 })]);
  });

  it('voiding one part voids them all and the line waits for a person again', async () => {
    const { prisma, owner, rentalId, jobId, lineId } = await rentAndRepair('350.0', 'Caricxva - Tanxa GEL350.00; gadmomricxavi: unknown sender');
    const { ids } = json<{ ids: string[] }>(
      await call(owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ serviceJobId: jobId, grossTetri: 20000 }, { rentalId, grossTetri: 15000 }] }),
    );
    expect((await call(owner, 'POST', `/api/payments/${ids[1]}/void`, { reason: 'wrong split' })).statusCode).toBe(200);

    const live = await prisma.payment.count({ where: { statementLineId: lineId, voidedAt: null } });
    expect(live).toBe(0);
    const queue = json<{ lines: { id: string }[] }>(await call(owner, 'GET', '/api/statement-lines'));
    expect(queue.lines.find((l) => l.id === lineId)).toBeTruthy();

    // And it can be split again, the other way.
    const again = await call(owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ rentalId, grossTetri: 30000 }, { serviceJobId: jobId, grossTetri: 5000 }] });
    expect(again.statusCode, again.body).toBe(200);
  });

  it('a card line shares the acquirer’s fee between the parts in proportion', async () => {
    const { prisma, owner, rentalId, jobId, lineId } = await rentAndRepair('344.75', 'Caricxva - Tanxa GEL344.75; Wallet/domestic MC cards');
    const gross = acquiringGross(34475);
    expect(gross).toBe(35000);
    const res = await call(owner, 'POST', `/api/statement-lines/${lineId}/split`, { parts: [{ rentalId, grossTetri: 15000 }, { serviceJobId: jobId, grossTetri: 20000 }] });
    expect(res.statusCode, res.body).toBe(200);
    const made = await prisma.payment.findMany({ where: { statementLineId: lineId, voidedAt: null }, orderBy: { statementPart: 'asc' } });
    expect(made.every((p) => p.channel === 'acquiring')).toBe(true);
    expect(made.map((p) => p.grossTetri)).toEqual([15000, 20000]);
    // 5.25 kept by the bank: 2.25 on the first part, the rest on the last; net adds up to what was credited.
    expect(made.map((p) => p.feeTetri)).toEqual([225, 300]);
    expect(made.reduce((n, p) => n + p.netTetri, 0)).toBe(34475);
  });
});
