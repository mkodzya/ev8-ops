import { parseGel } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { useT } from '../i18n/index.js';
import { errorText } from '../lib/use.js';
import { Drawer } from './Drawer.js';
import { Field } from './Wizard.js';

export interface ModelFields {
  id: string;
  brand: string;
  name: string;
  weeklyRateTetri: number | null;
  salePriceTetri: number | null;
  archived: boolean;
}

/** The option at the end of a model list that opens this form instead of picking. */
export const NEW_MODEL = '__new_model__';

const money = (tetri: number | null) => (tetri == null ? '' : String(tetri / 100));

/**
 * One form for a model, wherever the need for one turns up.
 *
 * It opens over a purchase when the model on the invoice is not in the list
 * yet, over the models page, and over a model's own card to correct it. The
 * brand is a choice among the brands already here, because a typed brand is
 * how "Flybrother" and "FlyBrother" became two companies; a new brand is
 * still one click away. Prices are not needed to order a moped, so they are
 * never what stops somebody from saving.
 */
export function ModelDrawer({
  model,
  brands,
  onClose,
  onSaved,
}: {
  model?: ModelFields;
  brands: string[];
  onClose: () => void;
  onSaved: (m: { id: string; brand: string; name: string }) => void;
}) {
  const t = useT();
  const known = [...new Set(brands)].sort((a, b) => a.localeCompare(b));
  const [f, setF] = useState({
    brand: model?.brand ?? (known.length === 1 ? known[0] : ''),
    name: model?.name ?? '',
    weeklyRate: money(model?.weeklyRateTetri ?? null),
    salePrice: money(model?.salePriceTetri ?? null),
    archived: model?.archived ?? false,
  });
  const [newBrand, setNewBrand] = useState(known.length === 0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; twin?: { id: string; name: string } } | null>(null);

  const badMoney = (s: string) => s.trim() !== '' && parseGel(s) == null;
  const ready = f.brand.trim() !== '' && f.name.trim() !== '' && !badMoney(f.weeklyRate) && !badMoney(f.salePrice);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const body = {
      brand: f.brand.trim(),
      name: f.name.trim(),
      weeklyRateTetri: f.weeklyRate.trim() ? parseGel(f.weeklyRate) : null,
      salePriceTetri: f.salePrice.trim() ? parseGel(f.salePrice) : null,
    };
    try {
      if (model) {
        await api.patch(`/api/models/${model.id}`, { ...body, archived: f.archived });
        onSaved({ id: model.id, brand: body.brand, name: body.name });
      } else {
        const made = await api.post<{ id: string; brand: string; name: string }>('/api/models', body);
        onSaved(made);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === 'duplicate_model') {
        const twin = e.extra.id ? { id: String(e.extra.id), name: String(e.extra.name ?? '') } : undefined;
        setErr({ text: t.models.duplicate, twin });
      } else {
        setErr({ text: errorText(e) });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer title={model ? t.models.editTitle : t.models.add} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="field">
          <span className="lbl">{t.models.brand}</span>
          <div className="chips-pick" role="radiogroup" aria-label={t.models.brand}>
            {known.map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={!newBrand && f.brand === b}
                className="seg seg-sm"
                onClick={() => {
                  setNewBrand(false);
                  setF({ ...f, brand: b });
                }}
              >
                {b}
              </button>
            ))}
            {known.length > 0 && (
              <button
                type="button"
                role="radio"
                aria-checked={newBrand}
                className="seg seg-sm"
                onClick={() => {
                  setNewBrand(true);
                  setF({ ...f, brand: '' });
                }}
              >
                + {t.models.newBrand}
              </button>
            )}
          </div>
          {newBrand && (
            <input className="input" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} maxLength={100} placeholder={t.models.brand} autoFocus={known.length > 0} />
          )}
        </div>
        <Field label={t.models.name}>
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} required autoFocus={!newBrand} />
        </Field>
        <div className="two-col">
          <Field label={t.models.weeklyRate}>
            <input className="input input-amount mono" value={f.weeklyRate} onChange={(e) => setF({ ...f, weeklyRate: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label={t.models.salePrice}>
            <input className="input input-amount mono" value={f.salePrice} onChange={(e) => setF({ ...f, salePrice: e.target.value })} inputMode="decimal" />
          </Field>
        </div>
        {model && (
          <label className="check">
            <input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />
            <span>{t.models.archived}</span>
          </label>
        )}
        {err && (
          <div className="hint hint-bad">
            {err.text}
            {err.twin && (
              <>
                {' '}
                <Link to={`/models/${err.twin.id}`}>{err.twin.name}</Link>
              </>
            )}
          </div>
        )}
        <div className="row-actions">
          <button type="button" className="pill" onClick={onClose}>
            {t.actions.cancel}
          </button>
          <button className="pill pill-accent" disabled={busy || !ready}>
            {busy ? t.common.checking : model ? t.actions.save : t.models.create}
          </button>
        </div>
        <p className="drawer-tip">{model ? t.models.editTip : t.models.addTip}</p>
      </form>
    </Drawer>
  );
}
