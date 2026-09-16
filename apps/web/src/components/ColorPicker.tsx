import { useState } from 'react';
import { VEHICLE_COLORS, colorOf } from '@ev8/shared';
import { useT } from '../i18n/index.js';

/**
 * The paint of a moped, chosen rather than typed.
 *
 * Typing is how Odoo ended up with eleven spellings of six colours. A click
 * stores the code (`red`), which every screen already reads and every paper
 * prints in both languages. A second click on the same paint takes it back,
 * because "not known" is an honest answer. A colour we have no swatch for is
 * still allowed, as words: the picker must never make someone pick the
 * nearest paint to get past the form.
 */
export function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useT();
  const code = colorOf(value);
  const [other, setOther] = useState(value.trim() !== '' && code === null);
  const name = code ? t.colors[code] : other ? t.colors.other : t.colors.none;

  return (
    <div className="field">
      <span className="lbl">
        {t.models.color} <span className="cp-name">{name}</span>
      </span>
      <div className="cp" role="radiogroup" aria-label={t.models.color}>
        {VEHICLE_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={code === c}
            aria-label={t.colors[c]}
            title={t.colors[c]}
            className={`cp-dot swatch-${c}`}
            onClick={() => {
              setOther(false);
              onChange(code === c ? '' : c);
            }}
          />
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={other}
          className="cp-other"
          onClick={() => {
            setOther(!other);
            onChange('');
          }}
        >
          {t.colors.other}
        </button>
      </div>
      {other && (
        <input
          className="input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t.colors.otherHint}
          maxLength={60}
          autoFocus
        />
      )}
    </div>
  );
}
