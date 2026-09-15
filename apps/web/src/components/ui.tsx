import { colorOf, type RentalStatus, type VehicleState } from '@ev8/shared';
import type { ReactNode } from 'react';
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
 * A moped's colour, drawn rather than spelled: a column of words in three
 * alphabets was unreadable, and a column of colours is read without reading.
 *
 * The swatch depicts the word in the data and not the paint on the moped —
 * Odoo holds `Красный`, never a number, and nobody has measured a fender. So
 * a word we do not know is written out instead of being guessed at, and the
 * word itself is always on the swatch for a pointer and for a screen reader.
 */
export function ColorText({ of }: { of: string | null }) {
  const t = useT();
  const code = colorOf(of);
  if (code) return <span className={`swatch swatch-${code}`} title={t.colors[code]} aria-label={t.colors[code]} />;
  // Not a colour we know, or none at all: the word as typed, or nothing.
  return <span className="swatch-word">{of ?? ''}</span>;
}

/**
 * The top of every page: a title, a supporting line, and the actions.
 *
 * Two type roles and no third. The title is the page's own name in the display
 * face; the supporting line says how much of it there is, in the quiet face,
 * sitting on the title's baseline. Anything longer than a phrase is a note
 * under the pair, not a third thing beside them — a heading row with three
 * weights in it stops being a heading.
 */
export function PageHead({
  title,
  sub,
  note,
  wrap = false,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  note?: ReactNode;
  wrap?: boolean;
  children?: ReactNode;
}) {
  return (
    <>
      <header className={`page-head ${wrap ? 'page-head-wrap' : ''}`}>
        <h1>{title}</h1>
        {sub != null && <span className="page-sub">{sub}</span>}
        {children != null && (
          <>
            <span className="spacer" />
            {children}
          </>
        )}
      </header>
      {note != null && <p className="page-note">{note}</p>}
    </>
  );
}
