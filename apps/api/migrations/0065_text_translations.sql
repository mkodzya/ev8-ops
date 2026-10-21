-- EV8 Ops — migration 0065: typed text in the reader's language (ADR-0042,
-- decided by Mika on 21.10.2026).
--
-- What a person types about a moped or a repair — a state change's reason,
-- what happened, a mechanic's work, a refusal — is shown to a reader of
-- another language translated, marked as a translation, with the original one
-- tap away. The original stays the record: nothing here changes a column a
-- person wrote, and search, exports, PDFs and Telegram keep the original.
--
--   * **One row per distinct text, not per record.** The same reason kept by
--     the moped's event and by its journal line is one row and one request.
--     A text is found by the sha256 of its UTF-8 bytes as stored, in hex.
--   * **Only texts about mopeds and repairs come here** (answer A): the job
--     reads them by the list in packages/shared/src/typed.ts, and the words
--     of customers, rentals, money, sales and purchases never do.
--   * **A translation is filled in the background** by the worker's clock
--     through the API, the one place the key is. Without the key the texts
--     wait, and the screens show the originals.
--   * **The text's own language is empty**: the original is shown for it.
--     A failure is a word of ours (`network`, `refused`), never the service's
--     answer; a text the job will not send is given up with its reason.
--
-- `translation_days` keeps, per day in Tbilisi, how many requests went out,
-- how they ended and the tokens they took — counts only, no text — so the
-- cost is measured on the test stand and the daily cap (500 texts) is held.

CREATE TABLE IF NOT EXISTS text_translations (
  source_hash      text PRIMARY KEY CHECK (source_hash ~ '^[0-9a-f]{64}$'),
  source_text      text NOT NULL,
  -- The language it was written in: ka, ru, en, or none of them.
  lang             text CHECK (lang IN ('ka', 'ru', 'en', 'other')),
  text_ka          text,
  text_ru          text,
  text_en          text,
  -- The model that translated it.
  model            text,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  next_try_at      timestamptz NOT NULL DEFAULT now(),
  attempts         integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  translated_at    timestamptz,
  -- Not translated and not to be: refused, an answer that was not one, too
  -- long, not words at all, or tried too many times.
  gave_up_at       timestamptz,
  last_failure     text,
  last_http_status integer
);
-- What waits for the translator: the job reads it every minute.
CREATE INDEX IF NOT EXISTS text_translations_waiting ON text_translations (next_try_at) WHERE translated_at IS NULL AND gave_up_at IS NULL;

CREATE TABLE IF NOT EXISTS translation_days (
  day           date PRIMARY KEY,
  -- Requests the service answered: each is one text, and each is paid for.
  requests      integer NOT NULL DEFAULT 0 CHECK (requests >= 0),
  translated    integer NOT NULL DEFAULT 0 CHECK (translated >= 0),
  failed        integer NOT NULL DEFAULT 0 CHECK (failed >= 0),
  input_tokens  bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
