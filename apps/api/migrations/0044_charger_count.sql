-- EV8 Ops — migration 0044: chargers are counted the way batteries are.
--
-- Meeting of Mika and Kardu, 14.10.2026: the fleet grows into a warehouse —
-- where every moped stands, the batteries and the chargers. Until now a
-- charger was only a number on a rental; nobody could say how many lay in the
-- showroom or had gone missing. A charger is counted, not numbered, exactly
-- like a battery (wave 4 §3.8, D16): an owner's stocktake by place, the moves
-- after it, and what the couriers hold read from the open rentals' acts. So
-- the battery tables say which of the two a row counts; every row so far is a
-- battery.

ALTER TABLE battery_inventories ADD COLUMN item text NOT NULL DEFAULT 'battery' CHECK (item IN ('battery', 'charger'));
ALTER TABLE battery_moves ADD COLUMN item text NOT NULL DEFAULT 'battery' CHECK (item IN ('battery', 'charger'));
CREATE INDEX battery_inventories_item_idx ON battery_inventories(item, counted_on DESC, created_at DESC);
CREATE INDEX battery_moves_item_idx ON battery_moves(item, created_at);
