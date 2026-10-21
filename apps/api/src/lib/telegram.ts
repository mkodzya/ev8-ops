// The Telegram link: sending only (stage 6; ADR-0032 §2, ADR-0038 §6–7).
//
// EV8 Ops tells one group of the workshop what happened, through the bot the
// owner registered himself (Mika, 21.10.2026: «новый бот, который я заведу
// сам, и одна группа мастерской»). It asks Telegram for two things only —
// who the bot is, and to send a message — and never for updates: there is no
// webhook and no `getUpdates`, and a button in a message would bring presses
// nobody here receives, so a notice carries a link instead.
//
// The token is a server secret (CLAUDE.md rule 3): Mika puts it and the
// group on the stand himself (`deploy/set-telegram.sh`). Telegram takes the
// token in the path of the address, so the address is built in one place,
// below, and goes nowhere else: no error, outcome or log line carries it. A
// failure is one of our own words and a status code — Telegram's own
// description is not kept either. Without the token or the group the link is
// off, quietly, the way the site's mail is off without its password.

export interface TelegramConfig {
  token: string;
  /** The workshop's group; a group's id is negative. */
  chatId: string;
}

/** A bot token as BotFather gives it: the bot's number, a colon, and the secret. */
const TOKEN_SHAPE = /^\d+:[\w-]{30,}$/;
const CHAT_SHAPE = /^-?\d+$/;

/** Null without both, or with either not of its shape: the link is then off. */
export function telegramConfig(e: NodeJS.ProcessEnv = process.env): TelegramConfig | null {
  const token = (e.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = (e.TELEGRAM_CHAT_ID ?? '').trim();
  if (!TOKEN_SHAPE.test(token) || !CHAT_SHAPE.test(chatId)) return null;
  return { token, chatId };
}

/** Why Telegram took nothing: our word for it, never its answer. */
export type TelegramFailure =
  | 'unauthorized' // the token is not (or no longer) a bot's
  | 'rate_limited' // too many messages: try again after the pause Telegram names
  | 'chat_not_found' // no such group, or the bot is not in it
  | 'chat_moved' // the group became a supergroup with another id
  | 'forbidden' // the bot was removed from the group or may not write there
  | 'bad_request' // Telegram did not take this message: sending it again will not help
  | 'http' // Telegram's side failed
  | 'network' // no answer
  | 'bad_answer'; // an answer that is not Telegram's

export class TelegramError extends Error {
  constructor(
    readonly failure: TelegramFailure,
    readonly httpStatus: number | null = null,
    /** For `rate_limited`: how many seconds Telegram asked to wait. */
    readonly retryAfterSec: number | null = null,
  ) {
    super(`telegram: ${failure}${httpStatus ? ` (${httpStatus})` : ''}`);
  }
}

/** The part of `fetch` this needs, so a test can stand in for Telegram. */
export type TelegramFetch = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ status: number; json: () => Promise<unknown> }>;

const API = 'https://api.telegram.org';
const TIMEOUT_MS = 15_000;
// Telegram lets a bot write about one message a second into a chat and twenty
// a minute into a group. One every three seconds stays under both, across
// every run of the sender — a notice kicked off by a closing and the worker's
// minute do not add up past it.
const MIN_GAP_MS = 3_000;
let lastSendAt = 0;

export interface TelegramClientOptions {
  fetch?: TelegramFetch;
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});

export class TelegramClient {
  private readonly fetchFn: TelegramFetch;
  private readonly gapMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly cfg: TelegramConfig,
    opts: TelegramClientOptions = {},
  ) {
    this.fetchFn = opts.fetch ?? (fetch as unknown as TelegramFetch);
    this.gapMs = opts.gapMs ?? MIN_GAP_MS;
    this.sleep = opts.sleep ?? realSleep;
    this.now = opts.now ?? Date.now;
  }

  /**
   * The one door to Telegram: the token goes into the address here and only
   * here, and a refusal becomes one of our words here. Two methods, both
   * that only send or only describe the bot itself.
   */
  private async call(method: 'getMe' | 'sendMessage', payload: Record<string, unknown>): Promise<unknown> {
    let res: Awaited<ReturnType<TelegramFetch>>;
    try {
      res = await this.fetchFn(`${API}/bot${this.cfg.token}/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The cause is dropped on purpose: a fetch error can quote the address, and the address holds the token.
      throw new TelegramError('network');
    }
    let body: Record<string, unknown> | null = null;
    try {
      body = obj(await res.json());
    } catch {
      body = null;
    }
    if (res.status >= 200 && res.status < 300) {
      if (body?.ok === true) return body.result;
      throw new TelegramError('bad_answer', res.status);
    }
    const code = typeof body?.error_code === 'number' ? body.error_code : res.status;
    // Read to tell two refusals apart, and not kept: it is Telegram's text, not ours.
    const said = typeof body?.description === 'string' ? body.description : '';
    // A token Telegram does not know is answered 404 as often as 401.
    if (code === 401 || code === 404) throw new TelegramError('unauthorized', code);
    if (code === 429) {
      const wait = obj(body?.parameters).retry_after;
      throw new TelegramError('rate_limited', code, typeof wait === 'number' && wait > 0 ? Math.ceil(wait) : null);
    }
    if (code === 403) throw new TelegramError('forbidden', code);
    if (code === 400) {
      if (obj(body?.parameters).migrate_to_chat_id != null) throw new TelegramError('chat_moved', code);
      if (/chat not found/i.test(said)) throw new TelegramError('chat_not_found', code);
      throw new TelegramError('bad_request', code);
    }
    if (code >= 500) throw new TelegramError('http', code);
    throw new TelegramError('bad_request', code);
  }

  /** Is the token a bot's? Its own number, nothing more. */
  async getMe(): Promise<{ id: number }> {
    const me = obj(await this.call('getMe', {}));
    if (typeof me.id !== 'number') throw new TelegramError('bad_answer');
    return { id: me.id };
  }

  /** One message in Telegram's HTML, with no preview of the link under it. */
  async sendMessage(chatId: string, html: string): Promise<{ messageId: number }> {
    const wait = lastSendAt + this.gapMs - this.now();
    if (wait > 0) await this.sleep(wait);
    lastSendAt = this.now();
    const sent = obj(await this.call('sendMessage', { chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }));
    if (typeof sent.message_id !== 'number') throw new TelegramError('bad_answer');
    return { messageId: sent.message_id };
  }
}

let fetchForTests: TelegramFetch | null = null;
let clientOptsForTests: TelegramClientOptions = {};

/** Tests stand in for Telegram: no request leaves the machine. */
export function setTelegramFetchForTests(fn: TelegramFetch | null, opts: TelegramClientOptions = {}): void {
  fetchForTests = fn;
  clientOptsForTests = opts;
}

/** A client for the stand's own bot, or the stand-in a test put in its place. */
export function telegramClient(cfg: TelegramConfig): TelegramClient {
  return new TelegramClient(cfg, { ...clientOptsForTests, ...(fetchForTests ? { fetch: fetchForTests } : {}) });
}
