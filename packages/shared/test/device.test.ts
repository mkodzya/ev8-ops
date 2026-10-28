// What a person leaves on a shared device, and what a sign-in forgets of it
// (QA before 1.17.0; ADR-0033 §9): a draft stays for whoever wrote it, and
// another person signing in after a session that ended without «Выйти» finds
// nothing of the last one's. Every id here is invented.
import { describe, expect, it } from 'vitest';
import { DRAFT_PREFIX, LAST_PERSON_KEY, RECENT_SEARCH_KEY, isDeviceLeftover, leftoversToForget } from '../src/index.js';

const KEYS = [`${DRAFT_PREFIX}todo-new`, `${DRAFT_PREFIX}job-new:vehicle-1`, RECENT_SEARCH_KEY, 'ev8-lang', 'ev8-signed-out', LAST_PERSON_KEY];

describe('a person’s leftovers on a shared device', () => {
  it('are the drafts and the recent searches; the language, the last person and a sign-out owed are the device’s', () => {
    expect(KEYS.filter(isDeviceLeftover)).toEqual([`${DRAFT_PREFIX}todo-new`, `${DRAFT_PREFIX}job-new:vehicle-1`, RECENT_SEARCH_KEY]);
    expect(isDeviceLeftover(LAST_PERSON_KEY)).toBe(false);
  });

  it('wait for the person who left them: the same person signing in again forgets nothing', () => {
    expect(leftoversToForget(KEYS, 'person-a', 'person-a')).toEqual([]);
  });

  it('go when another person signs in after him', () => {
    expect(leftoversToForget(KEYS, 'person-a', 'person-b')).toEqual([`${DRAFT_PREFIX}todo-new`, `${DRAFT_PREFIX}job-new:vehicle-1`, RECENT_SEARCH_KEY]);
  });

  it('go when nobody is known to have signed in here: they may be anybody’s', () => {
    expect(leftoversToForget(KEYS, null, 'person-b')).toEqual([`${DRAFT_PREFIX}todo-new`, `${DRAFT_PREFIX}job-new:vehicle-1`, RECENT_SEARCH_KEY]);
  });

  it('leave a device with none of them as it is', () => {
    expect(leftoversToForget(['ev8-lang', LAST_PERSON_KEY], 'person-a', 'person-b')).toEqual([]);
  });
});
