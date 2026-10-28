import { TODO_NOTE_MAX, localDateTime, todoBucket, todoDaysLate, todoShownFrom, type TodoView } from '@ev8/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, markStale } from '../../api.js';
import { Drawer } from '../../components/Drawer.js';
import { Field } from '../../components/Wizard.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { Form, useFieldError } from '../../ds/form/Form.js';
import { fmtDate } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { preparePhoto, uploadFile } from '../../lib/photos.js';
import { Typed } from '../../lib/typed.js';
import { errorText } from '../../lib/use.js';
import { TodoMeta } from './TodoParts.js';
import './todos.css';

/** A photo downsized on the device, or a PDF as it is (CustomerPage's documents do the same). */
interface Picked {
  name: string;
  mimeType: string;
  blob: Blob;
  previewUrl: string | null;
}

/**
 * A task opened (the director's mockup, «Задача» on the phone): its words,
 * whose it is and the day, the comment of whoever set it, the files. For
 * whose it is — «Сделано» with a comment if he wants, and with «нужно фото
 * или файл» a photo or a file first; for who set it — change or delete; for
 * either, a closed one opens again. The record it is about is a press away.
 */
export function TodoCard({ todo, today, onClose, onEdit, onChanged }: { todo: TodoView; today: string; onClose: () => void; onEdit: () => void; onChanged: () => void }) {
  const t = useT();
  const toast = useToast();
  const open = todo.closedAt == null;
  const late = open && todoBucket(todo, today) === 'overdue';
  const shownFrom = open ? todoShownFrom(todo) : null;
  const [removing, setRemoving] = useState(false);
  const link = todo.link;
  const href = link?.open ? (link.kind === 'vehicle' ? `/fleet/${link.id}` : link.kind === 'rental' ? `/rentals/${link.id}` : `/customers/${link.id}`) : null;
  const closedAt = todo.closedAt ? localDateTime(todo.closedAt) : null;

  const act = async (write: () => Promise<unknown>, text: string) => {
    try {
      await write();
      toast({ text });
      onChanged();
      onClose();
    } catch (e) {
      toast({ text: errorText(e) });
    }
  };

  return (
    <Drawer title={t.todos.card.title} onClose={onClose}>
      <p className="todo-card-text">{todo.text}</p>
      <TodoMeta todo={todo} showWho withNote={false} />
      <p className={late ? 'crit-text' : 'muted'}>
        {t.todos.card.dueOn(fmtDate(todo.dueOn))}
        {late && ` · ${t.todos.card.lateBy(todoDaysLate(todo.dueOn, today))}`}
      </p>
      {shownFrom && shownFrom > today && <p className="hint muted">{t.todos.shownFrom(fmtDate(shownFrom), todo.leadDays)}</p>}

      {todo.note && (
        <div className="field">
          <span className="lbl">{t.todos.card.setNote}</span>
          <div className="todo-card-note">
            <Typed text={todo.note} />
          </div>
        </div>
      )}

      {todo.files.length > 0 && (
        <div className="todo-files">
          {todo.files.map((f) => (
            <a key={f.id} className="todo-file" href={`/api/files/${f.id}`} target="_blank" rel="noreferrer">
              {f.label || t.todos.files(1)}
            </a>
          ))}
        </div>
      )}

      {!open && (
        <>
          <p className="muted">
            {todo.closedByRecord
              ? (t.todos.closedByRecord[link?.kind ?? ''] ?? '')
              : closedAt && todo.closedBy
                ? t.todos.closedBy(todo.closedBy.name, closedAt.date, closedAt.time)
                : null}
          </p>
          {todo.closeNote && (
            <div className="field">
              <span className="lbl">{t.todos.card.closedNote}</span>
              <div className="todo-card-note">
                <Typed text={todo.closeNote} />
              </div>
            </div>
          )}
        </>
      )}

      {open && todo.may.close && <CloseForm todo={todo} onDone={() => { onChanged(); onClose(); }} />}

      {removing ? (
        <div className="todo-drop" role="alertdialog" aria-label={t.todos.card.remove}>
          <span>{t.todos.card.removeAsk}</span>
          {todo.repeat !== 'none' && <span className="muted">{t.todos.card.removeRepeat}</span>}
          <span className="todo-card-actions">
            <button type="button" className="pill pill-sm" onClick={() => void act(() => api.del(`/api/todos/${todo.id}`), t.todos.toast.removed)}>
              {todo.repeat !== 'none' ? t.todos.card.removeOne : t.todos.card.remove}
            </button>
            {todo.repeat !== 'none' && (
              <button type="button" className="pill pill-sm" onClick={() => void act(() => api.del(`/api/todos/${todo.id}?stop=1`), t.todos.toast.removed)}>
                {t.todos.card.removeStop}
              </button>
            )}
            <button type="button" className="pill pill-sm" onClick={() => setRemoving(false)}>
              {t.form.back}
            </button>
          </span>
        </div>
      ) : (
        <div className="todo-card-actions">
          {href && (
            <Link className="pill pill-sm" to={href}>
              {t.todos.card.openCard}
            </Link>
          )}
          {todo.may.edit && (
            <button type="button" className="pill pill-sm" onClick={onEdit}>
              {t.todos.card.edit}
            </button>
          )}
          {todo.may.edit && (
            <button type="button" className="pill pill-sm" onClick={() => setRemoving(true)}>
              {t.todos.card.remove}
            </button>
          )}
          {todo.may.reopen && (
            <button type="button" className="pill pill-sm" onClick={() => void act(() => api.post(`/api/todos/${todo.id}/reopen`), t.todos.toast.reopened)}>
              {t.todos.card.reopen}
            </button>
          )}
        </div>
      )}
    </Drawer>
  );
}

/**
 * «Сделано»: the photos or files first, then the comment, then the button.
 * With «нужно фото или файл» and nothing picked, the press says so under the
 * files — the button is not greyed out beforehand (ux.md, «Ошибка поля»).
 * The files go up one by one, then the task closes; «Отменить» opens it again.
 */
function CloseForm({ todo, onDone }: { todo: TodoView; onDone: () => void }) {
  const t = useT();
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const value = { note, files: files.length };

  const add = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setBad(null);
    const out: Picked[] = [];
    for (const f of [...list]) {
      try {
        if (f.type === 'application/pdf') out.push({ name: f.name, mimeType: 'application/pdf', blob: f, previewUrl: null });
        else out.push(await preparePhoto(f));
      } catch {
        setBad(t.todos.card.cannotRead(f.name));
      }
    }
    setFiles((was) => [...was, ...out]);
    if (input.current) input.current.value = '';
    setBusy(false);
  };

  return (
    <Form
      value={value}
      initial={{ note: '', files: 0 }}
      label={t.todos.card.done}
      submit={async (key) => {
        if (todo.needsFile && todo.files.length === 0 && files.length === 0) throw new ApiError(409, 'todo_needs_file', 'todo_needs_file', { field: 'files' });
        try {
          // Each file its own write, its key derived from the form's: a retry finds the ones already stored.
          for (const [i, f] of files.entries()) await uploadFile(`/api/todos/${todo.id}/files`, f, {}, `${key}-${i}`, true);
          await api.post(`/api/todos/${todo.id}/close`, { note: note.trim() }, { key });
        } finally {
          if (files.length > 0) markStale();
        }
        return { toast: { text: t.todos.toast.done(todo.text), undo: () => api.post(`/api/todos/${todo.id}/reopen`) } };
      }}
      onDone={onDone}
    >
      <div className="field" data-field="files">
        {files.length > 0 && (
          <div className="thumbs">
            {files.map((p, i) => (
              <span key={`${p.name}-${i}`} className="thumb" title={p.name}>
                {p.previewUrl ? <img src={p.previewUrl} alt="" /> : 'PDF'}
                <button type="button" className="thumb-x" aria-label={t.photos.remove} onClick={() => setFiles((was) => was.filter((_, j) => j !== i))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        {/* The mockup's dashed place: what is needed, then where to put it — the camera on a phone, the files on a laptop. */}
        <label className="todo-drop todo-drop-pick">
          {todo.needsFile && todo.files.length === 0 && <span>{t.todos.card.fileNeeded}</span>}
          <b>{busy ? t.todos.card.adding : t.todos.card.addFile}</b>
          <input ref={input} type="file" accept="image/*,application/pdf" multiple onChange={(e) => void add(e.target.files)} hidden />
        </label>
        {bad && <span className="hint hint-bad">{bad}</span>}
        <FilesError />
      </div>
      <Field label={t.todos.card.yourNote} name="note" hint={t.todos.card.optional}>
        <textarea className="input" rows={2} value={note} maxLength={TODO_NOTE_MAX} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </Form>
  );
}

/** The refusal about the files, under them: «Сделано» pressed without one where one is needed. */
function FilesError() {
  const words = useFieldError('files');
  return words ? <span className="field-err">{words}</span> : null;
}
