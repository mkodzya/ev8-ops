-- EV8 Ops — migration 0001: users and roles, fleet, customers, rentals with
-- weekly periods, deposits, hand-over acts, and the change journal.
-- Hand-written SQL applied by scripts/migrate.mjs; prisma/schema.prisma mirrors
-- it for the generated client and must be kept in sync by hand.
--
-- Money is GEL in tetri as integers (…_tetri). Dates that are calendar days in
-- Asia/Tbilisi are `date`; instants are `timestamptz`.

CREATE TYPE user_role          AS ENUM ('owner', 'director', 'manager', 'mechanic', 'accountant');
CREATE TYPE vehicle_state      AS ENUM ('available', 'rented', 'service', 'out', 'sold');
CREATE TYPE vehicle_event_kind AS ENUM ('arrived', 'pickup', 'return', 'service_in', 'service_out', 'sold', 'bought_back', 'written_off', 'manual');
CREATE TYPE rental_status      AS ENUM ('booked', 'active', 'overdue', 'paused', 'returned', 'disputed');
CREATE TYPE period_pay_status  AS ENUM ('unpaid', 'partial', 'paid');
CREATE TYPE deposit_status     AS ENUM ('held', 'returned', 'withheld', 'partial');
CREATE TYPE act_kind           AS ENUM ('pickup', 'return');
CREATE TYPE customer_kind      AS ENUM ('person', 'sole_trader', 'company');

-- ---------------------------------------------------------------------------
-- People who log in. Rights come from the role (spec §3), never per person.
-- ---------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          user_role NOT NULL,
  locale        text NOT NULL DEFAULT 'ka',
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token        text PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ---------------------------------------------------------------------------
-- Fleet
-- ---------------------------------------------------------------------------
CREATE TABLE vehicle_models (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand                   text NOT NULL,
  name                    text NOT NULL,
  sale_price_tetri        integer,            -- site price, VAT included
  weekly_rate_tetri       integer,            -- default weekly tariff, VAT included
  cost_tetri              integer,            -- landed cost per unit (13.08.2026 method)
  for_sale                boolean NOT NULL DEFAULT true,
  for_rent                boolean NOT NULL DEFAULT false,
  photo_url               text,
  notes                   text,
  odoo_sale_product_id    integer UNIQUE,
  odoo_rental_product_id  integer UNIQUE,
  odoo_fleet_model_id     integer UNIQUE,
  archived                boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (brand, name)
);

CREATE TABLE vehicles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vin               text NOT NULL UNIQUE CHECK (vin <> '' AND vin = upper(vin)),
  model_id          uuid NOT NULL REFERENCES vehicle_models(id),
  color             text,
  year              integer CHECK (year BETWEEN 2000 AND 2100),
  arrived_on        date,
  state             vehicle_state NOT NULL DEFAULT 'available',
  current_rental_id uuid,                      -- FK added below, after rentals
  odometer_km       integer,
  notes             text,
  odoo_fleet_id     integer UNIQUE,
  odoo_lot_id       integer UNIQUE,
  archived          boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicles_model_idx ON vehicles(model_id);
CREATE INDEX vehicles_state_idx ON vehicles(state);

-- ---------------------------------------------------------------------------
-- Customers: one card per person (CST-01), no duplicate personal numbers (CST-02)
-- ---------------------------------------------------------------------------
CREATE TABLE customers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,               -- display name as the team writes it
  name_ka         text,                        -- Georgian spelling
  name_lat        text,                        -- Latin spelling
  personal_id     text UNIQUE,                 -- personal / tax number
  phone           text,                        -- WhatsApp number, E.164
  email           text,
  kind            customer_kind NOT NULL DEFAULT 'person',
  tags            text[] NOT NULL DEFAULT '{}',
  notes           text,
  odoo_partner_id integer UNIQUE,
  archived        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX customers_phone_idx ON customers(phone);

-- ---------------------------------------------------------------------------
-- Rentals: one row per hand-over; weekly periods hang off it (RNT-01..07)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE rental_number_seq;

CREATE TABLE rentals (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number                   text NOT NULL UNIQUE DEFAULT 'R-' || lpad(nextval('rental_number_seq')::text, 5, '0'),
  customer_id              uuid NOT NULL REFERENCES customers(id),
  vehicle_id               uuid REFERENCES vehicles(id),
  vin_unconfirmed          boolean NOT NULL DEFAULT false,   -- RNT-06: rental without a confirmed VIN
  vin_note                 text,                             -- what the contract says, when it does not match the fleet
  weekly_rate_tetri        integer NOT NULL CHECK (weekly_rate_tetri >= 0),
  deposit_tetri            integer NOT NULL DEFAULT 18000 CHECK (deposit_tetri >= 0),
  picked_up_on             date,
  expected_return_on       date,
  returned_on              date,
  status                   rental_status NOT NULL DEFAULT 'booked',
  paid_through             date,                             -- end of the last fully paid period
  buyout_target_tetri      integer CHECK (buyout_target_tetri IS NULL OR buyout_target_tetri > 0),
  buyout_per_payment_tetri integer CHECK (buyout_per_payment_tetri IS NULL OR buyout_per_payment_tetri > 0),
  notes                    text,
  odoo_order_id            integer UNIQUE,
  odoo_name                text,
  created_by               uuid REFERENCES users(id),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rentals_return_after_pickup CHECK (returned_on IS NULL OR picked_up_on IS NULL OR returned_on >= picked_up_on),
  CONSTRAINT rentals_vin_or_note CHECK (vehicle_id IS NOT NULL OR vin_unconfirmed)
);
CREATE INDEX rentals_customer_idx ON rentals(customer_id);
CREATE INDEX rentals_vehicle_idx ON rentals(vehicle_id);
CREATE INDEX rentals_status_idx ON rentals(status);

ALTER TABLE vehicles
  ADD CONSTRAINT vehicles_current_rental_fk FOREIGN KEY (current_rental_id) REFERENCES rentals(id);

CREATE TABLE rental_periods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id    uuid NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  seq          integer NOT NULL CHECK (seq >= 1),
  starts_on    date NOT NULL,
  ends_on      date NOT NULL,
  amount_tetri integer NOT NULL CHECK (amount_tetri >= 0),
  paid_tetri   integer NOT NULL DEFAULT 0 CHECK (paid_tetri >= 0),
  pay_status   period_pay_status NOT NULL DEFAULT 'unpaid',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rental_id, seq),
  CONSTRAINT rental_periods_seven_days CHECK (ends_on = starts_on + 6)
);

-- A liability, not revenue (RNT-05). One per rental.
CREATE TABLE deposits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id       uuid NOT NULL UNIQUE REFERENCES rentals(id) ON DELETE CASCADE,
  amount_tetri    integer NOT NULL CHECK (amount_tetri >= 0),
  status          deposit_status NOT NULL DEFAULT 'held',
  returned_tetri  integer NOT NULL DEFAULT 0 CHECK (returned_tetri >= 0),
  withheld_tetri  integer NOT NULL DEFAULT 0 CHECK (withheld_tetri >= 0),
  withheld_reason text,
  returned_to     text,                        -- who received it, when not the payer
  returned_on     date,
  decided_by      uuid REFERENCES users(id),
  confirmed_by    uuid REFERENCES users(id),   -- owner, for withholdings and third-party returns
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deposits_split CHECK (returned_tetri + withheld_tetri <= amount_tetri),
  CONSTRAINT deposits_withheld_reason CHECK (withheld_tetri = 0 OR withheld_reason IS NOT NULL)
);

-- Hand-over and return acts: photos as proof (spec §9.2), PDF later.
CREATE TABLE acts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rental_id     uuid NOT NULL REFERENCES rentals(id) ON DELETE CASCADE,
  kind          act_kind NOT NULL,
  occurred_on   date NOT NULL,
  odometer_km   integer,
  condition     text,
  photos        jsonb NOT NULL DEFAULT '[]',
  signature_url text,
  pdf_url       text,
  created_by    uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX acts_rental_idx ON acts(rental_id);

-- What happened to a VIN, in order. State is derived from these (FLT-03).
CREATE TABLE vehicle_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  kind        vehicle_event_kind NOT NULL,
  occurred_on date NOT NULL,
  from_state  vehicle_state,
  to_state    vehicle_state NOT NULL,
  rental_id   uuid REFERENCES rentals(id),
  reason      text,
  actor_id    uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_events_manual_reason CHECK (kind <> 'manual' OR reason IS NOT NULL)
);
CREATE INDEX vehicle_events_vehicle_idx ON vehicle_events(vehicle_id, occurred_on);

-- ---------------------------------------------------------------------------
-- Change journal (spec §8): who, when, what was, what became. Append-only;
-- nothing in the code updates or deletes a row here. There is no delete in
-- the product — only archive — so the journal is the full history.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES users(id),
  action      text NOT NULL,
  entity_type text NOT NULL,
  entity_id   text,
  before      jsonb,
  after       jsonb,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_entity_idx ON audit_log(entity_type, entity_id);
CREATE INDEX audit_log_created_idx ON audit_log(created_at);
