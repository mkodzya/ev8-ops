// The invoice of a goods sale (issue #11, ADR-0045 §8; acceptance 3): in
// Georgian, with the company's requisites, the VAT taken out of a final price,
// kept as it was handed out, and printed anew with the cancellation on it.
// A private buyer's personal number never goes on it. Buyers are invented.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const pdfText = async (bytes: Buffer) => (await import('../src/lib/driveDocs.js')).pdfText(new Uint8Array(bytes));
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

async function part(owner: string) {
  const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/parts', { name: `Mirror (example) ${uniq()}`, nameKa: `სარკე (მაგალითი) ${uniq()}`, salePriceTetri: 100_00 }));
  expect((await call(owner, 'POST', `/api/parts/${id}/initial`, { qty: 5, unitCostTetri: 40_00 })).statusCode).toBe(201);
  return id;
}

describe.skipIf(!HAS_DB)('the goods invoice', () => {
  it('prints a retail sale: seller\'s requisites, the buyer as retail, without VAT · VAT 18 % · total, the same bytes again', async () => {
    const owner = await loginAs('owner');
    const partId = await part(owner);
    const res = await call(owner, 'POST', '/api/goods-sales', { lines: [{ partId, qty: 1, unitPriceTetri: 100_00 }], paidNow: { channel: 'cash', amountTetri: 100_00 } });
    expect(res.statusCode, res.body).toBe(201);
    const { id, number } = json<{ id: string; number: string }>(res);

    const first = await call(owner, 'GET', `/api/goods-sales/${id}/invoice.pdf`);
    expect(first.statusCode).toBe(200);
    expect(first.headers['content-type']).toBe('application/pdf');
    const text = await pdfText(first.rawPayload);
    for (const s of [number, '84.75', '15.25', '100.00', 'საცალო მყიდველი', '412785721', 'ინვოისი']) expect(text, s).toContain(s);

    const again = await call(owner, 'GET', `/api/goods-sales/${id}/invoice.pdf`);
    expect(sha(again.rawPayload)).toBe(sha(first.rawPayload));
    const { prisma } = await import('../src/lib/db.js');
    expect(await prisma.auditLog.count({ where: { entityId: id, action: 'goods_sale.invoice' } })).toBe(1);

    // Cancelled: the paper handed out goes to the archive, the next says so.
    expect((await call(owner, 'POST', `/api/goods-sales/${id}/cancel`, { reason: 'test: returned' })).statusCode).toBe(200);
    const cancelled = await call(owner, 'GET', `/api/goods-sales/${id}/invoice.pdf`);
    expect(sha(cancelled.rawPayload)).not.toBe(sha(first.rawPayload));
    expect(await pdfText(cancelled.rawPayload)).toContain('გაუქმებულია');
    expect(await prisma.storedFile.count({ where: { goodsSaleId: id, archived: true } })).toBe(1);
  });

  it('names a charger in Georgian with its English under it, and says the unit in Georgian as the stock does', async () => {
    const owner = await loginAs('owner');
    expect((await call(owner, 'POST', '/api/batteries/inventory', { item: 'charger', showroomQty: 3, repairQty: 0, reason: 'test: counted for the invoice' })).statusCode).toBe(201);
    const res = await call(owner, 'POST', '/api/goods-sales', { lines: [{ countedItem: 'charger', spec: '73V6A', qty: 1, unitPriceTetri: 100_00 }], paidNow: { channel: 'cash', amountTetri: 100_00 } });
    expect(res.statusCode, res.body).toBe(201);
    const text = await pdfText((await call(owner, 'GET', `/api/goods-sales/${json<{ id: string }>(res).id}/invoice.pdf`)).rawPayload);
    for (const s of ['დამტენი 73V6A', 'Charger 73V6A', 'ცალი']) expect(text, s).toContain(s);
    expect(text).not.toContain('Зарядка');
    expect(text).not.toContain('pcs');
  });

  it('prints a part\'s card name under its Georgian one, as a charger has its English (QA 23.10.2026)', async () => {
    const owner = await loginAs('owner');
    const n = String(Math.floor(Math.random() * 1e6));
    const made = await call(owner, 'POST', '/api/parts', { name: `Колодки ${n}`, nameKa: `ხუნდები ${n}`, salePriceTetri: 30_00 });
    expect(made.statusCode, made.body).toBe(201);
    const partId = json<{ id: string }>(made).id;
    expect((await call(owner, 'POST', `/api/parts/${partId}/initial`, { qty: 2, unitCostTetri: 10_00 })).statusCode).toBe(201);
    const res = await call(owner, 'POST', '/api/goods-sales', { lines: [{ partId, qty: 1, unitPriceTetri: 30_00 }], paidNow: { channel: 'cash', amountTetri: 30_00 } });
    expect(res.statusCode, res.body).toBe(201);
    const text = await pdfText((await call(owner, 'GET', `/api/goods-sales/${json<{ id: string }>(res).id}/invoice.pdf`)).rawPayload);
    for (const s of [`ხუნდები ${n}`, `Колодки ${n}`]) expect(text, s).toContain(s);
  });

  it('names an own customer; a person\'s personal number stays off the paper, a company\'s tax code is on it', async () => {
    const owner = await loginAs('owner');
    const manager = await loginAs('manager');
    const { prisma } = await import('../src/lib/db.js');
    const personalId = `0${String(Date.now()).slice(-10)}`;
    const person = await prisma.customer.create({ data: { name: `Клиент Пример ${uniq()}`, personalId, phone: '555 00 00 00' } });
    const taxCode = `4${String(Date.now() + 7).slice(-8)}`;
    const company = await prisma.customer.create({ data: { name: `Компания Пример ${uniq()}`, kind: 'company', personalId: taxCode } });
    const partId = await part(owner);

    const a = json<{ id: string }>(await call(manager, 'POST', '/api/goods-sales', { customerId: person.id, lines: [{ partId, qty: 1, unitPriceTetri: 100_00 }] }));
    const ta = await pdfText((await call(manager, 'GET', `/api/goods-sales/${a.id}/invoice.pdf`)).rawPayload);
    expect(ta).toContain(person.name);
    expect(ta).not.toContain(personalId);

    const b = json<{ id: string }>(await call(owner, 'POST', '/api/goods-sales', { customerId: company.id, lines: [{ partId, qty: 2, unitPriceTetri: 50_00 }] }));
    const tb = await pdfText((await call(owner, 'GET', `/api/goods-sales/${b.id}/invoice.pdf`)).rawPayload);
    expect(tb).toContain(taxCode);
    expect(tb).toContain('100.00');
  });
});
