import { createHash } from 'node:crypto';
import { parseBankAmount } from '@ev8/shared';

// Reading the two statement exports this company actually gets.
//
// Both were read from the real files in Google Drive on 14.09.2026 — the
// Bank of Georgia `StatementExport.csv` and the TBC
// `transactions_history_*.csv`. Nothing here is guessed from a manual: the
// column names, the date formats, the way a payer is written and the way a
// card payment states its commission are all copied off those files.
//
// CSV only. Both banks offer it, and an xlsx reader is a dependency worth
// adding when somebody actually has a file we cannot read.

export interface ParsedLine {
  naturalKey: string;
  /** The bank's document number, where the bank gives one (Bank of Georgia): one operation in a file and in the API alike. */
  docNo?: string | null;
  occurredOn: string; // ISO
  direction: 'in' | 'out';
  /** In minor units of the account's currency: tetri for lari, cents for an account in dollars or euros (migration 0073). */
  amountTetri: number;
  grossTetri: number | null;
  feeTetri: number | null;
  /** What Bank of Georgia says an operation of an account in another currency is in lari, where it says it: kept for reference, never summed. */
  bankGelTetri?: number | null;
  payer: string | null;
  purpose: string | null;
  raw: string;
  channel: 'transfer' | 'acquiring' | 'cash';
}

export interface ParsedStatement {
  bank: 'bog' | 'tbc';
  account: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  lines: ParsedLine[];
}

/**
 * A file this cannot take, and why in one of the API's words: not a statement
 * at all, or a statement of an account in another currency, which is not read
 * from a file yet.
 */
export class ParseError extends Error {
  constructor(
    message: string,
    readonly code: 'unreadable_statement' | 'foreign_statement' = 'unreadable_statement',
  ) {
    super(message);
  }
}

/** A tolerant CSV reader: quotes, embedded newlines, doubled quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\r') {
      /* the \n that follows ends the row */
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// A card payment, as either bank writes it into a line
// ---------------------------------------------------------------------------
//
// Bank of Georgia states the customer's sum and the commission (below), or
// writes only `Wallet/domestic MC cards` and credits the net.
//
// TBC settles its terminal as a transfer from the bank itself. The partner is
// a phrase, not a person — «Wallet/domestic/საერთაშორისო … ბარათებით თიბისის
// სავაჭრო ობიექტებში …» — and the description states what was paid by card:
//   `08/10/2026_ის ტრანზაქციის თანხები … E MOTION MOTORS LLC, TBC BANK, Visa, 200.00, SH074829,,V`
// with 197.00 credited. Read off the first TBC statement loaded on production
// (12.10.2026), where both such lines came in as transfers of 197 and 98.50.
//
// One function reads it for a parsed line and for a stored one alike: lines
// already in the database keep their raw text, and are read the same way.

const BOG_WALLET = /Wallet\/domestic MC cards/i;
const TBC_SETTLEMENT = /Wallet\/domestic\//i;
const TBC_STATED = /TBC BANK,\s*[A-Za-z ]+?,\s*(\d[\d.,]*)\s*,/i;

/** Is this incoming line a card payment — and what the bank says the customer paid, when it says. */
export function cardOf(l: { amountTetri: number; grossTetri: number | null; feeTetri: number | null; raw: string }): { grossTetri: number | null; feeTetri: number | null } | null {
  if (l.grossTetri != null) return { grossTetri: l.grossTetri, feeTetri: l.feeTetri };
  if (BOG_WALLET.test(l.raw)) return { grossTetri: null, feeTetri: null };
  if (!TBC_SETTLEMENT.test(l.raw)) return null;
  const stated = parseBankAmount(TBC_STATED.exec(l.raw)?.[1] ?? '');
  // The stated sum is what was paid only when it is the credited sum plus a fee a bank could have kept.
  const sound = stated != null && stated > l.amountTetri && stated - l.amountTetri <= stated / 10;
  return sound ? { grossTetri: stated, feeTetri: stated - l.amountTetri } : { grossTetri: null, feeTetri: null };
}

const DMY_DOT = /^(\d{2})\.(\d{2})\.(\d{4})$/; // BOG
const DMY_SLASH = /^(\d{2})\/(\d{2})\/(\d{4})/; // TBC, sometimes with a time after it

function isoFrom(text: string): string | null {
  const t = text.trim();
  const dot = DMY_DOT.exec(t);
  if (dot) return `${dot[3]}-${dot[2]}-${dot[1]}`;
  const slash = DMY_SLASH.exec(t);
  if (slash) return `${slash[3]}-${slash[2]}-${slash[1]}`;
  return null;
}

function hashKey(bank: string, parts: (string | number)[], seen: Map<string, number>): string {
  const base = createHash('sha256').update(`${bank}|${parts.join('|')}`).digest('hex').slice(0, 32);
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}:${n}`;
}

// ---------------------------------------------------------------------------
// Bank of Georgia
// ---------------------------------------------------------------------------
//
// A preamble names the account and the period, then a header row:
//   TariRi | sabuTis # | mokorespondento angariSi | debeti | krediti | kursi |
//   eqv.lari | operaciis Sinaarsi
// Rows whose first cell is a date are transactions; `brunva` (turnover),
// `naSTi` (balance) and `sawyisi naSTi` (opening balance) are summaries and
// are skipped — by their name, which stands where a transaction has its
// document number: the opening balance carries a date and a sum like any
// other row (the first statement loaded on production, 12.10.2026, came in
// with its opening balance of 352.05 as money received).
//
// The payer of an incoming transfer sits inside the free text after
// `gadmomricxavi:`; the recipient of an outgoing one after `mimRebi:`; the
// purpose after `daniSnuleba:`. That is the export of January 2026. By
// October the same file words a line in English, under the same headers:
//   `tankhis gadaritskhva: Incoming Transfer - Amount: GEL150.00; Sender: …;
//    Account: GE…; Bank: JSC Bank of Georgia BAGAGE22; Details: tankhis gadaritskhva`
// with `Beneficiary:` in an outgoing transfer and `Merchant:` in a payment by
// the company's own card. Both wordings are read.
//
// A card payment states both figures, which is better than we assumed:
//   `Tanxa:GEL 3200; sakomisio: GEL 48` — the customer paid 3200, the
//   acquirer kept 48, the account was credited 3152.

const BOG_PAYER = /(?:gadmomricxavi|Sender):\s*([^;]+)/i;
const BOG_RECIPIENT = /(?:mimRebi|Beneficiary|Merchant):\s*([^;]+)/i;
const BOG_PURPOSE = /(?:daniSnuleba|Details):\s*([^;]+)/i;
/** A summary row names itself where a transaction has its document number. */
const BOG_SUMMARY_ROW = /^(sawyisi\s+naSTi|naSTi|brunva|opening balance|closing balance|turnover)$/i;
const BOG_CARD_GROSS = /Tanxa:\s*GEL\s*([\d.,]+)/i;
const BOG_CARD_FEE = /sakomisio:\s*GEL\s*([\d.,]+)/i;

/**
 * What the text of a Bank of Georgia line says: who, what for, and whether it
 * is a card payment with both of its sums. The same text comes in the CSV's
 * last column and in the API's entry comment, and is read one way.
 */
export function readBogText(
  content: string,
  direction: 'in' | 'out',
): { payer: string | null; purpose: string | null; card: boolean; grossTetri: number | null; feeTetri: number | null } {
  const grossText = BOG_CARD_GROSS.exec(content)?.[1];
  const feeText = BOG_CARD_FEE.exec(content)?.[1];
  const stated = grossText != null && feeText != null;
  return {
    payer: (direction === 'in' ? BOG_PAYER : BOG_RECIPIENT).exec(content)?.[1]?.trim() ?? null,
    purpose: BOG_PURPOSE.exec(content)?.[1]?.trim() ?? null,
    // "Wallet/domestic MC cards" is a card payment too (B2-06): the account
    // was credited the net, and the gross is recovered from it.
    card: stated || BOG_WALLET.test(content),
    grossTetri: stated ? parseBankAmount(grossText) : null,
    feeTetri: stated ? parseBankAmount(feeText) : null,
  };
}

export function parseBog(text: string, opts: { fileName: string }): ParsedStatement {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => r[0]?.trim() === 'TariRi');
  if (headerAt < 0) throw new ParseError('This does not look like a Bank of Georgia export: no "TariRi" header row.');

  const preamble = rows.slice(0, headerAt).flat().join(' ');
  const account = /angariSis\s*#:\s*([A-Z0-9]+)/i.exec(preamble)?.[1] ?? null;
  // The account is written with its currency after it (`GE…BG…GEL`). A
  // statement of the company's dollar or euro account has the same columns,
  // and its cents would go in as tetri: such a file is refused until the
  // money in another currency is kept apart from the lari.
  const currency = /^GE\d{2}[A-Z]{2}\d{16}([A-Z]{3})$/i.exec(account ?? '')?.[1]?.toUpperCase();
  if (currency && currency !== 'GEL') {
    throw new ParseError(`This Bank of Georgia statement is of an account in ${currency}: only statements in lari are read from a file for now.`, 'foreign_statement');
  }
  const period = /periodi:\s*(\d{2}\.\d{2}\.\d{2,4})\s*-\s*(\d{2}\.\d{2}\.\d{2,4})/i.exec(preamble);
  const asIso = (d: string): string | null => {
    const parts = d.split('.');
    if (parts.length !== 3) return null;
    const year = parts[2].length === 2 ? `20${parts[2]}` : parts[2];
    return `${year}-${parts[1]}-${parts[0]}`;
  };

  const seen = new Map<string, number>();
  const lines: ParsedLine[] = [];
  for (const r of rows.slice(headerAt + 1)) {
    const occurredOn = isoFrom(r[0] ?? '');
    if (!occurredOn) continue; // brunva, naSTi, blank rows
    if (BOG_SUMMARY_ROW.test((r[1] ?? '').trim())) continue; // the opening balance: a date and a sum, and not a transaction
    const debit = parseBankAmount(r[3] ?? '');
    const credit = parseBankAmount(r[4] ?? '');
    const content = (r[7] ?? '').replace(/\s+/g, ' ').trim();
    const direction: 'in' | 'out' = credit && credit > 0 ? 'in' : 'out';
    const amountTetri = Math.abs((direction === 'in' ? credit : debit) ?? 0);
    if (amountTetri === 0) continue; // nothing moved

    const text = readBogText(content, direction);

    lines.push({
      naturalKey: hashKey('bog', [occurredOn, r[1] ?? '', r[3] ?? '', r[4] ?? '', content], seen),
      docNo: (r[1] ?? '').trim() || null,
      occurredOn,
      direction,
      amountTetri,
      grossTetri: text.grossTetri,
      feeTetri: text.feeTetri,
      payer: text.payer,
      purpose: text.purpose ?? content.slice(0, 200),
      raw: [r[0], r[1], r[2], r[3], r[4], r[7]].join(' | '),
      channel: text.card ? 'acquiring' : 'transfer',
    });
  }
  if (lines.length === 0) throw new ParseError(`No transactions found in ${opts.fileName}.`);
  return {
    bank: 'bog',
    account,
    periodFrom: period ? asIso(period[1]) : null,
    periodTo: period ? asIso(period[2]) : null,
    lines,
  };
}

// ---------------------------------------------------------------------------
// TBC
// ---------------------------------------------------------------------------
//
// Two header rows — Georgian, then English — and then the data. The English
// row is the one to read. The amount is signed, the payer is a column of its
// own ("Partner's Name", in Georgian script), and every row carries a
// Transaction ID, which is exactly the natural key this needs. A day's card
// payments come as one line per card scheme (`cardOf` above).

export function parseTbc(text: string, opts: { fileName: string }): ParsedStatement {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => r[0]?.trim() === 'Date' && r.some((c) => c.trim() === 'Transaction ID'));
  if (headerAt < 0) throw new ParseError('This does not look like a TBC export: no English header row.');
  const header = rows[headerAt].map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const iDate = col('Date');
  const iDesc = col('Description');
  const iAmount = col('Amount');
  const iCurrency = col('Currency');
  const iAccount = col('Account Number');
  const iPartner = col("Partner's Name");
  const iTxn = col('Transaction ID');

  const seen = new Map<string, number>();
  const lines: ParsedLine[] = [];
  let account: string | null = null;
  let from: string | null = null;
  let to: string | null = null;

  for (const r of rows.slice(headerAt + 1)) {
    const occurredOn = isoFrom(r[iDate] ?? '');
    if (!occurredOn) continue;
    if ((r[iCurrency] ?? 'GEL').trim().toUpperCase() !== 'GEL') continue; // one currency for now
    const signed = parseBankAmount(r[iAmount] ?? '');
    if (signed == null || signed === 0) continue;
    account ??= (r[iAccount] ?? '').trim() || null;
    if (!from || occurredOn < from) from = occurredOn;
    if (!to || occurredOn > to) to = occurredOn;

    const txn = (r[iTxn] ?? '').trim();
    const raw = [r[iDate], r[iDesc], r[iAmount], r[iPartner], txn].join(' | ');
    // The terminal's settlement is a card payment, with the customer's sum stated in it.
    const card = signed > 0 ? cardOf({ amountTetri: signed, grossTetri: null, feeTetri: null, raw }) : null;
    lines.push({
      naturalKey: txn ? `txn:${txn}` : hashKey('tbc', [occurredOn, r[iAmount] ?? '', r[iDesc] ?? ''], seen),
      occurredOn,
      direction: signed > 0 ? 'in' : 'out',
      amountTetri: Math.abs(signed),
      grossTetri: card?.grossTetri ?? null,
      feeTetri: card?.feeTetri ?? null,
      payer: (r[iPartner] ?? '').trim() || null,
      purpose: (r[iDesc] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
      raw,
      channel: card ? 'acquiring' : 'transfer',
    });
  }
  if (lines.length === 0) throw new ParseError(`No transactions found in ${opts.fileName}.`);
  return { bank: 'tbc', account, periodFrom: from, periodTo: to, lines };
}

/** Which bank wrote this file, by what is in it rather than by its name. */
export function parseStatement(text: string, opts: { fileName: string }): ParsedStatement {
  if (/\bTariRi\b/.test(text)) return parseBog(text, opts);
  if (/Transaction ID/.test(text)) return parseTbc(text, opts);
  throw new ParseError(
    'Unrecognised file. Expected a Bank of Georgia export (StatementExport.csv) or a TBC one (transactions_history_*.csv), as CSV.',
  );
}
