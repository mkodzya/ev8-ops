-- EV8 Ops — migration 0052: read Signify's documents in Drive again.
--
-- Signify prints its form and puts what was filled in — the date, the VIN, the
-- deposit — into form fields over it; the first reader (0051) read the print
-- alone and found the fields empty (test stand, 19.10.2026). The reader now
-- reads both. Every document is marked unread, so the next read of Drive
-- reads them again; nothing else changes.

UPDATE drive_files SET read_modified_at = NULL, dated_on = NULL, contract_on = NULL, vin = NULL, deposit_tetri = NULL, withheld_tetri = NULL, paid_back_tetri = NULL
WHERE kind IN ('contract', 'return_act');
