import { fleetNumber } from '@ev8/shared';
import { useState } from 'react';
import { useT } from '../i18n/index.js';
import { Drawer } from './Drawer.js';
import { Field } from './Wizard.js';

/**
 * "Наклейки" in the fleet (Mika, 15.10.2026, variant В1): a PDF of 70 × 37 mm
 * labels, 24 to an A4 sheet — every moped, or the numbers from–to, since a new
 * batch gets consecutive ones. The QR leads to the stand the sheet was printed
 * from, so the page says where it is.
 */
export function StickersButton({ numbers }: { numbers: number[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const min = numbers.length ? Math.min(...numbers) : 1;
  const max = numbers.length ? Math.max(...numbers) : 1;
  const [range, setRange] = useState({ from: '', to: '' });
  if (numbers.length === 0) return null;
  const from = Number(range.from) || min;
  const to = Number(range.to) || max;
  const count = numbers.filter((n) => n >= from && n <= to).length;
  const href = `/api/fleet/stickers.pdf?from=${from}&to=${to}&origin=${encodeURIComponent(window.location.origin)}`;
  return (
    <>
      <button type="button" className="pill pill-sm" onClick={() => setOpen(true)}>
        {t.fleet.stickers}
      </button>
      {open && (
        <Drawer title={t.fleet.stickersTitle} onClose={() => setOpen(false)}>
          <p className="hint muted">{t.fleet.stickersHint}</p>
          <div className="money-who-row">
            <Field label={t.fleet.stickersFrom} name="from">
              <input className="input mono" inputMode="numeric" placeholder={String(min)} value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value.replace(/\D/g, '') })} />
            </Field>
            <Field label={t.fleet.stickersTo} name="to">
              <input className="input mono" inputMode="numeric" placeholder={String(max)} value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value.replace(/\D/g, '') })} />
            </Field>
          </div>
          <p className="money-after">{count > 0 ? t.fleet.stickersCount(count, fleetNumber(from)!, fleetNumber(to)!) : t.fleet.stickersNone}</p>
          {count > 0 && (
            <a className="pill pill-accent" href={href} target="_blank" rel="noreferrer">
              {t.fleet.stickersOpen}
            </a>
          )}
        </Drawer>
      )}
    </>
  );
}
