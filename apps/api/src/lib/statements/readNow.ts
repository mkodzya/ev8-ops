import { bogBusy, bogConfig, readBogNow, type BogOutcome } from '../bog.js';
import { readTbcNow, tbcBusy, tbcConfig, type TbcOutcome } from '../tbc.js';
import type { ApiBank, BankCurrency } from './apiDays.js';

// «Прочитать сейчас» on "Деньги → Выписки" (Mika, 29.10.2026: «давай сделаем
// кнопку тоже»): both banks asked at once for what the worker asks them every
// five minutes and every hour — the day's operations, and the night, which
// reads the past days of a pair not read yet (a new account in dollars reads
// back a month) and does nothing once they are read. The same functions as the
// jobs, in the same chain of each bank: no second copy of the bank's rules.
//
// A bank whose keys are not on the stand is skipped and not named. The banks'
// limits belong to the stand, not to a person — Bank of Georgia gives one
// statement a minute and some 800 lists of the day's operations a day for each
// account and currency, and the worker spends 288 of those — so whoever asks,
// the stand asks at most once a minute. In this process only: a restart, which
// takes longer than that, starts with none.

/** How long after a reading the next may be asked. */
export const READ_NOW_GAP_MS = 60_000;

/** What one pair of account and currency brought: counts and our words, by its last four digits. */
export interface PairRead {
  last4: string;
  currency: BankCurrency;
  /** New lines, of the day and of the past days together: in the queue for lari, parked for another currency. */
  added: number;
  /** The past days read for this pair; none when they were read already. */
  days: string[];
  /** Our word for why the bank gave nothing, or not everything, for this pair; null when it answered. */
  failure: string | null;
}

export interface BankRead {
  bank: ApiBank;
  /** Nothing came from this bank — no account to ask, or it refused every one: the first refusal's word. */
  failure: string | null;
  accounts: PairRead[];
}

export type ReadNow =
  // No bank's keys are on the stand.
  | { status: 'off' }
  // A job of a bank is running or waits for its turn: nothing is asked, and the minute is not spent.
  | { status: 'busy' }
  // The banks were asked less than a minute ago: the seconds until they may be asked again.
  | { status: 'too_soon'; seconds: number }
  | { status: 'ok'; banks: BankRead[]; seconds: number };

let lastAt: number | null = null;
/** The clock the minute is kept on, and the banks' days are read by; a test may hold it. */
let clockMs: () => number = Date.now;

/** Tests start from banks never asked by a person, on the real clock. */
export function resetReadNowForTests(): void {
  lastAt = null;
  clockMs = Date.now;
}

/** Tests hold the clock, or move it a minute on. */
export function setReadNowClockForTests(fn: () => number): void {
  clockMs = fn;
}

/**
 * Ask every bank that is on, at once, and say per pair what came. The checks
 * and the claim of the minute run before the first await: two presses at the
 * same moment make one reading.
 */
export async function readBanksNow(): Promise<ReadNow> {
  if (!bogConfig() && !tbcConfig()) return { status: 'off' };
  const now = clockMs();
  const left = lastAt == null ? 0 : lastAt + READ_NOW_GAP_MS - now;
  if (left > 0) return { status: 'too_soon', seconds: Math.ceil(left / 1000) };
  if (bogBusy() || tbcBusy()) return { status: 'busy' };
  lastAt = now;
  const at = new Date(now);
  const [bog, tbc] = await Promise.all([readBogNow(at), readTbcNow(at)]);
  const banks = [bankRead('bog', bog), bankRead('tbc', tbc)].filter((b): b is BankRead => b != null);
  return { status: 'ok', banks, seconds: READ_NOW_GAP_MS / 1000 };
}

/**
 * The day's reading and the night's, pair by pair. A reading that failed as a
 * whole failed for every pair of the bank: its word is each pair's that has
 * none of its own, and the bank's when no pair answered at all.
 */
function bankRead(bank: ApiBank, read: { status: 'off' } | { status: 'read'; today: BogOutcome | TbcOutcome; night: BogOutcome | TbcOutcome }): BankRead | null {
  if (read.status === 'off') return null;
  const pairs = new Map<string, PairRead>();
  let whole: string | null = null;
  for (const o of [read.today, read.night]) {
    if (o.status === 'failed') whole ??= o.failure;
    if (o.status !== 'ok') continue;
    for (const a of o.accounts) {
      const key = `${a.last4} ${a.currency}`;
      const was = pairs.get(key) ?? { last4: a.last4, currency: a.currency, added: 0, days: [], failure: null };
      pairs.set(key, { ...was, added: was.added + a.added, days: [...was.days, ...(a.days ?? [])], failure: was.failure ?? a.failure });
    }
  }
  const accounts = [...pairs.values()].map((p) => ({ ...p, failure: p.failure ?? whole }));
  return { bank, failure: accounts.length === 0 ? whole : null, accounts };
}
