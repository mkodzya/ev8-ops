import { TODO_MINE, todoBucket, todoOnToday, todoDaysLate } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';
import { TodoCard } from './TodoCard.js';
import { TodoRow, todosUrl, useQuickClose, type TodoList } from './TodoParts.js';
import { TodoSheet } from './TodoSheet.js';
import './todos.css';

/**
 * The block «Задачи» first on «Сегодня» (the director's issue and mockup):
 * one's own tasks late and today's — those shown ahead of their day too —
 * each with «Сделано» at its end, and «все задачи →». Not shown when there
 * are none. The same request as «Задачи → Мои», so the two never disagree,
 * and its rows are what the menu's two numbers count (ux №10).
 */
export function TodayTodos() {
  const t = useT();
  const { data, reload } = useLoad<TodoList>(todosUrl(TODO_MINE));
  const [opened, setOpened] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const quickClose = useQuickClose((todo) => setOpened(todo.id));
  if (!data) return null;
  const rows = data.todos.filter((x) => todoOnToday(x, data.today));
  const open = data.todos.find((x) => x.id === opened);
  const edit = data.todos.find((x) => x.id === editing);
  if (rows.length === 0 && !open && !edit) return null;
  return (
    <>
      {rows.length > 0 && (
        <section className="card queue-card todo-block">
          <div className="queue-head">
            <h2>
              {t.todos.title} · {rows.length}
            </h2>
            <Link to="/tasks">{t.todos.today.all}</Link>
          </div>
          <ul className="todo-list">
            {rows.map((x) => (
              <TodoRow
                key={x.id}
                todo={x}
                today={data.today}
                showWho={false}
                onOpen={(o) => setOpened(o.id)}
                onTick={(o) => void quickClose(o)}
                action={
                  <span className="todo-act">
                    {todoBucket(x, data.today) === 'overdue' ? (
                      <span className="todo-due todo-due-late">{t.todos.lateBy(todoDaysLate(x.dueOn, data.today))}</span>
                    ) : (
                      x.may.close && (
                        <button type="button" className="pill pill-sm" onClick={() => void quickClose(x)}>
                          {t.todos.card.done}
                        </button>
                      )
                    )}
                  </span>
                }
              />
            ))}
          </ul>
        </section>
      )}
      {open && <TodoCard todo={open} today={data.today} onClose={() => setOpened(null)} onEdit={() => { setOpened(null); setEditing(open.id); }} onChanged={reload} />}
      {edit && <TodoSheet todo={edit} onClose={() => setEditing(null)} onDone={reload} />}
    </>
  );
}
