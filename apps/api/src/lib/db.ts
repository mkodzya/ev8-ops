import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from './env.js';

// One pg pool shared by Prisma (through the driver adapter) and raw SQL.
// Migrations are the exception: they run through scripts/migrate.mjs.
export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: 10,
  allowExitOnIdle: true, // lets test runs exit cleanly
});

export const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

export async function closeDb(): Promise<void> {
  await prisma.$disconnect();
  await pool.end().catch(() => {});
}
