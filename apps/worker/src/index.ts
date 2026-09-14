// The clock.
//
// Every night in Asia/Tbilisi the worker asks the API to roll rental weeks
// forward (RNT-02) and to put any credit a customer is holding onto the new
// week (PAY-06). It does not do that work itself: those are money rules and
// there is one copy of them, in the API. Later jobs that talk to the outside
// world — WhatsApp reminders, the BOG statement pull — will live here with
// their own logic.
import { ORG_TZ, todayISO } from '@ev8/shared';
import cron from 'node-cron';

const API = (process.env.API_URL ?? 'http://api:8080').replace(/\/+$/, '');
const TOKEN = process.env.WORKER_TOKEN ?? 'dev-worker-token';
const PERIODS_CRON = process.env.PERIODS_CRON ?? '10 0 * * *';
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
  console.log(`worker: up — weeks roll at "${PERIODS_CRON}" ${TZ}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
