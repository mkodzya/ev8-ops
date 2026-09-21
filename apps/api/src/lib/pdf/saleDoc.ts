import { colorOnPaper, tokens } from '@ev8/shared';
import { COMPANY, DISCLAIMER, dmy, gel } from './company.js';
import { finish, gap, newDoc, write, type Doc } from './doc.js';
import { field, h1, h2, para, rule, signatures, stampPages, type DrawnSignature } from './layout.js';

// The paper of a sale (wave 5 §3.1): who bought what, for how much, on what
// schedule, and until when it is under warranty. When there is no credit the
// same document is the invoice — one sale, one paper, whichever way it is paid.
//
// The company's own sale contract — its clauses, its wording — is not in this
// repository: the rental contract here was set from the template read out of
// the company's Drive, and there is no such template for a sale. So this
// document states the facts of the sale and leaves the clauses to the
// template when the owner provides one; nothing legal is invented (CLAUDE.md,
// rule 1). It is marked accordingly at the foot.

export interface SaleDocData {
  number: string;
  soldOn: string;
  customer: { name: string; personalId: string | null; phone: string | null; email: string | null; address: string | null };
  vehicle: { brand: string; model: string; vin: string; color: string | null } | null;
  vinNote: string | null;
  priceTetri: number;
  extras: string | null;
  warrantyUntil: string | null;
  schedule: { seq: number; dueOn: string; amountTetri: number; paidTetri: number }[];
  /** A sale paid in one go: the same paper is the invoice. */
  instalments: boolean;
  signature?: DrawnSignature | null;
}

const EN = tokens.grey;

/** The schedule as a table, because that is how a buyer reads a schedule. */
function schedule(doc: Doc, rows: SaleDocData['schedule']): void {
  const cols = [doc.width * 0.12, doc.width * 0.38, doc.width * 0.25, doc.width * 0.25];
  const xs = [doc.left, doc.left + cols[0], doc.left + cols[0] + cols[1], doc.left + cols[0] + cols[1] + cols[2]];
  const head = [
    { ka: '№', en: '#' },
    { ka: 'თარიღი', en: 'Date' },
    { ka: 'თანხა', en: 'Amount' },
    { ka: 'გადახდილი', en: 'Paid' },
  ];
  const top = doc.pdf.y;
  head.forEach((h, i) => {
    write(doc, h.ka, { size: 8.5, bold: true, x: xs[i], y: top, width: cols[i] });
    write(doc, h.en, { size: 6.5, color: EN, x: xs[i], width: cols[i] });
  });
  doc.pdf.moveTo(doc.left, doc.pdf.y + 2).lineTo(doc.left + doc.width, doc.pdf.y + 2).lineWidth(0.5).strokeColor(tokens.ink).stroke();
  gap(doc, 0.3);
  for (const r of rows) {
    const y = doc.pdf.y;
    write(doc, String(r.seq), { size: 9, x: xs[0], y, width: cols[0] });
    write(doc, dmy(r.dueOn), { size: 9, x: xs[1], y, width: cols[1] });
    write(doc, gel(r.amountTetri), { size: 9, bold: true, x: xs[2], y, width: cols[2] });
    write(doc, r.paidTetri > 0 ? gel(r.paidTetri) : '—', { size: 9, x: xs[3], y, width: cols[3] });
    gap(doc, 0.2);
  }
  doc.pdf.moveTo(doc.left, doc.pdf.y).lineTo(doc.left + doc.width, doc.pdf.y).lineWidth(0.4).strokeColor(tokens.line).stroke();
  gap(doc, 0.4);
}

export async function renderSaleDoc(d: SaleDocData): Promise<Buffer> {
  const doc = newDoc(`EV8 ${d.number} — ${d.instalments ? 'ნასყიდობა განვადებით' : 'ნასყიდობა'}`);

  h1(doc, d.instalments ? { ka: 'ელექტრო მოპედის ნასყიდობა განვადებით', en: 'Sale of an electric moped by instalments' } : { ka: 'ელექტრო მოპედის ნასყიდობა', en: 'Sale of an electric moped' });
  write(doc, `№ ${d.number} · ${dmy(d.soldOn)}`, { align: 'center', size: 9.5, bold: true });
  gap(doc, 0.2);
  write(doc, DISCLAIMER.ka, { size: 6.5, align: 'center', color: EN });
  write(doc, DISCLAIMER.en, { size: 6.5, align: 'center', color: EN });
  rule(doc);

  h2(doc, { ka: '1. მხარეები', en: '1. Parties' });
  para(doc, {
    ka: `გამყიდველი: ${COMPANY.nameKa} (ს/ნ: ${COMPANY.taxId}; მისამართი: ${COMPANY.addressKa}; დირექტორი: ${COMPANY.directorKa}).`,
    en: `Seller: ${COMPANY.nameEn} (tax ID: ${COMPANY.taxId}; address: ${COMPANY.addressEn}; director: ${COMPANY.directorEn}).`,
  });
  para(doc, { ka: 'მყიდველი:', en: 'Buyer:' });
  field(doc, { ka: 'სახელი, გვარი', en: 'Name, surname' }, d.customer.name);
  field(doc, { ka: 'პირადი ნომერი', en: 'Personal number' }, d.customer.personalId ?? '');
  field(doc, { ka: 'ტელეფონი', en: 'Telephone' }, d.customer.phone ?? '');
  field(doc, { ka: 'მისამართი', en: 'Address' }, d.customer.address ?? '');

  h2(doc, { ka: '2. მოპედი', en: '2. The moped' });
  field(doc, { ka: 'მოდელი', en: 'Model' }, d.vehicle ? `${d.vehicle.brand} ${d.vehicle.model}` : '—');
  field(doc, { ka: 'VIN', en: 'VIN' }, d.vehicle?.vin ?? d.vinNote ?? '—');
  field(doc, { ka: 'ფერი', en: 'Colour' }, colorOnPaper(d.vehicle?.color));
  if (d.extras) field(doc, { ka: 'კომპლექტაცია', en: 'Equipment' }, d.extras);

  h2(doc, { ka: '3. ფასი და გადახდა', en: '3. Price and payment' });
  field(doc, { ka: 'ფასი (ლარი)', en: 'Price (GEL)' }, gel(d.priceTetri));
  field(doc, { ka: 'გარანტია მოქმედებს', en: 'Warranty valid until' }, d.warrantyUntil ? dmy(d.warrantyUntil) : '—');
  gap(doc, 0.4);
  write(doc, d.instalments ? 'გადახდის გრაფიკი' : 'გადახდა', { size: 9, bold: true });
  write(doc, d.instalments ? 'Payment schedule' : 'Payment', { size: 7, color: EN });
  gap(doc, 0.3);
  schedule(doc, d.schedule);

  signatures(
    doc,
    { ka: 'გამყიდველი', en: 'Seller', name: COMPANY.nameEn },
    { ka: 'მყიდველი', en: 'Buyer', name: d.customer.name, drawn: d.signature ?? null },
  );

  stampPages(doc, `${COMPANY.nameEn} · ${d.number} · ${dmy(d.soldOn)}`);
  return finish(doc);
}
