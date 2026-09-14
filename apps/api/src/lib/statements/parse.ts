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
  occurredOn: string; // ISO
  direction: 'in' | 'out';
  amountTetri: number;
  grossTetri: number | null;
  feeTetri: number | null;
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

export class ParseError extends Error {}

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
// are skipped.
//
// The payer of an incoming transfer sits inside the free text after
// `gadmomricxavi:`; the recipient of an outgoing one after `mimRebi:`; the
// purpose after `daniSnuleba:`.
//
// A card payment states both figures, which is better than we assumed:
//   `Tanxa:GEL 3200; sakomisio: GEL 48` — the customer paid 3200, the
//   acquirer kept 48, the account was credited 3152.

const BOG_PAYER = /gadmomricxavi:\s*([^;]+)/i;
const BOG_RECIPIENT = /mimRebi:\s*([^;]+)/i;
const BOG_PURPOSE = /daniSnuleba:\s*([^;]+)/i;
const BOG_CARD_GROSS = /Tanxa:\s*GEL\s*([\d.,]+)/i;
const BOG_CARD_FEE = /sakomisio:\s*GEL\s*([\d.,]+)/i;

export function parseBog(text: string, opts: { fileName: string }): ParsedStatement {
  const rows = parseCsv(text);
  const headerAt = rows.findIndex((r) => r[0]?.trim() === 'TariRi');
  if (headerAt < 0) throw new ParseError('This does not look like a Bank of Georgia export: no "TariRi" header row.');

  const preamble = rows.slice(0, headerAt).flat().join(' ');
  const account = /angariSis\s*#:\s*([A-Z0-9]+)/i.exec(preamble)?.[1] ?? null;
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
    if (!occurredOn) continue; // brunva, naSTi, sawyisi naSTi, blank rows
    const debit = parseBankAmount(r[3] ?? '');
    const credit = parseBankAmount(r[4] ?? '');
    const content = (r[7] ?? '').replace(/\s+/g, ' ').trim();
    const direction: 'in' | 'out' = credit && credit > 0 ? 'in' : 'out';
    const amountTetri = Math.abs((direction === 'in' ? credit : debit) ?? 0);
    if (amountTetri === 0) continue; // the opening-balance row and its kin

    const grossText = BOG_CARD_GROSS.exec(content)?.[1];
    const feeText = BOG_CARD_FEE.exec(content)?.[1];
    const isCard = grossText != null && feeText != null;
    const payer = (direction === 'in' ? BOG_PAYER : BOG_RECIPIENT).exec(content)?.[1]?.trim() ?? null;

    lines.push({
      naturalKey: hashKey('bog', [occurredOn, r[1] ?? '', r[3] ?? '', r[4] ?? '', content], seen),
      occurredOn,
      direction,
      amountTetri,
      grossTetri: isCard ? parseBankAmount(grossText) : null,
      feeTetri: isCard ? parseBankAmount(feeText) : null,
      payer,
      purpose: BOG_PURPOSE.exec(content)?.[1]?.trim() ?? content.slice(0, 200),
      raw: [r[0], r[1], r[2], r[3], r[4], r[7]].join(' | '),
      channel: isCard ? 'acquiring' : 'transfer',
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
// Transaction ID, which is exactly the natural key this needs.

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
    lines.push({
      naturalKey: txn ? `txn:${txn}` : hashKey('tbc', [occurredOn, r[iAmount] ?? '', r[iDesc] ?? ''], seen),
      occurredOn,
      direction: signed > 0 ? 'in' : 'out',
      amountTetri: Math.abs(signed),
      grossTetri: null,
      feeTetri: null,
      payer: (r[iPartner] ?? '').trim() || null,
      purpose: (r[iDesc] ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
      raw: [r[iDate], r[iDesc], r[iAmount], r[iPartner], txn].join(' | '),
      channel: 'transfer',
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
