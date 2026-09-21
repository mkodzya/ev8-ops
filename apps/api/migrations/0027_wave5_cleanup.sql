-- EV8 Ops — migration 0027: wave 5 is accepted, two columns it replaced go.
--
--   * `customers.is_supplier` was a flag beside the name; wave 5 gave a
--     record a kind of its own (`record_kind`, migration 0023) and every
--     screen and route now asks that. The flag is copied over one last time
--     before it goes, so nothing written through the old door is lost.
--   * `service_jobs.done_by` was the workshop typed by hand; wave 5 gave
--     workshops a table (§3.7) and the field has not been written from any
--     screen since. It holds nothing on either stand (checked 21.09.2026).
--
-- Both are dropped rather than left unread: a column nobody writes and
-- nobody reads is a question every later reader has to answer again.

UPDATE customers SET record_kind = 'supplier' WHERE is_supplier AND record_kind <> 'supplier';
ALTER TABLE customers DROP COLUMN is_supplier;
ALTER TABLE service_jobs DROP COLUMN done_by;
