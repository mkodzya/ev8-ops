import { localDateTime, todoBucket, todoDaysLate, type Role, type TodoView } from '@ev8/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { fmtDayMonth } from '../../format.js';
import type { Dict } from '../../i18n/en.js';
import { useT } from '../../i18n/index.js';
import { Typed } from '../../lib/typed.js';
import { errorText } from '../../lib/use.js';
import './todos.css';

// The pieces «Задачи» (issue #18 A, ADR-0050) shows in three places — its own
// section, the block first on «Сегодня», a mechanic's «Сегодня»: one row, one
// set of tags, one «Сделано». The rules are @ev8/shared's (`todos.ts`).

/** `GET /api/todos` as the screens read it. */
export interface TodoList {
  today: string;
  todos: TodoView[];
  done: TodoView[];
  doneTotal: number;
  /** An owner's chips: himself first, then whoever has tasks open. */
  people: { id: string; name: string; role: Role; open: number }[] | null;
}

/** One address per filter, so the section and the block on «Сегодня» share one request (and one cache) for «Мои». */
export const todosUrl = (who: string): string => `/api/todos?who=${encodeURIComponent(who)}`;

/** «каждую неделю, Пн», «каждый месяц, 15-го»; null for a task that does not repeat. */
export function repeatText(t: Dict, todo: Pick<TodoView, 'repeat' | 'repeatDay'>): string | null {
  if (todo.repeat === 'weekly' && todo.repeatDay) return t.todos.weekly(t.calendar.wd[todo.repeatDay - 1] ?? '');
  if (todo.repeat === 'monthly' && todo.repeatDay) return t.todos.monthly(todo.repeatDay);
  return null;
}

/** The day on the right of a row: «15.10 · −10 дн.» for one late, «30.10» for one to come. */
export function DueText({ todo, today }: { todo: TodoView; today: string }) {
  const t = useT();
  const late = todo.closedAt == null && todoBucket(todo, today) === 'overdue';
  return (
    <span className={`todo-due ${late ? 'todo-due-late' : ''}`}>
      {fmtDayMonth(todo.dueOn)}
      {late && ` · ${t.todos.lateBy(todoDaysLate(todo.dueOn, today))}`}
    </span>
  );
}

/**
 * The tags under a task's words: whose it is (where the list holds more than
 * one person's), the repeat, «нужно фото или файл», the record it is about —
 * a link to its card for whoever may open it — who set it, if not he, and
 * the comment, in the reader's language where a translation is ready
 * (ADR-0042). A closed one says who closed it and when, its files and his
 * comment instead (the mockup's «Сделано»).
 */
export function TodoMeta({ todo, showWho, withNote = true }: { todo: TodoView; showWho: boolean; withNote?: boolean }) {
  const t = useT();
  const repeat = repeatText(t, todo);
  const link = todo.link;
  const href = link?.open ? (link.kind === 'vehicle' ? `/fleet/${link.id}` : link.kind === 'rental' ? `/rentals/${link.id}` : `/customers/${link.id}`) : null;
  if (todo.closedAt) {
    const at = localDateTime(todo.closedAt);
    return (
      <span className="todo-meta">
        {showWho && <span className="todo-tag todo-tag-who">{todo.assignee.name}</span>}
        <span>{todo.closedByRecord ? (t.todos.closedByRecord[link?.kind ?? ''] ?? '') : todo.closedBy ? t.todos.closedBy(todo.closedBy.name, at.date, at.time) : ''}</span>
        {todo.files.length > 0 && <span>{t.todos.files(todo.files.length)}</span>}
        {withNote && todo.closeNote && <Typed text={todo.closeNote} quiet quoted />}
      </span>
    );
  }
  return (
    <span className="todo-meta">
      {showWho && <span className="todo-tag todo-tag-who">{todo.assignee.name}</span>}
      {repeat && <span className="todo-tag todo-tag-repeat">↻ {repeat}</span>}
      {todo.needsFile && <span className="todo-tag todo-tag-file">{t.todos.fileTag}</span>}
      {link &&
        (href ? (
          <Link className="todo-tag todo-tag-record" to={href}>
            {link.label}
          </Link>
        ) : (
          <span className="todo-tag todo-tag-record">{link.label}</span>
        ))}
      {todo.setBy.id !== todo.assignee.id && <span>{t.todos.setBy(todo.setBy.name)}</span>}
      {withNote && todo.note && <Typed text={todo.note} quiet quoted />}
    </span>
  );
}

/**
 * «Сделано» at one press, with «Отменить» in its message for ten seconds
 * (ux №14: reversible — undo, not a question). A task that asks for a photo
 * or a file opens its sheet instead: it cannot close without one.
 */
export function useQuickClose(open: (todo: TodoView) => void): (todo: TodoView) => Promise<void> {
  const t = useT();
  const toast = useToast();
  return async (todo) => {
    if (todo.needsFile && todo.files.length === 0) {
      open(todo);
      return;
    }
    try {
      await api.post(`/api/todos/${todo.id}/close`, {});
      toast({ text: t.todos.toast.done(todo.text), undo: () => api.post(`/api/todos/${todo.id}/reopen`) });
    } catch (e) {
      toast({ text: errorText(e) });
    }
  };
}

/**
 * One task as a row: the ring — «Сделано» for whose it is —, the words with
 * their tags, the day. The words open the task's sheet; the record's tag
 * opens its card, one press from the task (the director's issue).
 */
export function TodoRow({
  todo,
  today,
  showWho,
  onOpen,
  onTick,
  action,
}: {
  todo: TodoView;
  today: string;
  showWho: boolean;
  onOpen: (todo: TodoView) => void;
  onTick?: (todo: TodoView) => void;
  /** What stands at the row's end instead of its day: «Сделано» in the block on «Сегодня». */
  action?: ReactNode;
}) {
  const t = useT();
  const done = todo.closedAt != null;
  const late = !done && todoBucket(todo, today) === 'overdue';
  const tick = !done && todo.may.close && onTick ? () => onTick(todo) : undefined;
  return (
    <li className={`todo-row ${late ? 'todo-row-late' : ''} ${done ? 'todo-row-done' : ''}`}>
      <button type="button" className="todo-tick" onClick={tick ?? (() => onOpen(todo))} aria-label={tick ? `${t.todos.card.done}: ${todo.text}` : todo.text}>
        <span className="todo-ring" aria-hidden="true" />
      </button>
      <span className="todo-main">
        <button type="button" className="todo-open" onClick={() => onOpen(todo)}>
          <span className="todo-text">{todo.text}</span>
        </button>
        <TodoMeta todo={todo} showWho={showWho} />
      </span>
      {action ?? <DueText todo={todo} today={today} />}
    </li>
  );
}
