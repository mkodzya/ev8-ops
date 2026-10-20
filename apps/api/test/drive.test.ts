// The rentals folders in Google Drive (ADR-0031). Every name, number, date and
// folder here is made up; no request leaves the test — Google is a stand-in.
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';
import { assertion, driveConfig, forgetToken } from '../src/lib/drive.js';
import { fileKind, folderName, kindOfText, matchFolders, pdfText, readContract, readContractParty, readReturnAct, readingOrder, sharedWords } from '../src/lib/driveDocs.js';
import { actAfterPickup, joinKommoDeals, sectionOf } from '../src/lib/driveScan.js';
import { todayISO } from '@ev8/shared';

const ACT = [
  'ელექტრო მოპედის დაბრუნებისა და საბოლოო ანგარიშსწორების აქტი',
  'თარიღი: ____ 03/11/2031',
  'ქირავნობის ხელშეკრულების თარიღი: ______ 06/09/2031',
  'VIN: ________ HH8TEST0000000017',
  'შეტანილი დეპოზიტის ოდენობა: ______ 180 ლარი',
  'დაკავებული თანხა: ______ 30ლარი',
  'მოქირავისთვის ფაქტობრივად დაბრუნებული თანხა: ______ 150 ლარი',
  '7. დაკავებული თანხის საფუძველი',
].join('\n');

const CONTRACT = ['ქირაობის ხელშეკრულება', 'თარიღი: 06/09/2031', 'მოდელი: Fly Brother', 'VIN: HH8TEST0000000017'].join('\n');

/** A contract as Signify prints it with its fields filled in: a made-up renter, number and phone. */
const PARTY = [
  'ელექტრო მოპედის ქირაობის ხელშეკრულება',
  'თარიღი: 06/09/2031',
  'დამქირავებელი: შპს „ე-მოუშენ მოთორს“ (ს/ნ: 000000000; მისამართი: ქუთაისი, ქუჩა 1)',
  'მოქირავე:',
  'სახელი, გვარი:________________ ნინო თუშიძე',
  'პირადი ნომერი : ______________ 01234567890',
  'ტელეფონი: ____________________ +995 555 00 00 00',
  'ელ. ფოსტა: ___________________ test@example.com',
  'მისამართი: ___________________ სატესტო ქუჩა 1',
  '2. ხელშეკრულების საგანი',
  'VIN: _________________________ HH8TEST0000000017',
  '• ქირა: 150 ლარი',
  '• დეპოზიტი: 180 _____ ლარი (დაბრუნებადი)',
].join('\n');

/** A PDF with text, as Signify makes them — here made with the API's own fonts. */
async function pdfOf(text: string): Promise<Buffer> {
  const fonts = join(import.meta.dirname, '../src/assets/fonts');
  const doc = new PDFDocument({ size: 'A4' });
  doc.registerFont('geo', readFileSync(join(fonts, 'NotoSansGeorgian-Regular.ttf')));
  doc.registerFont('lat', readFileSync(join(fonts, 'NotoSans-Regular.ttf')));
  doc.fontSize(11);
  // Each run in the font that has its letters: the Georgian one has no digits.
  for (const line of text.split('\n')) {
    const runs = line.match(/[\u10A0-\u10FF]+(?:[ -]+[\u10A0-\u10FF]+)*|[^\u10A0-\u10FF]+/g) ?? [''];
    runs.forEach((run, i) => doc.font(/[\u10A0-\u10FF]/.test(run) ? 'geo' : 'lat').text(run, { continued: i < runs.length - 1 }));
  }
  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  doc.end();
  return done;
}

describe('the rentals folders in Drive: names and documents (ADR-0031)', () => {
  it('reads a folder’s name: the pickup day, then the person', () => {
    expect(folderName('310906 Nino Tushidze')).toEqual({ datedOn: '2031-09-06', person: 'Nino Tushidze' });
    expect(folderName('310906 ნინო თუშიძე')).toEqual({ datedOn: '2031-09-06', person: 'ნინო თუშიძე' });
    expect(folderName('10')).toEqual({ datedOn: null, person: '10' });
    expect(folderName('311399 Nobody').datedOn).toBeNull();
  });

  it('knows a document by its name, and never opens a photo or an audit trail', () => {
    expect(fileKind('ქირაობის ხელშეკრულება-1234.pdf', 'application/pdf')).toBe('contract');
    expect(fileKind('ქირაობის ხელშეკრულება-at.pdf', 'application/pdf')).toBe('skip');
    expect(fileKind('311103 დაბრუნებისა და საბოლოო ანგარიშსწორების აქტი test.pdf', 'application/pdf')).toBe('return_act');
    expect(fileKind('310906 Test Person.pdf', 'application/pdf')).toBe('scan');
    expect(fileKind('Test Person ID.pdf', 'application/pdf')).toBe('skip');
    expect(fileKind('Test passport.JPG', 'image/jpeg')).toBe('skip');
    expect(fileKind('IMG_0001.HEIC', 'image/heif')).toBe('skip');
  });

  it('reads a return act: its date, the contract’s, the moped, and what became of the deposit', () => {
    expect(readReturnAct(ACT)).toEqual({ returnedOn: '2031-11-03', contractOn: '2031-09-06', vin: 'HH8TEST0000000017', depositTetri: 18000, withheldTetri: 3000, paidBackTetri: 15000 });
    expect(readContract(CONTRACT)).toEqual({ signedOn: '2031-09-06', vin: 'HH8TEST0000000017' });
    expect(readReturnAct('nothing to read')).toEqual({ returnedOn: null, contractOn: null, vin: null, depositTetri: null, withheldTetri: null, paidBackTetri: null });
  });

  it('puts a field’s value beside its label, line by line, as the page shows them', () => {
    expect(
      readingOrder([
        { x: 300, y: 702, str: '03/11/2031' },
        { x: 72, y: 700, str: 'თარიღი:' },
        { x: 72, y: 650, str: 'VIN:' },
        { x: 200, y: 652, str: 'HH8TEST0000000017' },
      ]),
    ).toBe('თარიღი: 03/11/2031\nVIN: HH8TEST0000000017');
  });

  it('reads what Signify typed into the form fields, not only the print under them', async () => {
    const fonts = join(import.meta.dirname, '../src/assets/fonts');
    const doc = new PDFDocument({ size: 'A4' });
    doc.registerFont('geo', readFileSync(join(fonts, 'NotoSansGeorgian-Regular.ttf')));
    doc.initForm();
    const row = (label: string, value: string, y: number, unit = '') => {
      doc.font('geo').fontSize(11).text(label, 72, y);
      doc.font('Helvetica').formText(`f${y}`, 330, y, 140, 14, { value });
      if (unit) doc.font('geo').text(unit, 480, y);
    };
    row('დაბრუნებისა და საბოლოო ანგარიშსწორების აქტი თარიღი:', '03/11/2031', 80);
    row('ქირავნობის ხელშეკრულების თარიღი:', '06/09/2031', 120);
    row('VIN:', 'HH8TEST0000000017', 160);
    row('შეტანილი დეპოზიტის ოდენობა:', '180', 200, 'ლარი');
    row('დაკავებული თანხა:', '0', 240, 'ლარი');
    row('მოქირავისთვის ფაქტობრივად დაბრუნებული თანხა:', '180', 280, 'ლარი');
    doc.font('geo').text('7. დაკავებული თანხის საფუძველი', 72, 320);
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
    doc.end();
    const text = await pdfText(new Uint8Array(await done));
    expect(readReturnAct(text)).toEqual({ returnedOn: '2031-11-03', contractOn: '2031-09-06', vin: 'HH8TEST0000000017', depositTetri: 18000, withheldTetri: 0, paidBackTetri: 18000 });
  });

  it('reads the renter and the terms off a contract, after the company’s own part', () => {
    expect(readContractParty(PARTY)).toEqual({
      name: 'ნინო თუშიძე',
      personalId: '01234567890',
      phone: '+995 555 00 00 00',
      address: 'სატესტო ქუჩა 1',
      signedOn: '2031-09-06',
      vin: 'HH8TEST0000000017',
      rateTetri: 15000,
      depositTetri: 18000,
    });
    // An empty rate is none, not the deposit's sum.
    expect(readContractParty(PARTY.replace('• ქირა: 150 ლარი', '• ქირა: _____ ლარი')).rateTetri).toBeNull();
  });

  it('knows Signify’s documents by their text, whatever the file is called', () => {
    expect(kindOfText(PARTY)).toBe('contract');
    expect(kindOfText(ACT)).toBe('return_act');
    expect(kindOfText('')).toBeNull();
    // A VIN typed a letter short in the contract is read as it is, and found as the end of the moped's.
    expect(readContract(CONTRACT.replace('HH8TEST0000000017', 'H8TEST0000000017')).vin).toBe('H8TEST0000000017');
    const m = matchFolders([{ id: 'f', datedOn: '2031-09-06', person: 'Someone Else', vins: ['H8TEST0000000017'] }], [{ id: 'r', pickedUpOn: '2031-09-06', vin: 'HH8TEST0000000017', names: ['Nino Tushidze'] }]);
    expect(m.get('f')?.rentalId).toBe('r');
  });

  it('an empty field is nothing, not the next number on the page', () => {
    const blank = ['აქტი თარიღი: 1. მხარეები', 'შეტანილი დეპოზიტის ოდენობა: ____ ლარი', 'დაკავებული თანხა: ____ ლარი 7. საფუძველი'].join('\n');
    expect(readReturnAct(blank)).toMatchObject({ returnedOn: null, depositTetri: null, withheldTetri: null });
  });

  it('reads the same off a PDF with text', async () => {
    const text = await pdfText(new Uint8Array(await pdfOf(ACT)));
    expect(readReturnAct(text)).toMatchObject({ returnedOn: '2031-11-03', contractOn: '2031-09-06', depositTetri: 18000, withheldTetri: 3000, paidBackTetri: 15000 });
  });

  it('a folder is a renter’s by a word of the name spelt however, the day, or a VIN with the day — never the day alone', () => {
    // A letter typed wrong, Georgian against Latin.
    expect(sharedWords('Nini gulovani', ['Nino Gelovani'])).toBe(2);
    expect(sharedWords('ნინო თუშიძე', ['Nino Tushidze'])).toBe(2);
    expect(sharedWords('Someone Else', ['Nino Tushidze'])).toBe(0);
    const rentals = [
      { id: 'r1', pickedUpOn: '2031-09-06', vin: 'HH8TEST0000000017', names: ['Nino Tushidze'] },
      { id: 'r2', pickedUpOn: '2031-09-06', vin: 'HH8TEST0000000018', names: ['Shota Khachapuridze'] },
      { id: 'r3', pickedUpOn: '2031-08-01', vin: null, names: ['Zhuzhuna Japaradze'] },
    ];
    const m = matchFolders(
      [
        { id: 'f1', datedOn: '2031-09-06', person: 'Tushidze', vins: [] },
        { id: 'f2', datedOn: '2031-09-06', person: 'shota xachapuridze', vins: [] },
        { id: 'f3', datedOn: '2031-06-01', person: 'Zhuzhuna Japaradze', vins: [] },
        // The same day, nobody's name: no match.
        { id: 'f4', datedOn: '2031-09-06', person: 'Stranger Person', vins: [] },
        // The moped of r1 in an older renter's folder: not r1's.
        { id: 'f5', datedOn: '2031-05-01', person: 'Earlier Renter', vins: ['HH8TEST0000000017'] },
      ],
      rentals,
    );
    expect(Object.fromEntries([...m].map(([f, x]) => [f, x.rentalId]))).toEqual({ f1: 'r1', f2: 'r2', f3: 'r3' });
    expect(m.get('f1')?.by).toBe('name_date');
    expect(m.get('f3')?.by).toBe('name');
  });

  it('a finished folder needs the day or the VIN besides the name: a renter who came back has an older one', () => {
    const rentals = [{ id: 'r', pickedUpOn: '2031-10-08', vin: 'HH8TEST0000000029', names: ['Shota Khachapuridze'] }];
    const older = { id: 'old', datedOn: '2031-06-30', person: 'Khachapuridze Shota', vins: ['HH8TEST0000000021'] };
    expect(matchFolders([older], rentals, { nameAlone: false }).size).toBe(0);
    expect(matchFolders([older], rentals).get('old')?.rentalId).toBe('r');
    // The same moped again: the VIN is his, but the folder is months older.
    const sameMoped = { ...older, vins: ['HH8TEST0000000029'] };
    expect(matchFolders([sameMoped], rentals, { nameAlone: false }).size).toBe(0);
    const same = { id: 'same', datedOn: '2031-10-08', person: 'Khachapuridze Shota', vins: [] };
    expect(matchFolders([older, same], rentals, { nameAlone: false }).get('same')?.rentalId).toBe('r');
  });

  it('a return act dated before the pickup is an older rental’s, not this one’s (ADR-0034)', () => {
    expect(actAfterPickup('2031-11-03', '2031-10-08')).toBe(true);
    expect(actAfterPickup('2031-10-08', '2031-10-08')).toBe(true);
    expect(actAfterPickup('2031-07-01', '2031-10-08')).toBe(false);
    expect(actAfterPickup(null, '2031-10-08')).toBe(true);
  });

  it('a contract in Drive and a deal in Kommo for one person are one row, the deal’s link kept', () => {
    const contracts = [{ folderId: 'f1', who: 'Testadze Shota', datedOn: '2031-10-08' }, { folderId: 'f2', who: 'Nobody Else', datedOn: '2031-10-09' }];
    const deals = [
      { leadId: '1', kind: 'rent' as const, who: 'Shota Testadze', customerId: 'c1', phone: '+995555000001' },
      { leadId: '2', kind: 'rent' as const, who: 'Shota Otheradze', customerId: null, phone: null },
      { leadId: '3', kind: 'sale' as const, who: 'Nobody Else', customerId: null, phone: null },
    ];
    const r = joinKommoDeals(contracts, deals);
    expect(r.contracts[0]).toMatchObject({ folderId: 'f1', leadId: '1', customerId: 'c1', phone: '+995555000001' });
    // One shared word is not the same person; a sale is not a hand-over.
    expect(r.contracts[1]).toEqual(contracts[1]);
    expect(r.deals.map((d) => d.leadId)).toEqual(['2', '3']);
  });

  it('knows the two folders inside the shared one by their names', () => {
    expect(sectionOf('Aktiuri_Qiraoba')).toBe('active');
    expect(sectionOf('Dasrulebuli_Qiraoba_Depositis_dabruneba')).toBe('finished');
    expect(sectionOf('Other')).toBeNull();
  });

  it('a key is a service account’s JSON, and the request for a token is signed with it', () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    const key = JSON.stringify({ type: 'service_account', client_email: 'test@example.iam.gserviceaccount.com', private_key: privateKey });
    expect(driveConfig({ DRIVE_SA_KEY: Buffer.from(key).toString('base64'), DRIVE_ROOT: 'root-folder' })).toMatchObject({ clientEmail: 'test@example.iam.gserviceaccount.com', root: 'root-folder' });
    expect(driveConfig({ DRIVE_SA_KEY: key, DRIVE_ROOT: '' })).toBeNull();
    expect(driveConfig({ DRIVE_SA_KEY: '{"type":"user"}', DRIVE_ROOT: 'x' })).toBeNull();
    const jwt = assertion({ clientEmail: 'test@example.iam.gserviceaccount.com', privateKey });
    const claim = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString());
    expect(claim).toMatchObject({ iss: 'test@example.iam.gserviceaccount.com', scope: 'https://www.googleapis.com/auth/drive.readonly', aud: 'https://oauth2.googleapis.com/token' });
  });
});

describe.skipIf(!HAS_DB)('the rentals folders in Drive, read and laid beside the rentals (ADR-0031)', () => {
  it('a return act in Drive for a rental still running here is shown, with its deposit; a folder with no rental too', async () => {
    const { prisma } = await import('../src/lib/db.js');
    const { scanDrive } = await import('../src/lib/driveScan.js');
    // A running rental of a made-up renter, picked up on the folder's day.
    const owner = await loginAs('owner');
    const model = await prisma.vehicleModel.create({ data: { brand: 'Test', name: `Model ${uniq()}`, weeklyRateTetri: 15000, forRent: true } });
    const vin = `TESTD${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`;
    const vehicle = await prisma.vehicle.create({ data: { vin, modelId: model.id } });
    const surname = `Testadze${uniq().replace(/\D/g, '').slice(-5)}`;
    const customer = await prisma.customer.create({ data: { name: `Nino ${surname}`, nameLat: `Nino ${surname}` } });
    const made = await call(owner, 'POST', '/api/rentals', { customerId: customer.id, vehicleId: vehicle.id, weeklyRateTetri: '150', pickedUpOn: '2026-09-06' });
    expect(made.statusCode, made.body).toBe(201);
    const rentalId = json<{ id: string }>(made).id;
    // A second renter whose return act is in the folder while it still stands among the running ones.
    const vin2 = `TESTE${uniq().replace(/\D/g, '').slice(-12).padStart(12, '0')}`;
    const vehicle2 = await prisma.vehicle.create({ data: { vin: vin2, modelId: model.id } });
    const surname2 = `Testava${uniq().replace(/\D/g, '').slice(-5)}`;
    const customer2 = await prisma.customer.create({ data: { name: `Levan ${surname2}`, nameLat: `Levan ${surname2}` } });
    const made2 = await call(owner, 'POST', '/api/rentals', { customerId: customer2.id, vehicleId: vehicle2.id, weeklyRateTetri: '150', pickedUpOn: '2026-09-08' });
    expect(made2.statusCode, made2.body).toBe(201);
    const rentalId2 = json<{ id: string }>(made2).id;
    // A contract of this week with no rental here: "Today" asks for it to be entered.
    const fresh = todayISO(new Date(), 'Asia/Tbilisi').slice(2).replace(/-/g, '');

    // Google, played by a function: the shared folder, its two sections, the renters' folders, two documents.
    const act = await pdfOf(ACT.replace('HH8TEST0000000017', vin));
    const act2 = await pdfOf(ACT.replace('HH8TEST0000000017', vin2));
    const contract = await pdfOf(PARTY.replace('06/09/2031', '07/09/2026'));
    const tree: Record<string, { id: string; name: string; mimeType: string }[]> = {
      root: [
        { id: 'sec-active', name: 'Aktiuri_Qiraoba', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'sec-done', name: 'Dasrulebuli_Qiraoba_Depositis_dabruneba', mimeType: 'application/vnd.google-apps.folder' },
      ],
      'sec-active': [
        { id: 'f-stranger', name: '260907 Stranger Testperson', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'f-levan', name: `260908 Levan ${surname2}`, mimeType: 'application/vnd.google-apps.folder' },
        { id: 'f-fresh', name: `${fresh} Fresh Testperson`, mimeType: 'application/vnd.google-apps.folder' },
      ],
      'f-levan': [{ id: 'doc-act2', name: '261103 დაბრუნებისა და საბოლოო ანგარიშსწორების აქტი test.pdf', mimeType: 'application/pdf' }],
      'f-fresh': [{ id: 'doc-fresh', name: `${fresh} Fresh.pdf`, mimeType: 'application/pdf' }],
      'sec-done': [{ id: 'm-11', name: '11', mimeType: 'application/vnd.google-apps.folder' }],
      'm-11': [{ id: 'f-nino', name: `260906 Nino ${surname}`, mimeType: 'application/vnd.google-apps.folder' }],
      'f-stranger': [
        { id: 'doc-scan', name: '260907 Stranger.pdf', mimeType: 'application/pdf' },
        // Signify's contract under an English name, as Kardu filed one on 17.10.2026.
        { id: 'doc-contract', name: 'Rental agreement — Test Person — 2026-09-07.pdf', mimeType: 'application/pdf' },
      ],
      'f-nino': [
        { id: 'doc-act', name: '261103 დაბრუნებისა და საბოლოო ანგარიშსწორების აქტი test.pdf', mimeType: 'application/pdf' },
        { id: 'doc-photo', name: 'Nino ID.JPG', mimeType: 'image/jpeg' },
      ],
    };
    const asked: string[] = [];
    const fakeFetch = (async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      asked.push(url.replace(/\?.*/, ''));
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        expect(String(init?.body)).toContain('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer');
        return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200 });
      }
      const m = /\/files\/([^/?]+)\?alt=media/.exec(url);
      if (m) return new Response(m[1] === 'doc-act' ? act : m[1] === 'doc-act2' ? act2 : m[1] === 'doc-contract' ? contract : 'not a pdf', { status: 200 });
      const parent = /'([^']+)' in parents/.exec(new URL(url).searchParams.get('q') ?? '')?.[1] ?? '';
      const files = (tree[parent] ?? []).map((f) => ({ ...f, modifiedTime: '2026-11-03T10:00:00.000Z', webViewLink: `https://drive.example/${f.id}` }));
      return new Response(JSON.stringify({ files }), { status: 200 });
    }) as typeof fetch;

    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    process.env.DRIVE_SA_KEY = JSON.stringify({ type: 'service_account', client_email: 'test@example.iam.gserviceaccount.com', private_key: privateKey });
    process.env.DRIVE_ROOT = 'root';
    forgetToken();
    try {
      const outcome = await scanDrive(fakeFetch);
      expect(outcome).toMatchObject({ status: 'ok', folders: 4, files: 5, read: 5 });
      // Every PDF read once; the photo listed and never asked for.
      expect(asked.filter((u) => u.includes('/files/doc-')).sort()).toEqual(['doc-act', 'doc-act2', 'doc-contract', 'doc-fresh', 'doc-scan'].map((id) => `https://www.googleapis.com/drive/v3/files/${id}`));
      expect((await prisma.driveFile.findUniqueOrThrow({ where: { id: 'doc-contract' } })).kind).toBe('contract');
      expect((await prisma.driveFile.findUniqueOrThrow({ where: { id: 'doc-scan' } })).kind).toBe('scan');

      const r = json<{
        on: boolean;
        returnedThere: { rental: { id: string }; act: { returnedOn: string; depositTetri: number; withheldTetri: number; paidBackTetri: number } | null }[];
        missingHere: { name: string }[];
        missingThere: { id: string }[];
      }>(await call(owner, 'GET', '/api/drive/reconciliation'));
      expect(r.on).toBe(true);
      expect(r.returnedThere.find((x) => x.rental.id === rentalId)?.act).toMatchObject({ returnedOn: '2031-11-03', depositTetri: 18000, withheldTetri: 3000, paidBackTetri: 15000 });
      expect(r.missingHere.map((x) => x.name)).toContain('260907 Stranger Testperson');
      // The act is in the folder among the running ones: the moped is back all the same (ADR-0034).
      expect(r.returnedThere.find((x) => x.rental.id === rentalId2)?.act).toMatchObject({ returnedOn: '2031-11-03', paidBackTetri: 15000 });

      // "Today": the return to close, the new contract to enter; the September folder is too old to ask about.
      type Q = { queue: { group: string; rows: { id: string; action: string; href: string; note: string | null }[] }[] };
      const rows = (q: Q) => q.queue.flatMap((g) => g.rows);
      const mine = rows(json<Q>(await call(owner, 'GET', '/api/today')));
      expect(mine.find((x) => x.id === `drive_return:${rentalId}`)).toMatchObject({ action: 'close_from_drive', href: `/rentals/${rentalId}/return`, note: '2031-11-03|15000' });
      expect(mine.find((x) => x.id === `drive_return:${rentalId2}`)?.action).toBe('close_from_drive');
      expect(mine.find((x) => x.id === 'drive_contract:f-fresh')).toMatchObject({ action: 'hand_over_from_drive', href: '/rentals/new?drive=f-fresh' });
      expect(mine.some((x) => x.id === 'drive_contract:f-stranger')).toBe(false);
      const managers = rows(json<Q>(await call(await loginAs('manager'), 'GET', '/api/today')));
      expect(managers.some((x) => x.id.startsWith('drive_'))).toBe(false);
      // The rental has its folder (a finished one), so it is not "with no folder".
      expect(r.missingThere.map((x) => x.id)).not.toContain(rentalId);

      const card = json<{ rental: { drive: { returnActUrl: string | null } | null } }>(await call(owner, 'GET', `/api/rentals/${rentalId}`));
      expect(card.rental.drive?.returnActUrl).toBe('https://drive.example/doc-act');

      // A second read asks for nothing it has read: the act is not downloaded again.
      asked.length = 0;
      expect(await scanDrive(fakeFetch)).toMatchObject({ status: 'ok', read: 0 });
      expect(asked.some((u) => u.includes('/files/doc-act'))).toBe(false);

      // «Завести аренду»: the wizard's fields, read off the contract there and then; nothing of the person kept in the copy.
      const missing = r.missingHere.find((x) => x.name === '260907 Stranger Testperson') as { id?: string } | undefined;
      expect(missing?.id).toBe('f-stranger');
      const realFetch = globalThis.fetch;
      globalThis.fetch = fakeFetch;
      try {
        const p = json<{ fromContract: boolean; name: string; personalId: string; phone: string; pickedUpOn: string; rateTetri: number; depositTetri: number; customer: unknown }>(
          await call(owner, 'GET', '/api/drive/folders/f-stranger/prefill'),
        );
        expect(p).toMatchObject({ fromContract: true, name: 'ნინო თუშიძე', personalId: '01234567890', phone: '+995 555 00 00 00', pickedUpOn: '2026-09-07', rateTetri: 15000, depositTetri: 18000, customer: null });
      } finally {
        globalThis.fetch = realFetch;
      }
      const kept = await prisma.driveFile.findUniqueOrThrow({ where: { id: 'doc-contract' } });
      expect(JSON.stringify(kept)).not.toContain('01234567890');
      expect(await prisma.auditLog.count({ where: { action: 'drive.prefill', entityId: 'f-stranger' } })).toBeGreaterThan(0);

      const manager = await loginAs('manager');
      expect((await call(manager, 'GET', '/api/drive/reconciliation')).statusCode).toBe(403);
      expect((await call(manager, 'GET', '/api/drive/folders/f-stranger/prefill')).statusCode).toBe(403);
    } finally {
      delete process.env.DRIVE_SA_KEY;
      delete process.env.DRIVE_ROOT;
      forgetToken();
      await prisma.driveFolder.deleteMany({});
    }
  });
});
