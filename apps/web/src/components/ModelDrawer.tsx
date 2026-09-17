import { parseGel } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { useT } from '../i18n/index.js';
import { FormSheet } from '../ds/form/Form.js';
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
  const initial = {
    brand: model?.brand ?? (known.length === 1 ? known[0] : ''),
    name: model?.name ?? '',
    weeklyRate: money(model?.weeklyRateTetri ?? null),
    salePrice: money(model?.salePriceTetri ?? null),
    archived: model?.archived ?? false,
  };
  const [f, setF] = useState(initial);
  const [newBrand, setNewBrand] = useState(known.length === 0);
  const [twin, setTwin] = useState<{ id: string; name: string } | null>(null);

  // A price that does not read as money is refused here, under its field:
  // sent as it is, it would arrive as "no price" and clear the one there.
  const amount = (s: string, field: string) => {
    if (!s.trim()) return null;
    const v = parseGel(s);
    if (v == null) throw new ApiError(400, 'bad_field', field, { field });
    return v;
  };

  return (
    <FormSheet
      title={model ? t.models.editTitle : t.models.add}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={model ? `model-edit:${model.id}` : 'model-new'}
      onRestore={setF}
      summary={(v) => [v.brand, v.name].filter(Boolean).join(' ')}
      label={model ? t.actions.save : t.models.create}
      submit={async (key) => {
        setTwin(null);
        const body = {
          brand: f.brand.trim(),
          name: f.name.trim(),
          weeklyRateTetri: amount(f.weeklyRate, 'weeklyRateTetri'),
          salePriceTetri: amount(f.salePrice, 'salePriceTetri'),
        };
        try {
          if (model) {
            await api.patch(`/api/models/${model.id}`, { ...body, archived: f.archived }, { key });
            onSaved({ id: model.id, brand: body.brand, name: body.name });
            return { toast: { text: t.form.changesSaved } };
          }
          const made = await api.post<{ id: string; brand: string; name: string }>('/api/models', body, { key });
          onSaved(made);
          return { toast: { text: t.models.added } };
        } catch (e) {
          if (e instanceof ApiError && e.code === 'duplicate_model' && e.extra.id) setTwin({ id: String(e.extra.id), name: String(e.extra.name ?? '') });
          throw e;
        }
      }}
    >
        <div className="field" data-field="brand">
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
        <Field label={t.models.name} name="name">
          <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={100} required autoFocus={!newBrand} />
        </Field>
        <div className="two-col">
          <Field label={t.models.weeklyRate} name="weeklyRateTetri">
            <input className="input input-amount mono" value={f.weeklyRate} onChange={(e) => setF({ ...f, weeklyRate: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label={t.models.salePrice} name="salePriceTetri">
            <input className="input input-amount mono" value={f.salePrice} onChange={(e) => setF({ ...f, salePrice: e.target.value })} inputMode="decimal" />
          </Field>
        </div>
        {model && (
          <label className="check">
            <input type="checkbox" checked={f.archived} onChange={(e) => setF({ ...f, archived: e.target.checked })} />
            <span>{t.models.archived}</span>
          </label>
        )}
        {twin && (
          <p className="hint">
            <Link to={`/fleet/models/${twin.id}`}>{twin.name}</Link>
          </p>
        )}
        <p className="drawer-tip">{model ? t.models.editTip : t.models.addTip}</p>
    </FormSheet>
  );
}
