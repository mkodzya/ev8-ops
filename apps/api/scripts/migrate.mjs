#!/usr/bin/env node
// Hermetic SQL migration runner — no Prisma engines, no network.
// Applies apps/api/migrations/*.sql in filename order, records each in
// _migrations with a sha256 checksum, refuses to run if an applied file drifted.
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', 'migrations');
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('migrate: DATABASE_URL is not set');
  process.exit(1);
}

// node-postgres Clients are single-use: calling .connect() a second time on
// the same instance throws "Client has already been connected", even after a
// prior failed attempt. So each retry gets its own fresh Client — reusing one
// across retries was a latent bug that only showed up when the db container
// took a moment to become ready (e.g. right after a recreate).
async function waitForDb(retries = 30) {
  for (let i = 0; i < retries; i++) {
    const attempt = new pg.Client({ connectionString: url });
    try {
      await attempt.connect();
      return attempt;
    } catch (err) {
      await attempt.end().catch(() => {});
      if (i === retries - 1) throw err;
      console.log(`migrate: database not ready (${err.code ?? err.message}), retrying in 2s…`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

const client = await waitForDb();
await client.query(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
const { rows: appliedRows } = await client.query('SELECT name, checksum FROM _migrations');
const applied = new Map(appliedRows.map((r) => [r.name, r.checksum]));

let ran = 0;
for (const file of files) {
  const sql = await readFile(join(migrationsDir, file), 'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const prior = applied.get(file);
  if (prior) {
    if (prior !== checksum) {
      console.error(`migrate: ${file} was already applied but its content changed. Refusing.`);
      process.exit(1);
    }
    continue;
  }
  process.stdout.write(`migrate: applying ${file}… `);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO _migrations (name, checksum) VALUES ($1, $2)', [file, checksum]);
    await client.query('COMMIT');
    console.log('ok');
    ran++;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`failed\n${err.message}`);
    process.exit(1);
  }
}

console.log(ran === 0 ? 'migrate: up to date' : `migrate: applied ${ran} migration(s)`);
await client.end();
