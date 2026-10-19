// The rentals folders in Google Drive (ADR-0031). Every name, number, date and
// folder here is made up; no request leaves the test — Google is a stand-in.
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import { HAS_DB, call, json, loginAs, uniq } from './helpers.js';
import { assertion, driveConfig, forgetToken } from '../src/lib/drive.js';
import { fileKind, folderName, matchFolders, pdfText, readContract, readReturnAct, readingOrder, sharedWords } from '../src/lib/driveDocs.js';
import { sectionOf } from '../src/lib/driveScan.js';

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

/** A PDF with text, as Signify makes them — here made with the API's own fonts. */
async function pdfOf(text: string): Promise<Buffer> {
  const fonts = join(import.meta.dirname, '../src/assets/fonts');
  const doc = new PDFDocument({ size: 'A4' });
  doc.registerFont('geo', readFileSync(join(fonts, 'NotoSansGeorgian-Regular.ttf')));
  doc.registerFont('lat', readFileSync(join(fonts, 'NotoSans-Regular.ttf')));
  doc.fontSize(11);
  // Each run in the font that has its letters: the Georgian one has no digits.
  for (const line of text.split('\n')) {
    const runs = line.match(/[\u10A0-\u10FF]+(?:[ ,.-]+[\u10A0-\u10FF]+)*|[^\u10A0-\u10FF]+/g) ?? [''];
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

    // Google, played by a function: the shared folder, its two sections, the renters' folders, two documents.
    const act = await pdfOf(ACT.replace('HH8TEST0000000017', vin));
    const tree: Record<string, { id: string; name: string; mimeType: string }[]> = {
      root: [
        { id: 'sec-active', name: 'Aktiuri_Qiraoba', mimeType: 'application/vnd.google-apps.folder' },
        { id: 'sec-done', name: 'Dasrulebuli_Qiraoba_Depositis_dabruneba', mimeType: 'application/vnd.google-apps.folder' },
      ],
      'sec-active': [{ id: 'f-stranger', name: '260907 Stranger Testperson', mimeType: 'application/vnd.google-apps.folder' }],
      'sec-done': [{ id: 'm-11', name: '11', mimeType: 'application/vnd.google-apps.folder' }],
      'm-11': [{ id: 'f-nino', name: `260906 Nino ${surname}`, mimeType: 'application/vnd.google-apps.folder' }],
      'f-stranger': [{ id: 'doc-scan', name: '260907 Stranger.pdf', mimeType: 'application/pdf' }],
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
      if (m) return new Response(m[1] === 'doc-act' ? act : 'not a pdf', { status: 200 });
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
      expect(outcome).toMatchObject({ status: 'ok', folders: 2, files: 2, read: 1 });
      // The photo was listed and never asked for; only the act was downloaded.
      expect(asked.filter((u) => u.includes('/files/doc-'))).toEqual(['https://www.googleapis.com/drive/v3/files/doc-act']);

      const r = json<{
        on: boolean;
        returnedThere: { rental: { id: string }; act: { returnedOn: string; depositTetri: number; withheldTetri: number; paidBackTetri: number } | null }[];
        missingHere: { name: string }[];
        missingThere: { id: string }[];
      }>(await call(owner, 'GET', '/api/drive/reconciliation'));
      expect(r.on).toBe(true);
      expect(r.returnedThere.find((x) => x.rental.id === rentalId)?.act).toMatchObject({ returnedOn: '2031-11-03', depositTetri: 18000, withheldTetri: 3000, paidBackTetri: 15000 });
      expect(r.missingHere.map((x) => x.name)).toContain('260907 Stranger Testperson');
      // The rental has its folder (a finished one), so it is not "with no folder".
      expect(r.missingThere.map((x) => x.id)).not.toContain(rentalId);

      const card = json<{ rental: { drive: { returnActUrl: string | null } | null } }>(await call(owner, 'GET', `/api/rentals/${rentalId}`));
      expect(card.rental.drive?.returnActUrl).toBe('https://drive.example/doc-act');

      // A second read asks for nothing it has read: the act is not downloaded again.
      asked.length = 0;
      expect(await scanDrive(fakeFetch)).toMatchObject({ status: 'ok', read: 0 });
      expect(asked.some((u) => u.includes('/files/doc-act'))).toBe(false);

      const manager = await loginAs('manager');
      expect((await call(manager, 'GET', '/api/drive/reconciliation')).statusCode).toBe(403);
    } finally {
      delete process.env.DRIVE_SA_KEY;
      delete process.env.DRIVE_ROOT;
      forgetToken();
      await prisma.driveFolder.deleteMany({});
    }
  });
});
