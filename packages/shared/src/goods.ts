// Goods sold over the counter (issue #11, ADR-0045; Mika 23.10.2026 «А»).
//
// Parts off the shelf and chargers from the count, sold to a customer or to
// a retail buyer who has no card. Two of Mika's decisions live here and in no
// other place, so the screen, the API and the invoice answer with one
// arithmetic:
//
//   * **The price is final, VAT inside.** A goods price is what the buyer is
//     told and pays; the 18 % is taken out of it once, from the sale's total
//     (100 ₾ = 84.75 + 15.25). Rent and everything else keep VAT on top —
//     this is a deliberate exception, not a second rule for the same thing.
//   * **The money is paid like a repair's**: a payment of its own kind tied to
//     the sale, with no allocation. What is open is the lines' total less the
//     sale's live payments.
//
// The rest are the session's defaults (docs/spec/goods-sales.md §1), named
// beside the function that carries each.
import { netFromGross, type Tetri } from './money.js';
import type { ISODate } from './types.js';
import { inPeriod, type Period } from './week.js';

/** What may be sold from the count. A battery is one word here, on Mika's say (§1 п. 17). */
export const SELLABLE_COUNTED = ['charger'] as const;
export type CountedGoods = 'charger' | 'battery';
export const GOODS_MAX_LINES = 20;
export const GOODS_MAX_QTY = 999;
/** «Отменить» on the toast: the seller, within a minute, as a payment's undo (§1 п. 11). */
export const GOODS_UNDO_MS = 60_000;

export interface GoodsLineMoney {
  qty: number;
  /** Final, VAT inside. */
  unitPriceTetri: Tetri;
}

export const goodsLineTetri = (l: GoodsLineMoney): Tetri => l.qty * l.unitPriceTetri;

export interface GoodsTotals {
  grossTetri: Tetri;
  netTetri: Tetri;
  vatTetri: Tetri;
}

/** The sale's total, and the VAT inside it — taken out once, from the whole. */
export function goodsTotals(lines: readonly GoodsLineMoney[]): GoodsTotals {
  const gross = lines.reduce((n, l) => n + goodsLineTetri(l), 0);
  const { net, vat } = netFromGross(gross);
  return { grossTetri: gross, netTetri: net, vatTetri: vat };
}

/**
 * Each line's share of the sale's net, by the largest remainder: the shares
 * add up to exactly the net `goodsTotals` gives, so a table by item and the
 * invoice's total cannot disagree by a tetri.
 */
export function goodsLineNets(lines: readonly GoodsLineMoney[]): Tetri[] {
  const { netTetri } = goodsTotals(lines);
  // gross / 1.18 in whole numbers: gross × 100 / 118.
  const exact = lines.map((l) => goodsLineTetri(l) * 100);
  const floors = exact.map((x) => Math.floor(x / 118));
  let left = netTetri - floors.reduce((n, x) => n + x, 0);
  const order = exact.map((x, i) => ({ i, rem: x % 118 })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  const out = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}

export type GoodsSaleStatus = 'active' | 'cancelled';
export type GoodsPayState = 'paid' | 'waiting_bank' | 'owes' | 'cancelled';
export type PromisedChannel = 'acquiring' | 'transfer';

/**
 * Where a sale's money stands. A cancelled sale owes nothing. What is open
 * and promised from the bank waits for its line; what is open and promised by
 * nobody is a debt — only an own customer's can be (§1 п. 7), but a retail
 * sale whose cash was voided says so too rather than claim to be paid.
 */
export function goodsSaleState(s: { status: GoodsSaleStatus; totalTetri: Tetri; paidTetri: Tetri; promisedChannel: PromisedChannel | null; retail: boolean }): {
  state: GoodsPayState;
  openTetri: Tetri;
} {
  if (s.status === 'cancelled') return { state: 'cancelled', openTetri: 0 };
  const open = Math.max(0, s.totalTetri - s.paidTetri);
  if (open === 0) return { state: 'paid', openTetri: 0 };
  return { state: s.promisedChannel ? 'waiting_bank' : 'owes', openTetri: open };
}

/**
 * A sale dated on or before an item's last stocktake asks whether the count
 * already saw it gone (§1 п. 9). A sale of today never does: a stocktake of
 * today was taken before it was written. Without a stocktake there is nothing
 * to have seen it.
 */
export function needsCountAnswer(soldOn: ISODate, lastCountOn: ISODate | null, today: ISODate): boolean {
  return lastCountOn != null && soldOn < today && soldOn <= lastCountOn;
}

export type StockDecision = 'already_counted' | 'ok' | 'refuse' | 'need_reason' | 'minus' | 'found_then_sold';

/**
 * Whether a line may take what it asks (§1 п. 3, 5). More than there is is
 * refused, except to an owner who says why: a part then goes below nought as
 * it is; a charger is first found — the count clamps at nought, and a minus
 * there would be invisible — and then sold, so the count stays where it was.
 * A line the stocktake already saw gone takes nothing at all.
 */
export function stockDecision(i: { asked: number; available: number; counted: boolean; owner: boolean; shortReason: string | null | undefined; countedAlready: boolean }): StockDecision {
  if (i.countedAlready) return 'already_counted';
  if (i.asked <= i.available) return 'ok';
  if (!i.owner) return 'refuse';
  if (!i.shortReason?.trim()) return 'need_reason';
  return i.counted ? 'found_then_sold' : 'minus';
}

/**
 * What is wrong with the money at the counter, if anything. Paying more than
 * the sale is refused; a retail buyer pays now or waits for the bank — there
 * is no card to put a debt on (§1 п. 7). An own customer may pay part, or
 * nothing.
 */
export function paymentProblem(i: { retail: boolean; totalTetri: Tetri; paidNowTetri: Tetri; promisedChannel: PromisedChannel | null }): 'retail_must_pay' | 'goods_paid_over' | null {
  if (i.paidNowTetri > i.totalTetri) return 'goods_paid_over';
  if (i.retail && i.paidNowTetri < i.totalTetri && !i.promisedChannel) return 'retail_must_pay';
  return null;
}

/** The shelf named a price and the seller sold at another: the journal says so. No price on the shelf is no edit. */
export function priceEdited(shelfPriceTetri: Tetri | null | undefined, unitPriceTetri: Tetri): boolean {
  return shelfPriceTetri != null && shelfPriceTetri > 0 && shelfPriceTetri !== unitPriceTetri;
}

export type CancelFate = 'credit' | 'void';

/**
 * What becomes of each payment when a sale is called off (§1 п. 4, 11, 13).
 * An own customer's money becomes his credit; a retail buyer's is voided
 * with the reason; the seller's own undo voids everything. A payment voided
 * that is one part of a split bank line would take the line's other parts
 * with it — that is refused, and the line is undone in «Разобрать» first.
 */
export function cancelPlan(i: { retail: boolean; mode: 'cancel' | 'undo'; payments: readonly { id: string; inSplit: boolean }[] }):
  | { refuse: 'goods_payment_in_split'; paymentId: string }
  | { fates: { id: string; fate: CancelFate }[] } {
  const fates = i.payments.map((p) => ({ id: p.id, fate: (i.mode === 'undo' || i.retail ? 'void' : 'credit') as CancelFate, inSplit: p.inSplit }));
  const stuck = fates.find((f) => f.fate === 'void' && f.inSplit);
  if (stuck) return { refuse: 'goods_payment_in_split', paymentId: stuck.id };
  return { fates: fates.map(({ id, fate }) => ({ id, fate })) };
}

/** A cancelled sale's reason when its seller undid it at once, no person's words in it (§1 п. 11). */
export const GOODS_UNDONE_AT_ONCE = 'undone at once';

/**
 * The reason a cancellation writes on everything it moves: the payment it
 * voids or turns into the customer's credit, the goods it puts back on the
 * shelf or in the showroom — «TS-00004 cancelled: <why>», where `why` is the
 * owner's words as typed or `GOODS_UNDONE_AT_ONCE`. Written from here and read
 * back by `goodsCancelNote`, so a screen says the code's part in the reader's
 * language and the person's part as it was typed (QA 23.10.2026: «TS-00004
 * cancelled: …» on a Russian screen). Rows already hold this shape: it never
 * changes, only the reading does.
 */
export function goodsCancelReason(number: string, why: string): string {
  return `${number} cancelled: ${why}`;
}

const CANCEL_NOTE = /^(TS-\d+) cancelled: ([\s\S]*)$/u;

/**
 * A cancellation's reason taken apart: the sale's number, and whose words —
 * the seller's undo (`undone`, no words), or the owner's, as typed. Null for
 * any other text, which a screen shows as it is.
 */
export function goodsCancelNote(reason: string | null | undefined): { number: string; undone: boolean; why: string } | null {
  const m = CANCEL_NOTE.exec((reason ?? '').trim());
  if (!m) return null;
  const why = m[2]!.trim();
  const undone = why === GOODS_UNDONE_AT_ONCE;
  return { number: m[1]!, undone, why: undone ? '' : why };
}

/**
 * The customer's one debt figure (B7-02) once a sale leaves `addedTetri` of
 * it open, from the figure and the credit he has now. The same arithmetic as
 * `customerDebt`: his money nothing has taken yet comes off the whole, the
 * new goods part included — so «было 750, станет 850» on the counter is what
 * his card will say after (QA 23.10.2026: the wizard said only this sale's 100).
 */
export function debtAfterSale(now: { owesTetri: Tetri; creditTetri: Tetri }, addedTetri: Tetri): Tetri {
  return Math.max(0, now.owesTetri - now.creditTetri + Math.max(0, addedTetri));
}

/** One line of a sale, as «Экономика» reads it. */
export interface GoodsEconomicsLine {
  saleId: string;
  soldOn: ISODate;
  status: GoodsSaleStatus;
  /** What the table groups by: `part:<id>` or `charger`. */
  key: string;
  name: string;
  qty: number;
  unitPriceTetri: Tetri;
  /** One unit's cost that day; null — nobody knows it, and the line stays out of the margin. */
  unitCostTetri: Tetri | null;
}

export interface GoodsEconomicsRow {
  key: string;
  name: string;
  qty: number;
  grossTetri: Tetri;
  netTetri: Tetri;
  /** Of the lines whose cost is known. */
  costTetri: Tetri;
  marginTetri: Tetri;
  unknownCostNetTetri: Tetri;
}

export interface GoodsEconomics {
  sales: number;
  qty: number;
  grossTetri: Tetri;
  vatTetri: Tetri;
  netTetri: Tetri;
  costTetri: Tetri;
  /** Net less cost, over the lines whose cost is known. */
  marginTetri: Tetri;
  /** Lines nobody knows the cost of: their net is not in the margin. */
  unknownCost: { lines: number; netTetri: Tetri };
  byItem: GoodsEconomicsRow[];
}

/**
 * Goods by the day they were sold, the cancelled left out. The net of each
 * sale is taken from its total once and shared over its lines, so the rows
 * add up to the total. The acquirer's fee is not a goods cost: it is the
 * company's expense, and the week shows it.
 */
export function goodsEconomics(lines: readonly GoodsEconomicsLine[], period: Period | null): GoodsEconomics {
  const live = lines.filter((l) => l.status === 'active' && (period == null || inPeriod(period, l.soldOn)));
  const bySale = new Map<string, GoodsEconomicsLine[]>();
  for (const l of live) bySale.set(l.saleId, [...(bySale.get(l.saleId) ?? []), l]);
  const out: GoodsEconomics = { sales: bySale.size, qty: 0, grossTetri: 0, vatTetri: 0, netTetri: 0, costTetri: 0, marginTetri: 0, unknownCost: { lines: 0, netTetri: 0 }, byItem: [] };
  const rows = new Map<string, GoodsEconomicsRow>();
  for (const sale of bySale.values()) {
    const totals = goodsTotals(sale);
    out.grossTetri += totals.grossTetri;
    out.vatTetri += totals.vatTetri;
    out.netTetri += totals.netTetri;
    const nets = goodsLineNets(sale);
    sale.forEach((l, i) => {
      const net = nets[i]!;
      const row = rows.get(l.key) ?? { key: l.key, name: l.name, qty: 0, grossTetri: 0, netTetri: 0, costTetri: 0, marginTetri: 0, unknownCostNetTetri: 0 };
      row.qty += l.qty;
      row.grossTetri += goodsLineTetri(l);
      row.netTetri += net;
      out.qty += l.qty;
      if (l.unitCostTetri == null) {
        row.unknownCostNetTetri += net;
        out.unknownCost.lines += 1;
        out.unknownCost.netTetri += net;
      } else {
        const cost = l.qty * l.unitCostTetri;
        row.costTetri += cost;
        row.marginTetri += net - cost;
        out.costTetri += cost;
        out.marginTetri += net - cost;
      }
      rows.set(l.key, row);
    });
  }
  out.byItem = [...rows.values()].sort((a, b) => b.grossTetri - a.grossTetri || a.name.localeCompare(b.name));
  return out;
}

const COUNTED_WORDS: Record<CountedGoods, { ru: string; ka: string; en: string }> = {
  charger: { ru: 'Зарядка', ka: 'დამტენი', en: 'Charger' },
  battery: { ru: 'Батарея', ka: 'ბატარეა', en: 'Battery' },
};

/** A counted item's name as sold and printed: «Зарядка 73V6A» / «დამტენი 73V6A» / «Charger 73V6A». */
export function countedName(item: CountedGoods, spec: string | null | undefined): { ru: string; ka: string; en: string } {
  const w = COUNTED_WORDS[item];
  const s = spec?.trim();
  return s ? { ru: `${w.ru} ${s}`, ka: `${w.ka} ${s}`, en: `${w.en} ${s}` } : { ...w };
}
