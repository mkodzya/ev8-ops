// Typed text in the reader's language (ADR-0042). Every text below is
// invented for the test; no name in it is a person's.
import { describe, expect, it } from 'vitest';
import {
  MAX_TRANSLATED_CHARS,
  NEVER_TRANSLATED_TABLES,
  TRANSLATED_EVENT_KINDS,
  TRANSLATED_JOURNAL_LINES,
  TRANSLATED_SOURCES,
  stockReasonText,
  translatable,
  translationFor,
} from '../src/typed.js';
import { GOODS_UNDONE_AT_ONCE, goodsCancelReason } from '../src/goods.js';

describe('what may be sent to the translator (Mika, 21.10.2026, answer A)', () => {
  it('lists only mopeds and repairs, and no table of customers, rentals, money, sales or purchases', () => {
    const tables = new Set(TRANSLATED_SOURCES.map((s) => s.split('.')[0]));
    expect([...tables].sort()).toEqual(
      ['audit_log', 'battery_inventories', 'battery_moves', 'service_jobs', 'service_parts', 'service_works', 'stock_moves', 'vehicle_events', 'vehicles', 'workshops'].sort(),
    );
    for (const never of NEVER_TRANSLATED_TABLES) expect(tables.has(never), never).toBe(false);
  });

  it('sends nothing no screen shows as text: a point’s note, a closed repair’s odometer reason', () => {
    expect(TRANSLATED_SOURCES).not.toContain('locations.note');
    expect(TRANSLATED_SOURCES).not.toContain('service_jobs.closed_odometer_reason');
  });

  it('takes no rental, sale or arrival reason of a moped, and no journal line about money or a customer', () => {
    for (const kind of ['pickup', 'return', 'sold', 'bought_back', 'arrived']) expect(TRANSLATED_EVENT_KINDS).not.toContain(kind);
    const entities = new Set(TRANSLATED_JOURNAL_LINES.map((l) => l.entityType));
    expect([...entities].sort()).toEqual(['battery', 'charger', 'service_job', 'vehicle']);
    const actions = TRANSLATED_JOURNAL_LINES.map((l) => l.action);
    for (const money of ['service.paid', 'service.unpaid', 'mechanic.payout', 'customer.merge', 'rental.update', 'sale.cancel']) expect(actions).not.toContain(money);
  });
});

describe('which texts are worth a translation', () => {
  it('takes a short note in any of the three languages', () => {
    expect(translatable('тормоза скрипят')).toBe(true);
    expect(translatable('brake pads worn')).toBe(true);
    expect(translatable('მუხრუჭი')).toBe(true);
    expect(translatable('ТО')).toBe(false); // two letters are a mark, not a sentence
  });

  it('leaves numbers, codes and lone record numbers as they are', () => {
    for (const code of ['SV-00012', 'EV-0012', 'R-00013', 'PO-00004', '12 300', 'TESTVIN0000000001', '350000000000001', '', '   ', null, undefined]) {
      expect(translatable(code), String(code)).toBe(false);
    }
    // A code inside a sentence is part of the sentence; the translator keeps it as written.
    expect(translatable('поменяли реле на EV-0012')).toBe(true);
  });

  it('never sends a rental’s or a sale’s words the code put into a moped’s record', () => {
    expect(translatable('return undone: клиент вернулся за мопедом')).toBe(false);
    expect(translatable('sale SL-00007 cancelled: покупатель передумал')).toBe(false);
    expect(translatable('bought back under SL-00007, needs work')).toBe(false);
  });

  it('never sends a goods sale’s words the code put on a part’s or a charger’s movement (ADR-0045)', () => {
    // A cancellation, the owner's reason or the seller's undo, as `goodsCancelReason` writes it.
    expect(translatable(goodsCancelReason('TS-00004', 'покупатель вернул товар (пример)'))).toBe(false);
    expect(translatable(goodsCancelReason('TS-00006', GOODS_UNDONE_AT_ONCE))).toBe(false);
    // A charger sold beyond the count is found first, with the owner's words behind the sale's number.
    expect(translatable('TS-00004: one more was in the box (example)')).toBe(false);
    // A repair's own words that only mention a goods sale are still a repair's.
    expect(translatable('поставили зеркало, проданное по TS-00004')).toBe(true);
  });

  it('never sends a rental’s number with its words: a hand-over, a swap, an act’s damage behind the rental’s number', () => {
    expect(translatable('hand-over R-00012')).toBe(false);
    expect(translatable('swap R-00012')).toBe(false);
    // A return's or a swap's act, as the repair it opened says what happened.
    expect(translatable('R-00012: царапина на крыле; ключ: погнут')).toBe(false);
    expect(translatable('R-00012: after return R-00012')).toBe(false);
    // A repair's own words that only mention a rental are still a repair's.
    expect(translatable('после аренды R-00012 стучит двигатель')).toBe(true);
  });

  it('skips a text too long to be a note', () => {
    expect(translatable('а'.repeat(MAX_TRANSLATED_CHARS) + ' б')).toBe(false);
    expect(translatable(`${'слово '.repeat(300)}`.trim())).toBe(true);
  });
});

describe('a stock movement’s reason, as the card shows it and the translator reads it', () => {
  it('drops the opening balance’s code and a receipt’s own order number', () => {
    expect(stockReasonText('initial')).toBeNull();
    expect(stockReasonText('PO-00004', { purchase: 'PO-00004' })).toBeNull();
    expect(stockReasonText('  ')).toBeNull();
    expect(stockReasonText(null)).toBeNull();
  });

  it('cuts the repair’s number off the front, since it is linked beside it', () => {
    expect(stockReasonText('SV-00012: купил механик', { job: 'SV-00012' })).toBe('купил механик');
    // Another repair's number is part of the words.
    expect(stockReasonText('SV-00012: купил механик', { job: 'SV-00099' })).toBe('SV-00012: купил механик');
    expect(stockReasonText('пересчёт полки')).toBe('пересчёт полки');
  });
});

describe('what a reader is shown', () => {
  const ru = { lang: 'ru' as const, ka: 'მუხრუჭები ჭრიალებს', ru: null, en: 'the brakes squeak' };

  it('shows the translation in the reader’s language, and the original to a reader of the original', () => {
    expect(translationFor(ru, 'ka')).toBe('მუხრუჭები ჭრიალებს');
    expect(translationFor(ru, 'en')).toBe('the brakes squeak');
    expect(translationFor(ru, 'ru')).toBeNull();
  });

  it('shows the original while nothing is translated, or the reader’s language is missing', () => {
    expect(translationFor(null, 'ka')).toBeNull();
    expect(translationFor(undefined, 'en')).toBeNull();
    expect(translationFor({ ...ru, en: '  ' }, 'en')).toBeNull();
  });

  it('translates a text in another language into all three', () => {
    const other = { lang: 'other' as const, ka: 'ka words', ru: 'ru words', en: 'en words' };
    expect(translationFor(other, 'ru')).toBe('ru words');
  });
});
