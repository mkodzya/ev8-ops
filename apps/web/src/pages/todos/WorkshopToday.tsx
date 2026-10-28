import { formatGel, todayISO } from '@ev8/shared';
import { Link } from 'react-router-dom';
import { LoadError } from '../../components/LoadError.js';
import { Loading } from '../../components/ui.js';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import { TodayTodos } from './TodayTodos.js';
import './todos.css';

interface WorkshopDay {
  today: string;
  repairs: { waiting: number; open: number };
  toApprove: number | null;
  maintenance: { due: number; late: number } | null;
  payoutTetri: number;
}

/**
 * A mechanic's own «Сегодня» (issue #18 of the director, part A; ADR-0050;
 * the mockup's tablet): before it a mechanic had none and landed on the
 * repairs. His tasks first — the same block as the front office's — then his
 * repairs, for whoever approves the repairs waiting, for whoever sees every
 * repair the planned maintenance (ADR-0038), and his own payout. No customer
 * and no customer's money (ADR-0033 §2). Each card leads where it is made of.
 */
export function WorkshopToday() {
  const t = useT();
  const { can } = useSession();
  const work = can('service.work');
  const { data, failure, reload } = useLoad<WorkshopDay>(work ? '/api/today/workshop' : null);
  const today = data?.today ?? todayISO();
  const d = new Date(`${today}T12:00:00Z`);
  const title = t.today.day(t.today.weekdays[d.getUTCDay()] ?? '', d.getUTCDate(), t.today.months[d.getUTCMonth()] ?? '');

  return (
    <>
      <header className="day-head">
        <h1>{t.today.title}</h1>
        <p className="muted">{title}</p>
      </header>
      <TodayTodos />
      {work && !data && failure && <LoadError failure={failure} onRetry={reload} />}
      {work && !data && !failure && <Loading rows={2} />}
      {data && (
        <div className="wday">
          <section className="card">
            <div className="wday-head">
              <h2>{t.todos.workshop.repairs}</h2>
              <Link to="/service">{t.todos.workshop.all}</Link>
            </div>
            {data.repairs.waiting + data.repairs.open === 0 ? (
              <p className="wday-line muted">{t.todos.workshop.noRepairs}</p>
            ) : (
              <>
                {data.repairs.waiting > 0 && <p className="wday-line">{t.todos.workshop.waiting(data.repairs.waiting)}</p>}
                {data.repairs.open > 0 && <p className="wday-line">{t.todos.workshop.working(data.repairs.open)}</p>}
              </>
            )}
          </section>

          {data.toApprove != null && data.toApprove > 0 && (
            <section className="card">
              <div className="wday-head">
                <h2>{t.todos.workshop.toApprove}</h2>
                <Link to="/service">{t.todos.workshop.all}</Link>
              </div>
              <p className="wday-line warn-text">{t.todos.workshop.toApproveN(data.toApprove)}</p>
            </section>
          )}

          {data.maintenance && (
            <section className="card">
              <div className="wday-head">
                <h2>{t.todos.workshop.maintenance}</h2>
                <Link to="/service">{t.todos.workshop.all}</Link>
              </div>
              {data.maintenance.due === 0 ? (
                <p className="wday-line muted">{t.todos.workshop.maintenanceNone}</p>
              ) : (
                <>
                  <p className="wday-line">{t.todos.workshop.maintenanceDue(data.maintenance.due)}</p>
                  {data.maintenance.late > 0 && <p className="wday-line crit-text">{t.todos.workshop.maintenanceLate(data.maintenance.late)}</p>}
                </>
              )}
            </section>
          )}

          <section className="card">
            <div className="wday-head">
              <h2>{t.todos.workshop.payout}</h2>
              <Link to="/service/balance">{t.todos.workshop.all}</Link>
            </div>
            <p className="wday-line">{data.payoutTetri > 0 ? t.todos.workshop.payoutNow(formatGel(data.payoutTetri)) : t.todos.workshop.payoutNone}</p>
          </section>
        </div>
      )}
    </>
  );
}
