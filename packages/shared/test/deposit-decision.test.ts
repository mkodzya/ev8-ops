import { describe, expect, it } from 'vitest';
import { NO_DECISION, decisionBody, decisionOk, keptOf, needsConfirming, type DecisionState } from '../src/index.js';

const HELD = 18000; // 180 ₾

const d = (over: Partial<DecisionState> = {}): DecisionState => ({ ...NO_DECISION, ...over });

// Wave 3 §3.4–3.5, B5-02. The path of a return that keeps part of a deposit
// had no test at all until QA-W6-16: the rules lived in the screen that draws
// them.
describe('what an owner decides about a deposit', () => {
  it('has no default: nothing is chosen until somebody chooses', () => {
    expect(keptOf(d(), HELD)).toBeNull();
    expect(decisionOk(d(), HELD)).toBe(false);
    expect(needsConfirming(d(), HELD)).toBe(false);
  });

  it('gives it all back', () => {
    const back = d({ action: 'return_all' });
    expect(keptOf(back, HELD)).toBe(0);
    expect(decisionOk(back, HELD)).toBe(true);
    expect(decisionBody(back, HELD)).toEqual({ action: 'return_all' });
    // Nothing stays with the company, so nothing is asked twice.
    expect(needsConfirming(back, HELD)).toBe(false);
  });

  it('keeps part, and asks before it does', () => {
    const part = d({ action: 'keep_part', amount: '15', grounds: ['cleaning'], reason: 'мойка' });
    expect(keptOf(part, HELD)).toBe(1500);
    expect(decisionOk(part, HELD)).toBe(true);
    expect(needsConfirming(part, HELD)).toBe(true);
    expect(decisionBody(part, HELD)).toEqual({ action: 'withhold', withheldTetri: 1500, grounds: ['cleaning'], reason: 'мойка' });
  });

  it('keeps all of it, and asks before it does', () => {
    const all = d({ action: 'keep_all', grounds: ['moped_damage'], reason: 'царапина на щитке' });
    expect(keptOf(all, HELD)).toBe(HELD);
    expect(decisionOk(all, HELD)).toBe(true);
    expect(needsConfirming(all, HELD)).toBe(true);
    expect(decisionBody(all, HELD)).toEqual({ action: 'withhold', withheldTetri: HELD, grounds: ['moped_damage'], reason: 'царапина на щитке' });
  });

  it('refuses to keep money without grounds or without a reason (B5-02)', () => {
    expect(decisionOk(d({ action: 'keep_part', amount: '15', reason: 'мойка' }), HELD)).toBe(false);
    expect(decisionOk(d({ action: 'keep_part', amount: '15', grounds: ['cleaning'] }), HELD)).toBe(false);
    expect(decisionOk(d({ action: 'keep_part', amount: '15', grounds: ['cleaning'], reason: '   ' }), HELD)).toBe(false);
  });

  it('refuses more than the deposit holds, and a "part" of nothing', () => {
    expect(decisionOk(d({ action: 'keep_part', amount: '200', grounds: ['cleaning'], reason: 'мойка' }), HELD)).toBe(false);
    expect(decisionOk(d({ action: 'keep_part', amount: '0', grounds: ['cleaning'], reason: 'мойка' }), HELD)).toBe(false);
    expect(decisionOk(d({ action: 'keep_part', amount: 'пятнадцать', grounds: ['cleaning'], reason: 'мойка' }), HELD)).toBe(false);
  });

  it('reads a sum as a person types it, spaces, comma and currency included', () => {
    const typed = (amount: string) => keptOf(d({ action: 'keep_part', amount }), HELD);
    expect(typed('15')).toBe(1500);
    expect(typed('15,50')).toBe(1550);
    expect(typed('15.50 ₾')).toBe(1550);
    // The way the product itself writes a sum: no-break spaces throughout.
    expect(typed('1 234.56 ₾')).toBe(123456);
  });

  it('hands the rest to somebody else only with a name and a why', () => {
    const toOther = { action: 'keep_part' as const, amount: '15', grounds: ['cleaning' as const], reason: 'мойка', toOther: true };
    expect(decisionOk(d({ ...toOther }), HELD)).toBe(false);
    expect(decisionOk(d({ ...toOther, toName: 'Брат' }), HELD)).toBe(false);
    expect(decisionOk(d({ ...toOther, toName: 'Брат', toReason: 'по доверенности' }), HELD)).toBe(true);
    expect(decisionBody(d({ ...toOther, toName: 'Брат', toReason: 'по доверенности' }), HELD)).toMatchObject({
      returnedTo: 'Брат',
      returnedToReason: 'по доверенности',
    });
  });

  it('keeping nothing is a return, whichever button was pressed', () => {
    expect(decisionBody(d({ action: 'keep_part', amount: '0' }), HELD)).toEqual({ action: 'return_all' });
  });
});
