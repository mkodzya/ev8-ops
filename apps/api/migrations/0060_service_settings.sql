-- EV8 Ops — migration 0060: the repair settings and the reason for a lower
-- reading at closing (stage 6 of docs/spec/mechanic-in-erp-plan.md; ADR-0038,
-- decided by Mika on 21.10.2026).
--
--   * **Three figures the owner sets, not the code** (ADR-0038 §3): the company
--     rate for an hour of norm — what a mechanic without a rate of his own is
--     paid, until now the constant 50 ₾ — and the interval and the warning of
--     the planned maintenance, 5 000 and 300 km by the spec. One row, as
--     `rental_settings` keeps the deposit. The maintenance itself is not
--     stored: it is worked out from the readings at every read.
--   * **A lower mileage at closing needs its reason** (ADR-0038 §4), as the
--     opening and the hand-over already do; the closing keeps it beside the
--     reading it explains. Old repairs have none and need none.

CREATE TABLE service_settings (
  id                      boolean PRIMARY KEY DEFAULT true CHECK (id),
  default_rate_tetri      integer NOT NULL DEFAULT 5000 CHECK (default_rate_tetri > 0),
  maintenance_interval_km integer NOT NULL DEFAULT 5000 CHECK (maintenance_interval_km BETWEEN 500 AND 100000),
  maintenance_warn_km     integer NOT NULL DEFAULT 300,
  updated_by              uuid REFERENCES users(id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- A warning as long as the interval would call every moped all the time.
  CONSTRAINT service_settings_warn CHECK (maintenance_warn_km >= 0 AND maintenance_warn_km < maintenance_interval_km)
);
INSERT INTO service_settings (id) VALUES (true);

ALTER TABLE service_jobs ADD COLUMN closed_odometer_reason text;
