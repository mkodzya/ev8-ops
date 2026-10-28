import { ALL_CHIP, TODO_BUCKETS, TODO_MINE, todoBucket, type TodoView } from '@ev8/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Loading, PageHead } from '../../components/ui.js';
import { fmtDayMonth } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import { TodoCard } from './TodoCard.js';
import { TodoRow, todosUrl, useQuickClose, type TodoList } from './TodoParts.js';
import { TodoSheet } from './TodoSheet.js';
import './todos.css';

/** Closed tasks shown before «Ещё N — показать». */
const DONE_SHOWN = 1;

type Sheet = { kind: 'new' } | { kind: 'card'; id: string } | { kind: 'edit'; todo: TodoView } | null;

/**
 * «Задачи» (issue #18 of the director, part A; ADR-0050; the mockup's
 * laptop frame): one's tasks by day — Просрочено · Сегодня · Завтра · Эта
 * неделя · Позже — and what was closed in the last seven days, folded. An
 * owner reads anybody's: the chips «Мои», each person with tasks open, «Все»
 * last, «Мои» first when the address names none (issue #17). Only what
 * people set by hand is here; what «Сегодня» finds in the data stays there.
 */
export function TodosPage() {
  const t = useT();
  const { me, can } = useSession();
  const [params, setParams] = useSearchParams();
  const everybody = can('todos.assign');
  const who = everybody ? params.get('who') || TODO_MINE : TODO_MINE;
  const { data, failure, reload } = useLoad<TodoList>(todosUrl(who));
  const [sheet, setSheet] = useState<Sheet>(null);
  const [allDone, setAllDone] = useState(false);
  const quickClose = useQuickClose((todo) => setSheet({ kind: 'card', id: todo.id }));

  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  const today = data.today;
  const groups = TODO_BUCKETS.map((bucket) => ({ bucket, rows: data.todos.filter((x) => todoBucket(x, today) === bucket) })).filter((g) => g.rows.length > 0);
  const late = groups.find((g) => g.bucket === 'overdue')?.rows.length ?? 0;
  // Whose a row is, said where the list holds more than one person's.
  const showWho = who === ALL_CHIP;
  const opened = sheet?.kind === 'card' ? [...data.todos, ...data.done].find((x) => x.id === sheet.id) : undefined;
  const pick = (next: string) => {
    const q = new URLSearchParams(params);
    if (next === TODO_MINE) q.delete('who');
    else q.set('who', next);
    setParams(q, { replace: true });
    setAllDone(false);
  };
  const people = data.people ?? [];
  const total = people.reduce((n, p) => n + p.open, 0);
  const done = allDone ? data.done : data.done.slice(0, DONE_SHOWN);
  const weekday = t.today.weekdays[new Date(`${today}T12:00:00Z`).getUTCDay()] ?? '';
  // A new task from somebody's list goes to him first.
  const newFor = who !== TODO_MINE && who !== ALL_CHIP ? who : undefined;

  return (
    <>
      <PageHead title={t.todos.title} sub={t.todos.count(data.todos.length, late)}>
        <button type="button" className="pill pill-sm pill-accent head-primary" onClick={() => setSheet({ kind: 'new' })}>
          + {t.todos.add}
        </button>
      </PageHead>

      {everybody && people.length > 0 && (
        <div className="seg-row todo-chips" role="group" aria-label={t.todos.form.assignee}>
          {people.map((p) => {
            const key = p.id === me?.id ? TODO_MINE : p.id;
            return (
              <button key={p.id} type="button" className={`seg ${who === key ? 'on' : ''}`} aria-pressed={who === key} onClick={() => pick(key)}>
                {p.id === me?.id ? t.todos.mine : p.name}
                <span className="seg-num">{p.open}</span>
              </button>
            );
          })}
          <button type="button" className={`seg ${who === ALL_CHIP ? 'on' : ''}`} aria-pressed={who === ALL_CHIP} onClick={() => pick(ALL_CHIP)}>
            {t.common.all}
            <span className="seg-num">{total}</span>
          </button>
        </div>
      )}

      {groups.length === 0 && (
        <section className="card empty-day">
          <p className="empty-title">{t.todos.empty}</p>
          <p className="muted">{who === TODO_MINE ? t.todos.emptySub : t.todos.emptyOther}</p>
          <button type="button" className="pill pill-accent" onClick={() => setSheet({ kind: 'new' })}>
            + {t.todos.add}
          </button>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.bucket} aria-label={t.todos.groups[g.bucket]}>
          <h2 className={`todo-day ${g.bucket === 'overdue' ? 'todo-day-late' : ''}`}>
            {t.todos.groups[g.bucket]}
            <small>{g.bucket === 'today' ? `${weekday}, ${fmtDayMonth(today)} · ${g.rows.length}` : g.rows.length}</small>
          </h2>
          <ul className="todo-list">
            {g.rows.map((x) => (
              <TodoRow key={x.id} todo={x} today={today} showWho={showWho} onOpen={(o) => setSheet({ kind: 'card', id: o.id })} onTick={(o) => void quickClose(o)} />
            ))}
          </ul>
        </section>
      ))}

      {data.doneTotal > 0 && (
        <section aria-label={t.todos.done}>
          <h2 className="todo-day">
            {t.todos.done}
            <small>{t.todos.doneSub(data.doneTotal)}</small>
          </h2>
          <ul className="todo-list">
            {done.map((x) => (
              <TodoRow key={x.id} todo={x} today={today} showWho={showWho} onOpen={(o) => setSheet({ kind: 'card', id: o.id })} />
            ))}
          </ul>
          {!allDone && data.done.length > DONE_SHOWN && (
            <button type="button" className="todo-more" onClick={() => setAllDone(true)}>
              {t.todos.moreDone(data.done.length - DONE_SHOWN)}
            </button>
          )}
        </section>
      )}

      {/* On a phone the one action sits above the bar, where the thumb is (ux №3). */}
      <div className="page-actions">
        <button type="button" className="pill pill-accent pill-wide" onClick={() => setSheet({ kind: 'new' })}>
          + {t.todos.add}
        </button>
      </div>

      {sheet?.kind === 'new' && <TodoSheet assigneeId={newFor} onClose={() => setSheet(null)} onDone={reload} />}
      {sheet?.kind === 'edit' && <TodoSheet todo={sheet.todo} onClose={() => setSheet(null)} onDone={reload} />}
      {opened && <TodoCard todo={opened} today={today} onClose={() => setSheet(null)} onEdit={() => setSheet({ kind: 'edit', todo: opened })} onChanged={reload} />}
    </>
  );
}
