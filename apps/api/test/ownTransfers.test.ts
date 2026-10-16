// Money between the company's own accounts, found by itself (ADR-0028).
// Every account number and every person here is made up.
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';
import { ibanOf, ibansIn, isCompany, ownSign, ownTransfers, type OwnLine } from '../src/lib/statements/ownTransfers.js';

const BOG = 'GE11BG0000000000000001';
const TBC = 'GE22TB0000000000000002';
const OWN = new Set([BOG, TBC]);

let n = 0;
const line = (l: Partial<OwnLine> & Pick<OwnLine, 'direction' | 'amountTetri' | 'occurredOn' | 'account'>): OwnLine => ({
  id: `l${++n}`,
  bank: l.account === TBC ? 'tbc' : 'bog',
  grossTetri: null,
  feeTetri: null,
  payer: null,
  purpose: null,
  raw: '',
  ...l,
});

describe('money between the company’s own accounts (ADR-0028)', () => {
  it('reads an account as a statement writes it, and the accounts a text names', () => {
    expect(ibanOf(`${BOG}GEL`)).toBe(BOG);
    expect(ibanOf('GE22 TB00 0000 0000 0000 02')).toBe(TBC);
    expect(ibanOf(null)).toBeNull();
    expect(ibansIn(`Outgoing Transfer; Beneficiary: someone; Account: ${TBC}; Bank: TBC`)).toEqual([TBC]);
  });

  it('knows the company by the names banks give it', () => {
    expect(isCompany('E MOTION MOTORS LLC')).toBe(true);
    expect(isCompany('e-motion motors llc')).toBe(true);
    expect(isCompany('შპს ე-მოუშენ მოთორს')).toBe(true);
    expect(isCompany('shps e-moushen motors')).toBe(true);
    expect(isCompany('Sps e-mouSen moTors')).toBe(true);
    expect(isCompany('Nino Tushidze')).toBe(false);
    expect(isCompany('New Auto Motors 24/7')).toBe(false);
    expect(isCompany(null)).toBe(false);
  });

  it('a line says it is ours when it names another of our accounts, or the company is on its other side', () => {
    expect(ownSign(line({ direction: 'out', amountTetri: 50000, occurredOn: '2026-10-16', account: BOG, purpose: `Account: ${TBC}` }), OWN)).toBe('account:tb');
    // Its own account in its text is not a sign.
    expect(ownSign(line({ direction: 'in', amountTetri: 50000, occurredOn: '2026-10-16', account: BOG, raw: BOG }), OWN)).toBeNull();
    expect(ownSign(line({ direction: 'in', amountTetri: 50000, occurredOn: '2026-10-16', account: TBC, payer: 'E MOTION MOTORS LLC' }), OWN)).toBe('company');
    // A card settlement names the company as the merchant: it is customers' money.
    const card = line({ direction: 'in', amountTetri: 19700, occurredOn: '2026-10-08', account: TBC, payer: 'E MOTION MOTORS LLC', raw: 'Wallet/domestic/x | E MOTION MOTORS LLC, TBC BANK, Visa, 200.00, ' });
    expect(ownSign(card, OWN)).toBeNull();
    expect(ownSign(line({ direction: 'in', amountTetri: 15000, occurredOn: '2026-10-16', account: BOG, payer: 'Nino Tushidze' }), OWN)).toBeNull();
  });

  it('marks a transfer and its other half, which says nothing about itself', () => {
    const out = line({ direction: 'out', amountTetri: 50000, occurredOn: '2026-10-16', account: BOG, payer: 'E MOTION MOTORS LLC' });
    const back = line({ direction: 'in', amountTetri: 50000, occurredOn: '2026-10-17', account: TBC, payer: 'unknown sender' });
    const customer = line({ direction: 'in', amountTetri: 15000, occurredOn: '2026-10-16', account: TBC, payer: 'Nino Tushidze' });
    expect(ownTransfers([out, back, customer], OWN)).toEqual([
      { id: out.id, reason: 'company' },
      { id: back.id, reason: 'pair:bog:2026-10-16' },
    ]);
  });

  it('pairs only the other way, the same sum, another account, within three days — and leaves a tie to a person', () => {
    const out = line({ direction: 'out', amountTetri: 50000, occurredOn: '2026-10-16', account: BOG, purpose: `Account: ${TBC}` });
    const sameAccount = line({ direction: 'in', amountTetri: 50000, occurredOn: '2026-10-16', account: BOG });
    const otherSum = line({ direction: 'in', amountTetri: 49999, occurredOn: '2026-10-16', account: TBC });
    const tooLate = line({ direction: 'in', amountTetri: 50000, occurredOn: '2026-10-20', account: TBC });
    expect(ownTransfers([out, sameAccount, otherSum, tooLate], OWN).map((m) => m.id)).toEqual([out.id]);

    const a = line({ direction: 'in', amountTetri: 50000, occurredOn: '2026-10-15', account: TBC });
    const b = line({ direction: 'in', amountTetri: 50000, occurredOn: '2026-10-17', account: TBC });
    expect(ownTransfers([out, a, b], OWN).map((m) => m.id)).toEqual([out.id]);
    const c = line({ direction: 'in', amountTetri: 50000, occurredOn: '2026-10-16', account: TBC });
    expect(ownTransfers([out, a, b, c], OWN)).toContainEqual({ id: c.id, reason: 'pair:bog:2026-10-16' });
  });
});

describe.skipIf(!HAS_DB)('money between the company’s own accounts, in the queue (ADR-0028)', () => {
  it('a new line marks itself and its half; a person putting one back is the last word', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { markOwnTransfers } = await import('../src/lib/statements/ownTransfers.js');
    const day = new Date();
    const stmt = (bank: 'bog' | 'tbc', account: string) =>
      prisma.statement.create({ data: { bank, fileName: `test-${uniq()}.csv`, fileSha256: uniq(), account } });
    const bog = await stmt('bog', `${BOG}GEL`);
    const tbc = await stmt('tbc', TBC);
    const mk = (statementId: string, bank: 'bog' | 'tbc', direction: 'in' | 'out', payer: string | null) =>
      prisma.statementLine.create({
        data: { statementId, bank, naturalKey: `test-${uniq()}`, occurredOn: day, direction, amountTetri: 123456, payer, purpose: null, raw: 'test line', status: 'unmatched' },
      });
    const out = await mk(bog.id, 'bog', 'out', 'E MOTION MOTORS LLC');
    const back = await mk(tbc.id, 'tbc', 'in', null);

    expect(await markOwnTransfers()).toBeGreaterThanOrEqual(2);
    for (const id of [out.id, back.id]) {
      expect(await prisma.statementLine.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: 'ignored', resolution: 'own_transfer', matchedRule: 'own_transfer_auto', resolvedById: null });
    }

    // The set-aside list says it was found by itself, and a person can put it back.
    const owner = await loginAs('owner');
    const aside = json<{ lines: { id: string; rule: string | null; reason: string | null }[] }>(await call(owner, 'GET', '/api/statement-lines/aside'));
    expect(aside.lines.find((l) => l.id === back.id)).toMatchObject({ rule: 'own_transfer_auto' });
    expect((await call(owner, 'POST', `/api/statement-lines/${back.id}/restore`, {})).statusCode).toBe(200);
    await markOwnTransfers();
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: back.id } })).toMatchObject({ status: 'unmatched', resolution: null });

    // Coming in, «Между счетами» is a person's answer too.
    expect((await call(owner, 'POST', `/api/statement-lines/${back.id}/own-transfer`, {})).statusCode).toBe(200);
    expect(await prisma.statementLine.findUniqueOrThrow({ where: { id: back.id } })).toMatchObject({ status: 'ignored', resolution: 'own_transfer', matchedRule: 'own_transfer' });
  });
});
