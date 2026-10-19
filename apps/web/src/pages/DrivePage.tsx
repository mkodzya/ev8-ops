import { formatGel, localDateTime } from '@ev8/shared';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { useToast } from '../ds/feedback/Toast.js';
import { useOperation } from '../ds/form/operation.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';

// The rentals folders in Google Drive beside the rentals here (Mika,
// 19.10.2026, variant A; ADR-0031). Drive is where the contracts and the
// return acts are filed; this screen shows where Drive and the rentals here
// disagree — a return Drive has, a folder with no rental, a rental with no
// folder — and how old the reading is. Nothing here writes to Drive.

interface Reconciliation {
  on: boolean;
  lastOkAt: string | null;
  lastTryAt: string | null;
  failure: string | null;
  folders: number;
  matched: number;
  returnedThere: {
    folder: { name: string; url: string | null };
    rental: { id: string; number: string; customer: { id: string; name: string } };
    act: { url: string | null; returnedOn: string | null; contractOn: string | null; vin: string | null; depositTetri: number | null; withheldTetri: number | null; paidBackTetri: number | null } | null;
  }[];
  missingHere: { id: string; name: string; url: string | null; datedOn: string | null; contract: { url: string | null; signedOn: string | null; vin: string | null } | null }[];
  missingThere: { id: string; number: string; customer: { id: string; name: string }; pickedUpOn: string | null; vin: string | null }[];
}

export function DrivePage() {
  const t = useT();
  const d = t.drive;
  const toast = useToast();
  const op = useOperation();
  const r = useLoad<Reconciliation>('/api/drive/reconciliation');

  if (!r.data) {
    return (
      <>
        <PageHead title={d.title} sub={d.subtitle} />
        {r.failure ? <LoadError failure={r.failure} onRetry={r.reload} /> : <Loading />}
      </>
    );
  }
  const x = r.data;
  if (!x.on) {
    return (
      <>
        <PageHead title={d.title} sub={d.subtitle} />
        <section className="card">
          <Empty text={d.off} />
        </section>
      </>
    );
  }
  const at = x.lastOkAt ? localDateTime(x.lastOkAt) : null;
  const gel = (v: number | null) => (v == null ? '—' : formatGel(v, { decimals: false }));
  const readNow = async () => {
    const res = await op.run((key) => api.post<{ status: string; folders?: number; failure?: string }>('/api/drive/scan', {}, { key }));
    if (!res.ok) return;
    if (res.value.status === 'ok') toast({ text: d.readDone(res.value.folders ?? 0) });
    r.reload();
  };

  return (
    <>
      <PageHead title={d.title} sub={d.subtitle} />

      <section className="card">
        <p className={x.failure ? 'warn-text' : 'muted'}>{at ? d.readAt(at.date, at.time) : d.never}</p>
        {x.failure && <p className="warn-text">{d.failed(d.failures[x.failure] ?? x.failure)}</p>}
        {at && <p>{d.summary(x.folders, x.matched)}</p>}
        <button type="button" className="pill pill-sm" disabled={op.state === 'busy'} onClick={() => void readNow()}>
          {op.state === 'busy' ? d.reading : d.readNow}
        </button>
        {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
      </section>

      {at && (
        <>
          <section className="card queue-card">
            <BlockHead title={`${d.returnedThere} — ${x.returnedThere.length}`} note={x.returnedThere.length > 0 ? d.returnedThereNote : undefined} />
            {x.returnedThere.length === 0 ? (
              <Empty text={d.nothing} />
            ) : (
              <ul className="queue">
                {x.returnedThere.map((row) => (
                  <li key={row.rental.id} className="q-row">
                    <Link to={`/rentals/${row.rental.id}`} className="q-who">
                      <span className="q-name">{row.rental.customer.name}</span>
                      <span className="q-sub muted">
                        {[
                          row.rental.number,
                          row.act?.returnedOn ? d.act(fmtDate(row.act.returnedOn)) : d.noAct,
                          row.act && row.act.depositTetri != null ? d.deposit(gel(row.act.depositTetri), gel(row.act.withheldTetri), gel(row.act.paidBackTetri)) : '',
                          row.act?.vin ? `···${row.act.vin.slice(-4)}` : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </Link>
                    {(row.act?.url ?? row.folder.url) && (
                      <span className="q-acts">
                        <a className="pill pill-sm" href={(row.act?.url ?? row.folder.url)!} target="_blank" rel="noreferrer">
                          {d.open}
                        </a>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card queue-card">
            <BlockHead title={`${d.missingHere} — ${x.missingHere.length}`} note={x.missingHere.length > 0 ? d.missingHereNote : undefined} />
            {x.missingHere.length === 0 ? (
              <Empty text={d.nothing} />
            ) : (
              <ul className="queue">
                {x.missingHere.map((f) => (
                  <li key={f.id} className="q-row">
                    <span className="q-who">
                      <span className="q-name">{f.name}</span>
                      <span className="q-sub muted">
                        {[f.contract?.signedOn ? d.contractOf(fmtDate(f.contract.signedOn)) : '', f.contract?.vin ? `···${f.contract.vin.slice(-4)}` : ''].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <span className="q-acts">
                      {/* The hand-over wizard, filled in from the contract (Mika, 19.10.2026). */}
                      <Link className="pill pill-sm pill-accent" to={`/rentals/new?drive=${encodeURIComponent(f.id)}`}>
                        {d.newRental}
                      </Link>
                      {f.url && (
                        <a className="pill pill-sm" href={f.url} target="_blank" rel="noreferrer">
                          {d.open}
                        </a>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card queue-card">
            <BlockHead title={`${d.missingThere} — ${x.missingThere.length}`} note={x.missingThere.length > 0 ? d.missingThereNote : undefined} />
            {x.missingThere.length === 0 ? (
              <Empty text={d.nothing} />
            ) : (
              <ul className="queue">
                {x.missingThere.map((m) => (
                  <li key={m.id} className="q-row">
                    <Link to={`/rentals/${m.id}`} className="q-who">
                      <span className="q-name">{m.customer.name}</span>
                      <span className="q-sub muted">{[m.number, m.pickedUpOn ? fmtDate(m.pickedUpOn) : '', m.vin ? `···${m.vin.slice(-4)}` : ''].filter(Boolean).join(' · ')}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </>
  );
}
