// Seed: the first owner login, nothing else.
//
// EV8 Ops has no demo dataset by rule (CLAUDE.md: never invent data). Real
// data arrives through tools/migrate_stage1.py from Odoo. This script only
// makes sure somebody can sign in to an empty database.
//
//   tsx src/seed.ts --if-empty     create the owner only when there are no users
//   tsx src/seed.ts                same, but say so out loud when users exist
//
// OWNER_EMAIL / OWNER_NAME / OWNER_PASSWORD come from the environment.
import { hashPassword } from './lib/auth.js';
import { closeDb, prisma } from './lib/db.js';
import { env } from './lib/env.js';

const IF_EMPTY = process.argv.includes('--if-empty');

async function main(): Promise<void> {
  const users = await prisma.user.count();
  if (users > 0) {
    console.log(IF_EMPTY ? 'seed: users exist, nothing to do' : `seed: ${users} user(s) already present, not touching them`);
    return;
  }
  if (!env.OWNER_PASSWORD) {
    throw new Error('seed: OWNER_PASSWORD is not set. The first owner login needs a password; there is no default.');
  }
  if (env.OWNER_PASSWORD.length < 8) {
    throw new Error('seed: OWNER_PASSWORD is shorter than 8 characters.');
  }
  await prisma.user.create({
    data: {
      email: env.OWNER_EMAIL,
      name: env.OWNER_NAME,
      passwordHash: hashPassword(env.OWNER_PASSWORD),
      role: 'owner',
      locale: env.DEFAULT_LOCALE,
    },
  });
  console.log(`seed: owner login created for ${env.OWNER_EMAIL}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
