-- EV8 Ops — migration 0058: the parts a mechanic writes into his repair, and
-- the tracker that belongs to a moped (stage 4 of
-- docs/spec/mechanic-in-erp-plan.md; ADR-0036; prototype
-- docs/redesign/prototypes/mechanic-parts-options.html, variants A and A
-- chosen by Mika on 20.10.2026).
--
--   * **A repair line says what kind it is.** Off the shelf (`stock`, as every
--     line before this one), bought by the mechanic with his own money
--     (`bought`), taken off this moped and put on the shelf (`removed`), or
--     taken off another moped and fitted here (`donor`).
--   * **Bought — with the receipt, and approved.** What the mechanic paid,
--     the photo of the receipt and who gets the money back; no limit on the
--     sum (Mika, 20.10.2026, register #111). Such a line waits for the chief
--     mechanic or an owner like a work found later (ADR-0035), so it carries
--     the same who-and-when of approval and refusal.
--   * **A tracker is somebody's.** Which parts are trackers the owner says on
--     the part; the IMEI and the SIM of the one on a moped are a row of their
--     own, open until it is taken off. No two open rows share an IMEI — that
--     is the database's to refuse, not only the screen's. Q31 of wave 6 («a
--     moped has no tracker field») is replaced (Mika, 20.10.2026).
--   * **A battery or a charger taken to repair from a repair** is a movement of
--     their own count (ADR-0025), not of the shelf: it says which repair.
--
-- Nothing old changes meaning: every existing line is `stock`, every part is
-- not a tracker, and no battery movement names a repair.

CREATE TYPE service_part_kind AS ENUM ('stock', 'bought', 'removed', 'donor');

ALTER TABLE service_parts
  ADD COLUMN kind             service_part_kind NOT NULL DEFAULT 'stock',
  ADD COLUMN donor_vehicle_id uuid REFERENCES vehicles(id),
  ADD COLUMN paid_tetri       integer,
  ADD COLUMN receipt_photo_id uuid REFERENCES files(id),
  ADD COLUMN reimburse_to     uuid REFERENCES users(id),
  ADD COLUMN created_by       uuid REFERENCES users(id),
  ADD COLUMN approved_by      uuid REFERENCES users(id),
  ADD COLUMN approved_at      timestamptz,
  ADD COLUMN rejected_by      uuid REFERENCES users(id),
  ADD COLUMN rejected_at      timestamptz,
  ADD COLUMN reject_reason    text,
  -- What was paid is a sum somebody paid: never nothing, never on another kind.
  ADD CONSTRAINT service_part_bought_shape CHECK (
    (kind = 'bought' AND paid_tetri IS NOT NULL AND paid_tetri > 0 AND receipt_photo_id IS NOT NULL AND reimburse_to IS NOT NULL)
    OR (kind <> 'bought' AND paid_tetri IS NULL AND receipt_photo_id IS NULL AND reimburse_to IS NULL)
  ),
  ADD CONSTRAINT service_part_donor_shape CHECK ((kind = 'donor') = (donor_vehicle_id IS NOT NULL)),
  -- Only a bought line waits for a decision; the shelf is the company's own.
  ADD CONSTRAINT service_part_decided_shape CHECK (
    kind = 'bought' OR (approved_at IS NULL AND rejected_at IS NULL)
  ),
  ADD CONSTRAINT service_part_decided_once CHECK (approved_at IS NULL OR rejected_at IS NULL),
  ADD CONSTRAINT service_part_rejected_shape CHECK (
    rejected_at IS NULL OR (rejected_by IS NOT NULL AND btrim(coalesce(reject_reason, '')) <> '')
  );
CREATE INDEX service_parts_donor_idx ON service_parts(donor_vehicle_id) WHERE donor_vehicle_id IS NOT NULL;

ALTER TABLE parts ADD COLUMN is_tracker boolean NOT NULL DEFAULT false;

CREATE TABLE vehicle_trackers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id       uuid NOT NULL REFERENCES vehicles(id),
  part_id          uuid REFERENCES parts(id),
  -- Fifteen digits from the sticker, kept without spaces; the check digit is
  -- the API's to test.
  imei             text NOT NULL CHECK (imei ~ '^[0-9]{15}$'),
  sim_phone        text CHECK (sim_phone IS NULL OR sim_phone ~ '^\+?[0-9]{6,15}$'),
  installed_on     date NOT NULL,
  removed_on       date,
  -- The repair it was put on with, and the line that took it off the shelf;
  -- empty for a tracker read from the warehouse's sheet.
  service_job_id   uuid REFERENCES service_jobs(id),
  service_part_id  uuid REFERENCES service_parts(id) ON DELETE SET NULL,
  removed_job_id   uuid REFERENCES service_jobs(id),
  source           text,
  created_by       uuid REFERENCES users(id),
  removed_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_tracker_dates CHECK (removed_on IS NULL OR removed_on >= installed_on)
);
-- Two working trackers with one IMEI are impossible (plan, stage 4 «Сдан»).
CREATE UNIQUE INDEX vehicle_trackers_imei_open ON vehicle_trackers(imei) WHERE removed_on IS NULL;
CREATE INDEX vehicle_trackers_vehicle_idx ON vehicle_trackers(vehicle_id);

ALTER TABLE battery_moves ADD COLUMN service_job_id uuid REFERENCES service_jobs(id);
CREATE INDEX battery_moves_service_idx ON battery_moves(service_job_id) WHERE service_job_id IS NOT NULL;
