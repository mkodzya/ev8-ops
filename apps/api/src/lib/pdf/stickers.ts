import { fleetNumber, tokens } from '@ev8/shared';
import qrcode from 'qrcode-generator';
import { finish, newDoc, write, type Doc } from './doc.js';

// The moped stickers (meeting of Mika and Kardu, 14.10.2026; variant В1 chosen
// by Mika on 15.10.2026, `docs/redesign/prototypes/moped-sticker-options.html`):
// an A4 sheet of 24 labels, 70 × 37 mm, three across and eight down — the
// common self-adhesive sheet, or plain paper and scissors. Each label carries
// the fleet number large, a QR code that opens the moped's card in EV8 Ops,
// the model and the tail of the VIN for the mechanic to check, and — once an
// owner has set it — the telephone a customer calls with a breakdown, in
// Georgian and English. The logo is not drawn: it is built with masks, which
// the PDF layer cannot draw, and the brand book forbids redrawing it.

const MM = 72 / 25.4;
const COLS = 3;
const ROWS = 8;
const W = 70 * MM;
const H = 37 * MM;
const PAD = 3 * MM;
const QR = 27 * MM;

export interface StickerVehicle {
  fleetNo: number;
  model: string;
  vin: string;
}

export interface StickerSheet {
  /** Where the QR leads, e.g. https://ops.ev8.ge — the stand that printed it. */
  origin: string;
  phone: string | null;
  vehicles: StickerVehicle[];
}

/** The QR's dark modules as squares, a quiet zone of two modules around them. */
function drawQr(doc: Doc, text: string, x: number, y: number, size: number): void {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const cell = size / (n + 4);
  doc.pdf.save().rect(x, y, size, size).fill(tokens.surface);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (q.isDark(r, c)) doc.pdf.rect(x + (c + 2) * cell, y + (r + 2) * cell, cell, cell);
    }
  }
  doc.pdf.fill(tokens.ink).restore();
}

export function stickerUrl(origin: string, fleetNo: number): string {
  return `${origin}/m/${fleetNumber(fleetNo)}`;
}

export async function renderStickers(s: StickerSheet): Promise<Buffer> {
  const doc = newDoc('EV8 — მოპედების სტიკერები / Moped stickers');
  // Stickers are placed, not flowed: nothing may push a label to a new page.
  doc.bottom = doc.pdf.page.height;
  const top = (doc.pdf.page.height - ROWS * H) / 2;
  const left = (doc.pdf.page.width - COLS * W) / 2;

  s.vehicles.forEach((v, i) => {
    const slot = i % (COLS * ROWS);
    if (i > 0 && slot === 0) doc.pdf.addPage();
    const x = left + (slot % COLS) * W;
    const y = top + Math.floor(slot / COLS) * H;
    // A hairline to cut along on plain paper; on a label sheet it falls on the edge.
    doc.pdf.save().lineWidth(0.3).strokeColor(tokens.lineSoft).rect(x, y, W, H).stroke().restore();

    drawQr(doc, stickerUrl(s.origin, v.fleetNo), x + PAD, y + (H - QR) / 2, QR);
    const tx = x + PAD + QR + 3 * MM;
    const tw = W - (tx - x) - PAD;
    write(doc, fleetNumber(v.fleetNo)!, { x: tx, y: y + PAD + 1 * MM, width: tw, size: 21, bold: true, lineGap: 0 });
    write(doc, `${v.model} · …${v.vin.slice(-6)}`, { x: tx, width: tw, size: 6.5, color: tokens.muted });
    if (s.phone) {
      write(doc, 'გაფუჭდა? დაგვირეკეთ', { x: tx, y: y + H - PAD - 7.2 * MM, width: tw, size: 6, color: tokens.muted, lineGap: 0.5 });
      write(doc, 'Breakdown? Call us', { x: tx, width: tw, size: 6, color: tokens.muted, lineGap: 0.5 });
      write(doc, s.phone, { x: tx, width: tw, size: 8, bold: true, lineGap: 0 });
    }
  });
  return finish(doc);
}
