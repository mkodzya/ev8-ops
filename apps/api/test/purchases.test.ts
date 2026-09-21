// Buying mopeds (PUR-01, PUR-02, PUR-03).
//
// The figures are the company's own shipment of 2024: the Flybrother
// contract ZJQXGLJY0012024, priced in CNY, paid in GEL, cleared together
// with the other shipment. The acceptance for PUR-02 is that an XL1200
// lands at 1 689.29 GEL.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';

const FLYBROTHER = [
  { key: 'Eagle', qty: 5, unitPrice: '4481.40' },
  { key: 'WOLF-8', qty: 6, unitPrice: '4653.40' },
  { key: 'F-150', qty: 5, unitPrice: '4481.40' },
  { key: 'B11', qty: 6, unitPrice: '5083.60' },
  { key: 'XL1200', qty: 12, unitPrice: '3425.50' },
  { key: '17C', qty: 5, unitPrice: '3425.50' },
];

async function supplier() {
  const { prisma } = await import('../src/lib/db.js');
  return prisma.customer.create({ data: { name: `Factory ${uniq()}`, kind: 'company', isSupplier: true } });
}

async function models(owner: string) {
  const ids: Record<string, string> = {};
  for (const line of FLYBROTHER) {
    const res = await call(owner, 'POST', '/api/models', { brand: `T${uniq().slice(-6)}`, name: line.key, forRent: true });
    ids[line.key] = json<{ id: string }>(res).id;
  }
  return ids;
}

function card(res: { body: string }) {
  return json<{
    purchase: {
      status: string;
      paidTetri: number;
      invoiceMinor: number;
      rate: number | null;
      units: number;
      lines: { id: string; model: { name: string } | null; partName: string | null; qty: number; unitCostTetri: number; fobTetri: number; extrasTetri: number }[];
    };
    vehicles: { vin: string; costTetri: number | null; state: string }[];
  }>(res);
}

describe.skipIf(!HAS_DB)('an order (PUR-01)', () => {
  it('takes lines in the seller’s currency and says nothing about a rate until money moves', async () => {
    const owner = await loginAs('owner');
    const s = await supplier();
    const ids = await models(owner);
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/purchases', {
        supplierId: s.id,
        currency: 'CNY',
        invoiceNo: 'ZJQXGLJY0012024',
        invoiceDate: '2024-07-10',
        orderedOn: '2024-07-10',
      }),
    );
    for (const line of FLYBROTHER) {
      const res = await call(owner, 'POST', `/api/purchases/${id}/lines`, { modelId: ids[line.key], qty: line.qty, unitPrice: line.unitPrice });
      expect(res.statusCode, res.body).toBe(201);
    }

    const before = card(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(before.purchase.invoiceMinor).toBe(16_146_950); // 161 469.50 CNY
    expect(before.purchase.units).toBe(39);
    expect(before.purchase.rate).toBeNull(); // nothing paid, so no rate to state
    expect(before.purchase.lines.every((l) => l.unitCostTetri === 0)).toBe(true);
  });

  it('refuses a line that is both a model and a part, and one that is neither', async () => {
    const owner = await loginAs('owner');
    const s = await supplier();
    const ids = await models(owner);
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/purchases', { supplierId: s.id }));
    expect((await call(owner, 'POST', `/api/purchases/${id}/lines`, { modelId: ids['B11'], partName: 'x', qty: 1, unitPrice: '1' })).statusCode).toBe(409);
    expect((await call(owner, 'POST', `/api/purchases/${id}/lines`, { qty: 1, unitPrice: '1' })).statusCode).toBe(409);
    expect((await call(owner, 'POST', `/api/purchases/${id}/lines`, { partName: 'Charger 60V 5A', qty: 10, unitPrice: '43.50' })).statusCode).toBe(201);
  });

  it('only an owner buys, and only an owner looks (redesign §2.1)', async () => {
    const owner = await loginAs('owner');
    const s = await supplier();
    const manager = await loginAs('manager');
    expect((await call(manager, 'POST', '/api/purchases', { supplierId: s.id })).statusCode).toBe(403);
    expect((await call(manager, 'GET', '/api/purchases')).statusCode).toBe(403);
    expect((await call(owner, 'POST', '/api/purchases', { supplierId: s.id })).statusCode).toBe(201);
  });
});

/**
 * A VIN the fleet will accept: 17 characters without I, O or Q (wave 5 §3.9).
 * The distinctive tail of whatever the test made up is kept, so two VINs from
 * one run still differ.
 */
function vin(...parts: (string | number)[]): string {
  const clean = parts.join('').toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, '');
  const tail = clean.slice(-17);
  return tail.length === 17 ? tail : 'V'.repeat(17 - tail.length) + tail;
}

describe.skipIf(!HAS_DB)('paying and receiving (PUR-02, PUR-03)', () => {
  async function ordered() {
    const owner = await loginAs('owner');
    const s = await supplier();
    const ids = await models(owner);
    const { id } = json<{ id: string }>(
      await call(owner, 'POST', '/api/purchases', {
        supplierId: s.id,
        currency: 'CNY',
        invoiceNo: 'ZJQXGLJY0012024',
        orderedOn: '2024-07-10',
        // What the shipment cost to bring in and clear, with the refunded
        // import VAT already taken out: 238.34 GEL a unit over 39 units.
        extrasTetri: String(39 * 238.34),
        extrasNote: 'logistics and customs, import VAT excluded (refunded)',
      }),
    );
    const lineIds: Record<string, string> = {};
    for (const line of FLYBROTHER) {
      const res = await call(owner, 'POST', `/api/purchases/${id}/lines`, { modelId: ids[line.key], qty: line.qty, unitPrice: line.unitPrice });
      lineIds[line.key] = json<{ id: string }>(res).id;
    }
    return { owner, id, ids, lineIds };
  }

  it('an XL1200 lands at 1 689.29, the figure the company worked out by hand', async () => {
    const { owner, id, lineIds } = await ordered();
    // A 30 % deposit and the balance, the way both contracts were paid.
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '20518.26', occurredOn: '2024-10-07' });
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '47875.93', occurredOn: '2024-12-10' });

    const c = card(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(c.purchase.paidTetri).toBe(6_839_419); // 68 394.19 GEL
    expect(c.purchase.rate).toBeCloseTo(0.42357, 5); // the rate that really happened

    const xl = c.purchase.lines.find((l) => l.model?.name.endsWith('XL1200'))!;
    expect(xl.unitCostTetri).toBe(168929);
    // Every tetri that left the bank is on some line, and no more.
    expect(c.purchase.lines.reduce((n, l) => n + l.fobTetri, 0)).toBe(6_839_419);
    expect(c.purchase.lines.reduce((n, l) => n + l.extrasTetri, 0)).toBe(39 * 23834);
    void lineIds;
  });

  it('arriving creates every VIN with its own cost and puts it in the fleet', async () => {
    const { owner, id, lineIds } = await ordered();
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '68394.19', occurredOn: '2024-12-10' });

    const tag = uniq().replace(/\D/g, '').slice(-6);
    const vins: Record<string, string[]> = {};
    for (const line of FLYBROTHER) {
      vins[lineIds[line.key]] = Array.from({ length: line.qty }, (_, i) => vin('PO', tag, line.key, i));
    }
    const res = await call(owner, 'POST', `/api/purchases/${id}/receive`, { receivedOn: '2025-03-14', vins });
    expect(res.statusCode, res.body).toBe(200);
    expect(json<{ vehicles: number }>(res).vehicles).toBe(39);

    const c = card(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(c.purchase.status).toBe('received');
    expect(c.vehicles).toHaveLength(39);
    expect(c.vehicles.every((v) => v.state === 'available')).toBe(true);
    const anXl = c.vehicles.find((v) => v.vin.includes('XL1200'))!;
    expect(anXl.costTetri).toBe(168929);

    const xlVehicle = c.vehicles.find((v) => v.vin.includes('XL1200'))!;
    const detail = json<{ vehicles: { id: string; vin: string }[] }>(await call(owner, 'GET', `/api/purchases/${id}`));
    const xlId = detail.vehicles.find((v) => v.vin === xlVehicle.vin)!.id;
    const fleet = json<{ vehicle: { costTetri: number | null; arrivedOn: string }; events: { kind: string }[] }>(
      await call(owner, 'GET', `/api/fleet/${xlId}`),
    );
    expect(fleet.events.map((e) => e.kind)).toContain('arrived');
    expect(fleet.vehicle.costTetri).toBe(168929);
    expect(fleet.vehicle.arrivedOn).toBe('2025-03-14');
  });

  it('refuses a shipment whose VINs do not match what was ordered', async () => {
    const { owner, id, lineIds } = await ordered();
    // A shipment may arrive before it is paid for (Mika, Q23); what it may
    // not do is arrive with the wrong VINs.
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '68394.19' });
    const none = await call(owner, 'POST', `/api/purchases/${id}/receive`, { vins: {} });
    expect(json<{ error: string }>(none).error).toBe('vins_missing');

    const tag = uniq().replace(/\D/g, '').slice(-6);
    const short: Record<string, string[]> = {};
    for (const line of FLYBROTHER) short[lineIds[line.key]] = Array.from({ length: line.qty }, (_, i) => vin('SH', tag, line.key, i));
    short[lineIds['B11']] = short[lineIds['B11']].slice(0, 5);
    const wrongCount = await call(owner, 'POST', `/api/purchases/${id}/receive`, { vins: short });
    expect(json<{ error: string; qty: number; given: number }>(wrongCount)).toMatchObject({ error: 'vins_count', qty: 6, given: 5 });
  });

  it('a VIN already in the fleet stops the whole arrival', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { owner, id, lineIds } = await ordered();
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '68394.19' });
    const tag = uniq().replace(/\D/g, '').slice(-6);
    const vins: Record<string, string[]> = {};
    for (const line of FLYBROTHER) vins[lineIds[line.key]] = Array.from({ length: line.qty }, (_, i) => vin('DUP', tag, line.key, i));
    // The route upper-cases a VIN on the way in; a row made directly has to
    // do the same, because the column insists on it.
    const clash = vins[lineIds['Eagle']][0].toUpperCase();
    const model = await prisma.vehicleModel.create({ data: { brand: `X${uniq().slice(-6)}`, name: 'Clash' } });
    await prisma.vehicle.create({ data: { vin: clash, modelId: model.id } });

    const res = await call(owner, 'POST', `/api/purchases/${id}/receive`, { vins });
    expect(json<{ error: string }>(res).error).toBe('duplicate_vin');
    // Nothing of the shipment was entered: the order is still open.
    const c = card(await call(owner, 'GET', `/api/purchases/${id}`));
    expect(c.purchase.status).toBe('ordered');
    expect(c.vehicles).toHaveLength(0);
  });

  it('an order that has arrived is a record and takes no more lines', async () => {
    const { owner, id, ids, lineIds } = await ordered();
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '68394.19' });
    const tag = uniq().replace(/\D/g, '').slice(-6);
    const vins: Record<string, string[]> = {};
    for (const line of FLYBROTHER) vins[lineIds[line.key]] = Array.from({ length: line.qty }, (_, i) => vin('RC', tag, line.key, i));
    await call(owner, 'POST', `/api/purchases/${id}/receive`, { vins });
    const late = await call(owner, 'POST', `/api/purchases/${id}/lines`, { modelId: ids['B11'], qty: 1, unitPrice: '1' });
    expect(json<{ error: string }>(late).error).toBe('purchase_closed');
    expect((await call(owner, 'POST', `/api/purchases/${id}/receive`, { vins })).statusCode).toBe(409);
  });
});

describe.skipIf(!HAS_DB)('an order entered by mistake', () => {
  it('is cancelled with a reason, but not while money hangs on it', async () => {
    const owner = await loginAs('owner');
    const s = await supplier();
    const { id } = json<{ id: string }>(await call(owner, 'POST', '/api/purchases', { supplierId: s.id }));
    await call(owner, 'POST', `/api/purchases/${id}/payments`, { grossTetri: '100' });
    const held = await call(owner, 'POST', `/api/purchases/${id}/cancel`, { reason: 'wrong supplier' });
    expect(json<{ error: string }>(held).error).toBe('purchase_has_payments');

    const { prisma } = await import('../src/lib/db.js');
    const payment = await prisma.payment.findFirstOrThrow({ where: { purchaseId: id } });
    await call(owner, 'POST', `/api/payments/${payment.id}/void`, { reason: 'wrong order' });
    expect((await call(owner, 'POST', `/api/purchases/${id}/cancel`, { reason: 'wrong supplier' })).statusCode).toBe(200);
  });
});
