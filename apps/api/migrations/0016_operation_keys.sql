-- EV8 Ops — migration 0016: operation keys (build plan Р5, spec B2-01).
--
-- A form takes a key when it opens and sends it with every attempt to save.
-- The first attempt claims the key; its answer is kept here, and any repeat —
-- a double tap, a retry after the connection dropped with the write already
-- done — gets that same answer instead of writing a second rental or payment.
-- Keys are per person, and forgotten after a week.

CREATE TABLE operation_keys (
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         text NOT NULL,
  route       text NOT NULL,
  status_code integer,
  body        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE INDEX operation_keys_created_idx ON operation_keys(created_at);
