-- EV8 Ops — migration 0026: the shelf takes parts back (wave 5, QA-W5-14).
--
-- Migration 0022 taught the enum the word `return`, but two things written
-- when there were three kinds of movement still knew only three, and both
-- refused the row a cancelled repair writes:
--
--   * `stock_move_direction` said which way each kind points, and a positive
--     `return` matched none of its three branches;
--   * `stock_moves_service_part_unique` gave a repair line one movement for
--     good, so the line that took parts off the shelf could not put them
--     back.
--
-- A return puts parts back, so it points the way a receipt does: qty > 0.
-- And a repair line has two movements at most — one out, one back — so the
-- index that keeps a request from issuing twice now counts per kind, which
-- refuses a second issue and a second return just as it did before.

ALTER TABLE stock_moves DROP CONSTRAINT stock_move_direction;
ALTER TABLE stock_moves ADD CONSTRAINT stock_move_direction CHECK (
  (kind = 'receipt' AND qty > 0) OR
  (kind = 'return' AND qty > 0) OR
  (kind = 'issue' AND qty < 0) OR
  kind = 'adjust'
);

DROP INDEX stock_moves_service_part_unique;
CREATE UNIQUE INDEX stock_moves_service_part_unique
  ON stock_moves(service_part_id, kind) WHERE service_part_id IS NOT NULL;
