// EV8 Ops' own addresses. A link EV8 Ops hands out — the QR on a sticker, the
// link under a notice in Telegram (ADR-0038 §6) — leads only to one of its own
// stands, or to a laptop; any other address would send people elsewhere.

/** The two stands, and a laptop. */
export const OWN_ORIGIN = /^(https:\/\/(test\.)?ops\.ev8\.ge|http:\/\/(localhost|127\.0\.0\.1)(:\d+)?)$/;

/**
 * The stand's own address for links in notices: `PUBLIC_URL`, written by
 * deploy/set-telegram.sh. Null without it, or with one that is not ours —
 * the notice then carries the record's number and no link, never a guess.
 */
export function publicUrl(e: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (e.PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  return OWN_ORIGIN.test(raw) ? raw : null;
}
