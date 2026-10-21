// The planned maintenance (stage 6; ADR-0038 §1–3). The plan's «Сдан» points:
// the first one at the nearest multiple of 5 000, a planned repair closing
// moves the next one, no mileage — no maintenance, overdue after passing the
// mark, the interval and the warning from the settings.
import { describe, expect, it } from 'vitest';
import { MAINTENANCE_INTERVAL_KM, MAINTENANCE_WARN_KM, latestReading, maintenanceDue, nextMaintenance, type MileageReading } from '../src/index.js';

const at = (day: string, time = '12:00') => `${day}T${time}:00+04:00`;
const next = (readings: MileageReading[], lastPlannedKm: number | null = null, intervalKm = MAINTENANCE_INTERVAL_KM, warnKm = MAINTENANCE_WARN_KM) =>
  nextMaintenance({ readings, lastPlannedKm, intervalKm, warnKm });

describe('the first maintenance is at the nearest multiple of the interval', () => {
  it('first read at 4 820 km: due at 5 000, 180 left, so it is time', () => {
    expect(next([{ km: 4820, at: at('2026-10-15') }])).toEqual({
      state: 'soon',
      currentKm: 4820,
      currentAt: '2026-10-15T08:00:00.000Z',
      firstKm: 4820,
      dueKm: 5000,
      leftKm: 180,
    });
  });

  it('a new moped at 0 km waits for 5 000, not for 0', () => {
    expect(next([{ km: 0, at: at('2026-10-15') }])).toMatchObject({ state: 'ok', dueKm: 5000, leftKm: 5000 });
  });

  it('first read at exactly 5 000 km: due now', () => {
    expect(next([{ km: 5000, at: at('2026-10-15') }])).toMatchObject({ state: 'soon', dueKm: 5000, leftKm: 0 });
  });

  it('first read at 12 300 km: due at 15 000', () => {
    expect(next([{ km: 12300, at: at('2026-10-15') }])).toMatchObject({ state: 'ok', dueKm: 15000, leftKm: 2700 });
  });

  it('the mark is counted from the first reading and does not move ahead with the mileage', () => {
    const readings = [
      { km: 4820, at: at('2026-10-15') },
      { km: 5150, at: at('2026-10-18') },
    ];
    // Passed 5 000 with no maintenance: overdue by 150, not «next at 10 000».
    expect(next(readings)).toMatchObject({ state: 'overdue', currentKm: 5150, firstKm: 4820, dueKm: 5000, leftKm: -150 });
  });

  it('reads the latest and the earliest by time, not by size: a replaced odometer reads less later', () => {
    const readings = [
      { km: 3000, at: at('2026-10-20') },
      { km: 4900, at: at('2026-10-15') },
    ];
    expect(next(readings)).toMatchObject({ currentKm: 3000, firstKm: 4900, dueKm: 5000, leftKm: 2000, state: 'ok' });
  });

  it('two readings at the same minute: the higher is the current one, the lower the first', () => {
    const same = at('2026-10-15', '10:00');
    expect(next([{ km: 4700, at: same }, { km: 4710, at: new Date(same) }])).toMatchObject({ currentKm: 4710, firstKm: 4700 });
  });
});

describe('a closed planned repair moves the next maintenance', () => {
  it('closed at 4 980: the next one is at 9 980', () => {
    const readings = [
      { km: 4820, at: at('2026-10-15') },
      { km: 4980, at: at('2026-10-17') },
    ];
    expect(next(readings)).toMatchObject({ state: 'soon', dueKm: 5000 });
    expect(next(readings, 4980)).toMatchObject({ state: 'ok', dueKm: 9980, leftKm: 5000 });
  });

  it('is overdue again once that mark is passed', () => {
    expect(next([{ km: 10_100, at: at('2026-11-30') }], 4980)).toMatchObject({ state: 'overdue', dueKm: 9980, leftKm: -120 });
  });
});

describe('the reading now', () => {
  it('is the latest by time, not the highest; at the same moment the higher one', () => {
    const r = [
      { km: 5300, at: at('2026-10-15', '10:00'), source: 'return' },
      { km: 5360, at: at('2026-10-16', '09:00'), source: 'repair_open' },
      { km: 9000, at: at('2026-10-14'), source: 'pickup' },
    ];
    expect(latestReading(r)).toEqual(r[1]);
    expect(latestReading([...r, { km: 5400, at: at('2026-10-16', '09:00'), source: 'repair_close' }])?.km).toBe(5400);
    expect(latestReading([])).toBeNull();
  });
});

describe('no mileage — no maintenance (ADR-0038 §1)', () => {
  it('says «unknown» and invents no figure', () => {
    expect(next([])).toEqual({ state: 'unknown', currentKm: null, currentAt: null, firstKm: null, dueKm: null, leftKm: null });
    // A planned repair with no reading of its own still leaves nothing to count from.
    expect(next([], 4980).state).toBe('unknown');
    expect(maintenanceDue('unknown')).toBe(false);
  });
});

describe('the interval and the warning come from the settings', () => {
  it('a 6 000 km interval puts the first mark at 6 000', () => {
    expect(next([{ km: 4820, at: at('2026-10-15') }], null, 6000)).toMatchObject({ dueKm: 6000, leftKm: 1180, state: 'ok' });
  });

  it('a warning of 200 km leaves 250 km left «ok», a warning of 300 calls it', () => {
    const r = [{ km: 4750, at: at('2026-10-15') }];
    expect(next(r, null, 5000, 200).state).toBe('ok');
    expect(next(r, null, 5000, 300).state).toBe('soon');
    // A warning of nought calls a moped only once it is past the mark.
    expect(next(r, null, 5000, 0).state).toBe('ok');
    expect(next([{ km: 5001, at: at('2026-10-15') }], 0, 5000, 0).state).toBe('overdue');
  });

  it('«Пора на ТО» is «soon» and «overdue», nothing else', () => {
    expect(['unknown', 'ok', 'soon', 'overdue'].filter((s) => maintenanceDue(s as never))).toEqual(['soon', 'overdue']);
  });
});
