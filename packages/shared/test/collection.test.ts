// «Взыскание» (ADR-0054): the ladder after the reminders. Days in November
// 2026 with no Georgian Orthodox holiday in them, but one test on purpose.
import { describe, expect, it } from 'vitest';
import { blockedSince, collectionStep, type CollectionEvent, type CollectionFacts } from '../src/collection.js';

const DUE = '2026-11-02'; // the payment day; 03 and 04 are the reminders' days
const facts = (events: CollectionEvent[] = [], more: Partial<CollectionFacts> = {}): CollectionFacts => ({
  status: 'overdue',
  pickedUpOn: '2026-10-26',
  dueOn: DUE,
  owesTetri: 15000,
  off: false,
  events,
  ...more,
});

describe('the collection ladder (ADR-0054)', () => {
  it('starts on the 3rd day late, after the two days of reminders', () => {
    expect(collectionStep(facts(), '2026-11-04')).toBeNull();
    expect(collectionStep(facts(), '2026-11-05')).toEqual({ step: 'call', stage: 3 });
    expect(collectionStep(facts(), '2026-11-12')).toEqual({ step: 'call', stage: 3 });
  });

  it('a call that failed puts the block on the next day, not the same one', () => {
    const failed: CollectionEvent[] = [{ kind: 'call', on: '2026-11-05', outcome: 'no_answer' }];
    expect(collectionStep(facts(failed), '2026-11-05')?.step).toBe('call');
    expect(collectionStep(facts(failed), '2026-11-06')?.step).toBe('block');
    const refused: CollectionEvent[] = [{ kind: 'call', on: '2026-11-05', outcome: 'refuses' }];
    expect(collectionStep(facts(refused), '2026-11-06')?.step).toBe('block');
  });

  it('a promise is waited for until its day; after it, a call again — not the block', () => {
    const promised: CollectionEvent[] = [
      { kind: 'call', on: '2026-11-05', outcome: 'no_answer' },
      { kind: 'call', on: '2026-11-06', outcome: 'promised', promisedOn: '2026-11-09' },
    ];
    expect(collectionStep(facts(promised), '2026-11-06')).toEqual({ step: 'waiting', stage: 3, until: '2026-11-09' });
    expect(collectionStep(facts(promised), '2026-11-09')?.step).toBe('waiting');
    // Late with the promise: called again, and the failure before the promise does not count.
    expect(collectionStep(facts(promised), '2026-11-10')?.step).toBe('call');
    const thenSilent = [...promised, { kind: 'call' as const, on: '2026-11-10', outcome: 'no_answer' as const }];
    expect(collectionStep(facts(thenSilent), '2026-11-11')?.step).toBe('block');
  });

  it('«pays today» is waited for until the evening', () => {
    const today: CollectionEvent[] = [{ kind: 'call', on: '2026-11-05', outcome: 'paid_today' }];
    expect(collectionStep(facts(today), '2026-11-05')).toMatchObject({ step: 'waiting', until: '2026-11-05' });
    expect(collectionStep(facts(today), '2026-11-06')?.step).toBe('call');
  });

  it('blocked: pick-up while owing; paid since — take the block off; unblocked — the ladder again', () => {
    const blocked: CollectionEvent[] = [
      { kind: 'call', on: '2026-11-05', outcome: 'no_answer' },
      { kind: 'blocked', on: '2026-11-06' },
    ];
    expect(collectionStep(facts(blocked), '2026-11-06')).toEqual({ step: 'pickup', stage: null, blockedOn: '2026-11-06' });
    expect(collectionStep(facts(blocked, { owesTetri: 0, status: 'active' }), '2026-11-07')).toEqual({ step: 'unblock', stage: null, blockedOn: '2026-11-06' });
    const unblocked = [...blocked, { kind: 'unblocked' as const, on: '2026-11-07' }];
    expect(blockedSince(unblocked)).toBeNull();
    expect(collectionStep(facts(unblocked, { owesTetri: 0, status: 'active' }), '2026-11-08')).toBeNull();
  });

  it('nothing for one who paid, one whose reminders a person switched off, a calls before this debt', () => {
    expect(collectionStep(facts([], { owesTetri: 0, status: 'active' }), '2026-11-05')).toBeNull();
    expect(collectionStep(facts([], { off: true }), '2026-11-05')).toBeNull();
    // A failed call about an earlier debt is not this one's.
    const old: CollectionEvent[] = [{ kind: 'call', on: '2026-10-20', outcome: 'no_answer' }];
    expect(collectionStep(facts(old), '2026-11-06')?.step).toBe('call');
  });

  it('a Georgian Orthodox holiday moves the ladder a day, as it moves the reminders', () => {
    // 23 November is a holiday: due on the 21st, the 3rd day that counts is the 25th.
    const f = facts([], { dueOn: '2026-11-21' });
    expect(collectionStep(f, '2026-11-24')).toBeNull();
    expect(collectionStep(f, '2026-11-25')?.step).toBe('call');
  });
});
