-- EV8 Ops — migration 0077: «Взыскание», what a person wrote down after the
-- reminders (the director's scenario of 03.11.2026; Mika's answers the same
-- day; ADR-0054).
--
-- From the 3rd day late a manager calls and looks at the GPS in the
-- tracker's app; one who does not get in touch within a day has the moped
-- blocked there and picked up. EV8 Ops sees neither the GPS nor the block:
-- these rows are what the person did, and the ladder of «Сегодня» is read
-- from them and from the schedule.
--
-- Only additions.

CREATE TABLE collection_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id   uuid NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('call', 'blocked', 'unblocked')),
  -- The Tbilisi day it was written on: the ladder counts days.
  day         date NOT NULL,
  outcome     text CHECK (outcome IN ('paid_today', 'promised', 'refuses', 'no_answer')),
  promised_on date,
  gps         text CHECK (gps IN ('still', 'moving', 'unseen')),
  -- Where the moped is, as the tracker's app shows it, for whoever picks it up.
  place       text,
  note        text,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT collection_events_call_shape CHECK ((kind = 'call') = (outcome IS NOT NULL)),
  CONSTRAINT collection_events_promise_shape CHECK ((outcome = 'promised') = (promised_on IS NOT NULL) OR outcome IS NULL AND promised_on IS NULL),
  CONSTRAINT collection_events_gps_shape CHECK (gps IS NULL OR kind = 'call'),
  CONSTRAINT collection_events_place_shape CHECK (place IS NULL OR kind = 'blocked')
);
CREATE INDEX collection_events_rental_idx ON collection_events(rental_id, created_at);
