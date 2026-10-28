import {
  TODO_LEAD_CHOICES,
  TODO_NOTE_MAX,
  TODO_REPEATS,
  TODO_TEXT_MAX,
  addDays,
  fleetNumber,
  repeatDayOf,
  todayISO,
  todoFault,
  todoRecordEnded,
  type RentalStatus,
  type Role,
  type TodoLinkKind,
  type TodoRepeat,
  type TodoView,
  type VehicleState,
} from '@ev8/shared';
import { useEffect, useState } from 'react';
import { ApiError, api } from '../../api.js';
import { Field } from '../../components/Wizard.js';
import { FormSheet } from '../../ds/form/Form.js';
import { fmtDate } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import './todos.css';

/** A record a new task is about, as the form shows it. */
export interface TodoLinkPick {
  kind: TodoLinkKind;
  id: string;
  label: string;
}

interface Assignees {
  mayLink: boolean;
  assignees: { id: string; name: string; role: Role; self: boolean; linkKinds: TodoLinkKind[] }[];
}

interface Draft {
  text: string;
  assigneeId: string;
  dueOn: string;
  leadDays: number;
  repeat: TodoRepeat;
  needsFile: boolean;
  link: TodoLinkPick | null;
  note: string;
}

/**
 * «Новая задача» and «Изменить задачу» (the director's mockup, the sheet on
 * the right): what to do, to whom, the day and how early it shows, the
 * repeat, «нужно фото или файл», the record it is about, a comment. Fewer
 * than seven fields: a sheet from the bottom on a phone, a panel on a laptop
 * (ux.md «Формы»). Opened over a card by «⋯ → Поручить», it comes with the
 * card's record already tied.
 */
export function TodoSheet({
  todo,
  link,
  assigneeId,
  fromCard = false,
  onClose,
  onDone,
}: {
  /** The task to change; none — a new one. */
  todo?: TodoView;
  /** The record a new task is about, from the card it was opened over. */
  link?: TodoLinkPick;
  /** Whom a new task goes to first: the person whose list it was opened from. */
  assigneeId?: string;
  /** Opened over a card: its message leads to «Задачи». */
  fromCard?: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const t = useT();
  const { me } = useSession();
  const today = todayISO();
  const people = useLoad<Assignees>('/api/todos/assignees');
  const initial: Draft = todo
    ? {
        text: todo.text,
        assigneeId: todo.assignee.id,
        dueOn: todo.dueOn,
        leadDays: todo.leadDays,
        repeat: todo.repeat,
        needsFile: todo.needsFile,
        link: todo.link ? { kind: todo.link.kind, id: todo.link.id, label: todo.link.label } : null,
        note: todo.note ?? '',
      }
    : { text: '', assigneeId: assigneeId ?? me?.id ?? '', dueOn: today, leadDays: 0, repeat: 'none', needsFile: false, link: link ?? null, note: '' };
  const [f, setF] = useState<Draft>(initial);
  const set = (patch: Partial<Draft>) => setF((v) => ({ ...v, ...patch }));

  const list = people.data?.assignees ?? [];
  const chosen = list.find((p) => p.id === f.assigneeId);
  // A record the chosen person does not read — a rental or a customer for a mechanic — is refused by the server; said here first.
  const linkWrong = f.link != null && chosen != null && !chosen.linkKinds.includes(f.link.kind);
  // The repeat keeps its day while only the due day of one task moves; a new repeat reads it from the due day.
  const repeatDay = f.repeat === 'none' ? null : todo && todo.repeat === f.repeat && todo.repeatDay ? todo.repeatDay : repeatDayOf(f.repeat, f.dueOn || today);
  const repeatHint =
    f.repeat === 'weekly' && repeatDay
      ? t.todos.form.weeklyHint(t.todos.form.everyWeekday[repeatDay - 1] ?? '')
      : f.repeat === 'monthly' && repeatDay
        ? t.todos.form.monthlyHint(repeatDay)
        : undefined;
  const dueChanged = !todo || f.dueOn !== todo.dueOn;

  return (
    <FormSheet
      title={todo ? t.todos.form.editTitle : t.todos.form.newTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={todo ? undefined : 'todo-new'}
      onRestore={todo ? undefined : setF}
      summary={(v) => v.text}
      label={todo ? t.todos.form.save : t.todos.form.submit}
      submit={async (key) => {
        // The form's own check first, the server's rule (`todoFault`): the words go under the field.
        const fault = todoFault({ text: f.text, note: f.note, dueOn: f.dueOn, leadDays: f.leadDays, today, dueChanged });
        if (fault) throw new ApiError(400, fault.code, fault.code, { field: fault.field });
        const body = {
          text: f.text.trim(),
          note: f.note.trim(),
          dueOn: f.dueOn,
          leadDays: f.leadDays,
          needsFile: f.needsFile,
          repeat: f.repeat,
          assigneeId: f.assigneeId,
          link: f.link ? { kind: f.link.kind, id: f.link.id } : null,
        };
        if (todo) {
          await api.patch(`/api/todos/${todo.id}`, body, { key });
          return { toast: { text: t.todos.toast.saved } };
        }
        await api.post('/api/todos', body, { key });
        return { toast: { text: t.todos.toast.set, open: fromCard ? '/tasks' : undefined } };
      }}
      onDone={() => onDone?.()}
    >
      <Field label={t.todos.form.text} name="text">
        <textarea className="input" rows={2} value={f.text} maxLength={TODO_TEXT_MAX} onChange={(e) => set({ text: e.target.value })} autoFocus={!todo} />
      </Field>

      {list.length > 1 && (
        <div className="field" data-field="assigneeId">
          <span className="lbl">{t.todos.form.assignee}</span>
          <div className="chips-pick" role="radiogroup" aria-label={t.todos.form.assignee}>
            {[...list.filter((p) => !p.self), ...list.filter((p) => p.self)].map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={f.assigneeId === p.id} className="seg seg-sm" onClick={() => set({ assigneeId: p.id })}>
                {p.self ? t.todos.self : p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="todo-pair">
        <Field label={t.todos.form.due} name="dueOn" hint={f.leadDays > 0 && f.dueOn ? t.todos.form.leadHint(fmtDate(addDays(f.dueOn, -f.leadDays))) : undefined}>
          <input className="input" type="date" value={f.dueOn} min={dueChanged ? today : undefined} onChange={(e) => set({ dueOn: e.target.value })} />
        </Field>
        <Field label={t.todos.form.lead} name="leadDays">
          <select className="input" value={f.leadDays} onChange={(e) => set({ leadDays: Number(e.target.value) })}>
            {[...new Set([...TODO_LEAD_CHOICES, f.leadDays])].sort((a, b) => a - b).map((n) => (
              <option key={n} value={n}>
                {n === 0 ? t.todos.form.leadNone : t.todos.form.leadDays(n)}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="field" data-field="repeat">
        <span className="lbl">{t.todos.form.repeat}</span>
        <div className="chips-pick" role="radiogroup" aria-label={t.todos.form.repeat}>
          {TODO_REPEATS.map((r) => (
            <button key={r} type="button" role="radio" aria-checked={f.repeat === r} className="seg seg-sm" onClick={() => set({ repeat: r })}>
              {t.todos.repeats[r]}
            </button>
          ))}
        </div>
        {repeatHint && <span className="hint muted">{repeatHint}</span>}
      </div>

      <label className="check" data-field="needsFile">
        <input type="checkbox" checked={f.needsFile} onChange={(e) => set({ needsFile: e.target.checked })} />
        <span>{t.todos.form.needsFile}</span>
      </label>

      {people.data?.mayLink && (
        <div className="field" data-field="link">
          <span className="lbl">{t.todos.form.link}</span>
          {f.link ? (
            <span className="todo-linked">
              <span className="todo-tag todo-tag-record">{`${t.todos.linkKinds[f.link.kind] ?? ''} · ${f.link.label}`}</span>
              <button type="button" className="pill pill-sm" onClick={() => set({ link: null })}>
                {t.todos.form.linkRemove}
              </button>
            </span>
          ) : (
            <LinkFinder kinds={chosen?.linkKinds ?? ['vehicle']} onPick={(l) => set({ link: l })} />
          )}
          {linkWrong && <span className="field-err">{t.todos.form.linkMechanic}</span>}
        </div>
      )}

      <Field label={t.todos.form.note} name="note" hint={t.todos.form.noteHint}>
        <textarea className="input" rows={2} value={f.note} maxLength={TODO_NOTE_MAX} onChange={(e) => set({ note: e.target.value })} />
      </Field>

      {list.length > 1 && <p className="hint muted">{t.todos.form.rules}</p>}
    </FormSheet>
  );
}

interface Found {
  groups: {
    vehicles: { items: { id: string; vin: string; fleetNo: number | null; state: VehicleState; model: string }[] };
    rentals: { items: { id: string; number: string; status: RentalStatus; customer: string }[] };
    customers: { items: { id: string; name: string }[] };
  } | null;
}

/**
 * The record a task is about, found as the header search finds it — a
 * sticker's number, four of a VIN, a rental's number, a name. Only the kinds
 * the chosen person may be sent, and none that has ended: a returned rental
 * or a moped gone would close the task at once.
 */
function LinkFinder({ kinds, onPick }: { kinds: TodoLinkKind[]; onPick: (l: TodoLinkPick) => void }) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [asked, setAsked] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setAsked(typed.trim()), 250);
    return () => window.clearTimeout(id);
  }, [typed]);
  const found = useLoad<Found>(asked.length >= 2 ? `/api/search?q=${encodeURIComponent(asked)}` : null);
  const g = found.data?.groups;
  const picks: (TodoLinkPick & { sub: string })[] = g
    ? [
        ...(kinds.includes('vehicle')
          ? g.vehicles.items
              .filter((v) => !todoRecordEnded({ kind: 'vehicle', vehicleState: v.state }))
              .map((v) => ({ kind: 'vehicle' as const, id: v.id, label: fleetNumber(v.fleetNo) ?? `···${v.vin.slice(-4)}`, sub: v.model }))
          : []),
        ...(kinds.includes('rental')
          ? g.rentals.items.filter((r) => !todoRecordEnded({ kind: 'rental', rentalStatus: r.status })).map((r) => ({ kind: 'rental' as const, id: r.id, label: r.number, sub: r.customer }))
          : []),
        ...(kinds.includes('customer') ? g.customers.items.map((c) => ({ kind: 'customer' as const, id: c.id, label: c.name, sub: t.todos.linkKinds.customer ?? '' })) : []),
      ]
    : [];
  return (
    <>
      <input className="input" type="search" value={typed} placeholder={t.todos.form.linkFind} aria-label={t.todos.form.link} onChange={(e) => setTyped(e.target.value)} />
      {asked.length >= 2 && found.data && (
        <div className="todo-pick">
          {picks.length === 0 && <span className="hint muted">{t.todos.form.linkNothing}</span>}
          {picks.map((p) => (
            <button key={`${p.kind}:${p.id}`} type="button" className="todo-pick-item" onClick={() => onPick({ kind: p.kind, id: p.id, label: p.label })}>
              <span>
                <b>{p.label}</b> <span className="muted">{p.sub}</span>
              </span>
              <span className="muted">{t.todos.linkKinds[p.kind]}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
