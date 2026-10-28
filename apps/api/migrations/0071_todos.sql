-- EV8 Ops — migration 0071: «Задачи», the tasks people set by hand (GitHub
-- issue #18 of the director, part A; Mika's «А» of 28.10.2026; ADR-0050).
--
-- An owner sets a task to a manager, to the chief mechanic or to himself;
-- everybody else to himself. A task is a text, a due day, whose it is, a
-- comment, «нужно фото или файл, чтобы закрыть» and, if wanted, the moped,
-- the rental or the customer it is about. It closes with «Сделано», a
-- comment if wanted, and the file when one was asked for.
--
--   * **Only what a person set.** Nothing «Сегодня» derives from the data —
--     a late week, a return, a moped due for maintenance — is copied here
--     (the director's issue, «Чтобы не задвоить»). The code says "todo":
--     "task" already names those rows.
--   * **A repeat is a series, each occurrence a task of its own.** The series
--     keeps what every occurrence is made from and the day of the last one it
--     made; the next one is made as soon as the last one's day has passed,
--     closed or not — «следующая появляется сама, даже если прошлая не
--     закрыта». `series_on` is the day the series gave an occurrence: it stays
--     when its due day is moved, and one series makes one task per day.
--   * **A record that ends closes the tasks about it**: a rental returned, a
--     moped sold or written off. Such a task says it closed by itself
--     (`closed_by_record`), not who closed it.
--   * **Nothing is deleted.** A task taken back by whoever set it keeps its
--     row with who and when; the journal keeps the rest.
--   * **The file it closes with is a stored file** (`files`, kind
--     `todo_file`): the bytes where every other photo and PDF is. The kind is
--     added here and used in 0072 — a value added to an enum cannot be used in
--     the transaction that added it.
--
-- Nothing is filled in: there were no tasks before this.

ALTER TYPE file_kind ADD VALUE IF NOT EXISTS 'todo_file';

CREATE TABLE IF NOT EXISTS todo_series (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repeat      text NOT NULL CHECK (repeat IN ('weekly', 'monthly')),
  -- The weekday (1 = Monday … 7 = Sunday) or the day of the month (1–31; the
  -- last day of a shorter month) — read from the first task's due day.
  repeat_day  smallint NOT NULL,
  -- The day of the last occurrence the series made.
  last_on     date NOT NULL,
  -- What each occurrence is made from; a change to a task of the series is
  -- a change to the ones after it.
  text        text NOT NULL CHECK (btrim(text) <> ''),
  note        text,
  lead_days   integer NOT NULL DEFAULT 0 CHECK (lead_days BETWEEN 0 AND 30),
  needs_file  boolean NOT NULL DEFAULT false,
  assignee_id uuid NOT NULL REFERENCES users(id),
  created_by  uuid NOT NULL REFERENCES users(id),
  vehicle_id  uuid REFERENCES vehicles(id),
  rental_id   uuid REFERENCES rentals(id),
  customer_id uuid REFERENCES customers(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- «Не повторять»: whoever set it, or the end of the record it is about.
  stopped_at  timestamptz,
  stopped_by  uuid REFERENCES users(id),
  CONSTRAINT todo_series_day CHECK (
    (repeat = 'weekly' AND repeat_day BETWEEN 1 AND 7) OR (repeat = 'monthly' AND repeat_day BETWEEN 1 AND 31)
  ),
  CONSTRAINT todo_series_one_link CHECK (num_nonnulls(vehicle_id, rental_id, customer_id) <= 1)
);
-- What still makes occurrences: read on every count of the menu.
CREATE INDEX IF NOT EXISTS todo_series_running ON todo_series (last_on) WHERE stopped_at IS NULL;

CREATE TABLE IF NOT EXISTS todos (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  text             text NOT NULL CHECK (btrim(text) <> ''),
  -- The comment of whoever set it.
  note             text,
  -- The Tbilisi day it is due.
  due_on           date NOT NULL,
  -- «Показать заранее за N дней»: on «Сегодня» this many days before its day.
  lead_days        integer NOT NULL DEFAULT 0 CHECK (lead_days BETWEEN 0 AND 30),
  -- «Нужно фото или файл, чтобы закрыть».
  needs_file       boolean NOT NULL DEFAULT false,
  assignee_id      uuid NOT NULL REFERENCES users(id),
  created_by       uuid NOT NULL REFERENCES users(id),
  vehicle_id       uuid REFERENCES vehicles(id),
  rental_id        uuid REFERENCES rentals(id),
  customer_id      uuid REFERENCES customers(id),
  series_id        uuid REFERENCES todo_series(id),
  series_on        date,
  closed_at        timestamptz,
  closed_by        uuid REFERENCES users(id),
  -- The comment of whoever closed it.
  close_note       text,
  -- Closed by itself: the record it was about ended.
  closed_by_record boolean NOT NULL DEFAULT false,
  deleted_at       timestamptz,
  deleted_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT todos_one_link CHECK (num_nonnulls(vehicle_id, rental_id, customer_id) <= 1),
  CONSTRAINT todos_series_shape CHECK ((series_id IS NULL) = (series_on IS NULL)),
  -- Open; closed by a person; or closed by its record — never two of them.
  CONSTRAINT todos_closed_shape CHECK (
    (closed_at IS NULL AND closed_by IS NULL AND close_note IS NULL AND NOT closed_by_record)
    OR (closed_at IS NOT NULL AND (closed_by IS NOT NULL) <> closed_by_record)
  ),
  CONSTRAINT todos_deleted_shape CHECK ((deleted_at IS NULL) = (deleted_by IS NULL))
);
-- One occurrence per day of a series, however many readers ask for it at once.
CREATE UNIQUE INDEX IF NOT EXISTS todos_series_slot ON todos (series_id, series_on) WHERE series_id IS NOT NULL;
-- The open tasks of a person, by day: the list, the block on «Сегодня», the menu's numbers.
CREATE INDEX IF NOT EXISTS todos_open_assignee ON todos (assignee_id, due_on) WHERE closed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS todos_rental_idx ON todos (rental_id) WHERE rental_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS todos_vehicle_idx ON todos (vehicle_id) WHERE vehicle_id IS NOT NULL;

-- The photo or the file a task closed with.
ALTER TABLE files ADD COLUMN IF NOT EXISTS todo_id uuid REFERENCES todos(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS files_todo_idx ON files(todo_id) WHERE todo_id IS NOT NULL;
