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
    // The notices a run wrote (0061) point at nothing by a key: they go first.
    await prisma.notice.deleteMany({ where: { createdAt: since } });
    // The translations a run listed, and the days it counted (0065): copies and counts, keyed by nothing else.
    await prisma.textTranslation.deleteMany({ where: { firstSeenAt: since } });
    await prisma.translationDay.deleteMany({ where: { updatedAt: since } });
    // What a stand-in for Kommo left behind, should a suite have died before
    // its own cleanup. The one row of `kommo_sync` is a singleton and stays.
    await prisma.kommoLead.deleteMany({ where: { firstSeenAt: since } });
    // A tracker points at its moped, its repair and its line; a part bought
    // points at the photo of its receipt (0058). Both go before the files.
    await prisma.vehicleTracker.deleteMany({ where: { createdAt: since } });
    await prisma.servicePart.deleteMany({ where: { createdAt: since } });
    await prisma.storedFile.deleteMany({ where: { createdAt: since } });
    // The tasks a run set and their repeats (0071, ADR-0050) point at people, mopeds, rentals and
    // customers: they go before all of those, the tasks before the repeats that made them. One is the
    // run's when it was made in the run, or set by or to somebody the run made.
    await prisma.todo.deleteMany({ where: { OR: [{ createdAt: since }, { createdBy: { createdAt: since } }, { assignee: { createdAt: since } }] } });
    await prisma.todoSeries.deleteMany({ where: { OR: [{ createdAt: since }, { createdBy: { createdAt: since } }, { assignee: { createdAt: since } }] } });
    // A payment and its statement line cross-reference each other; both
    // sides drop to NULL on delete (migration 0006), so the order here is
    // free. Payments first, then the statements that carried them.
    // A payout's rent offset (0066) points at its payment: let go of it first; the payout itself goes below.
    await prisma.mechanicPayout.updateMany({ where: { markedAt: since, offsetPaymentId: { not: null } }, data: { offsetTetri: 0, offsetPaymentId: null } });
    await prisma.payment.deleteMany({ where: { createdAt: since } }); // allocations cascade
    // The till's own rows point at people: they go before the people do.
    await prisma.cashHandover.deleteMany({ where: { handedAt: since } });
    await prisma.bankCashDeposit.deleteMany({ where: { createdAt: since } });
    await prisma.statement.deleteMany({ where: { createdAt: since } }); // lines cascade
    // Remembered payees and the categories a run added point at people and at
    // each other; the lines that pointed at them went with their statements.
    await prisma.expenseRule.deleteMany({ where: { createdAt: since } });
    await prisma.expenseCategory.deleteMany({ where: { createdAt: since } });
    // Payers remembered (0069) point at customers and at the income categories a run added.
    // A rule is the run's when it was remembered in the run or by somebody the run made:
    // a suite that dates one back to test the undo's minute still owns it. One the run
    // only forgot keeps its row and lets go of the person who forgot it.
    const runUserIds = (await prisma.user.findMany({ where: { createdAt: since }, select: { id: true } })).map((u) => u.id);
    await prisma.payerRule.deleteMany({ where: { OR: [{ createdAt: since }, { createdById: { in: runUserIds } }] } });
    await prisma.payerRule.updateMany({ where: { archivedById: { in: runUserIds } }, data: { archivedById: null } });
    await prisma.incomeCategory.deleteMany({ where: { createdAt: since } });
    // A battery moved by a repair names it (0058): the movement goes first.
    await prisma.batteryMove.deleteMany({ where: { createdAt: since } });
    // A goods sale (0067): its shelf movements name its lines, its payments went
    // above; then the sales themselves, lines and invoices cascading.
    // A sale is the run's when it was made in the run or by somebody the run made:
    // a suite that dates one back to test the undo's minute still owns it.
    const goodsOfRun = { OR: [{ createdAt: since }, { createdBy: { createdAt: since } }] };
    await prisma.stockMove.deleteMany({ where: { goodsSaleLine: { sale: goodsOfRun } } });
    await prisma.goodsSale.deleteMany({ where: goodsOfRun });
    await prisma.serviceJob.deleteMany({ where: { createdAt: since } }); // parts and photos cascade
    // A paid repair and a receipt paid back name their payout (0059): they go
    // first, then the payouts, before the people who were paid and who marked them.
    await prisma.mechanicPayout.deleteMany({ where: { markedAt: since } });
    await prisma.sale.deleteMany({ where: { createdAt: since } }); // instalments cascade
    await prisma.vehicle.updateMany({ where: { createdAt: since }, data: { purchaseId: null } });
    await prisma.purchase.deleteMany({ where: { createdAt: since } }); // lines cascade
    await prisma.vehicleEvent.deleteMany({ where: { createdAt: since } });
    // Batteries are counted, and the count remembers who counted it: the rows
    // go before the rentals they point at and the people who wrote them.
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
    await prisma.serviceSettings.updateMany({ where: { updatedBy: { createdAt: since } }, data: { updatedById: null } });
    await prisma.customer.deleteMany({ where: { createdAt: since } });
    // The book of works: what a run wrote into it — the bot's book too, when
    // the run imported it into an empty database — goes after the repairs
    // that used it (their lines cascade) and before the people who wrote it.
    await prisma.workType.deleteMany({ where: { createdAt: since } });
    await prisma.workCategory.deleteMany({ where: { createdAt: since, works: { none: {} } } });
    // Workshop devices name the owner who registered them (0055); sessions on them go first.
    await prisma.session.deleteMany({ where: { device: { registeredAt: since } } });
    await prisma.workshopDevice.deleteMany({ where: { registeredAt: since } });
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
