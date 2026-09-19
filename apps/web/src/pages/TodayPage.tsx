import { VEHICLE_STATES, type VehicleState } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { useLoad } from '../lib/use.js';
import { BlockHead, CustomerName, Loading, PageHead, StateBadge } from '../components/ui.js';
import { formatGel } from '../format.js';
import { dayTasks, type DayTask } from '../lib/tasks.js';
import { useT } from '../i18n/index.js';
import { useSession } from '../session.js';

// "Today" answers one question: what needs doing (U1). The first row is the
// work — each task a row with its own action — and the counts follow, smaller,
// because a number nobody acts on is not the reason anyone opens this screen.

interface OverdueRow {
  id: string;
  number: string;
  customer: { id: string; name: string; nameKa: string | null; nameLat: string | null; phone: string | null };
  days: number;
  debtTetri: number;
}

interface Summary {
  today: string;
  fleet: Record<VehicleState, number>;
  rentals: { active: number; overdue: number; withoutVin: number };
  overdueList: OverdueRow[];
  /** Handed over today with nothing paid yet (wave 3 §3.3). */
  awaitingPayment?: { id: string; number: string; customer: string }[];
  /** Returns a manager closed; the deposit waits for an owner (wave 3 §3.5). */
  depositsUndecided?: { id: string; number: string; customer: string; days: number }[];
  customers: number;
  unmatchedLines: number;
  openServiceJobs: number;
  salesOverdueTetri: number;
  deposits: { held: number; heldTetri: number };
  pickedUpToday: { id: string; number: string; customer: string }[];
  dueBackToday: { id: string; number: string; customer: string }[];
}

function TaskRow({ task }: { task: DayTask }) {
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
  const { data: s, failure, reload } = useLoad<Summary>('/api/summary');
  if (!s && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!s) return <Loading />;

  const tasks = dayTasks(s, t, can);

  return (
    <>
      <PageHead title={t.today.title} sub={<span className="mono">{s.today}</span>} />

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

      {(s.awaitingPayment ?? []).length > 0 && (
        <section className="card">
          <BlockHead title={t.w3.awaitingPayment} sub={t.rentals.count(s.awaitingPayment!.length)} />
          <ul className="od-list">
            {s.awaitingPayment!.map((r) => (
              <li key={r.id}>
                <Link to={`/rentals/${r.id}`} className="od-who">
                  <span className="od-name">{r.customer}</span>
                  <span className="mono muted od-num">{r.number}</span>
                </Link>
                <span className="od-acts">
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

      {(s.depositsUndecided ?? []).length > 0 && (
        <section className="card">
          <BlockHead title={t.w3.depositsUndecided} sub={t.rentals.count(s.depositsUndecided!.length)} />
          <ul className="od-list">
            {s.depositsUndecided!.map((r) => (
              <li key={r.id}>
                <Link to={`/rentals/${r.id}`} className="od-who">
                  <span className="od-name">{r.customer}</span>
                  <span className="mono muted od-num">{r.number}</span>
                </Link>
                <span className="od-days warn-text">{t.w3.daysWaiting(r.days)}</span>
                <span className="od-acts">
                  <Link to={`/rentals/${r.id}?decide=1`} className="pill pill-sm pill-accent">
                    {t.w3.decide}
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {s.overdueList.length > 0 && (
        <section className="card">
          <BlockHead title={t.today.overdueList} sub={t.rentals.count(s.overdueList.length)} />
          <ul className="od-list">
            {s.overdueList.map((r) => (
              <li key={r.id}>
                <Link to={`/rentals/${r.id}`} className="od-who">
                  <span className="od-name"><CustomerName of={r.customer} second={false} /></span>
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
              <BlockHead title={t.today.pickedUp} sub={t.rentals.count(s.pickedUpToday.length)} />
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
              <BlockHead title={t.today.dueBack} sub={t.rentals.count(s.dueBackToday.length)} />
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
        <BlockHead title={t.today.fleet} sub={t.fleet.count(VEHICLE_STATES.reduce((n, st) => n + s.fleet[st], 0))} />
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
