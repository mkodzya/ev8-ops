import { localDateTime } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../i18n/index.js';
import { ChangedFromTo, noteWords } from '../lib/journal.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

// "История изменений" on a record's card (wave 6 §3.8, crit. 17а, 17б).
//
// A block under the feed, not a chip inside it. The card answers two
// questions and they are not the same one: the feed says what happened to
// this rental — payments, acts, documents — and this says who changed it.
// A chip that swapped the columns would be lying about being a chip, and a
// chip that opens nothing for a manager is worse than a block a manager
// never sees (designer, 22.09.2026).
//
// The rows come from the journal's own route, sliced by the record **and its
// parts**: a deposit decision is written on the deposit, a signature on the
// act, and a person who made them inside a rental looks for them there.

interface Line {
  id: string;
  at: string;
  action: string;
  actorName: string | null;
  before: unknown;
  after: unknown;
  note: string | null;
  kind: 'change' | 'event';
  times: number;
}

export function RecordHistory({ kind, id, search }: { kind: 'rental' | 'sale' | 'purchase' | 'service_job' | 'vehicle' | 'customer'; id: string; search: string }) {
  const t = useT();
  const { can } = useSession();
  const [open, setOpen] = useState(false);
  // A manager has no block at all — not an empty one, not a refusal. The
  // request is not made either: the route would answer 403 (crit. 17б).
  const mayRead = can('users.manage');
  const history = useLoad<{ rows: Line[] }>(mayRead ? `/api/journal?record=${kind}:${id}` : null);
  if (!mayRead) return null;

  const rows = history.data?.rows ?? [];
  const when = (at: string) => {
    const d = localDateTime(at);
    return `${d.date} ${d.time}`;
  };

  return (
    <section className="card">
      {/* The whole heading opens it, not the count beside it. A counter is as
          wide as its digits — 34 px for "4" and narrower for "2" — and
          `ux.md` №13 asks for 44. A target that shrinks as a record has less
          history is the wrong shape for the rule; the heading is always as
          wide as the block (QA-W6-22). */}
      <button type="button" className="queue-head history-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <h2>{t.recordHistory.title}</h2>
        <span className="pill pill-sm">{rows.length}</span>
      </button>
      {open && (
        <>
          {rows.length === 0 ? (
            <p className="empty">{t.recordHistory.none}</p>
          ) : (
            <ul className="timeline">
              {rows.map((l) => (
                <li key={l.id}>
                  <span className="mono muted">{when(l.at)}</span>
                  <span>
                    {t.feedWords[l.action] ?? l.action}
                    {l.kind === 'change' && <ChangedFromTo action={l.action} before={l.before} after={l.after} />}
                    {l.actorName && <span className="muted"> · {l.actorName}</span>}
                    {noteWords(t, l.note, l.after) && <span className="muted"> · «{noteWords(t, l.note, l.after)}»</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link className="pill pill-sm" to={`/settings/journal?q=${encodeURIComponent(search)}`}>
            {t.recordHistory.openJournal}
          </Link>
        </>
      )}
    </section>
  );
}
