import { nextWorkCode, worksTotal } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Empty, Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { FormSheet } from '../ds/form/Form.js';
import { useLocale, useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { nameIn, normText, untranslated, type WorkBook, type WorkCategory, type WorkType } from '../lib/workBook.js';
import { useSession } from '../session.js';
import './workshop-job.css';

/**
 * Справочник работ (stage 2 of the mechanic plan; prototype
 * mechanic-job-open-options.html, part 2, variant A): every work on one
 * scroll, its category as a heading, a sheet to change one. The chief
 * mechanic and the owners keep it; the code is permanent, and a work nobody
 * does any more is switched off, never deleted.
 */
export function WorkBookPage() {
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<WorkBook>('/api/work-book');
  const [q, setQ] = useState('');
  const [showOff, setShowOff] = useState(false);
  const [editing, setEditing] = useState<WorkType | { category: string } | null>(null);
  const [category, setCategory] = useState<WorkCategory | null>(null);
  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const mayEdit = can('service.norms');
  const offCount = data.works.filter((w) => !w.active).length;
  const needle = q.trim().toLowerCase();
  const matches = (w: WorkType) => !needle || w.code.toLowerCase().includes(needle) || [w.nameKa, w.nameRu, w.nameEn].some((n) => n?.toLowerCase().includes(needle));
  const visible = data.works.filter((w) => (showOff || w.active) && matches(w));
  const groups = data.categories.map((c) => ({ c, works: visible.filter((w) => w.category === c.code) })).filter((g) => g.works.length > 0);
  const gaps = data.works.some((w) => untranslated(w, locale)) || data.categories.some((c) => untranslated(c, locale));
  const done = () => {
    setEditing(null);
    setCategory(null);
    reload();
  };

  return (
    <div className="wjob-step">
      <PageHead title={t.wbook.title} sub={t.wbook.count(data.works.filter((w) => w.active).length, data.categories.length)} />
      {(data.fromBot > 0 || gaps) && (
        <p className="wbook-banner">
          {data.fromBot > 0 && <b>{t.wbook.fromBot} </b>}
          {gaps && t.wbook.gaps}
        </p>
      )}
      <div className="wbook-tools">
        <input className="input" placeholder={t.wbook.search} value={q} onChange={(e) => setQ(e.target.value)} />
        {offCount > 0 && (
          <button type="button" className="pill" aria-pressed={showOff} onClick={() => setShowOff(!showOff)}>
            {showOff ? t.wbook.hideOff : t.wbook.showOff(offCount)}
          </button>
        )}
        {mayEdit && (
          <button type="button" className="pill pill-accent" onClick={() => setEditing({ category: groups[0]?.c.code ?? data.categories[0]?.code ?? '' })}>
            + {t.wbook.add}
          </button>
        )}
      </div>
      {groups.length === 0 && <Empty text={t.wbook.empty} />}
      {groups.map(({ c, works }) => {
        const sum = worksTotal(works.filter((w) => w.active).map((w) => ({ qty: 1, normSec: w.normSec, rateTetri: 0 })));
        return (
          <ul key={c.code} className="wbook-group">
            <li>
              <button type="button" className="wbook-head" disabled={!mayEdit} onClick={() => setCategory(c)}>
                <span>{nameIn(c, locale)}</span>
                <span className="muted">{t.wbook.groupSum(works.filter((w) => w.active).length, normText(sum.seconds, locale))}</span>
              </button>
            </li>
            {works.map((w) => (
              <li key={w.id}>
                <button type="button" className={`wbook-row ${w.active ? '' : 'off'}`} disabled={!mayEdit} onClick={() => setEditing(w)}>
                  <span className="wjob-code">{w.code}</span>
                  <span className="wjob-name">
                    {nameIn(w, locale)} {w.notes && <span className="wbook-mark note">{t.wbook.note}</span>} {!w.active && <span className="wbook-mark">{t.wbook.off}</span>}
                  </span>
                  <span className="wjob-min mono">{t.wjob.min(normText(w.normSec, locale))}</span>
                </button>
              </li>
            ))}
          </ul>
        );
      })}
      {editing && <WorkSheet book={data} work={'id' in editing ? editing : null} category={editing.category} onClose={() => setEditing(null)} onDone={done} />}
      {category && <CategorySheet category={category} onClose={() => setCategory(null)} onDone={done} />}
    </div>
  );
}

function WorkSheet({ book, work, category, onClose, onDone }: { book: WorkBook; work: WorkType | null; category: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { locale } = useLocale();
  const initial = {
    category,
    nameKa: work?.nameKa ?? '',
    nameRu: work?.nameRu ?? '',
    nameEn: work?.nameEn ?? '',
    normMin: work ? normText(work.normSec, locale) : '',
    notes: work?.notes ?? '',
    active: work?.active ?? true,
  };
  const [f, setF] = useState(initial);
  const cat = book.categories.find((c) => c.code === f.category);
  return (
    <FormSheet
      title={work ? `${work.code} · ${cat ? nameIn(cat, locale) : ''}` : t.wbook.newWork}
      onClose={onClose}
      value={f}
      initial={initial}
      label={work ? t.actions.save : t.wbook.addButton}
      submit={async (key) => {
        const body = { nameKa: f.nameKa.trim(), nameRu: f.nameRu.trim(), nameEn: f.nameEn.trim(), normMin: f.normMin.trim(), notes: f.notes.trim() };
        if (work) {
          await api.patch(`/api/work-book/works/${work.id}`, { ...body, active: f.active }, { key });
          return { toast: { text: t.wbook.saved(work.code) } };
        }
        const made = await api.post<{ code: string }>('/api/work-book/works', { ...body, category: f.category }, { key });
        return { toast: { text: t.wbook.added(made.code) } };
      }}
      onDone={onDone}
    >
      {!work && (
        <Field label={t.wbook.category} name="category">
          <select className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {book.categories.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} · {nameIn(c, locale)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t.wbook.nameKa} name="nameKa">
        <input className={`input ${f.nameKa ? '' : 'wbook-empty-field'}`} value={f.nameKa} placeholder={work ? t.wbook.emptyPlaceholder : undefined} onChange={(e) => setF({ ...f, nameKa: e.target.value })} />
      </Field>
      <Field label={t.wbook.nameRu} name="nameRu">
        <input className={`input ${f.nameRu ? '' : 'wbook-empty-field'}`} value={f.nameRu} placeholder={work ? t.wbook.emptyPlaceholder : undefined} onChange={(e) => setF({ ...f, nameRu: e.target.value })} />
      </Field>
      <Field label={t.wbook.nameEn} name="nameEn">
        <input className={`input ${f.nameEn ? '' : 'wbook-empty-field'}`} value={f.nameEn} placeholder={work ? t.wbook.emptyPlaceholder : t.wbook.optional} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
      </Field>
      <Field label={t.wbook.norm} name="normMin" hint={t.wbook.normHint}>
        <input className="input mono" inputMode="decimal" value={f.normMin} onChange={(e) => setF({ ...f, normMin: e.target.value })} />
      </Field>
      <Field label={t.wbook.notes} name="notes">
        <input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </Field>
      {work && (
        <label className="check">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          {t.wbook.active}
        </label>
      )}
      {!work && <p className="hint muted">{t.wbook.codeAuto(nextWorkCode(f.category, book.works.map((w) => w.code)))}</p>}
    </FormSheet>
  );
}

function CategorySheet({ category, onClose, onDone }: { category: WorkCategory; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { nameKa: category.nameKa ?? '', nameRu: category.nameRu ?? '', nameEn: category.nameEn ?? '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={t.wbook.categoryTitle(category.code)}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.actions.save}
      submit={async (key) => {
        await api.patch(`/api/work-book/categories/${category.code}`, { nameKa: f.nameKa.trim(), nameRu: f.nameRu.trim(), nameEn: f.nameEn.trim() }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onDone}
    >
      <p className="hint muted">{t.wbook.categoryHint}</p>
      <Field label={t.wbook.nameKa} name="nameKa">
        <input className={`input ${f.nameKa ? '' : 'wbook-empty-field'}`} value={f.nameKa} onChange={(e) => setF({ ...f, nameKa: e.target.value })} />
      </Field>
      <Field label={t.wbook.nameRu} name="nameRu">
        <input className={`input ${f.nameRu ? '' : 'wbook-empty-field'}`} value={f.nameRu} placeholder={t.wbook.emptyPlaceholder} onChange={(e) => setF({ ...f, nameRu: e.target.value })} />
      </Field>
      <Field label={t.wbook.nameEn} name="nameEn">
        <input className={`input ${f.nameEn ? '' : 'wbook-empty-field'}`} value={f.nameEn} placeholder={t.wbook.emptyPlaceholder} onChange={(e) => setF({ ...f, nameEn: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

