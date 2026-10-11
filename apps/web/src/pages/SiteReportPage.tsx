import { monthOf, todayISO, weekOf } from '@ev8/shared';
import { useSearchParams } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';

// "Отчёты → Сайт" (Kardu, 11.10.2026): what ev8.ge's own counter saw
// (migration 0036). The counter keeps one number per day for each thing the
// site reports and nothing that tells one person from another, so this screen
// can only ever say "how many", never "who".
//
// What it will not do: turn a zero into a percentage. A step of the way from
// a visit to a request is shown as a count; a share of nothing is left out.

type Lang = 'ka' | 'en' | 'ru';
type Segment = 'petrol' | 'car' | 'electric' | 'other' | 'novice';
type Page = '' | 'models/' | 'subscription/' | 'stations/' | 'am-licence/' | 'how-it-works/' | 'faq/' | 'contacts/';

interface Answer {
  from: string;
  to: string;
  empty: boolean;
  visits: { total: number; byLang: Record<Lang, number> };
  pages: { page: Page; views: number; whatsapp: number }[];
  whatsapp: number;
  requests: { total: number; byLang: Record<Lang, number> };
  answers: { total: number; questions: number[][]; segments: Record<Segment, number> };
  days: { day: string; visits: number; views: number; whatsapp: number; requests: number }[];
}

const PAGE_KEY: Record<Page, 'home' | 'models' | 'subscription' | 'stations' | 'licence' | 'how' | 'faq' | 'contacts'> = {
  '': 'home',
  'models/': 'models',
  'subscription/': 'subscription',
  'stations/': 'stations',
  'am-licence/': 'licence',
  'how-it-works/': 'how',
  'faq/': 'faq',
  'contacts/': 'contacts',
};
const SEGMENT_ORDER: Segment[] = ['petrol', 'car', 'electric', 'other', 'novice'];

export function SiteReportPage() {
  const t = useT();
  const s = t.siteReport;
  const [params, setParams] = useSearchParams();
  const today = todayISO();
  const thisWeek = weekOf(today);
  const thisMonth = monthOf(today);

  const from = params.get('from') ?? thisMonth.from;
  const to = params.get('to') ?? thisMonth.to;
  const which =
    from === thisWeek.from && to === thisWeek.to ? 'week' : from === thisMonth.from && to === thisMonth.to ? 'month' : 'custom';

  const { data, failure, reload } = useLoad<Answer>(`/api/reports/site?${new URLSearchParams({ from, to })}`);
  const pick = (next: { from: string; to: string }) => setParams(new URLSearchParams(next), { replace: true });

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const r = data;
  const views = (p: Page) => r.pages.find((x) => x.page === p)?.views ?? 0;

  const steps: { label: string; n: number }[] = [
    { label: s.stepVisits, n: r.visits.total },
    { label: s.stepGarage, n: views('models/') },
    { label: s.stepBuilder, n: views('subscription/') },
    { label: s.stepWhatsapp, n: r.whatsapp },
    { label: s.stepRequests, n: r.requests.total },
  ];

  return (
    <>
      <PageHead wrap title={s.title} sub={s.period(fmtDate(r.from), fmtDate(r.to))} note={s.subtitle} />

      <div className="chips week-period">
        <button type="button" className={`chip ${which === 'week' ? 'on' : ''}`} onClick={() => pick(thisWeek)}>
          {s.week}
        </button>
        <button type="button" className={`chip ${which === 'month' ? 'on' : ''}`} onClick={() => pick(thisMonth)}>
          {s.month}
        </button>
        <input
          className="chip chip-date"
          type="date"
          aria-label={s.from}
          value={from}
          max={to}
          onChange={(e) => e.target.value && pick({ from: e.target.value, to })}
        />
        <input
          className="chip chip-date"
          type="date"
          aria-label={s.to}
          value={to}
          min={from}
          onChange={(e) => e.target.value && pick({ from, to: e.target.value })}
        />
      </div>

      {r.empty ? (
        <section className="card">
          <Empty text={s.empty} />
        </section>
      ) : (
        <>
          <section className="card util-total">
            <p className="util-hero">{r.visits.total}</p>
            <p className="hint">
              {s.visits} · {s.byLang(r.visits.byLang.ka, r.visits.byLang.en)}
            </p>
          </section>

          <section className="card">
            <BlockHead title={s.funnel} note={s.stepsNote} />
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {steps.map((x) => (
                    <tr key={x.label}>
                      <td>{x.label}</td>
                      <td className="num mono">{x.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <BlockHead title={s.pages} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{s.page}</th>
                    <th className="num">{s.opened}</th>
                    <th className="num">{s.whatsapp}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.pages.map((p) => (
                    <tr key={p.page || 'home'}>
                      <td>{s.pageNames[PAGE_KEY[p.page]]}</td>
                      <td className="num mono">{p.views}</td>
                      <td className="num mono">{p.whatsapp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="card">
            <BlockHead title={s.answers} sub={r.answers.total > 0 ? s.answered(r.answers.total) : undefined} />
            {r.answers.total === 0 ? (
              <Empty text={s.noAnswers} />
            ) : (
              <>
                {s.questions.map((q, i) => (
                  <div className="table-wrap" key={q}>
                    <table className="table">
                      <thead>
                        <tr>
                          <th>{q}</th>
                          <th className="num" />
                        </tr>
                      </thead>
                      <tbody>
                        {(s.options[i] ?? []).map((o, j) => (
                          <tr key={o}>
                            <td>{o}</td>
                            <td className="num mono">{r.answers.questions[i]?.[j] ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{s.segments}</th>
                        <th className="num" />
                      </tr>
                    </thead>
                    <tbody>
                      {SEGMENT_ORDER.map((g) => (
                        <tr key={g}>
                          <td>{s.segmentNames[g]}</td>
                          <td className="num mono">{r.answers.segments[g]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section className="card">
            <BlockHead title={s.byDay} />
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>{s.day}</th>
                    <th className="num">{s.visits}</th>
                    <th className="num">{s.views}</th>
                    <th className="num">{s.whatsapp}</th>
                    <th className="num">{s.requests}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.days.map((d) => (
                    <tr key={d.day}>
                      <td>{fmtDate(d.day)}</td>
                      <td className="num mono">{d.visits}</td>
                      <td className="num mono">{d.views}</td>
                      <td className="num mono">{d.whatsapp}</td>
                      <td className="num mono">{d.requests}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </>
  );
}
