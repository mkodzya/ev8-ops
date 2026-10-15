-- EV8 Ops — migration 0041: the day of the week a rental's rent is due.
--
-- A week is still counted from the pickup day (RNT-02), and until now its rent
-- was due on that first day. Two renters pay on another day by agreement — one
-- on the second day of his week, one on the fourth (Mika, 14.10.2026) — and the
-- product called them late on days they were not. The rental now says on which
-- weekday its rent is due; empty = the pickup's weekday, as before (ADR-0021).
-- ISO numbering: 1 = Monday … 7 = Sunday.

ALTER TABLE rentals ADD COLUMN pay_weekday smallint CHECK (pay_weekday BETWEEN 1 AND 7);
