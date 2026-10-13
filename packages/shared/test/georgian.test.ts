import { describe, expect, it } from 'vitest';
import { hasGeorgian, latinTranscript, looseNames, nameMatches, nameSpellings, normaliseName, parseBankAmount, transliterateGeorgian } from '../src/index.js';

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
    expect(transliterateGeorgian('Zhuzhuna Japaradze')).toBe('Zhuzhuna Japaradze');
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

describe('a card that holds only the typed Latin name (12.10.2026)', () => {
  // Kommo holds names the way people type Georgian in Latin letters, and the
  // cards were made from Kommo. The names below are examples, nobody's.
  const typed = ['Khachapuridze Shota'];

  it('one loose form for the three spellings of a name', () => {
    expect(looseNames('ხაჭაპურიძე შოთა')).toEqual([['khachapuridze', 'shota']]);
    // Typed Latin gives its own reading first; read as a bank's letters it is something else.
    expect(looseNames('Khachapuridze Shota')[0]).toEqual(['khachapuridze', 'shota']);
    // A Bank of Georgia line: x is ხ, W is ჭ, Z is ძ, S is შ, T is თ.
    expect(looseNames('xaWapuriZe SoTa')).toContainEqual(['khachapuridze', 'shota']);
    // Sounds typed Latin cannot tell apart are one sound: თ and ტ, ქ კ and ყ, ფ and პ, ც and წ, ჩ and ჭ.
    expect(looseNames('თა ტა ქა კა ყა ფა პა ცა წა ჩა ჭა')).toEqual([['ta', 'ta', 'ka', 'ka', 'ka', 'pa', 'pa', 'tsa', 'tsa', 'cha', 'cha']]);
    expect(looseNames('Qeti Tsereteli')[0]).toEqual(looseNames('ქეთი წერეთელი')[0]);
    expect(looseNames('Zhuzhuna Japaradze')[0]).toEqual(looseNames('ჟუჟუნა ჯაფარაძე')[0]);
  });

  it('is found in a line of either bank', () => {
    // TBC writes Georgian, surname first as often as not.
    expect(nameMatches('ხაჭაპურიძე შოთა', typed)).toBe(true);
    expect(nameMatches('შოთა ხაჭაპურიძე', typed)).toBe(true);
    // Bank of Georgia writes its own transliteration inside the free text.
    expect(nameMatches('Private Transfer: gadmomricxavi: xaWapuriZe SoTa; angariSi: GE32', typed)).toBe(true);
    // And the other way round: a card typed in the bank's letters, a line in Georgian.
    expect(nameMatches('ჯაფარაძე ჟუჟუნა', ['JuJuna jafaraZe'])).toBe(true);
    expect(nameMatches('gadmomricxavi: jafaraZe JuJuna', ['Zhuzhuna Japaradze'])).toBe(true);
  });

  it('still needs the whole name: one shared word, or a near name, is nobody', () => {
    expect(nameMatches('gadmomricxavi: xaWapuriZe giorgi', typed)).toBe(false);
    expect(nameMatches('შოთა ბერიძე', typed)).toBe(false);
    expect(nameMatches('ხაჭაპური შოთა', typed)).toBe(false);
    expect(nameMatches('gadmomricxavi: xaWapuriZe', typed)).toBe(false);
    // A single-word name is matched by that word alone and by nothing longer.
    expect(nameMatches('gadmomricxavi: SoTa xaWapuriZe', ['Shota'])).toBe(false);
  });

  it('a name with no Georgian sounds in it is compared as it stands', () => {
    expect(nameMatches('AHMED YUSUF', ['Yusuf Ahmed'])).toBe(true);
    expect(nameMatches('AHMED YOUSEF', ['Yusuf Ahmed'])).toBe(false);
  });
});

describe('one form of a name on a card: Georgian, and its Latin transcript (Mika, 13.10.2026)', () => {
  // Every name here is invented.
  it('writes a Georgian name in Latin letters as a passport does, each word capitalised', () => {
    expect(latinTranscript('ნინო თუშიძე')).toBe('Nino Tushidze');
    expect(latinTranscript('ჟუჟუნა ჯაფარაძე')).toBe('Zhuzhuna Japaradze');
    // No apostrophes: the pairs a passport does not tell apart come out as one letter.
    expect(latinTranscript('ქეთი წერეთელი')).toBe('Keti Tsereteli');
    expect(latinTranscript('ჭაბუკა ხარაძე')).toBe('Chabuka Kharadze');
    expect(latinTranscript('ღვთისო ყაზბეგი')).toBe('Ghvtiso Qazbegi');
    // A double surname keeps its hyphen, and each half its capital.
    expect(latinTranscript('ანა ხარაზიშვილი-თუშიძე')).toBe('Ana Kharazishvili-Tushidze');
  });

  it('leaves what is not Georgian as it stands', () => {
    expect(latinTranscript('Nino Tushidze')).toBe('Nino Tushidze');
    expect(latinTranscript('შპს EV8 ჯგუფი 2')).toBe('Shps EV8 Jgupi 2');
    expect(latinTranscript('')).toBe('');
    expect([hasGeorgian('ნინო'), hasGeorgian('Nino'), hasGeorgian(null)]).toEqual([true, false, false]);
  });

  it('a card gets the spelling it lacks, and keeps the one that was typed', () => {
    // Typed in Georgian only: that is the Georgian spelling, and the transcript follows.
    expect(nameSpellings({ name: 'ნინო თუშიძე' })).toEqual({ nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidze' });
    // A Georgian spelling beside a Latin name: only the missing field is filled.
    expect(nameSpellings({ name: 'Tushidze Nino', nameKa: 'ნინო თუშიძე' })).toEqual({ nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidze' });
    // What a person typed stays, even when the transcript would say it differently.
    expect(nameSpellings({ name: 'ნინო თუშიძე', nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidse' })).toEqual({ nameKa: 'ნინო თუშიძე', nameLat: 'Nino Tushidse' });
    // Latin only: there is nothing to transcribe, and no Georgian is made up.
    expect(nameSpellings({ name: 'Nino Tushidze' })).toEqual({ nameKa: null, nameLat: null });
    expect(nameSpellings({ name: 'Nino Tushidze', nameKa: '  ', nameLat: ' ' })).toEqual({ nameKa: null, nameLat: null });
  });

  it('the transcript and the Georgian name are one name to the loose form', () => {
    for (const ka of ['ნინო თუშიძე', 'ჟუჟუნა ჯაფარაძე', 'ქეთი წერეთელი', 'ღვთისო ყაზბეგი']) {
      expect(looseNames(latinTranscript(ka))[0]).toEqual(looseNames(ka)[0]);
    }
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
