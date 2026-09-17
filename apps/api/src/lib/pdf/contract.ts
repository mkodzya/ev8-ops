import { colorOnPaper, tokens } from '@ev8/shared';
import { finish, gap, newDoc, write } from './doc.js';
import { COMPANY, DISCLAIMER, LESSEE, LESSOR, TERMS, dmy, gel } from './company.js';
import { bullet, check, field, h1, h2, para, rule, signatures, stampPages } from './layout.js';

// The rental contract with annex 1 (the hand-over act), set from the
// company's own Signify template as read from Google Drive on 14.09.2026.
// Every clause below is that template's wording; only the fields change.

export interface ContractData {
  number: string;
  contractDate: string; // ISO
  customer: { name: string; personalId: string | null; phone: string | null; email: string | null; address: string | null };
  vehicle: { brand: string; model: string; vin: string; color: string | null } | null;
  vinNote: string | null;
  weeklyRateTetri: number;
  depositTetri: number;
  buyoutTargetTetri: number | null;
  batteries: number | null;
  chargers: number | null;
  nightParkingAddress: string | null;
  pickedUpOn: string | null;
  condition: string | null;
  hasPhotos: boolean;
}

export async function renderContract(d: ContractData): Promise<Buffer> {
  const doc = newDoc(`EV8 ${d.number} — ქირაობის ხელშეკრულება`);

  h1(doc, { ka: 'ელექტრო მოპედის ქირაობის ხელშეკრულება', en: 'Electric moped rental agreement' });
  write(doc, `№ ${d.number} · ${dmy(d.contractDate)}`, { align: 'center', size: 9.5, bold: true });
  gap(doc, 0.2);
  write(doc, DISCLAIMER.ka, { size: 6.5, align: 'center', color: tokens.grey });
  write(doc, DISCLAIMER.en, { size: 6.5, align: 'center', color: tokens.grey });
  rule(doc);

  h2(doc, { ka: '1. ხელშეკრულების მხარეები', en: '1. Parties to the agreement' });
  para(doc, {
    ka: `დამქირავებელი: ${COMPANY.nameKa} (ს/ნ: ${COMPANY.taxId}; მისამართი: ${COMPANY.addressKa}; დირექტორი: ${COMPANY.directorKa}).`,
    en: `Lessor: ${COMPANY.nameEn} (tax ID: ${COMPANY.taxId}; address: ${COMPANY.addressEn}; director: ${COMPANY.directorEn}).`,
  });
  para(doc, { ka: 'მოქირავე:', en: 'Lessee:' });
  field(doc, { ka: 'სახელი, გვარი', en: 'Name, surname' }, d.customer.name);
  field(doc, { ka: 'პირადი ნომერი', en: 'Personal number' }, d.customer.personalId ?? '');
  field(doc, { ka: 'ტელეფონი', en: 'Telephone' }, d.customer.phone ?? '');
  field(doc, { ka: 'ელ. ფოსტა', en: 'E-mail' }, d.customer.email ?? '');
  field(doc, { ka: 'მისამართი', en: 'Address' }, d.customer.address ?? '');

  h2(doc, { ka: '2. ხელშეკრულების საგანი', en: '2. Subject of the agreement' });
  para(doc, {
    ka: 'დამქირავებელი გადასცემს, ხოლო მოქირავე იღებს დროებით სარგებლობაში ელექტრო მოპედს:',
    en: 'The Lessor hands over, and the Lessee receives for temporary use, an electric moped:',
  });
  field(doc, { ka: 'მოდელი', en: 'Model' }, d.vehicle ? `${d.vehicle.brand} ${d.vehicle.model}` : '—');
  field(doc, { ka: 'VIN', en: 'VIN' }, d.vehicle?.vin ?? d.vinNote ?? '—');
  field(doc, { ka: 'ფერი', en: 'Colour' }, colorOnPaper(d.vehicle?.color));
  para(doc, {
    ka: 'გადაცემის აქტი წარმოადგენს წინამდებარე ხელშეკრულების განუყოფელ და არსებით ნაწილს. აქტში მითითებული ინფორმაცია (მდგომარეობა, კომპლექტაცია, შენიშვნები) სავალდებულოა ორივე მხარისთვის.',
    en: 'The hand-over act is an inseparable and essential part of this agreement. The information stated in the act (condition, equipment, remarks) is binding on both parties.',
  });

  h2(doc, { ka: '3. ქირაობის პირობები', en: '3. Terms of the rent' });
  field(doc, { ka: 'ქირა (ლარი, კვირაში)', en: 'Rent (GEL, per week)' }, gel(d.weeklyRateTetri));
  field(doc, { ka: 'დეპოზიტი (ლარი, დაბრუნებადი)', en: 'Deposit (GEL, refundable)' }, gel(d.depositTetri));
  bullet(doc, {
    ka: `მინიმალური ვადა: ${TERMS.minWeeks} კვირა (ვადა იწყება მიღება-ჩაბარების აქტის ხელმოწერიდან).`,
    en: `Minimum term: ${TERMS.minWeeks} week (the term starts from the signing of the hand-over act).`,
  });
  bullet(doc, { ka: 'გადახდა: კომპანიის საბანკო ანგარიშზე.', en: "Payment: to the company's bank account." });
  bullet(doc, {
    ka: 'დამქირავებელს აქვს უფლება დეპოზიტიდან ჩამოაჭრას მიყენებული ზიანის თანხა ან ჯარიმები.',
    en: 'The Lessor has the right to deduct from the deposit the amount of damage caused or fines.',
  });

  h2(doc, { ka: '4. მოპედის გამოყენების წესები და შეზღუდვები', en: '4. Rules and restrictions on the use of the moped' });
  para(doc, { ka: 'მოქირავე ვალდებულია:', en: 'The Lessee is obliged to:' });
  bullet(doc, {
    ka: 'გამოიყენოს მოპედი მხოლოდ თბილისის ფარგლებში და დაიცვას საგზაო მოძრაობის წესები.',
    en: 'use the moped only within Tbilisi and observe the traffic rules.',
  });
  bullet(doc, {
    ka: 'უზრუნველყოს მოპედის უსაფრთხო გამოყენება. მკაცრად ეკრძალება მოპედის გადაცემა, გაქირავება ან გაზიარება მესამე პირებზე.',
    en: 'ensure the safe use of the moped. Handing over, subletting or sharing the moped with third parties is strictly prohibited.',
  });
  bullet(doc, {
    ka: 'დარღვევის შემთხვევაში ხელშეკრულება წყდება დაუყოვნებლივ და დეპოზიტი არ ბრუნდება.',
    en: 'In case of a breach, the agreement is terminated immediately and the deposit is not returned.',
  });

  h2(doc, { ka: '5. პარკირებისა და ბატარეის უსაფრთხოება', en: '5. Parking and battery safety' });
  bullet(doc, {
    ka: 'ღამის პარკირება: მოპედი ღამის განმავლობაში უნდა განთავსდეს მხოლოდ დანართ №1-ში მითითებულ მისამართზე.',
    en: 'Night parking: during the night the moped must be kept only at the address stated in Annex No. 1.',
  });
  bullet(doc, {
    ka: 'ბატარეის მოხსნა: მოქირავე ვალდებულია ყოველ ღამე (ან როდესაც მოპედს ტოვებს უყურადღებოდ) ამოიღოს ბატარეა.',
    en: 'Battery removal: the Lessee is obliged to remove the battery every night (or whenever the moped is left unattended).',
  });
  bullet(doc, {
    ka: `დარღვევის შემთხვევაში: ბატარეის ამოუღებლობის გამო მოპედის/ბატარეის ქურდობაზე პასუხისმგებლობა ეკისრება მოქირავეს, ხოლო ჯარიმა თითო დარღვევაზე შეადგენს ${TERMS.batteryFine} ლარს.`,
    en: `In case of a breach: the Lessee bears responsibility for theft of the moped or battery caused by failure to remove the battery, and the fine for each breach is ${TERMS.batteryFine} GEL.`,
  });

  h2(doc, { ka: '6. პასუხისმგებლობა, ზიანი და ჯარიმები', en: '6. Liability, damage and fines' });
  bullet(doc, {
    ka: 'მიღება-ჩაბარების აქტის ხელმოწერის მომენტიდან მოქირავე იღებს სრულ მატერიალურ პასუხისმგებლობას მოპედის დაზიანებაზე, ქურდობაზე, ავარიებზე და მესამე პირის ზიანზე.',
    en: 'From the moment of signing the hand-over act, the Lessee assumes full material liability for damage to the moped, theft, accidents and damage caused to third parties.',
  });
  bullet(doc, {
    ka: 'ავარიის შემთხვევაში მოქირავე ვალდებულია დაუყოვნებლივ აცნობოს დამქირავებელს.',
    en: 'In case of an accident the Lessee is obliged to notify the Lessor immediately.',
  });
  bullet(doc, {
    ka: 'ზიანის ანაზღაურება: მოქირავე ანაზღაურებს რეალური შეკეთების, ნაწილების და მომსახურების ხარჯებს, რომლის ოდენობასაც განსაზღვრავს დამქირავებელი.',
    en: 'Compensation for damage: the Lessee compensates the actual cost of repair, parts and services, the amount of which is determined by the Lessor.',
  });
  bullet(doc, {
    ka: `სანქციები: დაგვიანებული დაბრუნება — ${TERMS.lateFeePerDay} ლარი დღეში (${TERMS.lateFeeParts} ლარი ქირა და ჯარიმა); გასაღების დაკარგვა — ${TERMS.keyLoss} ლარი; ევაკუაცია — ფაქტობრივი ხარჯით.`,
    en: `Sanctions: late return — ${TERMS.lateFeePerDay} GEL per day (${TERMS.lateFeeParts} GEL rent and fine); loss of the key — ${TERMS.keyLoss} GEL; towing — at actual cost.`,
  });

  h2(doc, { ka: '7. გამოსყიდვის უფლება, დაბრუნება და შეწყვეტა', en: '7. Right of buy-out, return and termination' });
  if (d.buyoutTargetTetri) {
    bullet(doc, {
      ka: `გამოსყიდვა: მოქირავეს აქვს უფლება შეიძინოს მოპედი და ორი ბატარეა საკუთრებაში, როდესაც ჯამური გადახდები მიაღწევს ${gel(d.buyoutTargetTetri)} ლარს.`,
      en: `Buy-out: the Lessee has the right to acquire ownership of the moped and two batteries when the total payments reach ${gel(d.buyoutTargetTetri)} GEL.`,
    });
  }
  bullet(doc, {
    ka: 'დაბრუნება: ხელშეკრულების დასრულებისას მოპედი უნდა დაბრუნდეს დროულად, ტექნიკურად გამართული და სრული კომპლექტაციით.',
    en: 'Return: at the end of the agreement the moped must be returned on time, technically sound and with the complete set of equipment.',
  });
  bullet(doc, {
    ka: 'ცალმხრივი შეწყვეტა: დამქირავებელს აქვს უფლება დაუყოვნებლივ შეწყვიტოს ხელშეკრულება და მოითხოვოს მოპედის დაბრუნება პირობების დარღვევის, გადახდის დაგვიანების ან არასწორი გამოყენების შემთხვევაში.',
    en: 'Unilateral termination: the Lessor has the right to terminate the agreement immediately and demand the return of the moped in case of breach of the terms, late payment or improper use.',
  });

  h2(doc, { ka: '8. მხარეთა ხელმოწერები', en: '8. Signatures of the parties' });
  para(doc, {
    ka: 'ხელშეკრულება რეგულირდება საქართველოს კანონმდებლობით.',
    en: 'The agreement is governed by the legislation of Georgia.',
  });
  signatures(
    doc,
    { ...LESSOR, name: `${COMPANY.nameKa} · ${COMPANY.directorKa}` },
    { ...LESSEE, name: d.customer.name },
  );

  // ---- Annex 1: the hand-over act -----------------------------------------
  doc.pdf.addPage();
  h1(doc, { ka: 'დანართი №1: მოპედის მიღება-ჩაბარების აქტი', en: 'Annex No. 1: moped hand-over and acceptance act' });
  write(doc, `№ ${d.number}`, { align: 'center', size: 9.5, bold: true });
  rule(doc);
  field(doc, { ka: 'გადაცემის თარიღი', en: 'Date of hand-over' }, dmy(d.pickedUpOn ?? d.contractDate));
  para(doc, {
    ka: `წინამდებარე აქტით დამქირავებელი გადასცემს, ხოლო მოქირავე იბარებს ხელშეკრულების მე-2 პუნქტში მითითებულ ელექტრო მოპედს${d.vehicle ? ` (${d.vehicle.brand} ${d.vehicle.model}, VIN ${d.vehicle.vin})` : ''}.`,
    en: `By this act the Lessor hands over, and the Lessee accepts, the electric moped specified in clause 2 of the agreement${d.vehicle ? ` (${d.vehicle.brand} ${d.vehicle.model}, VIN ${d.vehicle.vin})` : ''}.`,
  });

  h2(doc, { ka: '1. კომპლექტაცია', en: '1. Equipment handed over' });
  check(doc, !!d.vehicle, { ka: 'მოპედი', en: 'Moped' });
  check(doc, true, { ka: 'გასაღები', en: 'Key' });
  check(doc, (d.batteries ?? 0) > 0, { ka: 'ბატარეა', en: 'Battery' }, `${d.batteries ?? 0} ცალი / pcs`);
  check(doc, (d.chargers ?? 0) > 0, { ka: 'დამტენი', en: 'Charger' }, `${d.chargers ?? 0} ცალი / pcs`);

  h2(doc, { ka: '2. ვიზუალური და ტექნიკური მდგომარეობა', en: '2. Visual and technical condition' });
  const clean = !d.condition;
  check(doc, clean, { ka: 'კარგ მდგომარეობაში (ხილული დაზიანებების გარეშე)', en: 'In good condition (no visible damage)' });
  check(doc, !clean, { ka: 'დაფიქსირებულია შემდეგი შენიშვნები/დაზიანებები', en: 'The following remarks / damage are recorded' });
  if (!clean) para(doc, { ka: d.condition!, en: '' }, { indent: 18 });

  h2(doc, { ka: '3. ფოტო/ვიდეო ფიქსაცია', en: '3. Photo / video record' });
  para(doc, {
    ka: 'მოპედის მდგომარეობა გადაცემის მომენტში დაფიქსირებულია ფოტო/ვიდეო მასალით, რომელიც წარმოადგენს მტკიცებულებას:',
    en: 'The condition of the moped at the moment of hand-over is recorded by photo / video material, which constitutes evidence:',
  });
  check(doc, d.hasPhotos, { ka: 'დიახ', en: 'Yes' });
  check(doc, !d.hasPhotos, { ka: 'არა', en: 'No' });

  h2(doc, { ka: '4. ღამის პარკირების სავალდებულო მისამართი', en: '4. Mandatory night parking address' });
  para(doc, {
    ka: 'მოქირავე ადასტურებს, რომ მოპედი ღამის განმავლობაში განთავსდება შემდეგ მისამართზე:',
    en: 'The Lessee confirms that during the night the moped will be kept at the following address:',
  });
  field(doc, { ka: 'მისამართი', en: 'Address' }, d.nightParkingAddress ?? '');

  signatures(
    doc,
    { ...LESSOR, name: `${COMPANY.nameKa} · ${COMPANY.directorKa}` },
    { ...LESSEE, name: d.customer.name },
  );

  stampPages(doc, `${COMPANY.nameKa} · ${COMPANY.nameEn} · ს/ნ ${COMPANY.taxId} · ${d.number}`);
  return finish(doc);
}
