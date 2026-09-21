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
    await prisma.storedFile.deleteMany({ where: { createdAt: since } });
    // A payment and its statement line cross-reference each other; both
    // sides drop to NULL on delete (migration 0006), so the order here is
    // free. Payments first, then the statements that carried them.
    await prisma.payment.deleteMany({ where: { createdAt: since } }); // allocations cascade
    // The till's own rows point at people: they go before the people do.
    await prisma.cashHandover.deleteMany({ where: { handedAt: since } });
    await prisma.bankCashDeposit.deleteMany({ where: { createdAt: since } });
    await prisma.statement.deleteMany({ where: { createdAt: since } }); // lines cascade
    await prisma.serviceJob.deleteMany({ where: { createdAt: since } }); // parts and photos cascade
    await prisma.sale.deleteMany({ where: { createdAt: since } }); // instalments cascade
    await prisma.vehicle.updateMany({ where: { createdAt: since }, data: { purchaseId: null } });
    await prisma.purchase.deleteMany({ where: { createdAt: since } }); // lines cascade
    await prisma.vehicleEvent.deleteMany({ where: { createdAt: since } });
    // Batteries are counted, and the count remembers who counted it: the rows
    // go before the rentals they point at and the people who wrote them.
    await prisma.batteryMove.deleteMany({ where: { createdAt: since } });
    await prisma.batteryInventory.deleteMany({ where: { createdAt: since } });
    // A moped points at its current rental; unpin before the rental goes.
    await prisma.vehicle.updateMany({ where: { createdAt: since }, data: { currentRentalId: null } });
    await prisma.rental.deleteMany({ where: { createdAt: since } }); // periods, deposit, acts cascade
    await prisma.vehicle.deleteMany({ where: { createdAt: since } });
    // Points go after the mopeds that stood at them.
    await prisma.location.deleteMany({ where: { createdAt: since } });
    // The shelf goes before the people who moved things on it: a part
    // remembers who added it.
    await prisma.stockMove.deleteMany({ where: { createdAt: since } });
    await prisma.part.deleteMany({ where: { createdAt: since } });
    await prisma.vehicleModel.deleteMany({ where: { createdAt: since } });
    // Settings are singletons and quick rates outlive the run that made them,
    // but both remember the person who touched them (wave 6 §3.5). A run that
    // changed the deposit or added a rate therefore pins its own owner in
    // place, and deleting that owner fails on the foreign key — which is what
    // left the whole teardown half-done. The rows a run created go; the
    // singleton only forgets who last touched it.
    await prisma.quickRate.deleteMany({ where: { createdAt: since } });
    await prisma.workshop.deleteMany({ where: { createdAt: since } });
    await prisma.quickRate.updateMany({ where: { createdBy: { createdAt: since } }, data: { createdById: null } });
    await prisma.workshop.updateMany({ where: { createdBy: { createdAt: since } }, data: { createdById: null } });
    await prisma.rentalSettings.updateMany({ where: { updatedBy: { createdAt: since } }, data: { updatedById: null } });
    await prisma.customer.deleteMany({ where: { createdAt: since } });
    await prisma.user.deleteMany({ where: { createdAt: since } }); // sessions cascade
  } catch (err) {
    // Loudly. A cleanup that fails quietly leaves the next run matching
    // against rows nobody meant to keep — which is exactly how three
    // statement suites started failing on data from an earlier run.
    console.error('test teardown failed — the test database is now dirty:', err);
    throw err;
  } finally {
    await closeDb();
  }
}
