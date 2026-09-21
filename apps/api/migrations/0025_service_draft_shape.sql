-- EV8 Ops — migration 0025: a reported breakdown is open too (wave 5 §3.7).
--
-- The rule "a job has a closing date exactly when it is not open" was written
-- when there were three statuses. A draft — a breakdown a manager reported
-- and nobody has picked up — is not closed either, so it has no date, and the
-- rule has to say so or the row cannot be written at all.

ALTER TABLE service_jobs DROP CONSTRAINT service_closed_shape;
ALTER TABLE service_jobs ADD CONSTRAINT service_closed_shape CHECK (
  (status IN ('draft', 'open')) = (closed_on IS NULL)
);
