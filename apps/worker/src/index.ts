// Background worker. Stage 1 job: roll weekly rental periods forward every
// night in Asia/Tbilisi (RNT-02) — while a rental is active, each period
// that should exist by today is created once; nothing is ever duplicated,
// so the job can run as often as it likes. Later stages add WhatsApp
// reminders, the BOG statement pull and Kommo fan-out here.
import { ORG_TZ, PERIOD_DAYS, periodsThrough, todayISO } from '@ev8/shared';
import cron from 'node-cron';
import pg from 'pg';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://ev8ops:ev8ops@localhost:5433/ev8ops';
const PERIODS_CRON = process.env.PERIODS_CRON ?? '10 0 * * *';
const TZ = process.env.TZ ?? ORG_TZ;

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 3 });

async function waitForDb(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      console.log('worker: waiting for database…');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error('database never became ready');
}

interface OpenRental {
  id: string;
  number: string;
  picked_up_on: string;
  weekly_rate_tetri: number;
  max_seq: number | null;
}

/** Create the periods that should exist by `asOf` for every active rental. Idempotent. */
export async function rollPeriods(asOf = todayISO(new Date(), TZ)): Promise<{ rentals: number; created: number }> {
  const { rows } = await pool.query<OpenRental>(
    `SELECT r.id, r.number, to_char(r.picked_up_on, 'YYYY-MM-DD') AS picked_up_on, r.weekly_rate_tetri,
            (SELECT max(seq) FROM rental_periods p WHERE p.rental_id = r.id) AS max_seq
       FROM rentals r
      WHERE r.status IN ('active', 'overdue')
        AND r.picked_up_on IS NOT NULL
        AND r.returned_on IS NULL`,
  );
  let created = 0;
  for (const r of rows) {
    const wanted = periodsThrough(r.picked_up_on, asOf);
    const have = r.max_seq ?? 0;
    for (const p of wanted) {
      if (p.seq <= have) continue;
      await pool.query(
        `INSERT INTO rental_periods (rental_id, seq, starts_on, ends_on, amount_tetri)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (rental_id, seq) DO NOTHING`,
        [r.id, p.seq, p.startsOn, p.endsOn, r.weekly_rate_tetri],
      );
      created++;
    }
  }
  return { rentals: rows.length, created };
}

async function main(): Promise<void> {
  await waitForDb();
  const first = await rollPeriods();
  console.log(`worker: periods rolled on boot — ${first.rentals} open rental(s), ${first.created} period(s) created`);

  cron.schedule(
    PERIODS_CRON,
    async () => {
      try {
        const r = await rollPeriods();
        console.log(`worker: ${todayISO(new Date(), TZ)} periods — ${r.rentals} open rental(s), ${r.created} created`);
      } catch (err) {
        console.error('worker: periods failed', err);
      }
    },
    { timezone: TZ },
  );
  console.log(`worker: up — periods of ${PERIOD_DAYS} days roll at "${PERIODS_CRON}" ${TZ}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
