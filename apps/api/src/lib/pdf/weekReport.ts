import { tokens } from '@ev8/shared';
import { COMPANY, dmy, gel } from './company.js';
import { finish, gap, newDoc, write, type Doc } from './doc.js';
import { h1, rule, stampPages, type Bi } from './layout.js';

// The week on one page, for the meeting Mika and Kardu have (wave 6 §3.1,
// crit. 4). Same paper as the contract and the sale: Noto Sans Georgian
// first at full size, the English underneath in grey, the brand's own ink —
// nothing here picks a colour of its own (ADR-0003, guard-code rule 1).
//
// It is a report, not a document anybody signs: no signature block, no
// clauses. What it must do is fit on one page and be readable in Georgian,
// so the rows are a two-column list rather than a table, and a value that
// does not exist is written out in words instead of being printed as 0.

const EN = tokens.grey;

export interface WeekRow {
  label: Bi;
  /** Already formatted — the API decides what a missing figure reads as. */
  value: string;
  /** Money going out, printed in the critical ink. */
  negative?: boolean;
  /** "нет данных" and the like: quiet, so a reader does not take it for a number. */
  absent?: boolean;
}

export interface WeekDocData {
  from: string;
  to: string;
  /** The day the "as of" figures were taken on, when it is not the last day of the week. */
  asOf: string | null;
  groups: { title: Bi; rows: WeekRow[] }[];
  /** One quiet line at the foot: what the page does not claim to cover. */
  notes: string[];
}

function row(doc: Doc, r: WeekRow): void {
  const labelW = doc.width * 0.62;
  const valueX = doc.left + labelW + 10;
  const valueW = doc.width - labelW - 10;
  const top = doc.pdf.y;
  write(doc, r.label.ka, { size: 9.5, x: doc.left, width: labelW });
  write(doc, r.label.en, { size: 7.5, color: EN, x: doc.left, width: labelW });
  const afterLabel = doc.pdf.y;
  write(doc, r.value, {
    bold: !r.absent,
    size: r.absent ? 8.5 : 10.5,
    color: r.absent ? EN : r.negative ? tokens.crit : tokens.ink,
    align: 'right',
    x: valueX,
    y: top,
    width: valueW,
  });
  const bottom = Math.max(afterLabel, doc.pdf.y);
  doc.pdf.moveTo(doc.left, bottom + 1).lineTo(doc.left + doc.width, bottom + 1).lineWidth(0.4).strokeColor(tokens.line).stroke();
  doc.pdf.y = bottom;
  gap(doc, 0.35);
}

export async function renderWeekReport(d: WeekDocData): Promise<Buffer> {
  const doc = newDoc(`EV8 ${d.from} — ${d.to}`);

  h1(doc, { ka: 'კვირის ციფრები', en: 'The week in figures' });
  write(doc, `${dmy(d.from)} — ${dmy(d.to)}`, { align: 'center', size: 9.5, bold: true });
  if (d.asOf) {
    write(doc, `მონაცემები ${dmy(d.asOf)}-ის მდგომარეობით · as at ${dmy(d.asOf)}`, { align: 'center', size: 7, color: EN });
  }
  rule(doc);

  for (const g of d.groups) {
    gap(doc, 0.3);
    write(doc, g.title.ka, { size: 10, bold: true });
    write(doc, g.title.en, { size: 7.5, bold: true, color: EN });
    gap(doc, 0.25);
    for (const r of g.rows) row(doc, r);
  }

  if (d.notes.length > 0) {
    gap(doc, 0.5);
    for (const n of d.notes) write(doc, n, { size: 7, color: EN });
  }

  stampPages(doc, `${COMPANY.nameEn} · ${dmy(d.from)} — ${dmy(d.to)}`);
  return finish(doc);
}

/** Whole GEL the way the paper writes it, with the sign a reader expects. */
export const money = (tetri: number, opts: { negative?: boolean } = {}): string =>
  `${opts.negative && tetri > 0 ? '−' : ''}${gel(tetri)} ₾`;
