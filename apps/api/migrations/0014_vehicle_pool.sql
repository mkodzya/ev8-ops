-- The parks: what a moped is for.
--
-- The second of the three axes ADR-0005 describes. `state` says what is
-- happening to a moped and `location_id` says where it stands; neither says
-- whether it is here to be rented or to be sold. Until now that was guessed
-- from the model, which is wrong in both directions: a Flybrother is sold as
-- often as it is rented, and the one Luyuan anybody ever asked about was
-- asked about by a renter.
--
-- `pool` is nullable on purpose, and it is the honest half of this migration.
-- Odoo has no such field, so only two kinds of evidence exist:
--   * a moped that has been rented is a rental moped — the rental is the fact;
--   * a moped whose model never carried a weekly rate in Odoo (all five Luyuan
--     models) was never rentable, so it is a sale moped.
-- Everything else stays NULL — "nobody has decided" — rather than taking the
-- more common answer. On 15.09.2026 that is 18 mopeds out of 48, and sorting
-- them is one click each on the fleet screen, not a guess made here.
--
-- Moving between parks is a decision, so it is an event like every other
-- decision: `to_rent` / `to_sale` with a date, a reason and an author, sitting
-- in the same timeline as hand-overs and repairs. State does not change with
-- it — a moped in the workshop stays in the workshop when it changes park —
-- so those events carry from_pool/to_pool and repeat the state unchanged.

CREATE TYPE vehicle_pool AS ENUM ('rent', 'sale');

ALTER TABLE vehicles ADD COLUMN pool vehicle_pool;

ALTER TYPE vehicle_event_kind ADD VALUE 'to_rent';
ALTER TYPE vehicle_event_kind ADD VALUE 'to_sale';

ALTER TABLE vehicle_events
  ADD COLUMN from_pool vehicle_pool,
  ADD COLUMN to_pool   vehicle_pool;

-- Evidence, in order: what happened beats what the model allows.
UPDATE vehicles v
   SET pool = 'rent'
 WHERE v.pool IS NULL
   AND EXISTS (SELECT 1 FROM rentals r WHERE r.vehicle_id = v.id);

UPDATE vehicles v
   SET pool = 'sale'
 WHERE v.pool IS NULL
   AND NOT EXISTS (SELECT 1 FROM rentals r WHERE r.vehicle_id = v.id)
   AND (SELECT m.weekly_rate_tetri FROM vehicle_models m WHERE m.id = v.model_id) IS NULL;

CREATE INDEX vehicles_pool ON vehicles(pool) WHERE pool IS NOT NULL;
