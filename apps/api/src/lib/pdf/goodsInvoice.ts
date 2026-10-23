import { goodsTotals, tokens } from '@ev8/shared';
import { COMPANY, DISCLAIMER, dmy, gel2 } from './company.js';
import { finish, gap, heightOf, keepTogether, newDoc, write, type Doc } from './doc.js';
import { h1, rule, signatures, stampPages, type Bi } from './layout.js';

// The invoice of a goods sale (issue #11, ADR-0045 §8): Georgian first, the
// English small and grey, like every paper the company prints. The price is
// final with VAT inside, so the totals take the VAT out of the whole: without
// VAT, VAT 18 %, and the sum to pay.
//
// It is the buyer's paper, not the tax invoice of RS.ge — that one is kept in
// Polaris. What is not printed, on purpose: a bank account (company.ts has no
// IBAN — it comes from Mika), whether it was paid (that changes; the paper
// does not), the sum in words. A private buyer's personal number never goes
// on a paper a manager prints (CST-03): a company's tax code does.

export interface GoodsInvoiceData {
  number: string;
  soldOn: string;
  /** A retail buyer: no card, a name and a phone if he gave them. */
  buyer: { retail: true; name: string | null; phone: string | null } | { retail: false; name: string; phone: string | null; address: string | null; taxCode: string | null };
  /** `name`: the item's second name — a charger's English, a part's card name as the team wrote it; `unit`: the stock's code (`pcs`, `set`…). */
  lines: { name: string; nameKa: string | null; unit: string | null; qty: number; unitPriceTetri: number }[];
  issuedBy: string | null;
  cancelled: { on: string; reason: string } | null;
}

const EN = tokens.grey;

/** A unit's word on the Georgian paper, as the stock screen says it in Georgian — not the code it is kept by. */
const UNIT_KA: Record<string, string> = { pcs: 'ცალი', set: 'კომპლ', l: 'ლ', kg: 'კგ', m: 'მ' };

function block(doc: Doc, x: number, w: number, top: number, title: Bi, rows: string[]): number {
  doc.pdf.y = top;
  write(doc, title.ka, { size: 9, bold: true, x, width: w });
  write(doc, title.en, { size: 7, color: EN, x, width: w });
  gap(doc, 0.2);
  for (const r of rows) if (r) write(doc, r, { size: 9, x, width: w });
  return doc.pdf.y;
}

/** The table of what was sold. Widths in sixths of the page, the name taking the most. */
function table(doc: Doc, lines: GoodsInvoiceData['lines']): void {
  const fr = [0.06, 0.38, 0.1, 0.1, 0.18, 0.18];
  const ws = fr.map((f) => doc.width * f);
  const xs = ws.map((_, i) => doc.left + ws.slice(0, i).reduce((n, w) => n + w, 0));
  const right = new Set([3, 4, 5]);
  const head: Bi[] = [
    { ka: '№', en: '#' },
    { ka: 'დასახელება', en: 'Item' },
    { ka: 'ერთ.', en: 'Unit' },
    { ka: 'რაოდ.', en: 'Qty' },
    { ka: 'ფასი დღგ-ს ჩათვლით', en: 'Price incl. VAT' },
    { ka: 'თანხა', en: 'Amount' },
  ];
  keepTogether(doc, 60);
  const top = doc.pdf.y;
  let bottom = top;
  head.forEach((h, i) => {
    doc.pdf.y = top;
    const pad = right.has(i) ? 0 : 4;
    write(doc, h.ka, { size: 8, bold: true, x: xs[i]!, width: ws[i]! - pad, align: right.has(i) ? 'right' : 'left' });
    write(doc, h.en, { size: 6.5, color: EN, x: xs[i]!, width: ws[i]! - pad, align: right.has(i) ? 'right' : 'left' });
    bottom = Math.max(bottom, doc.pdf.y);
  });
  doc.pdf.y = bottom;
  doc.pdf.moveTo(doc.left, doc.pdf.y + 2).lineTo(doc.left + doc.width, doc.pdf.y + 2).lineWidth(0.5).strokeColor(tokens.ink).stroke();
  gap(doc, 0.35);
  lines.forEach((l, n) => {
    const cells = [String(n + 1), l.nameKa || l.name, l.unit ? (UNIT_KA[l.unit] ?? l.unit) : '', String(l.qty), gel2(l.unitPriceTetri), gel2(l.qty * l.unitPriceTetri)];
    const h = Math.max(...cells.map((c, i) => heightOf(doc, c || ' ', { size: 9, width: ws[i]! - 4 })));
    keepTogether(doc, h + 6);
    const y = doc.pdf.y;
    cells.forEach((c, i) => write(doc, c, { size: 9, bold: i === 5, x: xs[i]!, y, width: ws[i]! - (right.has(i) ? 0 : 4), align: right.has(i) ? 'right' : 'left' }));
    doc.pdf.y = y + h;
    // The item's second name under the Georgian one whenever it has both — a charger's English, a
    // part's card name in whatever language the team wrote it — so every line reads alike (QA
    // 23.10.2026: a part printed its Georgian alone while a charger had «Charger 73V6A» under it).
    if (l.nameKa && l.name && l.nameKa !== l.name) {
      write(doc, l.name, { size: 7, color: EN, x: xs[1]!, width: ws[1]! - 4 });
    }
    gap(doc, 0.2);
  });
  doc.pdf.moveTo(doc.left, doc.pdf.y).lineTo(doc.left + doc.width, doc.pdf.y).lineWidth(0.4).strokeColor(tokens.line).stroke();
  gap(doc, 0.4);
}

function total(doc: Doc, t: Bi, value: string, strong = false): void {
  const labelW = doc.width * 0.62;
  const y = doc.pdf.y;
  write(doc, `${t.ka} / ${t.en}`, { size: strong ? 10 : 9, bold: strong, x: doc.left, y, width: labelW, align: 'right' });
  write(doc, value, { size: strong ? 11 : 9.5, bold: true, x: doc.left + labelW, y, width: doc.width - labelW, align: 'right' });
  gap(doc, 0.25);
}

export async function renderGoodsInvoice(d: GoodsInvoiceData): Promise<Buffer> {
  const doc = newDoc(`EV8 ${d.number} — ინვოისი`);
  h1(doc, { ka: 'ინვოისი', en: 'Invoice' });
  write(doc, `№ ${d.number} · ${dmy(d.soldOn)}`, { align: 'center', size: 9.5, bold: true });
  if (d.cancelled) {
    gap(doc, 0.4);
    const y = doc.pdf.y;
    doc.pdf.rect(doc.left, y - 2, doc.width, 30).fillColor(tokens.ink).fillOpacity(0.06).fill().fillOpacity(1);
    write(doc, `გაუქმებულია · Cancelled · ${dmy(d.cancelled.on)}`, { align: 'center', size: 10, bold: true, y: y + 2 });
    write(doc, d.cancelled.reason, { align: 'center', size: 7.5, color: EN });
    doc.pdf.y = Math.max(doc.pdf.y, y + 30);
  }
  gap(doc, 0.2);
  write(doc, DISCLAIMER.ka, { size: 6.5, align: 'center', color: EN });
  write(doc, DISCLAIMER.en, { size: 6.5, align: 'center', color: EN });
  rule(doc);

  // Seller and buyer side by side.
  const colW = (doc.width - 24) / 2;
  const top = doc.pdf.y;
  const left = block(doc, doc.left, colW, top, { ka: 'გამყიდველი', en: 'Seller' }, [COMPANY.nameKa, COMPANY.nameEn, `ს/კ ${COMPANY.taxId}`, COMPANY.addressKa, `დირექტორი: ${COMPANY.directorKa}`]);
  const b = d.buyer;
  const buyerRows = b.retail
    ? ['საცალო მყიდველი · Retail buyer', b.name ?? '', b.phone ?? '']
    : [b.name, b.phone ?? '', b.address ?? '', b.taxCode ? `ს/კ ${b.taxCode}` : ''];
  const right = block(doc, doc.left + colW + 24, colW, top, { ka: 'მყიდველი', en: 'Buyer' }, buyerRows);
  doc.pdf.y = Math.max(left, right);
  rule(doc);

  table(doc, d.lines);
  const t = goodsTotals(d.lines);
  keepTogether(doc, 70);
  total(doc, { ka: 'ჯამი დღგ-ს გარეშე', en: 'Total excl. VAT' }, gel2(t.netTetri));
  total(doc, { ka: 'დღგ 18%', en: 'VAT 18%' }, gel2(t.vatTetri));
  total(doc, { ka: 'სულ გადასახდელი', en: 'Total incl. VAT' }, `${gel2(t.grossTetri)} ₾`, true);
  gap(doc, 0.2);
  write(doc, 'ფასები მოიცავს დღგ-ს · Prices include VAT', { size: 7.5, color: EN, align: 'right' });
  gap(doc, 0.6);

  if (d.issuedBy) {
    write(doc, `გაცემულია / Issued by: ${d.issuedBy}`, { size: 8.5 });
  }
  signatures(doc, { ka: 'გამყიდველი', en: 'Seller', name: COMPANY.nameEn }, { ka: 'მყიდველი', en: 'Buyer', name: b.retail ? (b.name ?? '') : b.name });
  stampPages(doc, `${COMPANY.nameEn} · ${d.number} · ${dmy(d.soldOn)}`);
  return finish(doc);
}
