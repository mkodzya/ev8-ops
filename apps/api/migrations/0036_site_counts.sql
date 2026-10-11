-- EV8 Ops — migration 0036: the site's own anonymous counter (Mika,
-- 01.10.2026: "свой анонимный счётчик на нашем сервере, без имён и
-- телефонов, без сторонней аналитики"; the numbers are read in EV8 Ops,
-- Reports → Site — Kardu, 11.10.2026).
--
-- What ev8.ge counts is a tally per day, and nothing else: no row per
-- visitor, no address, no cookie, no time of day. A visit, a page opened, a
-- WhatsApp button pressed, a request that reached the mailbox, and the three
-- answers of the quiz as one combination. So the table cannot say who did
-- anything — only how many, on which day.
--
--   metric   key
--   visit    ka | en                  once per browser tab session
--   view     ka:<page> | en:<page>    every page opened ('' is the home page)
--   whatsapp ka:<page> | en:<page>    the WhatsApp link pressed on that page
--   request  ka | en                  counted by the API itself when the mail went out
--   answers  <q1>.<q2>.<q3>           the quiz's answers, as option numbers

CREATE TABLE site_counts (
  day    date    NOT NULL,
  metric text    NOT NULL CHECK (metric IN ('visit', 'view', 'whatsapp', 'request', 'answers')),
  key    text    NOT NULL DEFAULT '' CHECK (length(key) <= 40),
  n      integer NOT NULL DEFAULT 0 CHECK (n >= 0),
  PRIMARY KEY (day, metric, key)
);
