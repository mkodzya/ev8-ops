-- EV8 Ops — migration 0072: the files a task closes with have an owner of
-- their own (ADR-0050; the kind `todo_file` came in 0071).
--
-- The owner check on `files` learns the new kind. Postgres refuses to use an
-- enum value in the transaction that added it, so this is a file of its own,
-- as 0008 was for the repairs' photos. The rest of the rule is 0067's, as it
-- stands.

ALTER TABLE files DROP CONSTRAINT IF EXISTS files_owner;
ALTER TABLE files ADD CONSTRAINT files_owner CHECK (
  (kind = 'act_photo'         AND act_id IS NOT NULL AND customer_id IS NULL) OR
  (kind = 'customer_document' AND customer_id IS NOT NULL AND act_id IS NULL) OR
  (kind = 'service_photo'     AND service_job_id IS NOT NULL) OR
  (kind = 'pdf'               AND doc_kind IS NOT NULL AND (rental_id IS NOT NULL OR sale_id IS NOT NULL OR goods_sale_id IS NOT NULL)) OR
  (kind = 'todo_file'         AND todo_id IS NOT NULL)
);
