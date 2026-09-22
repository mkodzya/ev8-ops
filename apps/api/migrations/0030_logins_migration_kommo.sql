-- EV8 Ops — migration 0030: failed logins, the transfer's leftovers, Kommo
-- (wave 6 §3.6–3.10).
--
-- Three things the tail of the wave needs a table or a column for:
--
--   * **Failed logins were counted in memory.** A restart of the API forgave
--     every attempt, so ten tries became ten tries per restart (§3.9,
--     crit. 22). They are counted in rows now, by address and by IP, and the
--     password is not among the columns — it never is.
--   * **Deposits that came from Odoo without a decision.** Forty-two are held
--     on paper; the money moved long before the transfer, or nobody wrote
--     down that it did. Closing one is not today's payout: it must not reach
--     the till or the payments. A decision of its own says so (§3.7).
--   * **Kommo.** A customer, a rental and a sale carry the front office's
--     link or deal id, one way only until the webhook tariff (register #5,
--     B10-03). A moped gets no tracker field: no moped has a tracker (Q31).

CREATE TABLE login_attempts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL,
  ip         text,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- The question asked of this table is always "how many for this address
-- lately", so that is the index.
CREATE INDEX login_attempts_email_idx ON login_attempts (email, created_at DESC);

-- What an owner said about a deposit the transfer brought over: handed back
-- before, kept before, or nobody knows. NULL means nobody has said anything,
-- which is where all forty-two start.
CREATE TYPE deposit_migration_decision AS ENUM ('returned_earlier', 'kept_earlier', 'unknown');
ALTER TABLE deposits ADD COLUMN migration_decision deposit_migration_decision;
ALTER TABLE deposits ADD COLUMN migration_reason   text;
ALTER TABLE deposits ADD COLUMN migration_decided_at timestamptz;
-- A reason is required for every one of them: "kept" without a why is a
-- number nobody can defend a year later (§3.7).
ALTER TABLE deposits ADD CONSTRAINT deposits_migration_reason
  CHECK (migration_decision IS NULL OR length(btrim(coalesce(migration_reason, ''))) > 0);

ALTER TABLE customers ADD COLUMN kommo_ref text;
ALTER TABLE rentals   ADD COLUMN kommo_ref text;
ALTER TABLE sales     ADD COLUMN kommo_ref text;
