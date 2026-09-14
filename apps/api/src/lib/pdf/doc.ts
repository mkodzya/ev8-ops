import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';

// The drawing layer for company documents.
//
// Two faces, one family: Noto Sans for Latin and digits, Noto Sans Georgian
// for Georgian and the lari sign — neither covers the other, and the brand
// faces (Be Vietnam Pro, Inter) have no Georgian at all.
//
// So this file lays out text itself rather than handing a string to pdfkit:
// it splits every word into single-script runs, measures each run with the
// face that can draw it, breaks lines by hand and places the runs. pdfkit's
// own `continued` chunks were the first attempt and they do not survive
// centring — each chunk is centred on its own and they land on top of one
// another — nor do they keep the left margin after an indented field.

const here = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(here, '..', '..', 'assets', 'fonts');

export const FONT = { lat: 'lat', latB: 'latB', geo: 'geo', geoB: 'geoB' } as const;

/** Georgian (Mkhedruli, Mtavruli, Asomtavruli, Nuskhuri) and the lari sign. */
const GEORGIAN = /[Ⴀ-ჿᲐ-Ჿⴀ-⴯₾]/;

export interface Doc {
  pdf: PDFKit.PDFDocument;
  /** Text width between the margins. */
  width: number;
  left: number;
  bottom: number;
}

export function newDoc(title: string): Doc {
  const pdf = new PDFDocument({
    size: 'A4',
    margins: { top: 48, bottom: 56, left: 48, right: 48 },
    info: { Title: title, Author: 'E-Motion Motors LLC', Creator: 'EV8 Ops' },
    autoFirstPage: true,
    bufferPages: true, // page numbers are stamped once the body is laid out
  });
  pdf.registerFont(FONT.lat, readFileSync(join(fontsDir, 'NotoSans-Regular.ttf')));
  pdf.registerFont(FONT.latB, readFileSync(join(fontsDir, 'NotoSans-Bold.ttf')));
  pdf.registerFont(FONT.geo, readFileSync(join(fontsDir, 'NotoSansGeorgian-Regular.ttf')));
  pdf.registerFont(FONT.geoB, readFileSync(join(fontsDir, 'NotoSansGeorgian-Bold.ttf')));
  return {
    pdf,
    width: pdf.page.width - pdf.page.margins.left - pdf.page.margins.right,
    left: pdf.page.margins.left,
    bottom: pdf.page.height - pdf.page.margins.bottom,
  };
}

export function finish(doc: Doc): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.pdf.on('data', (c: Buffer) => chunks.push(c));
    doc.pdf.on('end', () => resolve(Buffer.concat(chunks)));
    doc.pdf.on('error', reject);
    doc.pdf.end();
  });
}

interface Run {
  font: string;
  text: string;
  w: number;
}

export interface TextOpts {
  bold?: boolean;
  size?: number;
  color?: string;
  align?: 'left' | 'center' | 'right';
  width?: number;
  x?: number;
  y?: number;
  lineGap?: number;
}

function faces(bold: boolean): { geo: string; lat: string } {
  return bold ? { geo: FONT.geoB, lat: FONT.latB } : { geo: FONT.geo, lat: FONT.lat };
}

/** One word split into single-script runs, each measured with its own face. */
function measureWord(doc: Doc, word: string, size: number, bold: boolean): Run[] {
  const f = faces(bold);
  const runs: Run[] = [];
  for (const ch of word) {
    const font = GEORGIAN.test(ch) ? f.geo : f.lat;
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.text += ch;
    else runs.push({ font, text: ch, w: 0 });
  }
  for (const r of runs) r.w = doc.pdf.font(r.font).fontSize(size).widthOfString(r.text);
  return runs;
}

function lineHeight(doc: Doc, size: number, lineGap: number): number {
  const a = doc.pdf.font(FONT.lat).fontSize(size).currentLineHeight(true);
  const b = doc.pdf.font(FONT.geo).fontSize(size).currentLineHeight(true);
  return Math.max(a, b) + lineGap;
}

interface Line {
  runs: Run[];
  w: number;
}

/** Greedy line breaking over words that may each be mixed-script. */
function layout(doc: Doc, text: string, size: number, bold: boolean, width: number): Line[] {
  const lines: Line[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/).filter((w) => w !== '');
    let cur: Line = { runs: [], w: 0 };
    for (const word of words) {
      const runs = measureWord(doc, word, size, bold);
      const w = runs.reduce((n, r) => n + r.w, 0);
      const blank = /^\s+$/.test(word);
      if (blank && cur.runs.length === 0) continue; // no leading space on a new line
      if (cur.w + w > width && cur.runs.length > 0) {
        // A trailing space never goes to the next line.
        if (blank) continue;
        lines.push(cur);
        cur = { runs: [], w: 0 };
      }
      cur.runs.push(...runs);
      cur.w += w;
    }
    lines.push(cur);
  }
  return lines;
}

/** Write a mixed-script string, wrapping and aligning it by hand. */
export function write(doc: Doc, text: string, opts: TextOpts = {}): void {
  const size = opts.size ?? 9;
  const bold = opts.bold ?? false;
  const lineGap = opts.lineGap ?? 1.5;
  const width = opts.width ?? doc.width;
  const x0 = opts.x ?? doc.left;
  if (opts.y != null) doc.pdf.y = opts.y;
  const lh = lineHeight(doc, size, lineGap);
  doc.pdf.fillColor(opts.color ?? '#0b0b0b');
  for (const line of layout(doc, text, size, bold, width)) {
    if (doc.pdf.y + lh > doc.bottom) doc.pdf.addPage();
    // pdfkit advances y on every text() call, once per run. The baseline is
    // taken before the runs are drawn and restored after, so a line of four
    // runs moves down one line and not four.
    const y = doc.pdf.y;
    let x = opts.align === 'center' ? x0 + (width - line.w) / 2 : opts.align === 'right' ? x0 + width - line.w : x0;
    for (const run of line.runs) {
      // No `width` here, deliberately: pdfkit routes any call that carries
      // one through its LineWrapper — which re-wraps the run and breaks the
      // page on its own — and `lineBreak: false` does not switch that off.
      // These runs are already laid out; they only need placing.
      doc.pdf.font(run.font).fontSize(size).text(run.text, x, y, { lineBreak: false });
      x += run.w;
    }
    doc.pdf.y = y + lh;
  }
  doc.pdf.x = doc.left;
}

/** How tall a string will be at this width, without drawing it. */
export function heightOf(doc: Doc, text: string, opts: TextOpts = {}): number {
  const size = opts.size ?? 9;
  const lineGap = opts.lineGap ?? 1.5;
  const lines = layout(doc, text, size, opts.bold ?? false, opts.width ?? doc.width);
  return lines.length * lineHeight(doc, size, lineGap);
}

/** Vertical space, in multiples of a 9pt line. */
export function gap(doc: Doc, lines = 1): void {
  doc.pdf.y += 11 * lines;
}

/** Start a new page when what comes next does not fit on this one. */
export function keepTogether(doc: Doc, needed: number): void {
  if (doc.pdf.y + needed > doc.bottom) doc.pdf.addPage();
}
