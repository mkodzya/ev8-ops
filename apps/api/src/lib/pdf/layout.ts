import { gap, heightOf, keepTogether, write, type Doc } from './doc.js';

// Bilingual blocks. Georgian carries the legal weight and sits first at full
// size; the English translation follows in grey, smaller, and is marked as
// unofficial at the head of the document. Stacked rather than two columns: a
// Georgian clause and its translation are rarely the same length, and columns
// would leave one side full of holes.

export interface Bi {
  ka: string;
  en: string;
}

const EN = '#5d6b5d';
const RULE = '#dbe4de';

export function h1(doc: Doc, t: Bi): void {
  write(doc, t.ka, { bold: true, size: 15, align: 'center' });
  write(doc, t.en, { size: 9.5, align: 'center', color: EN });
  gap(doc, 0.6);
}

export function h2(doc: Doc, t: Bi): void {
  // A heading never ends a page on its own: it is kept with the two lines
  // that follow it. Measured rather than guessed — a fixed guard pushed
  // whole clauses onto fresh pages and left two of five nearly empty.
  keepTogether(doc, heightOf(doc, t.ka, { size: 10.5, bold: true }) + heightOf(doc, t.en, { size: 8.5, bold: true }) + 28);
  gap(doc, 0.4);
  write(doc, t.ka, { bold: true, size: 10.5 });
  write(doc, t.en, { bold: true, size: 8.5, color: EN });
  gap(doc, 0.15);
}

export function para(doc: Doc, t: Bi, opts: { indent?: number } = {}): void {
  // No page guard: a long clause is allowed to break across pages, line by
  // line, which is what `write` already does. Only blocks that make no sense
  // split — a heading, a field, a signature — are guarded.
  const x = doc.left + (opts.indent ?? 0);
  const w = doc.width - (opts.indent ?? 0);
  write(doc, t.ka, { size: 9, x, width: w });
  if (t.en) write(doc, t.en, { size: 8, color: EN, x, width: w });
  gap(doc, 0.35);
}

export function bullet(doc: Doc, t: Bi): void {
  const indent = 13;
  const w = doc.width - indent;
  // The dot and the first line must not be separated; the rest may flow.
  keepTogether(doc, 24);
  doc.pdf.circle(doc.left + 3.5, doc.pdf.y + 5, 1.7).fillColor('#0b0b0b').fill();
  write(doc, t.ka, { size: 9, x: doc.left + indent, width: w });
  write(doc, t.en, { size: 8, color: EN, x: doc.left + indent, width: w });
  gap(doc, 0.3);
}

/**
 * A filled field: the label in both languages on the left, the value on the
 * right, on a rule. The value is what the paper form leaves blank — here it
 * is always printed, because a document with a blank to fill in by hand is
 * the thing this replaces (RNT-08).
 */
export function field(doc: Doc, t: Bi, value: string): void {
  const labelW = doc.width * 0.42;
  const valueX = doc.left + labelW + 10;
  const valueW = doc.width - labelW - 10;
  const hLabel = heightOf(doc, t.ka, { width: labelW }) + heightOf(doc, t.en, { size: 7.5, width: labelW });
  const hValue = heightOf(doc, value || '—', { size: 9.5, bold: true, width: valueW });
  keepTogether(doc, Math.max(hLabel, hValue) + 8);

  const top = doc.pdf.y;
  write(doc, t.ka, { size: 9, x: doc.left, width: labelW });
  write(doc, t.en, { size: 7.5, color: EN, x: doc.left, width: labelW });
  const afterLabel = doc.pdf.y;
  write(doc, value || '—', { bold: true, size: 9.5, x: valueX, y: top, width: valueW });
  const bottom = Math.max(afterLabel, doc.pdf.y);
  doc.pdf
    .moveTo(valueX, bottom + 1)
    .lineTo(doc.left + doc.width, bottom + 1)
    .lineWidth(0.4)
    .strokeColor(RULE)
    .stroke();
  doc.pdf.y = bottom;
  gap(doc, 0.4);
}

/** A checkbox drawn rather than typed: no font here carries a tick mark. */
export function check(doc: Doc, on: boolean, t: Bi, note?: string): void {
  const box = 9;
  const indent = box + 9;
  const w = doc.width - indent;
  const ka = t.ka + (note ? ` — ${note}` : '');
  // The box and its label stay together; a long note may wrap onward.
  keepTogether(doc, 26);
  const top = doc.pdf.y;
  doc.pdf.rect(doc.left + 1, top + 1.5, box, box).lineWidth(0.7).strokeColor('#0b0b0b').stroke();
  if (on) {
    doc.pdf
      .moveTo(doc.left + 3, top + 6)
      .lineTo(doc.left + 5, top + 8.5)
      .lineTo(doc.left + 8.5, top + 3.2)
      .lineWidth(1.3)
      .strokeColor('#0b0b0b')
      .stroke();
  }
  write(doc, ka, { size: 9, x: doc.left + indent, y: top, width: w });
  if (t.en) write(doc, t.en, { size: 7.5, color: EN, x: doc.left + indent, width: w });
  gap(doc, 0.15);
}

export function rule(doc: Doc): void {
  gap(doc, 0.3);
  doc.pdf.moveTo(doc.left, doc.pdf.y).lineTo(doc.left + doc.width, doc.pdf.y).lineWidth(0.5).strokeColor(RULE).stroke();
  gap(doc, 0.5);
}

/** Two signature lines side by side, named underneath. */
export function signatures(doc: Doc, left: Bi & { name: string }, right: Bi & { name: string }): void {
  keepTogether(doc, 84);
  gap(doc, 0.7);
  const colW = (doc.width - 32) / 2;
  const top = doc.pdf.y;
  const xs = [doc.left, doc.left + colW + 32];
  const sides = [left, right];
  let maxY = top;
  for (let i = 0; i < 2; i++) {
    doc.pdf.y = top;
    write(doc, sides[i].ka, { size: 9, bold: true, x: xs[i], width: colW });
    write(doc, sides[i].en, { size: 7.5, color: EN, x: xs[i], width: colW });
    const lineY = top + 38;
    doc.pdf.moveTo(xs[i], lineY).lineTo(xs[i] + colW, lineY).lineWidth(0.6).strokeColor('#0b0b0b').stroke();
    write(doc, sides[i].name, { size: 9, x: xs[i], y: lineY + 5, width: colW });
    maxY = Math.max(maxY, doc.pdf.y);
  }
  doc.pdf.y = maxY;
}

/** The company line and page numbers, stamped after the body is laid out. */
export function stampPages(doc: Doc, footer: string): void {
  const range = doc.pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.pdf.switchToPage(i);
    const y = doc.pdf.page.height - doc.pdf.page.margins.bottom + 20;
    const keep = doc.bottom;
    doc.bottom = doc.pdf.page.height; // the footer sits below the text frame
    write(doc, footer, { size: 7, color: '#7a827a', x: doc.left, y, width: doc.width });
    write(doc, `${i - range.start + 1} / ${range.count}`, { size: 7, color: '#7a827a', x: doc.left, y, width: doc.width, align: 'right' });
    doc.bottom = keep;
  }
}
