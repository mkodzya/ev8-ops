// The clock.
//
// Every night in Asia/Tbilisi the worker asks the API to roll rental weeks
// forward (RNT-02) and to put any credit a customer is holding onto the new
// week (PAY-06). It does not do that work itself: those are money rules and
// there is one copy of them, in the API. Later jobs that talk to the outside
// world — WhatsApp reminders, the BOG statement pull — will live here with
// their own logic.
//
// Every few minutes it also asks the API to ask Kommo who is renting
// (ADR-0012: the account's plan has no webhooks, so the link polls). The
// asking itself happens in the API, where the Kommo token and the database
// are; the worker holds neither and is only the clock here too.
import { ORG_TZ, todayISO } from '@ev8/shared';
import cron from 'node-cron';

const API = (process.env.API_URL ?? 'http://api:8080').replace(/\/+$/, '');
const TOKEN = process.env.WORKER_TOKEN ?? 'dev-worker-token';
const PERIODS_CRON = process.env.PERIODS_CRON ?? '10 0 * * *';
const KOMMO_CRON = process.env.KOMMO_CRON ?? '*/5 * * * *';
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
  console.log(`worker: up — weeks roll at "${PERIODS_CRON}" ${TZ}, Kommo is asked at "${KOMMO_CRON}"`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
