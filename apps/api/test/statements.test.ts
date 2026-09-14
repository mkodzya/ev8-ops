// Loading a statement and letting it settle what it can (PAY-01, PAY-02, PAY-03).
//
// The CSV fragments below are the real shapes of the two exports this
// company gets — the column layout, the date formats, the transliterated
// payer inside a Bank of Georgia line, the way a card payment states its
// commission — with the people and the amounts made up for the test.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const BOG_HEADER = [
  ',,,"angariSis mflobeli: Sps e-mouSen moTors",,,,',
  ',,,"angariSis #:GE41BG0000000600217157GEL (600217157)",,,,',
  ',,,,,,,',
  '"centraluri filiali",,,"naerTi amonaweri piradi angariSidan",,,,',
  '"gagarinis q. #29 a",,,"periodi: 01.09.26-30.09.26",,,,',
  '"TariRi","sabuTis #","mokorespondento angariSi","debeti","krediti","kursi","eqv.lari","operaciis Sinaarsi"',
  '"01.09.2024","sawyisi naSTi","","GEL","0","1","0",""',
].join('\n');

const bogRow = (date: string, credit: string, content: string, doc = '0017') =>
  `"${date}","${doc}","GE38TB7756045063400002","","${credit}","1","${credit}","${content}"`;

const BOG_SUMMARY = ['"brunva","","","0","320","1","",""', '"naSTi","","","","320.00","1","320.00",""'].join('\n');

const TBC_HEADER = [
  '"თარიღი","დანიშნულება","ტრანზაქციის ტიპი","თანხა","ვალუტა","ანგარიშის ნომერი","ანგარიშის დასახელება","დამატებითი ინფორმაცია","საბუთის თარიღი","საბუთის №","პარტნიორის ანგარიში","პარტნიორი","პარტნიორის საგადასახადო კოდი","პარტნიორის ბანკის კოდი","პარტნიორის ბანკი","შუამავალი ბანკის კოდი","შუამავალი ბანკი","ხარჯის ტიპი","გადასახადის გადამხდელის კოდი","გადასახადის გადამხდელის დასახელება","სახაზინო კოდი","ოპ.კოდი","დამატებითი დანიშნულება","ტრანზაქციის ID"',
  '"Date","Description","Transaction Type","Amount","Currency","Account Number","Account Name","Additional Information","Document Date","Document Number","Partner\'s Account","Partner\'s Name","Partner\'s Tax Code","Partner\'s Bank Code","Partner\'s Bank","Intermediary Bank Code","Intermediary Bank","Charge Details","Taxpayer Code","Taxpayer Name","Treasury Code","Op.Code","Additional Description","Transaction ID"',
].join('\n');

const tbcRow = (date: string, amount: string, partner: string, txn: string, desc = 'Rent') =>
  `"${date}","${desc}","Income","${amount}","GEL","GE40TB7370836020100011","ე-მოუშენ მოთორს","","${date}","589041","GE32BG0000000207005800","${partner}","","BAGAGE22","სს ბანკი","","","","","","","BULK","","${txn}"`;

async function rentalFor(name: { ru: string; ka: string }, opts: { rate?: number; pickedUpOn?: string } = {}) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `TESTS${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name: name.ru, nameKa: name.ka } });
  const director = await loginAs('director');
  const { id } = json<{ id: string }>(
    await call(director, 'POST', '/api/rentals', {
      customerId: customer.id,
      vehicleId: vehicle.id,
      weeklyRateTetri: opts.rate ?? 14000,
      pickedUpOn: opts.pickedUpOn ?? '2026-09-01',
    }),
  );
  return { prisma, director, customer, rentalId: id };
}

describe.skipIf(!HAS_DB)('reading a Bank of Georgia export', () => {
  it('skips the preamble and the balance rows, and finds the payer inside the text', async () => {
    const who = { ru: 'Важа Тестовый', ka: 'ვაჟა ტესტიძე' };
    const { director, rentalId } = await rentalFor(who);
    const text = [
      BOG_HEADER,
      bogRow(
        '05.09.2026',
        '320.0',
        `Private Transfer: Caricxva - Tanxa: GEL320.00; gadmomricxavi: testiZe vaJa; angariSi: GE32BG0000000207005800GEL; daniSnuleba: qira ${uniq()}`,
      ),
      BOG_SUMMARY,
    ].join('\n');

    const res = await call(director, 'POST', '/api/statements', { fileName: 'StatementExport.csv', text });
    expect(res.statusCode, res.body).toBe(201);
    const result = json<{ bank: string; lineCount: number; newLines: number; matched: number }>(res);
    expect(result.bank).toBe('bog');
    expect(result.lineCount).toBe(1); // the opening balance and the summaries are not transactions
    expect(result.matched).toBe(1);

    const card = json<{ rental: { paidThrough: string | null }; deposit: { paidTetri: number } }>(
      await call(director, 'GET', `/api/rentals/${rentalId}`),
    );
    expect(card.deposit.paidTetri).toBe(18000);
    expect(card.rental.paidThrough).toBe('2026-09-07');
  });

  it('reads a card line for what the customer paid, not what the bank credited (PAY-04)', async () => {
    const { director, rentalId } = await rentalFor({ ru: 'Нино Картовна', ka: 'ნინო ბარათიძე' }, { rate: 14000, pickedUpOn: '2026-09-03' });
    const text = [
      BOG_HEADER,
      bogRow(
        '03.09.2026',
        '315.20',
        `Caricxva - Tanxa GEL315.20; gadaxda - TariRi: 03/09/2026 18:21:14; Tanxa:GEL 320; sakomisio: GEL 4.80; baraTi: MC, 5167***6145; terminalis ID: POS30LTG ${uniq()}`,
      ),
    ].join('\n');
    const res = await call(director, 'POST', '/api/statements', { fileName: 'StatementExport.csv', text });
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
    const { director, prisma } = await rentalFor({ ru: 'Давид Двойной', ka: 'დავით ორმაგიძე' });
    const text = [BOG_HEADER, bogRow('06.09.2026', '140.0', `Caricxva: gadmomricxavi: ormagiZe daviT; daniSnuleba: qira ${tag}`)].join('\n');

    const first = json<{ newLines: number; matched: number }>(await call(director, 'POST', '/api/statements', { fileName: 'a.csv', text }));
    expect(first.newLines).toBe(1);
    const second = json<{ lineCount: number; newLines: number; matched: number }>(
      await call(director, 'POST', '/api/statements', { fileName: 'a.csv', text }),
    );
    expect(second.lineCount).toBe(1);
    expect(second.newLines).toBe(0);
    expect(second.matched).toBe(0);
    expect(await prisma.payment.count({ where: { bankText: { contains: tag } } })).toBe(1);
  });

  it('money leaving the account is kept but never queued as a customer payment', async () => {
    const { director } = await rentalFor({ ru: 'Лука Расходов', ka: 'ლუკა ხარჯიძე' });
    const text = [
      BOG_HEADER,
      `"09.09.2026","0018","GE89BG0000000902936900GEL","95.0","","1","95.0","my auto.ge: gadaricxva - Tanxa: GEL95.00; mimRebi: TNET LLC ${uniq()}"`,
    ].join('\n');
    const res = json<{ outgoing: number; unmatched: number }>(await call(director, 'POST', '/api/statements', { fileName: 'out.csv', text }));
    expect(res.outgoing).toBe(1);
    expect(res.unmatched).toBe(0);
  });
});

describe.skipIf(!HAS_DB)('reading a TBC export', () => {
  it('matches a payer written in Georgian and keeps the bank’s own transaction id', async () => {
    const { director, rentalId } = await rentalFor({ ru: 'Георгий Тбисиев', ka: 'გიორგი თბისიძე' });
    const txn = `1532697${uniq().replace(/\D/g, '').slice(-8)}.20`;
    const text = [TBC_HEADER, tbcRow('04/09/2026', '320.0', 'თბისიძე გიორგი', txn)].join('\n');

    const res = json<{ bank: string; matched: number }>(await call(director, 'POST', '/api/statements', { fileName: 'transactions_history.csv', text }));
    expect(res.bank).toBe('tbc');
    expect(res.matched).toBe(1);

    const card = json<{ rental: { paidThrough: string | null } }>(await call(director, 'GET', `/api/rentals/${rentalId}`));
    expect(card.rental.paidThrough).toBe('2026-09-07');

    // The same transaction id in a second file is the same transaction.
    const again = json<{ newLines: number }>(await call(director, 'POST', '/api/statements', { fileName: 'overlap.csv', text }));
    expect(again.newLines).toBe(0);
  });
});

describe.skipIf(!HAS_DB)('the queue of lines nobody could place (PAY-03)', () => {
  it('holds a line with no name and no matching amount, and offers hints', async () => {
    const { director } = await rentalFor({ ru: 'Тамара Безымянная', ka: 'თამარ უსახელოძე' }, { rate: 15000, pickedUpOn: '2026-08-02' });
    const tag = uniq();
    const text = [BOG_HEADER, bogRow('20.09.2026', '77.77', `Caricxva - Tanxa GEL77.77; Wallet/domestic MC cards ${tag}`)].join('\n');
    const res = json<{ unmatched: number; matched: number }>(await call(director, 'POST', '/api/statements', { fileName: 'q.csv', text }));
    expect(res.matched).toBe(0);
    expect(res.unmatched).toBe(1);

    const queue = json<{ lines: { id: string; amountTetri: number; raw: string }[] }>(await call(director, 'GET', '/api/statement-lines'));
    const mine = queue.lines.find((l) => l.raw.includes(tag));
    expect(mine).toBeTruthy();
    expect(mine!.amountTetri).toBe(7777);

    const detail = json<{ line: { id: string }; hints: { rentalId: string; why: string }[] }>(
      await call(director, 'GET', `/api/statement-lines/${mine!.id}`),
    );
    expect(detail.hints.length).toBeGreaterThan(0);
  });

  it('assigning a line to a rental makes the payment and takes it out of the queue', async () => {
    const { director, rentalId } = await rentalFor({ ru: 'Лаша Неопознанный', ka: 'ლაშა უცნობიძე' }, { rate: 15000 });
    const tag = uniq();
    const text = [BOG_HEADER, bogRow('21.09.2026', '99.99', `Caricxva - Tanxa GEL99.99; Wallet/domestic MC cards ${tag}`)].join('\n');
    await call(director, 'POST', '/api/statements', { fileName: 'q2.csv', text });
    const queue = json<{ lines: { id: string; raw: string }[] }>(await call(director, 'GET', '/api/statement-lines'));
    const line = queue.lines.find((l) => l.raw.includes(tag))!;

    const assigned = await call(director, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId });
    expect(assigned.statusCode, assigned.body).toBe(200);

    const after = json<{ lines: { id: string }[] }>(await call(director, 'GET', '/api/statement-lines'));
    expect(after.lines.find((l) => l.id === line.id)).toBeUndefined();

    const { prisma } = await import('../src/lib/db.js');
    const p = await prisma.payment.findFirstOrThrow({ where: { rentalId, source: 'statement' } });
    expect(p.grossTetri).toBe(9999);
    expect((await call(director, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId })).statusCode).toBe(409);
  });

  it('a line that is not a customer payment is put aside with a reason', async () => {
    const { director } = await rentalFor({ ru: 'Отложенный Тест', ka: 'ტესტ გადადებული' });
    const tag = uniq();
    const text = [BOG_HEADER, bogRow('22.09.2026', '5.0', `Caricxva - Tanxa GEL5.00; Business Package S paketis momsaxurebis sakomisio ${tag}`)].join('\n');
    await call(director, 'POST', '/api/statements', { fileName: 'q3.csv', text });
    const queue = json<{ lines: { id: string; raw: string }[] }>(await call(director, 'GET', '/api/statement-lines'));
    const line = queue.lines.find((l) => l.raw.includes(tag))!;
    expect((await call(director, 'POST', `/api/statement-lines/${line.id}/ignore`, {})).statusCode).toBe(400);
    expect((await call(director, 'POST', `/api/statement-lines/${line.id}/ignore`, { reason: 'bank package fee' })).statusCode).toBe(200);
    const after = json<{ lines: { id: string }[] }>(await call(director, 'GET', '/api/statement-lines'));
    expect(after.lines.find((l) => l.id === line.id)).toBeUndefined();
  });
});

describe.skipIf(!HAS_DB)('who may load a statement', () => {
  it('a manager may not, and an unreadable file is refused with a sentence that says why', async () => {
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/statements', { fileName: 'x.csv', text: 'anything' })).statusCode).toBe(403);
    const director = await loginAs('director');
    const bad = await call(director, 'POST', '/api/statements', { fileName: 'x.csv', text: 'name,amount\nfoo,1' });
    expect(bad.statusCode).toBe(400);
    expect(json<{ error: string; message: string }>(bad).error).toBe('unreadable_statement');
    expect(json<{ message: string }>(bad).message).toMatch(/Bank of Georgia|TBC/);
  });
});
