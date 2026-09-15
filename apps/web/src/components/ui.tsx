import { colorOf, type RentalStatus, type VehicleState } from '@ev8/shared';
import { useLocale, useT } from '../i18n/index.js';
import { vinParts } from '../format.js';
import { primaryName, secondName, type Named } from '../lib/names.js';
import { placeOf, type Place } from '../lib/place.js';

/** Colour + shape + word, the same everywhere (brand.md). */
export function StateBadge({ state }: { state: VehicleState }) {
  const t = useT();
  return (
    <span className={`state state-${state}`}>
      <span className="state-mark" aria-hidden="true" />
      {t.states[state]}
    </span>
  );
}

export function RentalBadge({ status }: { status: RentalStatus }) {
  const t = useT();
  return (
    <span className={`rstatus rstatus-${status}`}>
      <span className="state-mark" aria-hidden="true" />
      {t.rentalStatus[status]}
    </span>
  );
}

export function Vin({ vin }: { vin: string }) {
  const { head, tail } = vinParts(vin);
  return (
    <span className="vin">
      <span className="vin-head">{head}</span>
      <span className="vin-tail">{tail}</span>
    </span>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}

export function Loading() {
  const t = useT();
  return <p className="empty">{t.common.loading}</p>;
}

/**
 * A person's name in the language of the interface, with the other spelling
 * behind it in grey when it differs (U14). One component, so a list and a
 * card never disagree about which of a customer's three spellings leads.
 */
export function CustomerName({ of, second = true }: { of: Named; second?: boolean }) {
  const { locale } = useLocale();
  const other = second ? secondName(of, locale) : null;
  return (
    <>
      {primaryName(of, locale)}
      {other && <span className="muted name-alt">{other}</span>}
    </>
  );
}

/**
 * Where a moped stands. Three answers and no fourth: a point we named, the
 * customer who has it, or nobody has said — the last one reads as a question
 * rather than as a blank, because that is what it is.
 */
export function PlaceText({ of }: { of: { state: VehicleState; location: { name: string } | null } }) {
  const t = useT();
  const place: Place = placeOf(of);
  if (place.kind === 'point') return <span>{place.name}</span>;
  if (place.kind === 'customer') return <span className="muted">{t.points.atCustomer}</span>;
  if (place.kind === 'gone') return <span className="muted">{t.common.dash}</span>;
  return <span className="place-unset">{t.points.unset}</span>;
}

/**
 * A moped's colour, in the language of whoever is reading. Odoo holds the word
 * as it was typed — `შავი` on one card and `Black` on the next, the same
 * paint — so the screen says it once, its own way. A word nobody taught us is
 * shown exactly as it was typed: better an unfamiliar word than a wrong one.
 */
export function ColorText({ of }: { of: string | null }) {
  const t = useT();
  const code = colorOf(of);
  if (code) return <span>{t.colors[code]}</span>;
  return <span>{of ?? t.common.dash}</span>;
}
