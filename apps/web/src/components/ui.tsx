import { colorOf, type RentalStatus, type VehicleState } from '@ev8/shared';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLocale, useT } from '../i18n/index.js';
import { useAnnounceHeader, usePageHeadSlot } from '../ds/shell/header.js';
import { Skeleton } from '../ds/state/Skeleton.js';
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

/** Loading: the shared skeleton (ux.md) — nothing for 300 ms, then the shape of a list. */
export function Loading({ rows }: { rows?: number } = {}) {
  return <Skeleton rows={rows} />;
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
export function ColorText({ of, named = false }: { of: string | null; named?: boolean }) {
  const t = useT();
  const code = colorOf(of);
  if (code && named)
    return (
      <span className="swatch-named">
        <span className={`swatch swatch-${code}`} aria-hidden="true" />
        {t.colors[code]}
      </span>
    );
  if (code) return <span className={`swatch swatch-${code}`} title={t.colors[code]} aria-label={t.colors[code]} />;
  // Not a colour we know, or none at all: the word as typed, or nothing.
  if (named) return <>{of ?? ''}</>;
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
  badge,
  sub,
  note,
  wrap = false,
  children,
}: {
  title: ReactNode;
  /** The one state marker a single thing carries: a pill, beside its name. */
  badge?: ReactNode;
  sub?: ReactNode;
  note?: ReactNode;
  wrap?: boolean;
  children?: ReactNode;
}) {
  // On a phone the title and its count move up into the 56 px header (wave 1 §3.2).
  useAnnounceHeader(title, sub);
  // Drawn in the shell's slot, so it keeps its line while pages change
  // (PageHeadSlot); inline only outside the shell.
  const slot = usePageHeadSlot();
  const head = (
    <>
      <header className={`page-head ${wrap ? 'page-head-wrap' : ''}`}>
        {/* The words share a baseline with each other; the group they make is
            what the buttons centre on. Baseline and centre on one flex line
            fight, and the buttons lose — they sank below the words. */}
        <div className="head-text">
          <h1>{title}</h1>
          {badge != null && <span className="page-badge">{badge}</span>}
          {sub != null && <span className="page-sub">{sub}</span>}
        </div>
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
  return slot ? createPortal(head, slot) : head;
}

/**
 * The top of a block inside a page, built exactly like the top of the page:
 * the block's name, one quiet line on the same baseline saying how much of it
 * there is, and its action at the far end of the same line rather than lost
 * under a table. A block and the page it sits in should read as the same
 * sentence said twice at two sizes.
 */
export function BlockHead({ title, sub, note, children }: { title: ReactNode; sub?: ReactNode; note?: ReactNode; children?: ReactNode }) {
  return (
    <>
      <div className="block-head">
        <div className="head-text">
          <h2>{title}</h2>
          {sub != null && <span className="block-sub">{sub}</span>}
        </div>
        {children != null && (
          <>
            <span className="spacer" />
            {children}
          </>
        )}
      </div>
      {note != null && <p className="block-note">{note}</p>}
    </>
  );
}
