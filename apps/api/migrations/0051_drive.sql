-- EV8 Ops — migration 0051: what the rentals folders in Drive hold.
--
-- The company files each rental in Google Drive: a folder for the renter,
-- named by the pickup day and the name, with the contract; when the moped
-- comes back the folder moves to the finished rentals with the return act
-- (Mika, 19.10.2026, variant A; ADR-0031). EV8 Ops reads that, read only, and
-- keeps here what it read — the folders, their documents, what Signify's
-- documents say — to lay beside the rentals. Nothing here is the company's
-- record: it is a copy of Drive, made again on every read, and a folder that
-- is no longer there is no longer here.

CREATE TABLE drive_folders (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  section     text NOT NULL CHECK (section IN ('active', 'finished')),
  web_url     text,
  dated_on    date,
  rental_id   uuid REFERENCES rentals(id) ON DELETE SET NULL,
  matched_by  text CHECK (matched_by IN ('vin', 'name_date', 'name')),
  seen_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drive_folders_rental ON drive_folders(rental_id);

CREATE TABLE drive_files (
  id               text PRIMARY KEY,
  folder_id        text NOT NULL REFERENCES drive_folders(id) ON DELETE CASCADE,
  name             text NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('contract', 'return_act', 'scan')),
  modified_at      timestamptz NOT NULL,
  web_url          text,
  -- The version whose text was read; another modified time is read again.
  read_modified_at timestamptz,
  dated_on         date,
  contract_on      date,
  vin              text,
  deposit_tetri    integer,
  withheld_tetri   integer,
  paid_back_tetri  integer,
  seen_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drive_files_folder ON drive_files(folder_id);

-- One row: how the last read went.
CREATE TABLE drive_sync (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_try_at timestamptz,
  last_ok_at  timestamptz,
  failure     text,
  folders     integer NOT NULL DEFAULT 0,
  files       integer NOT NULL DEFAULT 0
);
INSERT INTO drive_sync (id) VALUES (1);
