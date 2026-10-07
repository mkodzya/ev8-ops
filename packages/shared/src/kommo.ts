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
