// Money entered by hand that the bank has sent already (B11-03).
//
// Bank of Georgia's lines arrive within minutes now, before anybody types the
// transfer in. A transfer or a card payment entered by hand is checked
// against the lines of the same sum, gross or net, within ±3 days: one still
// in «Разобрать» is offered to be attached instead, one already attached to
// this customer's payment is named, and nothing is written twice unless the
// person says it is another transfer. People and sums are made up.
import { acquiringFee, addDays, todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const today = () => todayISO();

/** A sum no other suite uses, so another suite's line cannot be taken for this one's. */
const oddSum = () => 50_000 + Math.floor(Math.random() * 400_000) + 7;

async function rentalOf(name: string) {
  const { prisma } = await import('../src/lib/db.js');
  const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, forRent: true } });
  const vehicle = await prisma.vehicle.create({ data: { vin: `INBNK${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`, modelId: model.id } });
  const customer = await prisma.customer.create({ data: { name } });
  const owner = await loginAs('owner');
  const res = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: 14000, pickedUpOn: addDays(today(), -10) });
  expect(res.statusCode, res.body).toBe(201);
  const { id } = json<{ id: string }>(res);
  const { number } = await prisma.rental.findUniqueOrThrow({ where: { id }, select: { number: true } });
  return { prisma, owner, customerId: customer.id, rentalId: id, number };
}

/** A bank line as the pull leaves it: in the queue, waiting for a person. */
async function bankLine(opts: { amountTetri: number; occurredOn?: string; payer?: string; grossTetri?: number; feeTetri?: number }) {
  const { prisma } = await import('../src/lib/db.js');
  const statement = await prisma.statement.create({ data: { bank: 'bog', fileName: `Business Online ${uniq()}`, fileSha256: `test-${uniq()}`, source: 'api' } });
  return prisma.statementLine.create({
    data: {
      statementId: statement.id,
      bank: 'bog',
      naturalKey: `in-bank-${uniq()}`,
      occurredOn: new Date(`${opts.occurredOn ?? today()}T00:00:00Z`),
      direction: 'in',
      amountTetri: opts.amountTetri,
      grossTetri: opts.grossTetri ?? null,
      feeTetri: opts.feeTetri ?? null,
      payer: opts.payer ?? null,
      purpose: 'qira',
      raw: `Private Transfer: test line ${uniq()}`,
    },
  });
}

type InBank = { lineId: string; occurredOn: string; amountTetri: number; grossTetri: number; payment: { id: string; number: string | null; grossTetri: number } | null };
type Refusal = { error: string; field: string; lines: InBank[] };

const rent = (rentalId: string, amountTetri: number, extra: Record<string, unknown> = {}) => ({ kind: 'rent', rentalId, amountTetri, channel: 'transfer', ...extra });

describe.skipIf(!HAS_DB)('a transfer entered by hand that the bank has sent already', () => {
  it('a line still in «Разобрать»: the preview shows it, the write is refused with it, attaching it writes the payment once', async () => {
    const { prisma, owner, rentalId } = await rentalOf(`Тест Банк ${uniq()}`);
    const sum = oddSum();
    const line = await bankLine({ amountTetri: sum });

    const preview = json<{ inBank: InBank[] }>(await call(owner, 'POST', '/api/money/preview', rent(rentalId, sum)));
    expect(preview.inBank.map((l) => l.lineId)).toEqual([line.id]);
    expect(preview.inBank[0]).toMatchObject({ amountTetri: sum, grossTetri: sum, occurredOn: today(), payment: null });

    const refused = await call(owner, 'POST', '/api/money', rent(rentalId, sum));
    expect(refused.statusCode, refused.body).toBe(409);
    const r = json<Refusal>(refused);
    expect(r.error).toBe('bank_line_exists');
    expect(r.field).toBe('notBankLines');
    expect(r.lines.map((l) => l.lineId)).toEqual([line.id]);
    expect(await prisma.payment.count({ where: { rentalId, voidedAt: null } })).toBe(0);

    // «Привязать эту строку»: the payment is made of the bank line, the queue loses it.
    const attached = await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId });
    expect(attached.statusCode, attached.body).toBe(200);
    const paid = await prisma.payment.findMany({ where: { rentalId, voidedAt: null } });
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ grossTetri: sum, source: 'statement', statementLineId: line.id });
    expect((await prisma.statementLine.findUniqueOrThrow({ where: { id: line.id } })).status).toBe('matched');
  });

  it('a line already attached to this customer’s payment is named, and the same money is not written again', async () => {
    const { prisma, owner, rentalId, number } = await rentalOf(`Тест Банк ${uniq()}`);
    const sum = oddSum();
    const line = await bankLine({ amountTetri: sum, occurredOn: addDays(today(), -2) });
    const { id: paymentId } = json<{ id: string }>(await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId }));

    const preview = json<{ inBank: InBank[] }>(await call(owner, 'POST', '/api/money/preview', rent(rentalId, sum)));
    expect(preview.inBank).toHaveLength(1);
    expect(preview.inBank[0].payment).toEqual({ id: paymentId, number, grossTetri: sum });

    const refused = await call(owner, 'POST', '/api/money', rent(rentalId, sum));
    expect(refused.statusCode, refused.body).toBe(409);
    expect(json<Refusal>(refused).lines[0].payment?.id).toBe(paymentId);

    // The older door says the same.
    const legacy = await call(owner, 'POST', '/api/payments', { rentalId, grossTetri: sum, channel: 'transfer' });
    expect(legacy.statusCode, legacy.body).toBe(409);
    expect(json<Refusal>(legacy).error).toBe('bank_line_exists');
    expect(await prisma.payment.count({ where: { rentalId, voidedAt: null } })).toBe(1);
  });

  it('«это другой перевод»: with the line named as not this money, the payment is written and the journal keeps which line', async () => {
    const { prisma, owner, rentalId } = await rentalOf(`Тест Банк ${uniq()}`);
    const sum = oddSum();
    const line = await bankLine({ amountTetri: sum });
    await call(owner, 'POST', `/api/statement-lines/${line.id}/assign`, { rentalId });

    const res = await call(owner, 'POST', '/api/money', rent(rentalId, sum, { notBankLines: [line.id] }));
    expect(res.statusCode, res.body).toBe(201);
    const { id } = json<{ id: string }>(res);
    expect(await prisma.payment.count({ where: { rentalId, voidedAt: null } })).toBe(2);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: 'payment', entityId: id, action: 'payment.record' } });
    expect((audit.after as { notBankLines?: string[] }).notBankLines).toEqual([line.id]);

    // A line that came after the person looked is not covered by what they said.
    const later = await bankLine({ amountTetri: sum, occurredOn: addDays(today(), -1) });
    const again = await call(owner, 'POST', '/api/money', rent(rentalId, sum, { notBankLines: [line.id] }));
    expect(again.statusCode, again.body).toBe(409);
    expect(json<Refusal>(again).lines.map((l) => l.lineId)).toEqual([later.id]);
  });

  it('a card payment: the line holds the net the bank credited, the form the gross the customer paid', async () => {
    const { owner, rentalId } = await rentalOf(`Тест Банк ${uniq()}`);
    const gross = oddSum();
    const net = gross - acquiringFee(gross);
    const line = await bankLine({ amountTetri: net });
    const preview = json<{ inBank: InBank[] }>(await call(owner, 'POST', '/api/money/preview', rent(rentalId, gross, { channel: 'acquiring' })));
    expect(preview.inBank.map((l) => l.lineId)).toEqual([line.id]);
    const refused = await call(owner, 'POST', '/api/money', rent(rentalId, gross, { channel: 'acquiring' }));
    expect(refused.statusCode, refused.body).toBe(409);
  });

  it('nothing to find: cash, somebody else’s line, a line naming somebody else, a line four days away', async () => {
    const { prisma, owner, rentalId } = await rentalOf(`Тест Банк ${uniq()}`);
    const other = await rentalOf(`Другой Клиент ${uniq()}`);
    const sum = oddSum();

    // Cash never passes through the bank.
    await bankLine({ amountTetri: sum });
    const cash = await call(owner, 'POST', '/api/money', rent(rentalId, sum, { channel: 'cash' }));
    expect(cash.statusCode, cash.body).toBe(201);

    // The same sum attached to another customer's rental is that customer's money.
    const theirs = oddSum();
    const theirLine = await bankLine({ amountTetri: theirs });
    await call(owner, 'POST', `/api/statement-lines/${theirLine.id}/assign`, { rentalId: other.rentalId });
    expect(json<{ inBank: InBank[] }>(await call(owner, 'POST', '/api/money/preview', rent(rentalId, theirs))).inBank).toEqual([]);

    // A waiting line whose payer is somebody else.
    const named = oddSum();
    const otherName = (await prisma.customer.findUniqueOrThrow({ where: { id: other.customerId } })).name;
    await bankLine({ amountTetri: named, payer: otherName });
    expect(json<{ inBank: InBank[] }>(await call(owner, 'POST', '/api/money/preview', rent(rentalId, named))).inBank).toEqual([]);

    // Outside ±3 days.
    const far = oddSum();
    await bankLine({ amountTetri: far, occurredOn: addDays(today(), -4) });
    const written = await call(owner, 'POST', '/api/money', rent(rentalId, far, { channel: 'transfer' }));
    expect(written.statusCode, written.body).toBe(201);
  });

  it('a manager takes cash and is shown no bank lines', async () => {
    const { rentalId } = await rentalOf(`Тест Банк ${uniq()}`);
    const sum = oddSum();
    await bankLine({ amountTetri: sum });
    const manager = await loginAs('manager');
    const preview = await call(manager, 'POST', '/api/money/preview', rent(rentalId, sum, { channel: 'cash' }));
    expect(preview.statusCode, preview.body).toBe(200);
    expect(json<{ inBank: InBank[] }>(preview).inBank).toEqual([]);
  });
});
