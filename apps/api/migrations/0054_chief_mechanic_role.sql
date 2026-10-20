-- EV8 Ops — migration 0054: the chief mechanic (ADR-0033).
--
-- A mechanic who also approves a repair before work starts and keeps the
-- book of norms. Rights come from code (packages/shared/src/permissions.ts);
-- this is only the word the database stores. On its own file for the reason
-- 0053 gives.

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'chief_mechanic';
