import { useState } from 'react';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { RowMenu } from '../components/RowMenu.js';
import { BlockHead, Empty, Loading } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { FormSheet } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import './workshops.css';

/**
 * Settings → Repair: the workshops that do the repairs (owner's decision of
 * 21.10.2026). The owner adds one, renames it, takes it off the list and puts
 * it back. Nothing is deleted (ADR-0011): a workshop taken off the list leaves
 * «Открыть ремонт» and the repair card's choice, and stays named on every
 * repair that had it, open ones included.
 */
export interface KeptWorkshop {
  id: string;
  name: string;
  phone: string | null;
  note: string | null;
  sortOrder: number;
  archived: boolean;
  /** Repairs that name it, and of those the ones still under way. */
  jobs: number;
  openJobs: number;
}

export function WorkshopsBlock() {
  const t = useT();
  const { data, failure, reload } = useLoad<{ workshops: KeptWorkshop[] }>('/api/workshops?all=1');
  const toast = useToast();
  const op = useOperation();
  const [editing, setEditing] = useState<KeptWorkshop | 'new' | null>(null);

  // Reversible, so it is undone from the message rather than confirmed first (ux.md, principle 14).
  const setArchived = async (w: KeptWorkshop, archived: boolean) => {
    const res = await op.run((key) => api.patch<{ openJobs: number }>(`/api/workshops/${w.id}`, { archived }, { key }), `archived:${w.id}:${archived}`);
    if (!res.ok) return;
    toast({
      text: archived ? t.wshop.archivedToast(w.name, res.value.openJobs) : t.wshop.restoredToast(w.name),
      undo: async () => {
        await api.patch(`/api/workshops/${w.id}`, { archived: !archived });
        reload();
      },
    });
    reload();
  };
  const menuOf = (w: KeptWorkshop) => [
    { key: 'edit', label: t.wshop.edit, onPick: () => setEditing(w) },
    { key: w.archived ? 'restore' : 'archive', label: w.archived ? t.wshop.restore : t.wshop.archive, onPick: () => void setArchived(w, !w.archived) },
  ];
  const onList = data ? data.workshops.filter((w) => !w.archived).length : 0;

  return (
    <section className="card">
      <BlockHead title={t.wshop.title} sub={data ? t.wshop.count(onList) : undefined} note={t.wshop.hint}>
        <button type="button" className="pill pill-sm" onClick={() => setEditing('new')}>
          + {t.wshop.add}
        </button>
      </BlockHead>
      {!data ? (
        failure ? <LoadError failure={failure} onRetry={reload} /> : <Loading rows={2} />
      ) : data.workshops.length === 0 ? (
        <Empty text={t.wshop.empty} />
      ) : (
        <ul className="item-list wshop-list">
          {data.workshops.map((w) => (
            <li key={w.id} className={w.archived ? 'row-off' : undefined}>
              <div className="wshop-main">
                <span className="item-name">{w.name}</span>
                <span className="wshop-sub muted">
                  {w.phone && (
                    <>
                      <a className="mono" href={`tel:${w.phone}`}>
                        {w.phone}
                      </a>
                      {' · '}
                    </>
                  )}
                  {t.wshop.jobs(w.jobs)}
                  {w.archived && ` · ${t.wshop.archived}`}
                </span>
                {w.note && <span className="wshop-note muted">{w.note}</span>}
              </div>
              <RowMenu actions={menuOf(w)} />
            </li>
          ))}
        </ul>
      )}
      {op.failure && (
        <p className="field-err" role="alert">
          {op.failure.text}
        </p>
      )}
      {editing && (
        <WorkshopForm
          workshop={editing === 'new' ? null : editing}
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

/** Add or edit: the name, a phone and a note — what the list has had since 0023. */
function WorkshopForm({ workshop, onClose, onDone }: { workshop: KeptWorkshop | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { name: workshop?.name ?? '', phone: workshop?.phone ?? '', note: workshop?.note ?? '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={workshop ? t.wshop.editTitle : t.wshop.addTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      // A half-typed new workshop comes back; an edit starts from the list again.
      draft={workshop ? undefined : 'workshop-new'}
      onRestore={workshop ? undefined : setF}
      summary={(v) => v.name}
      label={t.actions.save}
      submit={async (key) => {
        const body = { name: f.name.trim(), phone: f.phone.trim() || null, note: f.note.trim() || null };
        if (!workshop) {
          await api.post('/api/workshops', body, { key });
          return { toast: { text: t.wshop.added(body.name) } };
        }
        // Only what changed goes, so the journal says only that.
        const was = { name: workshop.name, phone: workshop.phone, note: workshop.note };
        const changed = (Object.keys(body) as (keyof typeof body)[]).filter((k) => body[k] !== was[k]);
        if (changed.length === 0) return;
        await api.patch(`/api/workshops/${workshop.id}`, Object.fromEntries(changed.map((k) => [k, body[k]])), { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onDone}
    >
      <Field label={t.wshop.name} name="name" hint={workshop ? t.wshop.renameHint : undefined}>
        <input className="input" autoFocus value={f.name} maxLength={200} onChange={(e) => setF({ ...f, name: e.target.value })} required />
      </Field>
      <Field label={t.wshop.phone} name="phone">
        <input className="input mono" inputMode="tel" value={f.phone} maxLength={40} onChange={(e) => setF({ ...f, phone: e.target.value })} />
      </Field>
      <Field label={t.wshop.note} name="note">
        <input className="input" value={f.note} maxLength={1000} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </FormSheet>
  );
}
