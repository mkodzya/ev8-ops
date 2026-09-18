import { prisma } from './db.js';

// The till by person (wave 2 §3.4, money.md decision В3). Nothing here is
// stored as a balance: each figure is summed from the payments a person took
// or paid out in cash, what they handed over, what they accepted from others
// and what they took to the bank — so a correction anywhere is the answer
// everywhere.

export interface TillRow {
  userId: string;
  name: string;
  role: string;
  /** Within the period asked for. */
  cashInTetri: number;
  cashInCount: number;
  cashOutTetri: number;
  handedTetri: number;
  acceptedTetri: number;
  bankTetri: number;
  /** Counted short on a handover and still the person's to explain. */
  shortTetri: number;
  /** Of what this person handed over in the period, what an owner has taken (§3.4 "принял владелец"). */
  takenTetri: number;
  /** Now, whatever the period: what this person should have on them. */
  onHandTetri: number;
  /** Handed over and not yet accepted. */
  pendingTetri: number;
  pending: { id: string; amountTetri: number; handedAt: string }[];
}

export async function tillSince(): Promise<Date> {
  const s = await prisma.moneySettings.findUnique({ where: { id: true } });
  return s?.tillSince ?? new Date(0);
}

export async function tillRows(opts: { from: Date; to: Date; userIds?: string[] }): Promise<TillRow[]> {
  const since = await tillSince();
  const users = await prisma.user.findMany({
    where: { active: true, ...(opts.userIds ? { id: { in: opts.userIds } } : {}) },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  const ids = users.map((u) => u.id);
  const [payments, handovers, bank] = await Promise.all([
    prisma.payment.findMany({
      where: { createdById: { in: ids }, channel: 'cash', voidedAt: null, createdAt: { gte: since } },
      select: { createdById: true, direction: true, grossTetri: true, createdAt: true },
    }),
    prisma.cashHandover.findMany({
      where: { handedAt: { gte: since } },
      select: { id: true, fromUserId: true, amountTetri: true, handedAt: true, status: true, countedTetri: true, decidedById: true, decidedAt: true },
      orderBy: { handedAt: 'asc' },
    }),
    prisma.bankCashDeposit.findMany({
      where: { userId: { in: ids }, voidedAt: null, createdAt: { gte: since } },
      select: { userId: true, amountTetri: true, createdAt: true },
    }),
  ]);

  const within = (d: Date) => d >= opts.from && d <= opts.to;
  const received = (h: (typeof handovers)[number]) => (h.status === 'disputed' ? h.countedTetri ?? 0 : h.amountTetri);

  return users.map((u) => {
    const mine = payments.filter((p) => p.createdById === u.id);
    const cashIn = mine.filter((p) => p.direction === 'in');
    const cashOut = mine.filter((p) => p.direction === 'out');
    const handed = handovers.filter((h) => h.fromUserId === u.id);
    const accepted = handovers.filter((h) => h.decidedById === u.id && h.status !== 'pending');
    const toBank = bank.filter((b) => b.userId === u.id);
    const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((n, x) => n + f(x), 0);
    const onHand =
      sum(cashIn, (p) => p.grossTetri) - sum(cashOut, (p) => p.grossTetri) - sum(handed, (h) => h.amountTetri) + sum(accepted, received) - sum(toBank, (b) => b.amountTetri);
    const pending = handed.filter((h) => h.status === 'pending');
    return {
      userId: u.id,
      name: u.name,
      role: u.role,
      cashInTetri: sum(cashIn.filter((p) => within(p.createdAt)), (p) => p.grossTetri),
      cashInCount: cashIn.filter((p) => within(p.createdAt)).length,
      cashOutTetri: sum(cashOut.filter((p) => within(p.createdAt)), (p) => p.grossTetri),
      handedTetri: sum(handed.filter((h) => within(h.handedAt)), (h) => h.amountTetri),
      acceptedTetri: sum(accepted.filter((h) => within(h.decidedAt!)), received),
      bankTetri: sum(toBank.filter((b) => within(b.createdAt)), (b) => b.amountTetri),
      shortTetri: sum(handed.filter((h) => h.status === 'disputed'), (h) => h.amountTetri - (h.countedTetri ?? 0)),
      takenTetri: sum(handed.filter((h) => h.status !== 'pending' && within(h.handedAt)), received),
      onHandTetri: onHand,
      pendingTetri: sum(pending, (h) => h.amountTetri),
      pending: pending.map((h) => ({ id: h.id, amountTetri: h.amountTetri, handedAt: h.handedAt.toISOString() })),
    };
  });
}

export async function onHandOf(userId: string): Promise<number> {
  const [row] = await tillRows({ from: new Date(0), to: new Date(), userIds: [userId] });
  return row?.onHandTetri ?? 0;
}
