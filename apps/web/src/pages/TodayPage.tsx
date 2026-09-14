import { VEHICLE_STATES, type VehicleState } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { StateBadge, Loading } from '../components/ui.js';
import { formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useSession } from '../session.js';

// "Today" answers one question: what needs doing (U1). The first row is the
// work — each task a row with its own action — and the counts follow, smaller,
// because a number nobody acts on is not the reason anyone opens this screen.

interface OverdueRow {
  id: string;
  number: string;
  customer: { id: string; name: string; phone: string | null };
  days: number;
  debtTetri: number;
}

interface Summary {
  today: string;
  fleet: Record<VehicleState, number>;
  rentals: { active: number; overdue: number; withoutVin: number };
  overdueList: OverdueRow[];
  customers: number;
  unmatchedLines: number;
  openServiceJobs: number;
  salesOverdueTetri: number;
  deposits: { held: number; heldTetri: number };
  pickedUpToday: { id: string; number: string; customer: string }[];
  dueBackToday: { id: string; number: string; customer: string }[];
}

interface Task {
  key: string;
  count: number;
  label: string;
  action: string;
  to: string;
  tone?: 'crit' | 'warn';
}

function TaskRow({ task }: { task: Task }) {
  return (
    <li className={`task ${task.tone ? `task-${task.tone}` : ''}`}>
      <span className="task-num">{task.count}</span>
      <span className="task-lbl">{task.label}</span>
      <Link to={task.to} className="pill pill-sm task-go">
        {task.action}
      </Link>
    </li>
  );
}

export function TodayPage() {
  const t = useT();
  const { can } = useSession();
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    void api.get<Summary>('/api/summary').then(setS);
  }, []);
  if (!s) return <Loading />;

  // Only what is actually waiting. A task with nothing in it is not a task,
  // and a first row of zeroes teaches people to stop reading the first row.
  const tasks: Task[] = [
    { key: 'dueBack', count: s.dueBackToday.length, label: t.today.dueBack, action: t.today.goReturn, to: '/rentals' },
    { key: 'pickedUp', count: s.pickedUpToday.length, label: t.today.pickedUp, action: t.today.goOpen, to: '/rentals' },
    { key: 'overdue', count: s.rentals.overdue, label: t.today.overdue, action: t.today.goOpen, to: '/rentals', tone: 'crit' as const },
    ...(can('payments.reconcile')
      ? [{ key: 'unmatched', count: s.unmatchedLines, label: t.today.unmatched, action: t.today.goSort, to: '/statements', tone: 'warn' as const }]
      : []),
    { key: 'withoutVin', count: s.rentals.withoutVin, label: t.today.withoutVin, action: t.today.goOpen, to: '/rentals', tone: 'warn' as const },
    { key: 'service', count: s.openServiceJobs, label: t.today.openService, action: t.today.goOpen, to: '/service', tone: 'warn' as const },
  ].filter((task) => task.count > 0);

  return (
    <>
      <header className="page-head">
        <h1>{t.today.title}</h1>
        <span className="mono muted">{s.today}</span>
      </header>

      <section className="tasks-wrap">
        {tasks.length > 0 ? (
          <ul className="tasks">
            {tasks.map((task) => (
              <TaskRow key={task.key} task={task} />
            ))}
          </ul>
        ) : (
          // An empty state offers the next action rather than an empty box.
          <div className="card task-clear">
            <p className="t-h3">{t.today.clear}</p>
            <p className="t-label">{t.today.clearNote}</p>
            {can('rental.create') && (
              <Link to="/rentals/new" className="pill pill-accent">
                {t.actions.newRental}
              </Link>
            )}
          </div>
        )}
      </section>

      {s.overdueList.length > 0 && (
        <section className="card">
          <h2>{t.today.overdueList}</h2>
          <ul className="od-list">
            {s.overdueList.map((r) => (
              <li key={r.id}>
                <Link to={`/rentals/${r.id}`} className="od-who">
                  <span className="od-name">{r.customer.name}</span>
                  <span className="mono muted od-num">{r.number}</span>
                </Link>
                <span className="od-days crit-text">{t.today.daysOverdue(r.days)}</span>
                <span className="t-money crit-text od-debt">{formatGel(r.debtTetri)}</span>
                <span className="od-acts">
                  {r.customer.phone && (
                    <a className="pill pill-sm" href={`tel:${r.customer.phone}`}>
                      {t.today.remind}
                    </a>
                  )}
                  {can('cash.record') && (
                    <Link to={`/rentals/${r.id}`} className="pill pill-sm pill-accent">
                      {t.today.markPaid}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="tiles tiles-quiet">
        <Link to="/rentals" className="tile">
          <span className="tile-num">{s.rentals.active}</span>
          <span className="tile-lbl">{t.today.activeRentals}</span>
        </Link>
        {s.salesOverdueTetri > 0 && (
          <Link to="/sales" className="tile tile-crit">
            <span className="tile-num mono">{formatGel(s.salesOverdueTetri, { decimals: false })}</span>
            <span className="tile-lbl">{t.today.salesOverdue}</span>
          </Link>
        )}
        <Link to="/customers" className="tile">
          <span className="tile-num">{s.customers}</span>
          <span className="tile-lbl">{t.today.customers}</span>
        </Link>
        <div className="tile">
          <span className="tile-num mono">{formatGel(s.deposits.heldTetri, { decimals: false })}</span>
          <span className="tile-lbl">{t.today.depositsHeld}</span>
        </div>
      </section>

      {(s.pickedUpToday.length > 0 || s.dueBackToday.length > 0) && (
        <div className="two-col">
          {s.pickedUpToday.length > 0 && (
            <section className="card">
              <h2>{t.today.pickedUp}</h2>
              <ul className="timeline">
                {s.pickedUpToday.map((r) => (
                  <li key={r.id}>
                    <Link to={`/rentals/${r.id}`} className="mono">
                      {r.number}
                    </Link>
                    <span>{r.customer}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {s.dueBackToday.length > 0 && (
            <section className="card">
              <h2>{t.today.dueBack}</h2>
              <ul className="timeline">
                {s.dueBackToday.map((r) => (
                  <li key={r.id}>
                    <Link to={`/rentals/${r.id}`} className="mono">
                      {r.number}
                    </Link>
                    <span>{r.customer}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <section className="card">
        <h2>{t.today.fleet}</h2>
        <ul className="state-list">
          {VEHICLE_STATES.map((st) => (
            <li key={st}>
              <Link to={`/fleet?state=${st}`}>
                <StateBadge state={st} />
                <span className="num mono">{s.fleet[st]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
