-- EV8 Ops — migration 0020: where a customer came from (wave 4 §3.5).
--
-- `customer-journey.md`: myauto.ge and word of mouth are the two that bring
-- people; the rest is a handful. Optional, and asked in the hand-over's
-- "new customer" step as well as on the card.

ALTER TABLE customers ADD COLUMN source text CHECK (source IN ('myauto', 'friends', 'social', 'site', 'other'));
