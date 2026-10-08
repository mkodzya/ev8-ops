// The Kommo link, step 1: where Kommo and EV8 Ops disagree about who rents
// (Mika, 07.10.2026; ADR-0012). Kommo is where the day's work is written, so
// its "rented" stage is read and laid beside the rentals running here. This
// file is the comparison and nothing else — no network, no database — because
// "Today" and the list both count from it and must not count differently.

/**
 * The deal a Kommo field points at. People paste the link from the address
 * bar (`https://…kommo.com/leads/detail/19912345`) or type the bare number;
 * anything else names no deal.
 */
export function kommoLeadId(ref: string | null | undefined): string | null {
  const s = (ref ?? '').trim();
  if (!s) return null;
  const m = s.match(/\/leads\/detail\/(\d+)/) ?? s.match(/^#?(\d+)$/);
  return m ? m[1]! : null;
}

/** A deal in Kommo's "rented" stage, as the last poll that worked saw it. */
export interface KommoLead {
  id: string;
  name: string;
  contactName: string | null;
}

/** A rental that is out with a customer here: picked up and not returned. */
export interface KommoRunningRental {
  id: string;
  number: string;
  kommoRef: string | null;
  vin: string | null;
  customer: { id: string; name: string; kommoRef: string | null };
}

/** A customer card here that carries a Kommo link. */
export interface KommoLinkedCustomer {
  id: string;
  name: string;
  kommoRef: string | null;
}

/** Rented in Kommo, no running rental here. */
export interface KommoRentedThere {
  leadId: string;
  leadName: string;
  contactName: string | null;
  /** The card here that points at this deal — where the rental is to be entered. */
  customer: { id: string; name: string } | null;
}

/**
 * Running here, and Kommo does not say so: the deal is not in the rented
 * stage (`not_rented`), or the rental and its customer name no deal at all
 * (`no_link`).
 */
export interface KommoRentedHere {
  rentalId: string;
  number: string;
  vin: string | null;
  customer: { id: string; name: string };
  leadId: string | null;
  reason: 'not_rented' | 'no_link';
}

export interface KommoMismatches {
  rentedThere: KommoRentedThere[];
  rentedHere: KommoRentedHere[];
  /** Deals that found their rental — so "17 in Kommo, 17 matched" can be said. */
  matched: number;
}

/**
 * The deal a rental answers to: its own Kommo field, and when that names no
 * deal, its customer's. A rental's own link wins — one customer may rent two
 * mopeds on two deals.
 */
export function leadOfRental(r: Pick<KommoRunningRental, 'kommoRef' | 'customer'>): string | null {
  return kommoLeadId(r.kommoRef) ?? kommoLeadId(r.customer.kommoRef);
}

export function reconcileKommo(leads: readonly KommoLead[], rentals: readonly KommoRunningRental[], customers: readonly KommoLinkedCustomer[]): KommoMismatches {
  const rented = new Set(leads.map((l) => l.id));
  const covered = new Set<string>();
  const rentedHere: KommoRentedHere[] = [];

  for (const r of rentals) {
    const leadId = leadOfRental(r);
    if (leadId && rented.has(leadId)) {
      covered.add(leadId);
      continue;
    }
    rentedHere.push({
      rentalId: r.id,
      number: r.number,
      vin: r.vin,
      customer: { id: r.customer.id, name: r.customer.name },
      leadId,
      reason: leadId ? 'not_rented' : 'no_link',
    });
  }

  const cardOf = new Map<string, { id: string; name: string }>();
  for (const c of customers) {
    const leadId = kommoLeadId(c.kommoRef);
    if (leadId && !cardOf.has(leadId)) cardOf.set(leadId, { id: c.id, name: c.name });
  }

  const rentedThere: KommoRentedThere[] = leads
    .filter((l) => !covered.has(l.id))
    .map((l) => ({ leadId: l.id, leadName: l.name, contactName: l.contactName, customer: cardOf.get(l.id) ?? null }));

  rentedThere.sort((a, b) => a.leadName.localeCompare(b.leadName) || a.leadId.localeCompare(b.leadId));
  rentedHere.sort((a, b) => a.number.localeCompare(b.number));
  return { rentedThere, rentedHere, matched: covered.size };
}

/**
 * How much the Kommo figures can be trusted right now. `waiting` — the link
 * is on and has not been asked yet; `silent` — Kommo has not answered for
 * longer than it should have, and what is on screen is the last list it gave.
 */
export type KommoFreshness = 'ok' | 'silent' | 'waiting';

export function kommoFreshness(lastOkAt: Date | null, lastTryAt: Date | null, now: Date, staleMs: number): KommoFreshness {
  if (!lastOkAt) return lastTryAt ? 'silent' : 'waiting';
  return now.getTime() - lastOkAt.getTime() > staleMs ? 'silent' : 'ok';
}

// ── Step 2: what EV8 Ops writes into a deal (ADR-0013) ──────────────────
//
// From the day the business runs here a rental payment is taken in EV8 Ops,
// and the note the staff used to type into the Kommo deal is written by EV8
// Ops itself. What follows is the wording of that note and the switch that
// says whether a stand writes at all — both without a network or a database.

/**
 * Whether this stand writes to Kommo, and where. Off unless said otherwise:
 * a stand that is only being tried out is connected to the real Kommo
 * account, and a trial payment must not land in a real customer's deal.
 * `only` names the deals a stand may write to and no other — a test deal
 * made for checking the link.
 */
export type KommoWriteMode = { kind: 'off' } | { kind: 'all' } | { kind: 'only'; leads: readonly string[] };

/** `on` — every deal; `only:123,456` — those deals; anything else, a typo included — off. */
export function kommoWriteMode(raw: string | null | undefined): KommoWriteMode {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === 'on') return { kind: 'all' };
  const m = s.match(/^only:([\d,\s]+)$/);
  const leads = m ? m[1]!.split(',').map((x) => x.trim()).filter((x) => x.length > 0) : [];
  return leads.length > 0 ? { kind: 'only', leads } : { kind: 'off' };
}

export const kommoMayWriteTo = (mode: KommoWriteMode, leadId: string): boolean => mode.kind === 'all' || (mode.kind === 'only' && mode.leads.includes(leadId));

export type KommoNoteLocale = 'ka' | 'ru' | 'en';

const NOTE_WORDS: Record<KommoNoteLocale, {
  payment: string;
  voided: string;
  channel: Record<'cash' | 'acquiring' | 'transfer', string>;
  rent: string;
  deposit: string;
  charges: string;
  credit: string;
  paidThrough: (d: string) => string;
  nothingPaid: string;
  takenBy: (who: string) => string;
  voidedBy: (who: string) => string;
  reason: (why: string) => string;
  of: (d: string) => string;
}> = {
  ru: {
    payment: 'оплата',
    voided: 'ОТМЕНЕНА оплата',
    channel: { cash: 'наличные', acquiring: 'карта', transfer: 'перевод' },
    rent: 'аренда',
    deposit: 'залог',
    charges: 'начисления',
    credit: 'на счёт клиента',
    paidThrough: (d) => `оплачено по ${d}`,
    nothingPaid: 'оплаченных недель нет',
    takenBy: (who) => `принял(а) ${who}`,
    voidedBy: (who) => `отменил(а) ${who}`,
    reason: (why) => `причина: ${why}`,
    of: (d) => `от ${d}`,
  },
  en: {
    payment: 'payment',
    voided: 'payment VOIDED',
    channel: { cash: 'cash', acquiring: 'card', transfer: 'bank transfer' },
    rent: 'rent',
    deposit: 'deposit',
    charges: 'charges',
    credit: 'customer credit',
    paidThrough: (d) => `paid through ${d}`,
    nothingPaid: 'no week paid',
    takenBy: (who) => `taken by ${who}`,
    voidedBy: (who) => `voided by ${who}`,
    reason: (why) => `reason: ${why}`,
    of: (d) => `of ${d}`,
  },
  // Written by a non-native; the words are the ones the screens already use.
  ka: {
    payment: 'გადახდა',
    voided: 'გადახდა გაუქმდა',
    channel: { cash: 'ნაღდი', acquiring: 'ბარათი', transfer: 'გადარიცხვა' },
    rent: 'ქირა',
    deposit: 'დეპოზიტი',
    charges: 'დარიცხვები',
    credit: 'კლიენტის ანგარიშზე',
    paidThrough: (d) => `გადახდილია ${d}-მდე`,
    nothingPaid: 'გადახდილი კვირა არ არის',
    takenBy: (who) => `მიიღო ${who}`,
    voidedBy: (who) => `გააუქმა ${who}`,
    reason: (why) => `მიზეზი: ${why}`,
    of: (d) => `${d}`,
  },
};

const noteDay = (iso: string): string => {
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
};
/** 150 ₾, 157.50 ₾ — with a plain space: the note is read in somebody else's interface. */
const noteGel = (tetri: number): string => {
  const whole = Math.floor(Math.abs(tetri) / 100);
  const frac = Math.abs(tetri) % 100;
  return `${tetri < 0 ? '-' : ''}${whole}${frac ? `.${String(frac).padStart(2, '0')}` : ''} ₾`;
};
const NOTE_SEP = ' · ';

export interface PaymentNoteFacts {
  rentalNumber: string;
  occurredOn: string;
  channel: 'cash' | 'acquiring' | 'transfer';
  grossTetri: number;
  /** What the payment closed on this rental, by kind; the rest is the customer's credit. */
  rentTetri: number;
  depositTetri: number;
  chargesTetri: number;
  /** The rental's "paid through" once this payment is in; null — no whole week is paid. */
  paidThrough: string | null;
  takenBy: string | null;
}

/**
 * The note for a payment, one line, the way the staff wrote theirs — what
 * came, when, how, what it closed, and where the rental stands after it:
 * `EV8 Ops · оплата 330 ₾ · 08.10.2026 · наличные · аренда 150 ₾, залог 180 ₾ · оплачено по 14.10.2026 · R-00012 · принял(а) …`.
 */
export function paymentNoteText(f: PaymentNoteFacts, locale: KommoNoteLocale): string {
  const w = NOTE_WORDS[locale];
  const credit = Math.max(0, f.grossTetri - f.rentTetri - f.depositTetri - f.chargesTetri);
  const parts = (
    [
      [w.rent, f.rentTetri],
      [w.deposit, f.depositTetri],
      [w.charges, f.chargesTetri],
      [w.credit, credit],
    ] as const
  ).filter(([, n]) => n > 0);
  // One part that is the whole payment needs no sum beside it.
  const split = parts.length === 1 ? parts[0]![0] : parts.map(([name, n]) => `${name} ${noteGel(n)}`).join(', ');
  return [
    'EV8 Ops',
    `${w.payment} ${noteGel(f.grossTetri)}`,
    noteDay(f.occurredOn),
    w.channel[f.channel],
    split,
    f.paidThrough ? w.paidThrough(noteDay(f.paidThrough)) : w.nothingPaid,
    f.rentalNumber,
    f.takenBy ? w.takenBy(f.takenBy) : '',
  ]
    .filter((x) => x.length > 0)
    .join(NOTE_SEP);
}

export interface PaymentVoidNoteFacts {
  rentalNumber: string;
  occurredOn: string;
  grossTetri: number;
  reason: string | null;
  paidThrough: string | null;
  voidedBy: string | null;
}

/** The note that takes an earlier one back: the payment was entered by mistake and is void. */
export function paymentVoidNoteText(f: PaymentVoidNoteFacts, locale: KommoNoteLocale): string {
  const w = NOTE_WORDS[locale];
  const why = (f.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return [
    'EV8 Ops',
    `${w.voided} ${noteGel(f.grossTetri)} ${w.of(noteDay(f.occurredOn))}`,
    why ? w.reason(why) : '',
    f.paidThrough ? w.paidThrough(noteDay(f.paidThrough)) : w.nothingPaid,
    f.rentalNumber,
    f.voidedBy ? w.voidedBy(f.voidedBy) : '',
  ]
    .filter((x) => x.length > 0)
    .join(NOTE_SEP);
}
