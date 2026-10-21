import { JOURNAL_FILTERS, localDateTime, type JournalFilter } from '@ev8/shared';
import { useSearchParams } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { Empty, Loading, PageHead } from '../components/ui.js';
import { useT } from '../i18n/index.js';
import { ChangedFromTo, JournalNote, noteWords } from '../lib/journal.js';
import { useLoad } from '../lib/use.js';

// Settings → Journal (wave 6 §3.8, B9-01, X3).
//
// The cards have shown their own slice of `audit_log` since wave 5, which
// answers "what happened to this rental". This screen answers the other
// question — who has been changing prices, who signed in, who looked at a
// personal number — and it is one screen, because "кто это сделал" does not
// split in two.
//
// A line with no "было" shows a dash rather than an empty cell: the column
// exists for every row, and a blank one reads as a bug.

interface Line {
  id: string;
  at: string;
  action: string;
  actorName: string | null;
  entityType: string;
  entityId: string | null;
  number: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  kind: 'change' | 'event';
  times: number;
}

// The company's clock, not the reader's and not the server's (QA-W6-18).
// The date used to come off the ISO string, which is UTC, and the time from
// whatever zone the laptop was in: after midnight in London the two named
// different days, and the period filter dropped the row.
const hhmm = (at: string) => localDateTime(at).time;
const when = (at: string) => {
  const { date, time } = localDateTime(at);
  return `${date} ${time}`;
};

export function JournalPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const filter = (params.get('filter') ?? 'all') as JournalFilter;
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';

  // The search and the period live in the address, so a screen can be sent
  // to somebody (ux №4).
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const query = new URLSearchParams();
  if (q) query.set('q', q);
  if (filter !== 'all') query.set('filter', filter);
  if (from) query.set('from', from);
  if (to) query.set('to', to);
  const suffix = query.toString() ? `?${query}` : '';
  const journal = useLoad<{ rows: Line[] }>(`/api/journal${suffix}`);

  // One dictionary for the feed on a card and for the journal, so the same
  // event does not read two ways (QA-W6-09). `actions-guard` fails the build
  // when the API writes an action nobody has words for.
  const words = (l: Line) => t.feedWords[l.action] ?? l.action;

  return (
    <>
      <PageHead title={t.journalPage.title} sub={t.journalPage.subtitle}>
        <a className="pill pill-sm" href={`/api/journal.csv${suffix}`} download>
          {t.journalPage.export}
        </a>
      </PageHead>

      <div className="list-toolbar">
        <input
          className="input"
          type="search"
          value={q}
          placeholder={t.journalPage.search}
          aria-label={t.journalPage.search}
          onChange={(e) => set('q', e.target.value)}
        />
        <div className="chips">
          {JOURNAL_FILTERS.map((f) => (
            <button key={f} type="button" className={`chip ${f === filter ? 'on' : ''}`} onClick={() => set('filter', f === 'all' ? '' : f)}>
              {t.journalPage.filters[f]}
            </button>
          ))}
          <input className="chip chip-date" type="date" aria-label={t.journalPage.from} value={from} max={to || undefined} onChange={(e) => set('from', e.target.value)} />
          <input className="chip chip-date" type="date" aria-label={t.journalPage.to} value={to} min={from || undefined} onChange={(e) => set('to', e.target.value)} />
        </div>
      </div>

      {!journal.data ? (
        journal.failure ? <LoadError failure={journal.failure} onRetry={journal.reload} /> : <Loading />
      ) : journal.data.rows.length === 0 ? (
        <Empty text={t.journalPage.empty} />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t.journalPage.when}</th>
                <th>{t.journalPage.who}</th>
                <th>{t.journalPage.what}</th>
                <th>{t.journalPage.record}</th>
                <th>{t.journalPage.was}</th>
                <th>{t.journalPage.why}</th>
              </tr>
            </thead>
            <tbody>
              {journal.data.rows.map((l) => (
                <tr key={l.id}>
                  <td className="nowrap">{when(l.at)}</td>
                  <td>{l.actorName ?? <span className="muted">{t.journalPage.nobody}</span>}</td>
                  <td>
                    {words(l)}
                    {l.times > 1 && <span className="muted"> · {t.journalPage.times(l.times, hhmm(l.at))}</span>}
                    {typeof (l.after as { attempt?: number } | null)?.attempt === 'number' && (
                      <span className="muted"> · {t.journalPage.attempt((l.after as { attempt: number }).attempt)}</span>
                    )}
                    {(l.after as { ip?: string } | null)?.ip && <span className="muted"> · {t.journalPage.ip((l.after as { ip: string }).ip)}</span>}
                  </td>
                  <td className="mono">{l.number ?? <span className="muted">{t.common.dash}</span>}</td>
                  <td>
                    {/* An event has no "было": the dash is the answer, not a
                        missing value (§3.8). */}
                    {l.kind === 'event' ? <span className="muted">{t.common.dash}</span> : <ChangedFromTo before={l.before} after={l.after} />}
                  </td>
                  <td>{noteWords(t, l.note, l.after) ? <JournalNote note={l.note} after={l.after} /> : <span className="muted">{t.common.dash}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
