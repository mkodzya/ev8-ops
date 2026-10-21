// The clock.
//
// Every night in Asia/Tbilisi the worker asks the API to roll rental weeks
// forward (RNT-02) and to put any credit a customer is holding onto the new
// week (PAY-06). It does not do that work itself: those are money rules and
// there is one copy of them, in the API.
//
// Every few minutes it also asks the API to ask Kommo who is renting
// (ADR-0012: the account's plan has no webhooks, so the link polls). The
// asking itself happens in the API, where the Kommo token and the database
// are; the worker holds neither and is only the clock here too.
//
// Bank of Georgia the same way (B11-03, Mika 14.10.2026): every five minutes
// the API asks the bank for the day's operations — 288 of the 800 requests a
// day the bank allows — and once a night it reads the full statement up to
// yesterday so nothing the day's pulls missed is lost. The night is asked
// again every hour and on every start; it does nothing once yesterday is read,
// so a night the bank did not answer is caught up within the hour.
//
// TBC the same way (ADR-0026), two minutes after each Bank of Georgia pull and
// half an hour off its night, so the two banks' lines do not meet the same
// hand-entered payment at the same moment: the day's movements every five
// minutes, and once a night yesterday read whole and checked against the
// bank's own sums for it.
//
// The notices to the workshop's Telegram group (ADR-0038 §6–7) are sent by the
// API right after each event, where the bot's token is. Every minute the
// worker asks it to send what did not go; hourly by day it asks it to look for
// mopeds due for their maintenance and parts below the minimum — from 09:00 to
// 20:00 Tbilisi time, so the group is not woken at night.
import { ORG_TZ, todayISO } from '@ev8/shared';
import cron from 'node-cron';

const API = (process.env.API_URL ?? 'http://api:8080').replace(/\/+$/, '');
const TOKEN = process.env.WORKER_TOKEN ?? 'dev-worker-token';
const PERIODS_CRON = process.env.PERIODS_CRON ?? '10 0 * * *';
const KOMMO_CRON = process.env.KOMMO_CRON ?? '*/5 * * * *';
const BOG_CRON = process.env.BOG_CRON ?? '*/5 * * * *';
// Off the five-minute marks, so the night does not queue behind a pull; every
// hour, and the first that finds yesterday unread reads it (01:17 normally).
const BOG_NIGHT_CRON = process.env.BOG_NIGHT_CRON ?? '17 * * * *';
const TBC_CRON = process.env.TBC_CRON ?? '2-59/5 * * * *';
const TBC_NIGHT_CRON = process.env.TBC_NIGHT_CRON ?? '47 * * * *';
// The rentals folders in Drive, read once a night (ADR-0031).
const DRIVE_CRON = process.env.DRIVE_CRON ?? '23 3 * * *';
const NOTICES_CRON = process.env.NOTICES_CRON ?? '* * * * *';
const NOTICES_SCAN_CRON = process.env.NOTICES_SCAN_CRON ?? '0 9-20 * * *';
const TZ = process.env.TZ ?? ORG_TZ;

interface RollResult {
  rentals: number;
  created: number;
  settledTetri: number;
}

async function rollPeriods(): Promise<RollResult> {
  const res = await fetch(`${API}/api/jobs/roll-periods`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-worker-token': TOKEN },
    body: JSON.stringify({ asOf: todayISO(new Date(), TZ) }),
  });
  if (!res.ok) throw new Error(`roll-periods: ${res.status} ${await res.text()}`);
  return (await res.json()) as RollResult;
}

type KommoOutcome = { status: 'off' } | { status: 'busy' } | { status: 'ok'; leads: number; contactsRead: boolean } | { status: 'failed'; failure: string; httpStatus: number | null };

// What the last poll said, so the log gets a line when something changes and
// not 288 identical ones a day. With no token the API answers `off`, and that
// is said once.
let kommoSaid = '';

async function pollKommo(): Promise<void> {
  let line: string;
  try {
    const res = await fetch(`${API}/api/jobs/kommo-sync`, { method: 'POST', headers: { 'x-worker-token': TOKEN } });
    if (!res.ok) throw new Error(`kommo-sync: ${res.status}`);
    const r = (await res.json()) as KommoOutcome;
    if (r.status === 'busy') return;
    line =
      r.status === 'off'
        ? 'the Kommo link is off (no token on this stand)'
        : r.status === 'ok'
          ? `Kommo answered — ${r.leads} deal(s) in the rented stage${r.contactsRead ? '' : ', contact names not read'}`
          : `Kommo did not answer — ${r.failure}${r.httpStatus ? ` (${r.httpStatus})` : ''}`;
  } catch (err) {
    line = `the Kommo poll did not reach the API — ${(err as Error).message}`;
  }
  if (line !== kommoSaid) console.log(`worker: ${line}`);
  kommoSaid = line;
}

type BankOutcome =
  | { status: 'off' }
  | { status: 'busy' }
  | {
      status: 'ok';
      listed: number;
      added: number;
      recorded: number;
      matched: number;
      known: { byKey: number; byId?: number; byDoc: number; bySum: number };
      days: string[];
      fromStatement?: boolean;
      mismatched?: string[];
    }
  | { status: 'failed'; failure: string; httpStatus: number | null; stage?: string | null };

type DriveOutcome =
  | { status: 'off' }
  | { status: 'busy' }
  | { status: 'ok'; folders: number; files: number; read: number; matched: number }
  | { status: 'failed'; failure: string; httpStatus: number | null };

let driveSaid = '';

/** Counts and our own words only: the folders are named by the renters. */
async function readDrive(): Promise<void> {
  let line: string;
  try {
    const res = await fetch(`${API}/api/jobs/drive-scan`, { method: 'POST', headers: { 'x-worker-token': TOKEN } });
    if (!res.ok) throw new Error(`drive-scan: ${res.status}`);
    const r = (await res.json()) as DriveOutcome;
    if (r.status === 'busy') return;
    line =
      r.status === 'off'
        ? 'the Drive link is off (no key on this stand)'
        : r.status === 'ok'
          ? `Drive read — ${r.folders} folder(s), ${r.files} document(s), ${r.read} read anew, ${r.matched} folder(s) with their rental`
          : `Drive did not answer — ${r.failure}${r.httpStatus ? ` (${r.httpStatus})` : ''}`;
  } catch (err) {
    line = `the Drive read did not reach the API — ${(err as Error).message}`;
  }
  if (line !== driveSaid || line.startsWith('Drive read')) console.log(`worker: ${line}`);
  driveSaid = line;
}

type Bank = 'bog' | 'tbc';
const BANK_NAME: Record<Bank, string> = { bog: 'Bank of Georgia', tbc: 'TBC' };

// What each job last said, so the log gets a line when something changes.
const said: Record<string, string> = {};

/** Counts and our own words only: the bank's answers carry names and account numbers. */
async function askBank(bank: Bank, part: 'today' | 'night'): Promise<void> {
  const job = `${bank}-${part}`;
  const name = BANK_NAME[bank];
  const night = part === 'night';
  let line: string;
  let always = false;
  try {
    const res = await fetch(`${API}/api/jobs/${job}`, { method: 'POST', headers: { 'x-worker-token': TOKEN } });
    if (!res.ok) throw new Error(`${job}: ${res.status}`);
    const r = (await res.json()) as BankOutcome;
    if (r.status === 'busy') return;
    if (r.status === 'off') line = `the ${name} link is off (no keys on this stand)`;
    else if (r.status === 'failed')
      line = `${name} did not answer${night ? ' with the statement' : ''} — ${r.failure}${r.httpStatus ? ` (${r.httpStatus})` : ''}${r.stage ? ` at the ${r.stage === 'token' ? 'token' : 'API'}` : ''}`;
    else {
      const byId = r.known.byId ?? 0;
      const known = r.known.byKey + byId + r.known.byDoc + r.known.bySum;
      const added = r.added ? `${r.added} new line(s), ${r.recorded} linked to payments entered by hand, ${r.matched} attached by a rule` : 'nothing new';
      const other = byId + r.known.byDoc + r.known.bySum;
      // How a line from a file was known matters while the join of file and API is unproven (ADR-0021, ADR-0026).
      const from = other ? `; ${other} already in from another source${byId ? ` (${byId} by the bank's transaction id, ${r.known.byDoc + r.known.bySum} by day and sum)` : ''}` : '';
      const off = r.mismatched?.length ? `; the movements of ${r.mismatched.join(', ')} do not add up to the bank's statement — read again within the hour` : '';
      line = night
        ? r.days.length
          ? `${name} statement ${r.days[0]}…${r.days[r.days.length - 1]} — ${r.listed} entr(ies), ${known} already in${from}, ${added}${off}`
          : `${name} statement — the nights are read`
        : `${name} answered${r.fromStatement ? ' through today’s statement (the day’s list did not)' : ''} — ${r.listed} operation(s) today, ${added}${from}`;
      always = r.added > 0 || (night && r.days.length > 0);
    }
  } catch (err) {
    line = `the ${name} ${night ? 'statement' : 'pull'} did not reach the API — ${(err as Error).message}`;
  }
  if (always || line !== said[job]) console.log(`worker: ${line}`);
  said[job] = line;
}

type NoticeOutcome = { status: 'off' | 'busy' | 'ok'; sent: number; failed: number; pending: number; maintenance?: number; stock?: number };

/** Counts only: the bot's token is in the address the API asks Telegram at, and it never comes back here. */
async function sendNotices(job: 'notices' | 'notices-scan'): Promise<void> {
  let line: string;
  let always = false;
  try {
    const res = await fetch(`${API}/api/jobs/${job}`, { method: 'POST', headers: { 'x-worker-token': TOKEN } });
    if (!res.ok) throw new Error(`${job}: ${res.status}`);
    const r = (await res.json()) as NoticeOutcome;
    if (r.status === 'busy') return;
    if (r.status === 'off') line = 'the Telegram link is off (no bot token or group on this stand)';
    else {
      const found = job === 'notices-scan' ? `; looked again — ${r.maintenance ?? 0} moped(s) newly due for maintenance, ${r.stock ?? 0} part(s) newly below the minimum` : '';
      line = `Telegram — ${r.sent} notice(s) sent, ${r.failed} not taken, ${r.pending} waiting${found}`;
      always = r.sent > 0 || r.failed > 0 || (r.maintenance ?? 0) + (r.stock ?? 0) > 0;
    }
  } catch (err) {
    line = `the notices did not reach the API — ${(err as Error).message}`;
  }
  if (always || line !== said[job]) console.log(`worker: ${line}`);
  said[job] = line;
}

async function waitForApi(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${API}/api/health`);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    console.log('worker: waiting for the API…');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('the API never became ready');
}

async function run(label: string): Promise<void> {
  try {
    const r = await rollPeriods();
    console.log(
      `worker: ${label} — ${r.rentals} open rental(s), ${r.created} week(s) opened, ${(r.settledTetri / 100).toFixed(2)} GEL of credit placed`,
    );
  } catch (err) {
    console.error('worker: roll failed', err);
  }
}

async function main(): Promise<void> {
  await waitForApi();
  await run('on boot');
  cron.schedule(PERIODS_CRON, () => void run(todayISO(new Date(), TZ)), { timezone: TZ });
  await pollKommo();
  cron.schedule(KOMMO_CRON, () => void pollKommo(), { timezone: TZ });
  await askBank('bog', 'today');
  await askBank('bog', 'night');
  cron.schedule(BOG_CRON, () => void askBank('bog', 'today'), { timezone: TZ });
  cron.schedule(BOG_NIGHT_CRON, () => void askBank('bog', 'night'), { timezone: TZ });
  await askBank('tbc', 'today');
  await askBank('tbc', 'night');
  cron.schedule(TBC_CRON, () => void askBank('tbc', 'today'), { timezone: TZ });
  cron.schedule(TBC_NIGHT_CRON, () => void askBank('tbc', 'night'), { timezone: TZ });
  await readDrive();
  cron.schedule(DRIVE_CRON, () => void readDrive(), { timezone: TZ });
  // What waits goes on start too; the looking-for is never done on start — a
  // worker restarted at night would wake the group.
  await sendNotices('notices');
  cron.schedule(NOTICES_CRON, () => void sendNotices('notices'), { timezone: TZ });
  cron.schedule(NOTICES_SCAN_CRON, () => void sendNotices('notices-scan'), { timezone: TZ });
  console.log(
    `worker: up — weeks roll at "${PERIODS_CRON}" ${TZ}, Kommo is asked at "${KOMMO_CRON}", Bank of Georgia at "${BOG_CRON}" and its statement at "${BOG_NIGHT_CRON}", TBC at "${TBC_CRON}" and its statement at "${TBC_NIGHT_CRON}", Drive is read at "${DRIVE_CRON}", notices go at "${NOTICES_CRON}" and are looked for at "${NOTICES_SCAN_CRON}"`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
