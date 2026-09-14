import type { RentalStatus, VehicleState } from '@ev8/shared';
import { useT } from '../i18n/index.js';
import { vinParts } from '../format.js';

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
