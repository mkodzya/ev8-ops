// The Kommo link: where Kommo and EV8 Ops disagree about who rents
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
  /** The card here the deal was tied to when it came in (ADR-0015): found by its phone, or made from the contact. */
  customerId?: string | null;
}

/**
 * A phone as something to compare by: its digits, a Georgian mobile with its
 * country code. Two cards of one person rarely write the number the same way
 * — `595 12 34 56`, `+995595123456`, `00995 595…` — and a deal coming in from
 * Kommo must find the card that is already here rather than make a second.
 */
export function phoneKey(raw: string | null | undefined): string | null {
  let d = (raw ?? '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9 && d.startsWith('5')) d = `995${d}`;
  return d.length >= 9 ? d : null;
}

/** `+995 595 12 34 56` for a Georgian mobile — the way the hand-over writes it on a card; anything else as it came. */
export function phoneAsOnCard(raw: string): string {
  const key = phoneKey(raw);
  if (key && key.length === 12 && key.startsWith('9955')) {
    const l = key.slice(3);
    return `+995 ${l.slice(0, 3)} ${l.slice(3, 5)} ${l.slice(5, 7)} ${l.slice(7)}`;
  }
  return raw.trim();
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

  const cardOf = cardsOfDeals(customers);
  const rentedThere: KommoRentedThere[] = leads
    .filter((l) => !covered.has(l.id))
    .map((l) => ({ leadId: l.id, leadName: l.name, contactName: l.contactName, customer: cardOf(l) }));

  rentedThere.sort((a, b) => a.leadName.localeCompare(b.leadName) || a.leadId.localeCompare(b.leadId));
  rentedHere.sort((a, b) => a.number.localeCompare(b.number));
  return { rentedThere, rentedHere, matched: covered.size };
}

/**
 * The card a deal belongs to: the one whose Kommo field names the deal, and
 * failing that the one the deal was tied to when it came in — a customer who
 * rents a second time keeps the first deal's link on the card.
 */
function cardsOfDeals(customers: readonly KommoLinkedCustomer[]): (l: KommoLead) => { id: string; name: string } | null {
  const byLead = new Map<string, { id: string; name: string }>();
  const byId = new Map<string, { id: string; name: string }>();
  for (const c of customers) {
    byId.set(c.id, { id: c.id, name: c.name });
    const leadId = kommoLeadId(c.kommoRef);
    if (leadId && !byLead.has(leadId)) byLead.set(leadId, { id: c.id, name: c.name });
  }
  return (l) => byLead.get(l.id) ?? (l.customerId ? (byId.get(l.customerId) ?? null) : null);
}

/** A sale here, as far as Kommo is concerned: its own link and its buyer's. */
export interface KommoSaleHere {
  kommoRef: string | null;
  customer: { kommoRef: string | null };
}

/**
 * Deals closed as won in Kommo's sales pipeline that no sale here answers to
 * (ADR-0015). A sale answers to a deal the way a rental does: by its own
 * Kommo field, and when that names no deal, by its buyer's. A cancelled sale
 * answers to nothing, and the caller leaves it out.
 */
export function unenteredSales(leads: readonly KommoLead[], sales: readonly KommoSaleHere[], customers: readonly KommoLinkedCustomer[]): KommoRentedThere[] {
  const answered = new Set<string>();
  for (const s of sales) {
    const leadId = kommoLeadId(s.kommoRef) ?? kommoLeadId(s.customer.kommoRef);
    if (leadId) answered.add(leadId);
  }
  const cardOf = cardsOfDeals(customers);
  return leads
    .filter((l) => !answered.has(l.id))
    .map((l) => ({ leadId: l.id, leadName: l.name, contactName: l.contactName, customer: cardOf(l) }))
    .sort((a, b) => a.leadName.localeCompare(b.leadName) || a.leadId.localeCompare(b.leadId));
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
