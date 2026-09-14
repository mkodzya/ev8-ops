-- Repair jobs (SRV-01, SRV-02).
--
-- A job is opened on a VIN, not on a rental: a moped is repaired whether it
-- is standing in the yard or out with somebody. When it is out, the repair
-- can be charged to the renter — by keeping part of the deposit, or as a
-- charge that stands on their balance until it is paid (SRV-02).
--
-- Whether the job moved the moped into service is recorded on the job, so
-- closing it only moves the moped back if this job is what put it there.

CREATE TYPE service_status AS ENUM ('open', 'done', 'cancelled');
CREATE TYPE service_payer  AS ENUM ('company', 'customer');

CREATE SEQUENCE service_number_seq;

CREATE TABLE service_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number          text NOT NULL UNIQUE DEFAULT 'SV-' || lpad(nextval('service_number_seq')::text, 5, '0'),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  rental_id       uuid REFERENCES rentals(id),
  customer_id     uuid REFERENCES customers(id),
  reason          text NOT NULL,
  opened_on       date NOT NULL,
  closed_on       date,
  status          service_status NOT NULL DEFAULT 'open',
  payer           service_payer NOT NULL DEFAULT 'company',
  labour_tetri    integer NOT NULL DEFAULT 0 CHECK (labour_tetri >= 0),
  done_by         text,
  notes           text,
  moved_vehicle   boolean NOT NULL DEFAULT false,
  withheld_tetri  integer NOT NULL DEFAULT 0 CHECK (withheld_tetri >= 0),
  odoo_repair_id  integer UNIQUE,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_closed_shape CHECK ((status = 'open') = (closed_on IS NULL)),
  -- Only a renter can be charged, and only for a job that names them.
  CONSTRAINT service_payer_shape CHECK (payer = 'company' OR customer_id IS NOT NULL),
  -- Keeping part of a deposit is a way of charging the renter, not a thing
  -- the company does to itself.
  CONSTRAINT service_withheld_shape CHECK (withheld_tetri = 0 OR (payer = 'customer' AND rental_id IS NOT NULL))
);
CREATE INDEX service_jobs_vehicle_idx ON service_jobs(vehicle_id);
CREATE INDEX service_jobs_status_idx ON service_jobs(status) WHERE status = 'open';
CREATE INDEX service_jobs_customer_idx ON service_jobs(customer_id) WHERE customer_id IS NOT NULL;

CREATE TABLE service_parts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           uuid NOT NULL REFERENCES service_jobs(id) ON DELETE CASCADE,
  name             text NOT NULL,
  qty              integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_price_tetri integer NOT NULL CHECK (unit_price_tetri >= 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_parts_job_idx ON service_parts(job_id);

-- Photos of the damage, alongside act photos and customer documents.
ALTER TYPE file_kind ADD VALUE 'service_photo';
ALTER TABLE files ADD COLUMN service_job_id uuid REFERENCES service_jobs(id) ON DELETE CASCADE;
CREATE INDEX files_service_idx ON files(service_job_id) WHERE service_job_id IS NOT NULL;
