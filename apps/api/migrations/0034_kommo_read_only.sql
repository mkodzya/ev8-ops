-- EV8 Ops — migration 0034: Kommo is read, not written (Mika, 08.10.2026).
--
-- Migration 0033 made room for payment notes written into Kommo deals. The
-- note was built, one real one was written and seen in its deal, and the
-- owner decided the same day that it is not wanted: everything but the CRM
-- itself lives in EV8 Ops, and what lives here is not copied into Kommo
-- (ADR-0014, which takes ADR-0013 back).
--
-- So the list of notes goes, and with it the two columns that remembered
-- when writing was switched on. What this drops is a delivery log, not the
-- business's data: the payments themselves are untouched, and the one note
-- that did go out (08.10.2026, into the deal of rental R-00002 on the test
-- stand) is recorded in ADR-0014 and stays in Kommo.

DROP TABLE IF EXISTS kommo_notes;
ALTER TABLE kommo_sync DROP COLUMN IF EXISTS notes_from;
ALTER TABLE kommo_sync DROP COLUMN IF EXISTS notes_mode;
