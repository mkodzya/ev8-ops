-- EV8 Ops — migration 0056: the book of works, and a repair the mechanic
-- opens himself (stage 2 of docs/spec/mechanic-in-erp-plan.md; ADR-0032,
-- ADR-0033; prototype docs/redesign/prototypes/mechanic-job-open-options.html,
-- variants A and A chosen by Mika on 20.10.2026).
--
--   * **The book of works** keeps a code, a category, a name in three
--     languages and a norm. A code is permanent and never given twice; a work
--     nobody wants is switched off, not deleted, so the repairs that used it
--     still say what it was. The norm is kept in seconds: OT-01 «Регулировка
--     зеркала» is 2.5 minutes, and rounding it would change the norm.
--     Categories are their own rows — a category's name is translated once,
--     not on each of its works. The rows themselves are filled by the API from
--     the mechanic bot's CATALOG_SEED of 11.10.2026 (apps/api/src/lib/workBook.ts),
--     as Mika chose on 20.10.2026: «берём CATALOG_SEED сейчас с пометкой».
--   * **A line of work on a repair** copies the norm and the mechanic's rate
--     when it is written and never reads them again: a norm changed in the
--     book does not change what was already done. A work not in the book is
--     words with no norm; the chief mechanic gives it one (stage 3).
--   * **The repair names its mechanic** — "his own repairs" are the ones he
--     carries, not the ones he happened to open — and says why it came in
--     (one of five reasons, as in the bot), what the odometer read when it was
--     opened (`odometer_km` is already the reading at closing), and when, to
--     the minute. Old repairs have none of this and stay as they were: their
--     hours cannot be recovered, so `opened_at` gets its default only after
--     the column exists.
--   * **A photo says what it shows**: the odometer, before, after, a receipt.

CREATE TABLE work_categories (
  code        text PRIMARY KEY CHECK (code ~ '^[A-Z]{2,3}$'),
  name_ka     text,
  name_ru     text,
  name_en     text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (coalesce(name_ka, name_ru, name_en) IS NOT NULL)
);

CREATE TABLE work_types (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,3}-[0-9]{2,3}$'),
  category    text NOT NULL REFERENCES work_categories(code),
  name_ka     text,
  name_ru     text,
  name_en     text,
  norm_sec    integer NOT NULL CHECK (norm_sec > 0),
  active      boolean NOT NULL DEFAULT true,
  notes       text,
  -- Where the row came from: 'bot-2026-10-11' for the bot's CATALOG_SEED;
  -- empty for a work added on the screen.
  source      text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (split_part(code, '-', 1) = category),
  CHECK (coalesce(name_ka, name_ru, name_en) IS NOT NULL)
);
CREATE INDEX work_types_category_idx ON work_types (category);

CREATE TYPE service_reason AS ENUM ('wear', 'accident', 'renter_fault', 'warranty', 'planned');

ALTER TABLE service_jobs
  ADD COLUMN mechanic_id        uuid REFERENCES users(id),
  ADD COLUMN reason_kind        service_reason,
  ADD COLUMN opened_odometer_km integer CHECK (opened_odometer_km IS NULL OR opened_odometer_km >= 0),
  ADD COLUMN odometer_reason    text,
  ADD COLUMN opened_at          timestamptz;
ALTER TABLE service_jobs ALTER COLUMN opened_at SET DEFAULT now();
CREATE INDEX service_jobs_mechanic_idx ON service_jobs (mechanic_id) WHERE mechanic_id IS NOT NULL;

CREATE TABLE service_works (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        uuid NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
  work_type_id  uuid REFERENCES work_types(id),
  free_text     text,
  qty           integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  norm_sec      integer CHECK (norm_sec IS NULL OR norm_sec > 0),
  rate_tetri    integer NOT NULL CHECK (rate_tetri > 0),
  mechanic_id   uuid REFERENCES users(id),
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  -- A line is a work from the book, or words; a work from the book always has its norm.
  CHECK (work_type_id IS NOT NULL OR btrim(coalesce(free_text, '')) <> ''),
  CHECK (work_type_id IS NULL OR norm_sec IS NOT NULL)
);
CREATE INDEX service_works_job_idx ON service_works (job_id);

ALTER TABLE files ADD COLUMN tag text CHECK (tag IS NULL OR tag IN ('before', 'after', 'odometer', 'receipt'));
