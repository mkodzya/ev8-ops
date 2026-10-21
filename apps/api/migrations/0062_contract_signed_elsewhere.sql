-- EV8 Ops — migration 0062: a contract marked as signed in Signify
-- (ADR-0039; Kardu on the call of 21.10.2026: one rental counted both among
-- the running and the unsigned — "исправить принудительно").
--
-- The company signs its rental contracts in Signify (register #36: no API on
-- its plan, "работа с Signify напрямую"), while EV8 Ops knew one signature
-- only — the one drawn on its own screen. A rental handed over here and
-- signed in Signify stayed "Не подписан" in the list and on "Today" for good.
--
--   * **A person says so, the system does not guess**: three columns on the
--     rental — when it was marked, by whom, and what they added. Drive is not
--     read for it (ADR-0034 §5): a Signify PDF's signatures are not read, and
--     a folder may be matched to the wrong rental.
--   * **Not `transferred_at`**: that one decides how money is matched and
--     which weeks were paid before the transfer; a signature is neither.
--   * **Not a row in `files`**: a stored file holds bytes, and the Signify PDF
--     is not copied here (ADR-0031).
--   * **Nothing is filled in**: which contracts were signed in Signify is not
--     known here, and is not invented. Kardu marks the one rental himself.
--
-- An owner takes the mark back with a reason; the journal keeps both.

ALTER TABLE rentals ADD COLUMN IF NOT EXISTS contract_signed_elsewhere_at   timestamptz;
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS contract_signed_elsewhere_by   uuid REFERENCES users(id);
ALTER TABLE rentals ADD COLUMN IF NOT EXISTS contract_signed_elsewhere_note text;
