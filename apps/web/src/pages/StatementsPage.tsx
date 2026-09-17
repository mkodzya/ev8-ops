import { spellingMatches } from '@ev8/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { LoadError } from '../components/LoadError.js';
import { SubmitButton } from '../ds/form/Form.js';
import '../ds/form/form.css';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { DataList } from '../ds/list/DataList.js';

type Bank = 'bog' | 'tbc' | 'credo';

const BANKS = ['bog', 'tbc', 'credo'] as const;

interface Statement {
  id: string;
  bank: Bank;
  fileName: string;
  account: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  lineCount: number;
  newLines: number;
  matched: number;
  uploadedBy: string | null;
  createdAt: string;
}

interface Statements {
  queue: number;
  statements: Statement[];
}

export interface Hint {
  rentalId: string;
  number: string;
  customer: string;
  why: 'amount' | 'pickup_day' | 'open';
}

export interface Preview {
  bank: Bank;
  account: string | null;
  periodFrom: string | null;
  periodTo: string | null;
  lineCount: number;
  newLines: number;
  alreadyIn: number;
  incoming: number;
  outgoing: number;
  sample: { occurredOn: string; amountTetri: number; direction: 'in' | 'out'; payer: string | null; purpose: string | null }[];
}

export interface QueueLine {
  id: string;
  bank: Bank;
  occurredOn: string;
  amountTetri: number;
  grossTetri: number | null;
  payer: string | null;
  purpose: string | null;
  raw: string;
  fileName: string;
  hints: Hint[];
}

/** Loading statements, and the queue of lines the rules could not place. */
export function StatementsPage() {
  const t = useT();
  const statements = useLoad<Statements>('/api/statements');
  const queue = useLoad<{ lines: QueueLine[] }>('/api/statement-lines');
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const importing = useOperation();
  // Step two of the wizard: what the chosen file would add, and the text it
  // would add it from, held until somebody says yes (U8).
  const [pending, setPending] = useState<{ fileName: string; text: string; preview: Preview } | null>(null);

  const reloadAll = () => {
    statements.reload();
    queue.reload();
  };

  // Step one: read the file and ask the API what it would do with it. The
  // import is the one action on this screen nobody can undo by hand, so it
  // does not happen on a file chooser's change event.
  const choose = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    setPending(null);
    importing.reset();
    try {
      // Read as text in the browser: the bank exports UTF-8 with a byte-order
      // mark and the parser on the other side wants characters, not bytes.
      const text = await file.text();
      const preview = await api.post<Preview>('/api/statements/preview', { fileName: file.name, text });
      setPending({ fileName: file.name, text, preview });
    } catch (e) {
      setErr(errorText(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
      setBusy(false);
    }
  };

  /** Step three: the same text, now kept — once, however many times the button is pressed. */
  const confirm = async () => {
    if (!pending) return;
    const res = await importing.run((key) =>
      api.post<{ newLines: number; matched: number; unmatched: number }>('/api/statements', { fileName: pending.fileName, text: pending.text }, { key }),
    );
    if (!res.ok) return;
    toast({ text: t.statements.result(String(res.value.newLines), String(res.value.matched), String(res.value.unmatched)) });
    setPending(null);
    importing.reset();
    reloadAll();
  };

  return (
    <>
      <PageHead wrap title={t.statements.title} sub={t.statements.count(statements.data?.statements.length ?? 0)} note={t.statements.uploadHint}>
        <label className="pill pill-sm pill-accent">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void choose(e.target.files)} />
          {busy ? t.common.checking : `+ ${t.statements.upload}`}
        </label>
      </PageHead>
      {err && <div className="hint hint-bad">{err}</div>}

      {pending && (
        <section className="card prev-card">
          <BlockHead title={t.statements.previewTitle} />
          <p className="hint muted">
            {pending.fileName} · {t.statements.banks[pending.preview.bank]} · <span className="mono">{fmtDate(pending.preview.periodFrom)} — {fmtDate(pending.preview.periodTo)}</span>
          </p>
          <ul className="prev-nums">
            <li>
              <span className="tile-num">{pending.preview.newLines}</span>
              <span className="tile-lbl">{t.statements.previewNew}</span>
            </li>
            <li>
              <span className="tile-num">{pending.preview.alreadyIn}</span>
              <span className="tile-lbl">{t.statements.previewKnown}</span>
            </li>
            <li>
              <span className="tile-num">{pending.preview.incoming}</span>
              <span className="tile-lbl">{t.statements.previewIn}</span>
            </li>
            <li>
              <span className="tile-num">{pending.preview.outgoing}</span>
              <span className="tile-lbl">{t.statements.previewOut}</span>
            </li>
          </ul>
          {pending.preview.sample.length > 0 && (
            <ul className="timeline prev-sample">
              {pending.preview.sample.map((l, i) => (
                <li key={i}>
                  <span className="mono">{fmtDate(l.occurredOn)}</span>
                  <span>
                    <span className="mono">{formatGel(l.amountTetri)}</span> <span className="muted">{l.payer ?? l.purpose ?? ''}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {importing.failure && (
            <div className="form-banner form-banner-bad" role="alert">
              <div>
                <b>{t.form.notSaved}</b> {importing.failure.text}
              </div>
            </div>
          )}
          <div className="row-actions">
            <button type="button" className="pill" onClick={() => setPending(null)} disabled={importing.state === 'busy'}>
              {t.actions.cancel}
            </button>
            {pending.preview.newLines === 0 ? (
              <button type="button" className="pill pill-accent" disabled>
                {t.statements.previewConfirm}
              </button>
            ) : (
              <SubmitButton type="button" state={importing.state} label={t.statements.previewConfirm} onClick={() => void confirm()} />
            )}
          </div>
        </section>
      )}

      <section className="card">
        <BlockHead title={t.statements.queue} sub={statements.data ? t.statements.linesCount(statements.data.queue) : undefined} />
        {!queue.data ? (
          queue.failure ? <LoadError failure={queue.failure} onRetry={queue.reload} /> : <Loading />
        ) : queue.data.lines.length === 0 ? (
          <Empty text={t.statements.queueNone} />
        ) : (
          <ul className="queue">
            {queue.data.lines.map((l) => (
              <QueueItem key={l.id} line={l} onDone={reloadAll} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <BlockHead title={t.statements.title} sub={statements.data ? t.statements.count(statements.data.statements.length) : undefined} />
        {!statements.data ? (
          statements.failure ? <LoadError failure={statements.failure} onRetry={statements.reload} /> : <Loading />
        ) : (
          <DataList
            rows={statements.data.statements}
            rowKey={(s) => s.id}
            fallback={(a, b) => b.createdAt.localeCompare(a.createdAt)}
            search={{ placeholder: t.lists.statementsSearch, match: (s, q) => spellingMatches(q, [s.fileName, s.account, s.uploadedBy]) }}
            chips={BANKS.map((b) => ({ key: b, label: t.statements.banks[b], test: (s: Statement) => s.bank === b }))}
            empty={{ text: t.statements.none }}
            card={(s) => ({
              title: (
                <>
                  {t.statements.banks[s.bank]} · <span className="mono">{fmtDate(s.periodFrom)} — {fmtDate(s.periodTo)}</span>
                </>
              ),
              sub: (
                <>
                  {s.fileName}
                  {s.uploadedBy && <> · {s.uploadedBy}</>}
                </>
              ),
              right: <span className="mono">{s.newLines} / {s.matched}</span>,
              rightSub: `${t.statements.newLines} / ${t.statements.matched}`,
            })}
            columns={[
              { key: 'bank', label: t.statements.bank, cell: (s) => t.statements.banks[s.bank], sort: { value: (s) => s.bank } },
              { key: 'file', label: t.statements.file, cell: (s) => <span className="muted">{s.fileName}</span>, sort: { value: (s) => s.fileName } },
              {
                key: 'period',
                label: t.statements.period,
                cell: (s) => (
                  <span className="mono">
                    {fmtDate(s.periodFrom)} — {fmtDate(s.periodTo)}
                  </span>
                ),
                sort: { value: (s) => s.periodTo, first: 'desc' },
              },
              { key: 'lines', label: t.statements.lines, num: true, cell: (s) => <span className="mono">{s.lineCount}</span>, sort: { value: (s) => s.lineCount, first: 'desc' } },
              { key: 'newLines', label: t.statements.newLines, num: true, cell: (s) => <span className="mono">{s.newLines}</span>, sort: { value: (s) => s.newLines, first: 'desc' } },
              { key: 'matched', label: t.statements.matched, num: true, cell: (s) => <span className="mono">{s.matched}</span>, sort: { value: (s) => s.matched, first: 'desc' } },
              { key: 'loadedBy', label: t.statements.loadedBy, cell: (s) => <span>{s.uploadedBy ?? t.common.dash}</span>, sort: { value: (s) => s.uploadedBy } },
            ]}
          />
        )}
      </section>
    </>
  );
}

/**
 * One unplaced line. Opening it asks the API what it might belong to, so
 * answering is a choice between named rentals rather than a search (PAY-03).
 */
export function QueueItem({ line, onDone }: { line: QueueLine; onDone: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const [open, setOpen] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [reason, setReason] = useState('');

  // One line, one decision: a second tap while the first is on its way does
  // nothing, and a refusal stays on this line (QA-1-03, QA-1-06).
  const act = async (fn: (key: string) => Promise<unknown>, done: string) => {
    const res = await op.run(fn);
    if (!res.ok) return;
    toast({ text: done });
    onDone();
  };

  return (
    <li className="queue-item">
      <button type="button" className="queue-head" onClick={() => setOpen((v) => !v)}>
        <span className="mono">{fmtDate(line.occurredOn)}</span>
        <span className="mono queue-amount">{formatGel(line.grossTetri ?? line.amountTetri)}</span>
        <span className="queue-text">{line.payer ?? line.purpose ?? line.raw}</span>
      </button>
      {/* The best guess, in the row: a queue you have to open twice to learn
          anything is a queue nobody works through (U7). */}
      {line.hints.length > 0 && (
        <p className="queue-guess">
          <span className="t-label">{t.statements.looksLike}</span>
          <button
            type="button"
            className="pill pill-sm pill-accent"
            onClick={() => void act((key) => api.post(`/api/statement-lines/${line.id}/assign`, { rentalId: line.hints[0].rentalId }, { key }), t.statements.assigned(line.hints[0].number))}
          >
            {line.hints[0].customer} · {line.hints[0].number}
          </button>
          <span className="t-label">{t.statements.why[line.hints[0].why]}</span>
          {line.hints.length > 1 && (
            <button type="button" className="pill pill-sm" onClick={() => setOpen((v) => !v)}>
              {t.statements.otherHints(line.hints.length - 1)}
            </button>
          )}
        </p>
      )}
      {op.failure && <p className="field-err" role="alert">{op.failure.fieldText ?? op.failure.text}</p>}
      {open && (
        <div className="queue-body">
          <p className="hint muted">
            {t.statements.line}: {line.raw}
          </p>
          {(
            <>
              <span className="lbl">{t.statements.hints}</span>
              <ul className="pick-list">
                {line.hints.map((h) => (
                  <li key={h.rentalId}>
                    <button type="button" onClick={() => void act((key) => api.post(`/api/statement-lines/${line.id}/assign`, { rentalId: h.rentalId }, { key }), t.statements.assigned(h.number))}>
                      <span>
                        <span className="mono">{h.number}</span> {h.customer}
                      </span>
                      <span className="muted">{t.statements.why[h.why]}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="row-actions">
                <Link className="pill pill-sm" to="/rentals">
                  {t.nav.rentals}
                </Link>
                {!ignoring ? (
                  <button type="button" className="pill pill-sm" onClick={() => setIgnoring(true)}>
                    {t.statements.ignore}
                  </button>
                ) : (
                  <span className="inline-form">
                    <input className="input input-inline" placeholder={t.statements.ignoreReason} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
                    <SubmitButton
                      small
                      type="button"
                      state={op.state}
                      label={t.actions.confirm}
                      onClick={() => void act((key) => api.post(`/api/statement-lines/${line.id}/ignore`, { reason }, { key }), t.statements.ignored)}
                    />
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}
