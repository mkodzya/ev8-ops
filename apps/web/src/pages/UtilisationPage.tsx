import { FREE_TOO_LONG_DAYS, monthOf, todayISO, utilisationQuery, weekOf } from '@ev8/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Empty, Loading, PageHead, Vin } from '../components/ui.js';
import { fmtDate } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { repairHoursText, type RepairHours } from '../lib/maintenance.js';
import { useLoad } from '../lib/use.js';

// "Отчёты → Загрузка парка аренды" (wave 6 §3.2, B10-01). The arithmetic is
// M-10 and lives in `packages/shared/src/utilisation.ts`; this screen only
// asks for a period and reads the answer out.
//
// Three things it will not do:
//
//   * it does not draw a threshold. The book has none — 34 % in the finance
//     plan is a plan, not a rule (§3.2) — so nothing here is painted red for
//     being low;
//   * it does not hide what the percentage left out. Mopeds no park has
//     claimed are named under the figure, with a link to the list of them,
//     because a percentage built on three quarters of the fleet must say so;
//   * it does not invent the third line of "что мешает". Nothing in the data
//     ties a repair to a missing battery, so that line reads "нет данных"
//     rather than a 0 nobody counted (CLAUDE.md rule 1).
//
// The period is in the address, and the request is built from the same list
// of keys the links are (`utilisationQuery`), so a period cannot reach the
// address bar and stop there (QA-W6-05).

interface BlockerVehicle {
  id: string;
  vin: string;
  model: string;
  days: number;
}

interface Answer {
  from: string;
  to: string;
  percent: number | null;
  rentedDays: number;
  poolDays: number;
  unassigned: number;
  vehicles: number;
  byModel: { modelId: string; model: string; vehicles: number; rentedDays: number; poolDays: number; percent: number | null }[];
  blockers: { inRepairAllPeriod: BlockerVehicle[]; freeTooLong: BlockerVehicle[]; batteriesHolding: null };
  repairs?: RepairHours;
}

export function UtilisationPage() {
  const t = useT();
  const { locale } = useLocale();
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const thisWeek = weekOf(today);
  const thisMonth = monthOf(today);

  const from = params.get('from') ?? thisMonth.from;
  const to = params.get('to') ?? thisMonth.to;
  const which =
    from === thisWeek.from && to === thisWeek.to ? 'week' : from === thisMonth.from && to === thisMonth.to ? 'month' : 'custom';

  // The one place the question is built, for the link and for the request
  // alike: a key not on this list travels nowhere, and a test says so.
  const query = utilisationQuery((key) => ({ from, to })[key as 'from' | 'to']);
  const { data, failure, reload } = useLoad<Answer>(`/api/reports/utilisation?${query}`);

  const pick = (next: { from: string; to: string }) => setParams(new URLSearchParams(next), { replace: true });

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const u = data;

  return (
    <>
      <PageHead wrap title={t.utilisationReport.title} sub={t.utilisationReport.period(fmtDate(u.from), fmtDate(u.to))} note={t.utilisationReport.subtitle} />

      <div className="chips week-period">
        <button type="button" className={`chip ${which === 'week' ? 'on' : ''}`} onClick={() => pick(thisWeek)}>
          {t.utilisationReport.week}
        </button>
        <button type="button" className={`chip ${which === 'month' ? 'on' : ''}`} onClick={() => pick(thisMonth)}>
          {t.utilisationReport.month}
        </button>
        <input
          className="chip chip-date"
          type="date"
          aria-label={t.utilisationReport.from}
          value={from}
          max={to}
          onChange={(e) => e.target.value && pick({ from: e.target.value, to })}
        />
        <input
          className="chip chip-date"
          type="date"
          aria-label={t.utilisationReport.to}
          value={to}
          min={from}
          onChange={(e) => e.target.value && pick({ from, to: e.target.value })}
        />
      </div>

      <section className="card util-total">
        {u.percent == null ? (
          // Not 0 %: nothing stood in the park, so there is no figure to give.
          <Empty text={t.utilisationReport.noFigure} />
        ) : (
          <>
            <p className="util-hero">{u.percent} %</p>
            <p className="hint">
              {t.utilisationReport.basis(u.rentedDays, u.poolDays)} · {t.utilisationReport.vehicles(u.vehicles)}
            </p>
          </>
        )}
        {/* Without this line the percentage would be quietly wrong (§3.2). */}
        {u.unassigned > 0 && (
          <p className="hint util-aside">
            {t.utilisationReport.unassigned(u.unassigned)} · <Link to="/fleet?f=nopool">{t.utilisationReport.unassignedLink}</Link>
          </p>
        )}
      </section>

      <section className="card">
        <BlockHead title={t.utilisationReport.byModel} />
        {u.byModel.length === 0 ? (
          <Empty text={t.utilisationReport.noFigure} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.utilisationReport.model}</th>
                  <th className="num">{t.utilisationReport.count}</th>
                  <th className="num">{t.utilisationReport.load}</th>
                </tr>
              </thead>
              <tbody>
                {u.byModel.map((m) => (
                  <tr key={m.modelId}>
                    <td>{m.model}</td>
                    <td className="num mono">{m.vehicles}</td>
                    <td className="num mono">{m.percent == null ? t.common.dash : `${m.percent} %`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <BlockHead title={t.utilisationReport.blockers} />
        <Blocker label={t.utilisationReport.inRepairAllPeriod} rows={u.blockers.inRepairAllPeriod} />
        {/* Hours in repair over the period, from the repairs' own minutes (ADR-0038). */}
        {u.repairs && (
          <dl className="figures">
            <div className="figure">
              <dt>{t.wmaint.repairsLine}</dt>
              <dd className="mono">{repairHoursText(u.repairs, t, locale)}</dd>
            </div>
          </dl>
        )}
        <Blocker label={t.utilisationReport.freeTooLong(FREE_TOO_LONG_DAYS)} rows={u.blockers.freeTooLong} />
        {/* No record ties a repair to a battery, so this is words, not a number. */}
        <dl className="figures">
          <div className="figure figure-stack">
            <dt>{t.utilisationReport.batteries}</dt>
            <dd className="muted">{t.utilisationReport.noRecord}</dd>
          </div>
        </dl>
      </section>
    </>
  );
}

/**
 * One line of "что мешает": how many mopeds, and which ones. The VINs stand
 * under the count rather than behind a link — the lists are short, and the
 * whole point of the block is to name what to go and do something about.
 */
/** How many of a blocker's mopeds are named before the list turns into a count. */
const BLOCKER_SHOWN = 5;

function Blocker({ label, rows }: { label: string; rows: BlockerVehicle[] }) {
  const t = useT();
  return (
    <>
      <dl className="figures">
        <div className="figure">
          <dt>{label}</dt>
          <dd className={rows.length === 0 ? 'muted' : 'mono'}>
            {rows.length === 0 ? t.utilisationReport.none : t.utilisationReport.vehicles(rows.length)}
          </dd>
        </div>
      </dl>
      {rows.length > 0 && (
        <ul className="util-list">
          {/* Five and a count, not the whole list: on a phone a long one
              pushes the percentage itself off the screen, and the percentage
              is what the screen is for (designer, 21.09.2026). */}
          {rows.slice(0, BLOCKER_SHOWN).map((v) => (
            <li key={v.id}>
              <Link to={`/fleet/${v.id}`}>
                <Vin vin={v.vin} />
              </Link>{' '}
              <span className="muted">
                {v.model} · {t.utilisationReport.days(v.days)}
              </span>
            </li>
          ))}
          {rows.length > BLOCKER_SHOWN && (
            <li className="muted">{t.utilisationReport.andMore(rows.length - BLOCKER_SHOWN)}</li>
          )}
        </ul>
      )}
    </>
  );
}
