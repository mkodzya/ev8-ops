import { colorOnPaper, tokens } from '@ev8/shared';
import { finish, gap, newDoc, write } from './doc.js';
import { COMPANY, DISCLAIMER, LESSEE, LESSOR, dmy, gel } from './company.js';
import { check, field, h1, h2, para, rule, signatures, stampPages } from './layout.js';

// The return and final settlement act, set from the company's own template
// as read from Google Drive on 14.09.2026. The paper form numbers its
// signature clause 10 after clause 8; that gap is an obvious slip in the
// original and is closed here.

/** Items the paper form checks off one by one. */
export const RETURN_ITEMS = ['moped', 'key', 'battery_1', 'battery_2', 'charger_1', 'charger_2'] as const;
export type ReturnItem = (typeof RETURN_ITEMS)[number];
export const ITEM_STATES = ['ok', 'damaged', 'missing'] as const;
export type ItemState = (typeof ITEM_STATES)[number];

export const ITEM_LABEL: Record<ReturnItem, { ka: string; en: string }> = {
  moped: { ka: 'მოპედი', en: 'Moped' },
  key: { ka: 'გასაღები', en: 'Key' },
  battery_1: { ka: 'ბატარეა №1', en: 'Battery No. 1' },
  battery_2: { ka: 'ბატარეა №2', en: 'Battery No. 2' },
  charger_1: { ka: 'დამტენი №1', en: 'Charger No. 1' },
  charger_2: { ka: 'დამტენი №2', en: 'Charger No. 2' },
};

/** Grounds for withholding, exactly the checkboxes of the paper form. */
export const WITHHOLD_GROUNDS = [
  'rent_arrears',
  'fines',
  'moped_damage',
  'incomplete_return',
  'key_loss',
  'charger_loss',
  'cleaning',
  'other',
] as const;
export type WithholdGround = (typeof WITHHOLD_GROUNDS)[number];

export const GROUND_LABEL: Record<WithholdGround, { ka: string; en: string }> = {
  rent_arrears: { ka: 'ქირის დავალიანება', en: 'Rent arrears' },
  fines: { ka: 'ჯარიმები', en: 'Fines' },
  moped_damage: { ka: 'მოპედის დაზიანება', en: 'Damage to the moped' },
  incomplete_return: { ka: 'კომპლექტაციის არასრული დაბრუნება', en: 'Incomplete return of the equipment' },
  key_loss: { ka: 'გასაღების დაკარგვა', en: 'Loss of the key' },
  charger_loss: { ka: 'დამტენის დაკარგვა', en: 'Loss of the charger' },
  cleaning: { ka: 'მოპედის რეცხვა / გაწმენდა', en: 'Washing / cleaning of the moped' },
  other: { ka: 'სხვა', en: 'Other' },
};

export interface ReturnActData {
  number: string;
  returnedOn: string;
  contractDate: string;
  customer: { name: string; personalId: string | null; phone: string | null; email: string | null; address: string | null };
  vehicle: { brand: string; model: string; vin: string; color: string | null } | null;
  vinNote: string | null;
  items: Partial<Record<ReturnItem, { state: ItemState; note?: string | null }>>;
  hasPhotos: boolean;
  depositTetri: number;
  withheldTetri: number;
  returnedTetri: number;
  withheldGrounds: WithholdGround[];
  withheldReason: string | null;
  returnedTo: string | null;
}

export async function renderReturnAct(d: ReturnActData): Promise<Buffer> {
  const doc = newDoc(`EV8 ${d.number} — დაბრუნების აქტი`);

  h1(doc, {
    ka: 'ელექტრო მოპედის დაბრუნებისა და საბოლოო ანგარიშსწორების აქტი',
    en: 'Act of return and final settlement of the electric moped',
  });
  write(doc, `№ ${d.number} · ${dmy(d.returnedOn)}`, { align: 'center', size: 9.5, bold: true });
  gap(doc, 0.2);
  write(doc, DISCLAIMER.ka, { size: 6.5, align: 'center', color: tokens.grey });
  write(doc, DISCLAIMER.en, { size: 6.5, align: 'center', color: tokens.grey });
  rule(doc);

  h2(doc, { ka: '1. მხარეები', en: '1. Parties' });
  para(doc, {
    ka: `დამქირავებელი: ${COMPANY.nameKa}, საიდენტიფიკაციო ნომერი: ${COMPANY.taxId}.`,
    en: `Lessor: ${COMPANY.nameEn}, tax identification number: ${COMPANY.taxId}.`,
  });
  para(doc, { ka: 'მოქირავე:', en: 'Lessee:' });
  field(doc, { ka: 'სახელი, გვარი', en: 'Name, surname' }, d.customer.name);
  field(doc, { ka: 'პირადი ნომერი', en: 'Personal number' }, d.customer.personalId ?? '');
  field(doc, { ka: 'ტელეფონი', en: 'Telephone' }, d.customer.phone ?? '');
  field(doc, { ka: 'ელ. ფოსტა', en: 'E-mail' }, d.customer.email ?? '');
  field(doc, { ka: 'მისამართი', en: 'Address' }, d.customer.address ?? '');

  h2(doc, { ka: '2. ხელშეკრულების მონაცემები', en: '2. Details of the agreement' });
  field(doc, { ka: 'ქირავნობის ხელშეკრულების თარიღი', en: 'Date of the rental agreement' }, dmy(d.contractDate));
  field(doc, { ka: 'ხელშეკრულების ნომერი', en: 'Number of the agreement' }, d.number);

  h2(doc, { ka: '3. დასაბრუნებელი მოპედის მონაცემები', en: '3. Details of the moped being returned' });
  field(doc, { ka: 'მოდელი', en: 'Model' }, d.vehicle ? `${d.vehicle.brand} ${d.vehicle.model}` : '—');
  field(doc, { ka: 'VIN', en: 'VIN' }, d.vehicle?.vin ?? d.vinNote ?? '—');
  field(doc, { ka: 'ფერი', en: 'Colour' }, colorOnPaper(d.vehicle?.color));

  h2(doc, { ka: '4. დაბრუნებული ქონების მდგომარეობა', en: '4. Condition of the returned property' });
  for (const item of RETURN_ITEMS) {
    const rec = d.items[item];
    if (!rec) continue;
    gap(doc, 0.2);
    write(doc, `${ITEM_LABEL[item].ka} / ${ITEM_LABEL[item].en}`, { bold: true, size: 9 });
    check(doc, rec.state === 'ok', { ka: 'გამართულია', en: 'In order' });
    check(doc, rec.state === 'damaged', { ka: 'დაზიანებულია', en: 'Damaged' }, rec.note ?? undefined);
    check(doc, rec.state === 'missing', { ka: 'არ დაბრუნებულა', en: 'Not returned' });
  }

  h2(doc, { ka: '5. ფოტო/ვიდეო დაფიქსირება', en: '5. Photo / video record' });
  para(doc, {
    ka: 'მოპედისა და დაბრუნებული ქონების მდგომარეობა დაფიქსირდა ფოტო და/ან ვიდეო მასალით:',
    en: 'The condition of the moped and of the returned property was recorded by photo and / or video material:',
  });
  check(doc, d.hasPhotos, { ka: 'დიახ', en: 'Yes' });
  check(doc, !d.hasPhotos, { ka: 'არა', en: 'No' });

  h2(doc, { ka: '6. დეპოზიტისა და საბოლოო ანგარიშსწორების ინფორმაცია', en: '6. Deposit and final settlement' });
  field(doc, { ka: 'შეტანილი დეპოზიტის ოდენობა (ლარი)', en: 'Deposit paid (GEL)' }, gel(d.depositTetri));
  field(doc, { ka: 'დაკავებული თანხა (ლარი)', en: 'Amount withheld (GEL)' }, gel(d.withheldTetri));
  field(doc, { ka: 'ფაქტობრივად დაბრუნებული თანხა (ლარი)', en: 'Amount actually returned (GEL)' }, gel(d.returnedTetri));
  if (d.returnedTo) {
    field(doc, { ka: 'თანხა დაუბრუნდა', en: 'Amount returned to' }, d.returnedTo);
  }

  h2(doc, { ka: '7. დაკავებული თანხის საფუძველი', en: '7. Grounds for the amount withheld' });
  for (const g of WITHHOLD_GROUNDS) {
    check(doc, d.withheldGrounds.includes(g), GROUND_LABEL[g], g === 'other' ? d.withheldReason ?? undefined : undefined);
  }

  h2(doc, { ka: '8. მხარეთა დადასტურება', en: '8. Confirmation by the parties' });
  para(doc, { ka: 'მოქირავე ადასტურებს, რომ:', en: 'The Lessee confirms that:' });
  for (const line of [
    { ka: 'მის მიერ დაბრუნებულია ზემოაღნიშნული ქონება;', en: 'the property listed above has been returned by them;' },
    { ka: 'მიღებულია საბოლოო ანგარიშსწორება;', en: 'the final settlement has been received;' },
    { ka: 'არ გააჩნია პრეტენზია განხორციელებულ ანგარიშსწორებასთან დაკავშირებით;', en: 'they have no claim in connection with the settlement made;' },
    { ka: 'ადასტურებს ზემოაღნიშნული თანხის მიღებას;', en: 'they confirm receipt of the amount stated above;' },
    { ka: 'არ გააჩნია სხვა ფინანსური ან ქონებრივი პრეტენზიები დამქირავებლის მიმართ.', en: 'they have no other financial or property claims against the Lessor.' },
  ]) {
    para(doc, line);
  }

  h2(doc, { ka: '9. ხელმოწერები', en: '9. Signatures' });
  signatures(
    doc,
    { ...LESSOR, name: `${COMPANY.nameKa} · ${COMPANY.directorKa}` },
    { ...LESSEE, name: d.customer.name },
  );

  stampPages(doc, `${COMPANY.nameKa} · ${COMPANY.nameEn} · ს/ნ ${COMPANY.taxId} · ${d.number}`);
  return finish(doc);
}
