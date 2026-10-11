// The site's anonymous counter: what the site may report, and how the report
// adds it up. The first cases need no database; the last suite posts beacons
// and reads them back, comparing before and after so other suites' counts on
// the same day do not matter.
import { todayISO } from '@ev8/shared';
import { describe, expect, it } from 'vitest';
import { HitLimiter, parseHit, segmentOf, type SiteReport } from '../src/lib/siteCounter.js';
import { HAS_DB, call, getApp, json, loginAs } from './helpers.js';

describe('what the site may report', () => {
  it('a visit, a page, a WhatsApp button and the answers — each with its language', () => {
    expect(parseHit({ e: 'visit', l: 'ka' })).toEqual({ metric: 'visit', key: 'ka' });
    expect(parseHit({ e: 'view', l: 'en', p: 'subscription/' })).toEqual({ metric: 'view', key: 'en:subscription/' });
    expect(parseHit({ e: 'view', l: 'ka', p: '' })).toEqual({ metric: 'view', key: 'ka:' });
    expect(parseHit({ e: 'whatsapp', l: 'ka', p: 'models/' })).toEqual({ metric: 'whatsapp', key: 'ka:models/' });
    expect(parseHit({ e: 'answers', l: 'ka', a: [0, 3, 2] })).toEqual({ metric: 'answers', key: '0.3.2' });
  });

  it('nothing outside the closed lists', () => {
    expect(parseHit(null)).toBeNull();
    expect(parseHit('visit')).toBeNull();
    expect(parseHit({ e: 'visit', l: 'de' })).toBeNull();
    expect(parseHit({ e: 'view', l: 'ka', p: 'wp-admin/' })).toBeNull();
    expect(parseHit({ e: 'view', l: 'ka' })).toBeNull();
    expect(parseHit({ e: 'answers', l: 'ka', a: [2, 0, 0] })).toBeNull();
    expect(parseHit({ e: 'answers', l: 'ka', a: [0, 0] })).toBeNull();
    expect(parseHit({ e: 'answers', l: 'ka', a: [0, 1.5, 0] })).toBeNull();
    // A request is counted by the API when the mail goes out, never on the browser's word.
    expect(parseHit({ e: 'request', l: 'ka' })).toBeNull();
  });

  it('reads who this is the way the site does', () => {
    expect(segmentOf([1, 0, 0])).toBe('novice');
    expect(segmentOf([0, 0, 1])).toBe('petrol');
    expect(segmentOf([0, 1, 2])).toBe('car');
    expect(segmentOf([0, 2, 0])).toBe('electric');
    expect(segmentOf([0, 3, 0])).toBe('other');
  });

  it('drops what comes faster than the ceiling, and starts again the next minute', () => {
    let now = 0;
    const l = new HitLimiter(2, () => now);
    expect([l.allow(), l.allow(), l.allow()]).toEqual([true, true, false]);
    now = 60_000;
    expect(l.allow()).toBe(true);
  });
});

describe('POST /api/site/hit', () => {
  it('refuses what the site cannot say, without a session', async () => {
    const res = await (await getApp()).inject({ method: 'POST', url: '/api/site/hit', payload: { e: 'view', l: 'ka', p: 'nope/' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad_site_hit' });
  });
});

describe.skipIf(!HAS_DB)('the counter, end to end', () => {
  const hit = async (body: object, asText = false) =>
    (await getApp()).inject({
      method: 'POST',
      url: '/api/site/hit',
      payload: asText ? JSON.stringify(body) : body,
      headers: asText ? { 'content-type': 'text/plain;charset=UTF-8' } : {},
    });

  it('adds up per day what the site sent, and only an owner reads it', async () => {
    const today = todayISO();
    const owner = await loginAs('owner');
    const read = async () => json<SiteReport>(await call(owner, 'GET', `/api/reports/site?from=${today}&to=${today}`));
    const before = await read();

    // sendBeacon posts text/plain: read as JSON all the same.
    expect((await hit({ e: 'visit', l: 'ka' }, true)).statusCode).toBe(204);
    await hit({ e: 'visit', l: 'en' });
    await hit({ e: 'view', l: 'ka', p: '' });
    await hit({ e: 'view', l: 'ka', p: 'models/' });
    await hit({ e: 'view', l: 'en', p: 'models/' });
    await hit({ e: 'whatsapp', l: 'ka', p: 'models/' });
    await hit({ e: 'answers', l: 'ka', a: [1, 3, 0] });
    await hit({ e: 'answers', l: 'ka', a: [0, 0, 1] });

    const after = await read();
    const page = (r: SiteReport, p: string) => r.pages.find((x) => x.page === p)!;
    expect(after.empty).toBe(false);
    expect(after.visits.total - before.visits.total).toBe(2);
    expect(after.visits.byLang.en - before.visits.byLang.en).toBe(1);
    expect(page(after, 'models/').views - page(before, 'models/').views).toBe(2);
    expect(page(after, '').views - page(before, '').views).toBe(1);
    expect(page(after, 'models/').whatsapp - page(before, 'models/').whatsapp).toBe(1);
    expect(after.whatsapp - before.whatsapp).toBe(1);
    expect(after.answers.total - before.answers.total).toBe(2);
    expect(after.answers.segments.novice - before.answers.segments.novice).toBe(1);
    expect(after.answers.segments.petrol - before.answers.segments.petrol).toBe(1);
    expect(after.answers.questions[2]![1]! - before.answers.questions[2]![1]!).toBe(1);
    expect(after.days.at(-1)?.day).toBe(today);

    expect((await call(null, 'GET', `/api/reports/site?from=${today}&to=${today}`)).statusCode).toBe(401);
    const manager = await loginAs('manager');
    expect((await call(manager, 'GET', `/api/reports/site?from=${today}&to=${today}`)).statusCode).toBe(403);
  });

  it('a period with nothing counted says so', async () => {
    const owner = await loginAs('owner');
    const r = json<SiteReport>(await call(owner, 'GET', '/api/reports/site?from=2001-01-01&to=2001-01-07'));
    expect(r.empty).toBe(true);
    expect(r.visits.total).toBe(0);
    expect(r.pages).toHaveLength(8);
  });
});
