// The one door to the translator (ADR-0042). The real SDK runs, and a
// stand-in answers for the service: nothing leaves the machine. The key and
// every note here are invented test values; no name in them is a person's.
import { afterEach, describe, expect, it } from 'vitest';

const KEY = 'sk-ant-test-invented-key-not-a-real-one-000000';
const NOTE = 'не тормозит задний, поменяли колодки';

interface Asked {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}
type Reply = { status: number; body: unknown } | 'throw';

/** The service as the test scripts it: one answer, and what it was asked. */
function fakeService(reply: Reply) {
  const asked: Asked[] = [];
  const fn = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => (headers[k] = v));
    const raw = init?.body ?? (input instanceof Request ? await input.text() : '{}');
    asked.push({ url, headers, body: JSON.parse(typeof raw === 'string' ? raw : '{}') as Record<string, unknown> });
    // A failed connection may quote what it was sending; the door must not keep it.
    if (reply === 'throw') throw new TypeError(`fetch failed: connect ECONNREFUSED (${KEY}) ${NOTE}`);
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json', 'request-id': 'req_test_0000' } });
  };
  return { fn, asked };
}

/** A message the service would send back, with the JSON the model wrote. */
const message = (text: string, stop_reason = 'end_turn', extra: Record<string, unknown> = {}) => ({
  id: 'msg_test_0000',
  type: 'message',
  role: 'assistant',
  model: 'claude-haiku-5-5',
  content: [{ type: 'text', text }],
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 412, output_tokens: 96 },
  ...extra,
});
const refusedBy = (status: number, type: string, msg: string) => ({ status, body: { type: 'error', error: { type, message: msg } } });

async function door(reply: Reply) {
  const t = await import('../src/lib/translator.js');
  const service = fakeService(reply);
  t.setTranslatorFetchForTests(service.fn);
  const cfg = t.translatorConfig({ ANTHROPIC_API_KEY: KEY })!;
  const result = await t.translateText(cfg, NOTE).catch((e: unknown) => e);
  return { result, asked: service.asked, t };
}

afterEach(async () => {
  const { setTranslatorFetchForTests } = await import('../src/lib/translator.js');
  setTranslatorFetchForTests(null);
});

describe('the translator’s door (ADR-0042)', () => {
  it('is on only with a key of its shape; Haiku 5.5 and 500 a day unless the stand says otherwise', async () => {
    const { translatorConfig } = await import('../src/lib/translator.js');
    expect(translatorConfig({})).toBeNull();
    expect(translatorConfig({ ANTHROPIC_API_KEY: 'not-a-key' })).toBeNull();
    expect(translatorConfig({ ANTHROPIC_API_KEY: 'sk-ant-short' })).toBeNull();
    expect(translatorConfig({ ANTHROPIC_API_KEY: `${KEY} # comment` })).toBeNull();
    expect(translatorConfig({ ANTHROPIC_API_KEY: ` ${KEY} ` })).toEqual({ apiKey: KEY, model: 'claude-haiku-5-5', dailyLimit: 500 });
    expect(translatorConfig({ ANTHROPIC_API_KEY: KEY, TRANSLATE_MODEL: 'claude-opus-5-5', TRANSLATE_DAILY_LIMIT: '50' })).toEqual({ apiKey: KEY, model: 'claude-opus-5-5', dailyLimit: 50 });
    // A model or a limit that is not one falls back, rather than switching the translator off.
    expect(translatorConfig({ ANTHROPIC_API_KEY: KEY, TRANSLATE_MODEL: 'gpt; rm', TRANSLATE_DAILY_LIMIT: 'lots' })).toMatchObject({ model: 'claude-haiku-5-5', dailyLimit: 500 });
  });

  it('asks once, with the note as data, at low effort, for one fixed shape — and the key only in its header', async () => {
    const { result, asked, t } = await door({ status: 200, body: message(JSON.stringify({ lang: 'ru', ka: 'უკანა არ მუხრუჭავს, ხუნდები შევცვალეთ', ru: '', en: 'the rear does not brake, pads replaced' })) });
    expect(asked).toHaveLength(1);
    const [a] = asked;
    expect(a!.url).toMatch(/\/v1\/messages$/);
    expect(a!.headers['x-api-key']).toBe(KEY);
    expect(JSON.stringify(a!.body)).not.toContain(KEY);
    expect(a!.body).toMatchObject({
      model: 'claude-haiku-5-5',
      system: t.SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `<note>\n${NOTE}\n</note>` }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: t.ANSWER_SCHEMA } },
    });
    // Haiku 5.5 takes no sampling settings and no prefill (the claude-api reference).
    expect(a!.body).not.toHaveProperty('temperature');
    expect(a!.body).not.toHaveProperty('fallbacks');
    expect(result).toEqual({
      ok: true,
      lang: 'ru',
      ka: 'უკანა არ მუხრუჭავს, ხუნდები შევცვალეთ',
      ru: null,
      en: 'the rear does not brake, pads replaced',
      usage: { inputTokens: 412, outputTokens: 96 },
    });
  });

  it('keeps the note’s own language empty even when the model filled it in', async () => {
    const { result } = await door({ status: 200, body: message(JSON.stringify({ lang: 'en', ka: 'ka words', ru: 'ru words', en: 'the brakes squeak' })) });
    expect(result).toMatchObject({ ok: true, lang: 'en', ka: 'ka words', ru: 'ru words', en: null });
  });

  it('gives no translation when the model declines, runs out of room or answers in another shape — each still counted', async () => {
    const usage = { inputTokens: 412, outputTokens: 96 };
    expect((await door({ status: 200, body: message('', 'refusal', { stop_details: { type: 'refusal', category: 'general_harms', explanation: 'test' } }) })).result).toEqual({ ok: false, failure: 'refused', usage });
    expect((await door({ status: 200, body: message('{"lang":"ru","ka":"…', 'max_tokens') })).result).toEqual({ ok: false, failure: 'too_long', usage });
    for (const text of ['not json', '[]', '{"lang":"de","ka":"a","ru":"b","en":"c"}', '{"lang":"ru","ka":"","ru":"","en":"x"}', '{"lang":"other","ka":"a","ru":"b"}']) {
      expect((await door({ status: 200, body: message(text) })).result, text).toEqual({ ok: false, failure: 'bad_answer', usage });
    }
  });

  it('turns every refusal of the service into our word, with neither the key nor the note in it', async () => {
    const { TranslatorError } = await import('../src/lib/translator.js');
    const cases: [Reply, Record<string, unknown>][] = [
      [refusedBy(401, 'authentication_error', 'invalid x-api-key'), { failure: 'unauthorized', httpStatus: 401 }],
      [refusedBy(403, 'permission_error', 'not allowed'), { failure: 'unauthorized', httpStatus: 403 }],
      [refusedBy(404, 'not_found_error', 'model: claude-haiku-5-5'), { failure: 'no_model', httpStatus: 404 }],
      [refusedBy(429, 'rate_limit_error', 'slow down'), { failure: 'rate_limited', httpStatus: 429 }],
      [refusedBy(400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API.'), { failure: 'billing', httpStatus: 400 }],
      [refusedBy(402, 'billing_error', 'payment required'), { failure: 'billing' }],
      [refusedBy(400, 'invalid_request_error', 'something about the request'), { failure: 'bad_request', httpStatus: 400 }],
      [refusedBy(500, 'api_error', 'internal'), { failure: 'http', httpStatus: 500 }],
      [refusedBy(529, 'overloaded_error', 'overloaded'), { failure: 'overloaded', httpStatus: 529 }],
      ['throw', { failure: 'network', httpStatus: null }],
    ];
    for (const [reply, expected] of cases) {
      const { result } = await door(reply);
      expect(result).toBeInstanceOf(TranslatorError);
      expect(result).toMatchObject(expected);
      for (const said of [String(result), JSON.stringify(result)]) {
        expect(said).not.toContain(KEY);
        expect(said).not.toContain(NOTE);
        expect(said).not.toMatch(/credit balance|invalid x-api-key|slow down|overloaded_error/);
      }
    }
  });

  it('reads an answer by the rules, without the SDK', async () => {
    const { readAnswer } = await import('../src/lib/translator.js');
    expect(readAnswer('{"lang":"ka","ka":"","ru":" тормоза ","en":"brakes"}')).toEqual({ lang: 'ka', ka: null, ru: 'тормоза', en: 'brakes' });
    expect(readAnswer('{"lang":"other","ka":"ა","ru":"б","en":"c"}')).toEqual({ lang: 'other', ka: 'ა', ru: 'б', en: 'c' });
    expect(readAnswer('{"lang":"ka","ru":"тормоза","en":"brakes"}')).toEqual({ lang: 'ka', ka: null, ru: 'тормоза', en: 'brakes' });
    expect(readAnswer('{"lang":"ka","ka":"","ru":"тормоза"}')).toBeNull();
    expect(readAnswer('null')).toBeNull();
  });
});
