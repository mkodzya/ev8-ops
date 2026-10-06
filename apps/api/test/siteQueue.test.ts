// The site's queue request goes to the mailbox, and nowhere else. These cases
// need no database: the route reads no session and stores nothing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { QueueLimiter, composeQueueMail, parseQueueRequest, siteMailConfig, type SiteMailConfig } from '../src/lib/siteQueue.js';
import { setSiteMailerForTests } from '../src/routes/site.js';
import { getApp } from './helpers.js';

const MAIL_ENV = {
  SITE_MAIL_HOST: 'smtp.example.test',
  SITE_MAIL_USER: 'box@example.test',
  SITE_MAIL_PASSWORD: 'not-a-real-password',
};

describe('the mail settings', () => {
  it('are off unless host, user and password are all there', () => {
    expect(siteMailConfig({})).toBeNull();
    expect(siteMailConfig({ ...MAIL_ENV, SITE_MAIL_PASSWORD: '' })).toBeNull();
  });

  it('write to the mailbox itself unless told otherwise, over 465 by default', () => {
    expect(siteMailConfig(MAIL_ENV)).toMatchObject({ port: 465, to: 'box@example.test' });
    expect(siteMailConfig({ ...MAIL_ENV, SITE_MAIL_TO: 'other@example.test', SITE_MAIL_PORT: '587' })).toMatchObject({
      port: 587,
      to: 'other@example.test',
    });
  });
});

describe('a queue request', () => {
  it('keeps a name and a phone, and reduces the phone to its digits', () => {
    const r = parseQueueRequest({ name: ' Test  Courier ', phone: '+995 (555) 12-34-56', lang: 'en' });
    expect(r).toEqual({ ok: true, request: { name: 'Test Courier', phone: '+995555123456', text: '', lang: 'en', page: '' } });
  });

  it('names the field that is wrong', () => {
    expect(parseQueueRequest({ phone: '+995555123456' })).toEqual({ ok: false, field: 'name' });
    expect(parseQueueRequest({ name: 'A', phone: '12345' })).toEqual({ ok: false, field: 'phone' });
    expect(parseQueueRequest({ name: 'A', phone: 'call me 555123456' })).toEqual({ ok: false, field: 'phone' });
    expect(parseQueueRequest({ name: 'A', phone: '555123456', text: 'x'.repeat(2001) })).toEqual({ ok: false, field: 'text' });
  });

  it('cannot start a new header line from the name', () => {
    const r = parseQueueRequest({ name: 'A\r\nBcc: someone@example.test', phone: '555123456' });
    expect(r.ok === true && r.request.name).toBe('A Bcc: someone@example.test');
  });

  it('is a bot when the hidden field is filled', () => {
    expect(parseQueueRequest({ name: 'A', phone: '555123456', website: 'x' })).toEqual({ ok: 'bot' });
  });

  it('becomes an email with the name in the subject and the text below', () => {
    const mail = composeQueueMail(
      { name: 'Test Courier', phone: '+995555123456', text: 'Model: example', lang: 'ka', page: '/en/subscription/' },
      new Date('2026-10-06T12:00:00Z'),
    );
    expect(mail.subject).toBe('EV8 site: queue request — Test Courier');
    expect(mail.text).toContain('Phone:    +995555123456');
    expect(mail.text).toContain('16:00:00 (Tbilisi)');
    expect(mail.text.trimEnd().endsWith('Model: example')).toBe(true);
  });
});

describe('the limit', () => {
  it('lets one phone through three times an hour, and everybody thirty times', () => {
    const l = new QueueLimiter();
    const t = 1_000_000;
    expect([1, 2, 3, 4].map(() => l.allow('1', t))).toEqual([true, true, true, false]);
    expect(l.allow('1', t + 60 * 60 * 1000)).toBe(true);
    const all = new QueueLimiter(3, 2);
    expect([all.allow('1', t), all.allow('2', t), all.allow('3', t)]).toEqual([true, true, false]);
  });
});

describe('POST /api/site/queue', () => {
  let sent: { cfg: SiteMailConfig; subject: string; text: string }[] = [];
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.ALLOW_DEV_SECRET = 'true';
    Object.assign(process.env, MAIL_ENV);
    sent = [];
    setSiteMailerForTests(async (cfg, mail) => {
      sent.push({ cfg, ...mail });
    });
  });
  afterEach(() => {
    for (const k of Object.keys(MAIL_ENV)) delete process.env[k];
    Object.assign(process.env, saved);
  });

  const post = async (payload: unknown) =>
    (await getApp()).inject({ method: 'POST', url: '/api/site/queue', payload: payload as object });

  it('sends one email and answers 202, without a session', async () => {
    const res = await post({ name: 'Test Courier', phone: '+995555123456', text: 'Model: example', lang: 'en' });
    expect(res.statusCode).toBe(202);
    expect(sent).toHaveLength(1);
    expect(sent[0].cfg.to).toBe('box@example.test');
    expect(sent[0].text).toContain('Test Courier');
  });

  it('is off, and says so, while the mailbox is not set up', async () => {
    delete process.env.SITE_MAIL_PASSWORD;
    const res = await post({ name: 'Test Courier', phone: '+995555123456' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'site_mail_off' });
    expect(sent).toHaveLength(0);
  });

  it('refuses a bad phone, and tells a bot it worked without sending', async () => {
    expect((await post({ name: 'A', phone: '1' })).json()).toEqual({ error: 'bad_site_request', field: 'phone' });
    const bot = await post({ name: 'A', phone: '+995555123456', website: 'spam' });
    expect(bot.statusCode).toBe(202);
    expect(sent).toHaveLength(0);
  });

  it('stops the fourth request from one phone within the hour', async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post({ name: 'A', phone: '+995555123456' })).statusCode);
    expect(codes).toEqual([202, 202, 202, 429]);
  });

  it('answers 502 when the mailbox refuses, and logs no name or phone', async () => {
    setSiteMailerForTests(async () => {
      throw new Error('auth failed');
    });
    const res = await post({ name: 'Test Courier', phone: '+995555123456' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'site_mail_failed' });
  });
});
