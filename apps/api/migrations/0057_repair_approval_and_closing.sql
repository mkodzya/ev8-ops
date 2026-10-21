-- EV8 Ops — migration 0057: approving, refusing and closing a mechanic's
-- repair (stage 3 of docs/spec/mechanic-in-erp-plan.md; ADR-0035; prototype
-- docs/redesign/prototypes/mechanic-approval-options.html, variants A and A
-- chosen by Mika on 20.10.2026).
--
--   * **Waiting stays one place.** A repair waiting for approval is a `draft`,
--     as stage 2 made it — the first time, and again when a work found later
--     sends it back (Mika, 20.10.2026: «добавленная работа ждёт согласования
--     одна, остальное идёт»). No `approval` column beside it (code check §5).
--   * **The repair says who approved it and when** — the first approval, the
--     one that let the work start. A line of work says the same of itself:
--     a work added later is approved, or refused, on its own.
--   * **A refusal is not a cancellation.** It keeps who refused, when and
--     why; the repair is `cancelled` as before, so everything that already
--     leaves a cancelled repair out — the economics, the shelf, the moped's
--     state — leaves a refused one out too. Until now the reason lived only
--     in the journal.
--   * **The minute it closed** (`closed_at`), beside the day it closed: the
--     downtime in hours of stage 6 needs it. Old repairs have only the day.
--
-- What existing rows get: the approvals the journal holds (`service.approve`
-- since stage 1) are written back with their person and minute; the lines of
-- repairs already in work count as approved, by whoever approved the repair
-- or, where it was opened in work at once, by whoever opened it.

ALTER TABLE service_jobs
  ADD COLUMN approved_by   uuid REFERENCES users(id),
  ADD COLUMN approved_at   timestamptz,
  ADD COLUMN rejected_by   uuid REFERENCES users(id),
  ADD COLUMN rejected_at   timestamptz,
  ADD COLUMN reject_reason text,
  ADD COLUMN closed_at     timestamptz,
  ADD CONSTRAINT service_rejected_shape CHECK (
    rejected_at IS NULL
    OR (status = 'cancelled' AND rejected_by IS NOT NULL AND btrim(coalesce(reject_reason, '')) <> '')
  );

ALTER TABLE service_works
  ADD COLUMN approved_by   uuid REFERENCES users(id),
  ADD COLUMN approved_at   timestamptz,
  ADD COLUMN rejected_by   uuid REFERENCES users(id),
  ADD COLUMN rejected_at   timestamptz,
  ADD COLUMN reject_reason text,
  ADD CONSTRAINT service_work_decided_once CHECK (approved_at IS NULL OR rejected_at IS NULL),
  ADD CONSTRAINT service_work_rejected_shape CHECK (
    rejected_at IS NULL OR (rejected_by IS NOT NULL AND btrim(coalesce(reject_reason, '')) <> '')
  );

-- The approvals stage 1 and 2 wrote to the journal only.
UPDATE service_jobs j
   SET approved_by = a.actor_id, approved_at = a.created_at
  FROM (
    SELECT DISTINCT ON (entity_id) entity_id, actor_id, created_at
      FROM audit_log
     WHERE action = 'service.approve' AND entity_type = 'service_job'
     ORDER BY entity_id, created_at
  ) a
 WHERE a.entity_id = j.id::text AND j.status IN ('open', 'done');

-- The lines of repairs already in work were approved with them.
UPDATE service_works w
   SET approved_by = coalesce(j.approved_by, j.created_by),
       approved_at = coalesce(j.approved_at, j.opened_at, w.created_at)
  FROM service_jobs j
 WHERE j.id = w.job_id AND j.status IN ('open', 'done');
