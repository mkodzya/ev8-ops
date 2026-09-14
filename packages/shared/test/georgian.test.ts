import { describe, expect, it } from 'vitest';
import { nameMatches, normaliseName, parseBankAmount, transliterateGeorgian } from '../src/index.js';

describe('the transliteration Georgian banks use', () => {
  // Every pair below is lifted from a real Bank of Georgia statement export.
  it('turns Georgian into the spelling a BOG statement line carries', () => {
    expect(transliterateGeorgian('ჩარიცხვა')).toBe('Caricxva');
    expect(transliterateGeorgian('დანიშნულება')).toBe('daniSnuleba');
    expect(transliterateGeorgian('გადმომრიცხავი')).toBe('gadmomricxavi');
    expect(transliterateGeorgian('მიმღები')).toBe('mimRebi');
    expect(transliterateGeorgian('ნაშთი')).toBe('naSTi');
    expect(transliterateGeorgian('საწყისი')).toBe('sawyisi');
    expect(transliterateGeorgian('კუხიანიძე კარდუ')).toBe('kuxianiZe kardu');
    expect(transliterateGeorgian('შპს ე-მოუშენ მოთორს')).toBe('Sps e-mouSen moTors');
  });

  it('leaves text that is already Latin alone', () => {
    expect(transliterateGeorgian('Vaja Jafaridze')).toBe('Vaja Jafaridze');
  });

  it('folds a name to comparable words and drops one-letter noise', () => {
    expect(normaliseName('კუხიანიძე კარდუ')).toEqual(['kuxianiZe'.toLowerCase(), 'kardu']);
    expect(normaliseName('შპს ე-მოუშენ მოთორს')).toEqual(['sps', 'mouSen'.toLowerCase(), 'moTors'.toLowerCase()]);
  });
});

describe('matching a payer to a customer', () => {
  const kardu = ['კუხიანიძე კარდუ', 'Kardu Kukhianidze'];

  it('finds the customer however the bank spelled them', () => {
    // BOG writes the transliteration, TBC writes Georgian.
    expect(nameMatches('Private Transfer: gadmomricxavi: kuxianiZe kardu; angariSi: GE32', kardu)).toBe(true);
    expect(nameMatches('კუხიანიძე კარდუ', kardu)).toBe(true);
    expect(nameMatches('KARDU KUKHIANIDZE', kardu)).toBe(true);
  });

  it('one shared word is not a match', () => {
    // A different Kardu, or a different Kukhianidze, is a different person.
    expect(nameMatches('gadmomricxavi: kardu beriZe', kardu)).toBe(false);
    expect(nameMatches('gadmomricxavi: nino kuxianiZe', kardu)).toBe(false);
  });

  it('a company matches on its own single word', () => {
    expect(nameMatches('gadmomricxavi: Polaris', ['Polaris'])).toBe(false); // extra words in the line
    expect(nameMatches('Polaris', ['Polaris'])).toBe(true);
  });

  it('says no when there is nothing to go on', () => {
    expect(nameMatches('', kardu)).toBe(false);
    expect(nameMatches('Wallet/domestic MC cards', kardu)).toBe(false);
  });
});

describe('amounts as banks write them', () => {
  it('reads both separators and both signs', () => {
    expect(parseBankAmount('1,350.00')).toBe(135000); // BOG
    expect(parseBankAmount('3152.0')).toBe(315200); // BOG
    expect(parseBankAmount('-100.0')).toBe(-10000); // TBC, an expense
    expect(parseBankAmount('315,20')).toBe(31520); // a comma as the decimal point
    expect(parseBankAmount(' 120.0 ')).toBe(12000);
  });

  it('refuses what is not an amount', () => {
    expect(parseBankAmount('naSTi')).toBeNull();
    expect(parseBankAmount('')).toBeNull();
    expect(parseBankAmount('GEL')).toBeNull();
  });
});
