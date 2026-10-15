import { localDateTime } from '@ev8/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api.js';
import { LoadError } from '../../components/LoadError.js';
import { BlockHead, PageHead } from '../../components/ui.js';
import { SubmitButton } from '../../ds/form/Form.js';
import '../../ds/form/form.css';
import { useOperation } from '../../ds/form/operation.js';
import '../../ds/money/money.css';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { fmtDate } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { errorText, useLoad } from '../../lib/use.js';

type Bank = 'bog' | 'tbc' | 'credo';
type Why = 'unauthorized' | 'forbidden' | 'not_found' | 'rate_limited' | 'http' | 'network' | 'bad_answer' | 'no_account';

/** Bank of Georgia read through its API (B11-03): how the link stands. */
interface BankApi {
  freshness: 'ok' | 'silent' | 'waiting';
  lastOkAt: string | null;
  failure: Why | null;
  nightThrough: string | null;
  nightFailure: Why | null;
}

interface Statements {
  queue: number;
  staleDays: number;
  limitBytes: number;
  banks: { bank: Bank; lastUploadAt: string | null; throughOn: string | null; daysOld: number | null; stale: boolean; never: boolean; api: BankApi | null }[];
  statements: { id: string; bank: Bank; fileName: string; periodFrom: string | null; periodTo: string | null; lineCount: number; newLines: number; matched: number; uploadedBy: string | null; createdAt: string }[];
}
interface Preview {
  bank: Bank;
  periodFrom: string | null;
  periodTo: string | null;
  lineCount: number;
  newLines: number;
  alreadyIn: number;
  incoming: number;
  outgoing: number;
  recorded: number;
  matched: number;
  unmatched: number;
}
interface Result {
  newLines: number;
  recorded: number;
  matched: number;
  unmatched: number;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;

/** The line under a bank that comes by itself: when it last answered, or why it does not. */
function ApiLine({ api }: { api: BankApi }) {
  const t = useT();
  const w = t.bogApi;
  const why = (f: Why | null) => w.why[f ?? 'http'];
  const at = api.lastOkAt ? localDateTime(api.lastOkAt) : null;
  // No account is a step of setting up, not the bank failing: one quiet line, and what to do meanwhile.
  // The last pull says whether it is still missing; a night that failed for it before it was set does not.
  if (api.failure === 'no_account') return <span className="muted">{w.noAccount}</span>;
  const silent = api.freshness === 'silent';
  return (
    <>
      {api.freshness === 'waiting' && <span className="muted">{w.waiting}</span>}
      {api.freshness === 'ok' && at && <span className="muted">{w.freshAt(at.date, at.time)}</span>}
      {silent && <span className="warn-text">{at ? w.silentSince(why(api.failure), at.date, at.time) : w.silentNever(why(api.failure))}</span>}
      {/* The night's failure is said apart only when it is news: not the same reason the line above gives. */}
      {api.nightFailure && api.nightFailure !== 'no_account' && !(silent && api.nightFailure === api.failure) && <span className="warn-text">{w.nightFailed(why(api.nightFailure))}</span>}
    </>
  );
}

/** Money → Выписки (wave 2 §3.5): how fresh each bank is, and loading a file with a look first. */
export function StatementsPage() {
  const t = useT();
  const { data, failure, reload } = useLoad<Statements>('/api/statements');
  const fileRef = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [pending, setPending] = useState<{ fileName: string; size: number; text: string; preview: Preview } | null>(null);
  const [done, setDone] = useState<Result | null>(null);
  const importing = useOperation();

  if (failure) return <LoadError failure={failure} onRetry={reload} />;

  // Step one: the file is checked here before anything is sent — too big, or
  // not a statement, is said in words and with what to do (QA-1-05).
  const choose = async (list: FileList | null) => {
    const file = list?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file || !data) return;
    setRefusal(null);
    setPending(null);
    setDone(null);
    importing.reset();
    if (file.size > data.limitBytes) {
      setRefusal(t.statements.tooBig(mb(file.size), mb(data.limitBytes)));
      return;
    }
    setReading(true);
    try {
      const text = await file.text();
      const preview = await api.post<Preview>('/api/statements/preview', { fileName: file.name, text });
      if (preview.newLines === 0) setRefusal(t.statements.allKnown);
      else setPending({ fileName: file.name, size: file.size, text, preview });
    } catch (e) {
      setRefusal(e instanceof ApiError && e.code === 'unreadable_statement' ? t.statements.notStatement : errorText(e));
    } finally {
      setReading(false);
    }
  };

  const load = async () => {
    if (!pending) return;
    const res = await importing.run((key) => api.post<Result>('/api/statements', { fileName: pending.fileName, text: pending.text }, { key }));
    if (!res.ok) return;
    setDone(res.value);
    setPending(null);
    importing.reset();
  };

  return (
    <>
      <PageHead wrap title={t.statements.title} note={t.statements.uploadHint}>
        <label className="pill pill-sm pill-accent">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void choose(e.target.files)} />
          {reading ? t.common.checking : `+ ${t.statements.upload}`}
        </label>
      </PageHead>

      {!data && <Skeleton rows={3} />}
      {data && (
        <div className="bank-cards">
          {data.banks.map((b) => (
            <div key={b.bank} className={`bank-card ${b.stale ? 'stale' : ''}`}>
              <b>{t.statements.banks[b.bank]}</b>
              {b.never ? (
                <span className="muted">{t.statements.never}</span>
              ) : (
                <>
                  <span>
                    {t.statements.lastUpload(fmtDate(b.lastUploadAt?.slice(0, 10)))}, {t.statements.through(fmtDate(b.throughOn))}
                  </span>
                  <span className={b.stale ? 'warn-text' : 'muted'}>{b.daysOld != null ? t.statements.daysAgo(b.daysOld) : ''}</span>
                  {b.stale && <span className="warn-text">{t.statements.staleNote(data.staleDays)}</span>}
                </>
              )}
              {b.api && <ApiLine api={b.api} />}
            </div>
          ))}
        </div>
      )}

      {refusal && (
        <div className="form-banner form-banner-bad" role="alert">
          <div>{refusal}</div>
        </div>
      )}

      {pending && (
        <section className="card">
          <BlockHead
            title={t.statements.upload}
            sub={[t.statements.banks[pending.preview.bank], pending.preview.periodFrom ? `${fmtDate(pending.preview.periodFrom)}–${fmtDate(pending.preview.periodTo)}` : null].filter(Boolean).join(' · ')}
          />
          <p className="muted">
            {pending.fileName} · {Math.round(pending.size / 1024)} KB
          </p>
          <dl className="upload-summary">
            <div>
              <dt>{t.statements.previewNew}</dt>
              <dd className="mono">{pending.preview.newLines}</dd>
            </div>
            <div>
              <dt>{t.statements.previewKnown}</dt>
              <dd className="mono">{pending.preview.alreadyIn}</dd>
            </div>
            <div>
              <dt>{t.statements.previewInOut}</dt>
              <dd className="mono">
                {pending.preview.incoming} · {pending.preview.outgoing}
              </dd>
            </div>
            <div>
              <dt>{t.statements.previewRecorded}</dt>
              <dd className="mono">{pending.preview.recorded}</dd>
            </div>
            <div>
              <dt>{t.statements.previewRules}</dt>
              <dd className="mono">{pending.preview.matched}</dd>
            </div>
            <div>
              <dt>{t.statements.previewQueue}</dt>
              <dd className="mono">{pending.preview.unmatched}</dd>
            </div>
          </dl>
          <div className="sort-actions">
            <SubmitButton type="button" state={importing.state} label={t.statements.loadN(pending.preview.newLines)} onClick={load} />
            <button type="button" className="pill" onClick={() => fileRef.current?.click()}>
              {t.statements.otherFile}
            </button>
          </div>
          {importing.failure && <p className="field-err">{importing.failure.text}</p>}
        </section>
      )}

      {done && (
        <section className="card">
          <p className="t-h3">{t.statements.doneN(done.newLines)}</p>
          <p className="muted">{t.statements.doneSummary(done.recorded, done.matched, done.unmatched)}</p>
          {done.unmatched > 0 && (
            <Link className="pill pill-accent" to="/money/sort">
              {t.statements.sortN(done.unmatched)}
            </Link>
          )}
        </section>
      )}

      {data && data.statements.length > 0 && (
        <section className="card">
          <BlockHead title={t.statements.uploads} />
          {data.statements.map((s) => (
            <div key={s.id} className="till-row">
              <span>
                {t.statements.banks[s.bank]} · {s.fileName}
                <span className="muted">
                  {' '}
                  · {[s.periodFrom ? `${fmtDate(s.periodFrom)}–${fmtDate(s.periodTo)}` : null, s.uploadedBy, fmtDate(s.createdAt.slice(0, 10))].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="mono">
                {t.statements.linesCount(s.newLines)} · {s.matched}
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
