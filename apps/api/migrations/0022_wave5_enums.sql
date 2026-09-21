-- EV8 Ops — migration 0022: two words the next migration needs (wave 5).
--
-- A value added to an enum cannot be used in the transaction that added it,
-- so the words come first and the tables that use them follow in 0023.
--
--   * a repair a manager reported is a draft until an owner picks it up
--     (§3.7): it already holds the moped and the photos, but not the
--     workshop, the payer or a single line;
--   * parts of a cancelled repair go back on the shelf as a movement of
--     their own (B8-04) — a ledger is corrected by writing in it, not by
--     rubbing out what is already there.

ALTER TYPE service_status ADD VALUE IF NOT EXISTS 'draft' BEFORE 'open';
ALTER TYPE stock_move_kind ADD VALUE IF NOT EXISTS 'return';
