-- The owner check on `files` has to learn about the kind added in 0007.
-- Postgres refuses to use a new enum value in the same transaction that
-- added it, which is why this is a migration of its own rather than the
-- last three lines of the previous one.
ALTER TABLE files DROP CONSTRAINT files_owner;
ALTER TABLE files ADD CONSTRAINT files_owner CHECK (
  (kind = 'act_photo'         AND act_id IS NOT NULL AND customer_id IS NULL) OR
  (kind = 'customer_document' AND customer_id IS NOT NULL AND act_id IS NULL) OR
  (kind = 'service_photo'     AND service_job_id IS NOT NULL) OR
  (kind = 'pdf'               AND rental_id IS NOT NULL AND doc_kind IS NOT NULL)
);
