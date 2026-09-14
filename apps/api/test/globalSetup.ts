// Integration-test safety rails, as in Self Platform.
//   1. Refuse to touch a database that has not opted in as a test database.
//   2. Delete whatever the run created, in FK-safe order, when it finishes.
const OPT_IN = 'EV8_TEST_DB';

function assertDisposableDatabase(url: string): void {
  if (process.env[OPT_IN] === 'yes-wipe-it') return;
  const dbName = (url.split('/').pop() ?? '').split('?')[0].toLowerCase();
  if (/test/.test(dbName)) return;
  throw new Error(
    `Refusing to run integration tests against database "${dbName}".\n` +
      'These suites write to the database and delete what they wrote — pointing them\n' +
      'at a working stand mixes test rows into real customers and rentals.\n\n' +
      'Use a disposable database whose name contains "test", e.g.\n' +
      '  DATABASE_URL=postgresql://ev8ops:ev8ops@localhost:5433/ev8ops_test\n' +
      `or set ${OPT_IN}=yes-wipe-it if you genuinely mean this one.`,
  );
}

let startedAt: Date | null = null;

export async function setup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return; // no DB → every integration suite skips itself
  assertDisposableDatabase(url);
  startedAt = new Date();
}

export async function teardown(): Promise<void> {
  if (!startedAt) return;
  const { prisma, closeDb } = await import('../src/lib/db.js');
  const since = { gte: startedAt };
  try {
    await prisma.auditLog.deleteMany({ where: { createdAt: since } });
    await prisma.vehicleEvent.deleteMany({ where: { createdAt: since } });
    await prisma.rental.deleteMany({ where: { createdAt: since } }); // periods, deposit, acts cascade
    await prisma.vehicle.deleteMany({ where: { createdAt: since } });
    await prisma.vehicleModel.deleteMany({ where: { createdAt: since } });
    await prisma.customer.deleteMany({ where: { createdAt: since } });
    await prisma.user.deleteMany({ where: { createdAt: since } }); // sessions cascade
  } finally {
    await closeDb();
  }
}
