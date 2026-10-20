-- EV8 Ops — migration 0055: the workshop tablet and the mechanic's PIN
-- (ADR-0033 §5–8).
--
-- The workshop has one tablet for everybody. An owner registers it once; on
-- it a mechanic taps their name and types a PIN, so the work and the parts
-- they write are theirs and nobody else's. Anywhere else everybody signs in
-- with an address and a password as before.
--
--   * **A mechanic may have no address.** Somebody who only ever signs in on
--     the tablet needs no mailbox to be a person here. Everybody else still
--     signs in with an address and a password, and the two come together:
--     an address without a password opens nothing.
--   * **The PIN is stored the way a password is** (scrypt, never returned,
--     never journaled). Five wrong ones close that person's PIN sign-in for
--     fifteen minutes; the counter and the lock are the person's, not the
--     device's, so trying another tablet does not start over.
--   * **The mechanic's rate for an hour of norm.** Empty means the company's
--     rate (50 GEL); payouts read it from stage 5 of the plan.
--   * **The device.** Its token is an id and a secret: a salted hash cannot be
--     looked up by value, so the id finds the row and the secret is checked
--     against it like a password. Revoking a device ends every PIN session
--     opened on it. Nothing is deleted — a revoked tablet stays in the list.
--   * **A session says how it began.** A PIN session reaches the repair
--     screens only and ends after ten idle minutes; that is decided in code,
--     the row only remembers the kind and the device.

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN pin_hash          text;
ALTER TABLE users ADD COLUMN pin_failed        integer NOT NULL DEFAULT 0 CHECK (pin_failed >= 0);
ALTER TABLE users ADD COLUMN pin_locked_until  timestamptz;
ALTER TABLE users ADD COLUMN labour_rate_tetri integer CHECK (labour_rate_tetri IS NULL OR labour_rate_tetri > 0);

ALTER TABLE users ADD CONSTRAINT users_email_with_password
  CHECK ((email IS NULL) = (password_hash IS NULL));
ALTER TABLE users ADD CONSTRAINT users_sign_in
  CHECK (email IS NOT NULL OR role IN ('mechanic', 'chief_mechanic'));
ALTER TABLE users ADD CONSTRAINT users_pin_is_a_mechanics
  CHECK (pin_hash IS NULL OR role IN ('mechanic', 'chief_mechanic'));

CREATE TABLE workshop_devices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL CHECK (length(btrim(name)) > 0),
  secret_hash   text NOT NULL,
  registered_by uuid NOT NULL REFERENCES users(id),
  registered_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz,
  revoked_by    uuid REFERENCES users(id),
  CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

CREATE TYPE session_kind AS ENUM ('password', 'pin');
ALTER TABLE sessions ADD COLUMN kind      session_kind NOT NULL DEFAULT 'password';
ALTER TABLE sessions ADD COLUMN device_id uuid REFERENCES workshop_devices(id);
ALTER TABLE sessions ADD CONSTRAINT sessions_pin_on_a_device CHECK ((kind = 'pin') = (device_id IS NOT NULL));
CREATE INDEX sessions_device_idx ON sessions (device_id) WHERE device_id IS NOT NULL;
