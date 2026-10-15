import { useState } from 'react';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { RowMenu } from '../components/RowMenu.js';
import { BlockHead, Loading } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { FormSheet } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useLocale, useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import type { ExpenseCategory } from './money/ExpenseAnswers.js';

/**
 * Settings → Расходы: what money leaving the account goes on (migration 0046).
 * Twelve to begin with, read off the real queue and accepted by Mika on
 * 15.10.2026; an owner adds, renames and takes one off. A category taken off
 * keeps the lines already in it.
 */
export function ExpenseCategoriesPage() {
  const t = useT();
  const { locale } = useLocale();
  const { data, failure, reload } = useLoad<{ categories: ExpenseCategory[] }>('/api/expense-categories?all=1');
  const toast = useToast();
  const op = useOperation();
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const name = (c: ExpenseCategory) => (locale === 'ka' ? c.nameKa : locale === 'en' ? c.nameEn : null) || c.nameRu;
  const setArchived = async (c: ExpenseCategory, archived: boolean) => {
    const res = await op.run((key) => api.patch(`/api/expense-categories/${c.id}`, { archived }, { key }), `archive:${c.id}:${archived}`);
    if (!res.ok) return;
    toast({ text: t.form.changesSaved });
    reload();
  };
  const flip = (c: ExpenseCategory) => ({ key: c.archived ? 'restore' : 'archive', label: c.archived ? t.exp.restore : t.exp.archive, onPick: () => void setArchived(c, !c.archived) });
  const menuOf = (c: ExpenseCategory) => [{ key: 'edit', label: t.exp.edit, onPick: () => setEditing(c) }, flip(c)];
  return (
    <section className="card">
      <BlockHead title={t.exp.title} note={t.exp.hint} />
      <ul className="item-list">
        {data.categories.map((c) => (
          <li key={c.id} className="kv">
            <span className={c.archived ? 'muted' : undefined}>
              {name(c)}
              {c.archived && <span className="muted"> · {t.exp.archived}</span>}
            </span>
            <RowMenu actions={menuOf(c)} />
          </li>
        ))}
      </ul>
      <button type="button" className="pill pill-sm" onClick={() => setEditing('new')}>
        + {t.exp.add}
      </button>
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
      {editing && (
        <CategorySheet
          category={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            reload();
          }}
        />
      )}
    </section>
  );
}

function CategorySheet({ category, onClose, onDone }: { category: ExpenseCategory | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { nameRu: category?.nameRu ?? '', nameKa: category?.nameKa ?? '', nameEn: category?.nameEn ?? '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={category ? t.exp.editTitle : t.exp.addTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.actions.save}
      submit={async (key) => {
        const body = { nameRu: f.nameRu.trim(), nameKa: f.nameKa.trim(), nameEn: f.nameEn.trim() };
        if (category) await api.patch(`/api/expense-categories/${category.id}`, body, { key });
        else await api.post('/api/expense-categories', body, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onDone}
    >
      <Field label={t.exp.nameRu} name="nameRu">
        <input className="input" autoFocus value={f.nameRu} onChange={(e) => setF({ ...f, nameRu: e.target.value })} />
      </Field>
      <Field label={t.exp.nameKa} name="nameKa">
        <input className="input" value={f.nameKa} onChange={(e) => setF({ ...f, nameKa: e.target.value })} />
      </Field>
      <Field label={t.exp.nameEn} name="nameEn">
        <input className="input" value={f.nameEn} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
      </Field>
    </FormSheet>
  );
}
