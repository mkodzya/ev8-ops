-- EV8 Ops — migration 0038: the site's counter and the petrol price leave
-- EV8 Ops (Mika, 11.10.2026: "это были правки для сайта" — they are built on
-- the site's side, mkodzya/ev8-site, and EV8 Ops stays about rentals).
--
-- Migrations 0036 and 0037 made their two tables and stay in this folder: a
-- migration that ran is never taken back, it is answered by the next one. A
-- stand that ran them — the test stand, for an hour — loses the tables here;
-- a stand that never did runs all three and ends where it began. The site had
-- not started sending and no price was ever read, so there is no tally and no
-- price to keep: on the test stand site_counts was empty and fuel_price held
-- one row with the reason of a failed reading.

DROP TABLE IF EXISTS site_counts;
DROP TABLE IF EXISTS fuel_price;
