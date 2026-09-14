import { VEHICLE_STATES, type VehicleState } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { StateBadge, Loading, Empty } from '../components/ui.js';
import { formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useSession } from '../session.js';

interface Summary {
  today: string;
  fleet: Record<VehicleState, number>;
  rentals: { active: number; overdue: number; withoutVin: number };
  customers: number;
  unmatchedLines: number;
  openServiceJobs: number;
  salesOverdueTetri: number;
  deposits: { held: number; heldTetri: number };
  pickedUpToday: { id: string; number: string; customer: string }[];
  dueBackToday: { id: string; number: string; customer: string }[];
}

export function TodayPage() {
  const t = useT();
  const { can } = useSession();
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => {
    void api.get<Summary>('/api/summary').then(setS);
  }, []);
  if (!s) return <Loading />;

  const fleetTotal = VEHICLE_STATES.reduce((n, st) => n + s.fleet[st], 0);
  const nothing = fleetTotal === 0 && s.customers === 0 && s.rentals.active + s.rentals.overdue === 0;

  return (
    <>
      <header className="page-head">
        <h1>{t.today.title}</h1>
        <span className="mono muted">{s.today}</span>
      </header>
      {nothing && <Empty text={t.today.empty} />}
      <section className="tiles">
        <Link to="/rentals" className={`tile ${s.rentals.overdue > 0 ? 'tile-crit' : ''}`}>
          <span className="tile-num">{s.rentals.overdue}</span>
          <span className="tile-lbl">{t.today.overdue}</span>
        </Link>
        <Link to="/rentals" className="tile">
          <span className="tile-num">{s.rentals.active}</span>
          <span className="tile-lbl">{t.today.activeRentals}</span>
        </Link>
        <Link to="/rentals" className={`tile ${s.rentals.withoutVin > 0 ? 'tile-warn' : ''}`}>
          <span className="tile-num">{s.rentals.withoutVin}</span>
          <span className="tile-lbl">{t.today.withoutVin}</span>
        </Link>
        {can('payments.reconcile') && (
          <Link to="/statements" className={`tile ${s.unmatchedLines > 0 ? 'tile-warn' : ''}`}>
            <span className="tile-num">{s.unmatchedLines}</span>
            <span className="tile-lbl">{t.today.unmatched}</span>
          </Link>
        )}
        {s.salesOverdueTetri > 0 && (
          <Link to="/sales" className="tile tile-crit">
            <span className="tile-num mono">{formatGel(s.salesOverdueTetri, { decimals: false })}</span>
            <span className="tile-lbl">{t.today.salesOverdue}</span>
          </Link>
        )}
        <Link to="/service" className={`tile ${s.openServiceJobs > 0 ? 'tile-warn' : ''}`}>
          <span className="tile-num">{s.openServiceJobs}</span>
          <span className="tile-lbl">{t.today.openService}</span>
        </Link>
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
