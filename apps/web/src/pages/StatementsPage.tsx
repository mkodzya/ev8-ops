import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BlockHead, Empty, Loading, PageHead } from '../components/ui.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { LoadError } from '../components/LoadError.js';

type Bank = 'bog' | 'tbc' | 'credo';

interface Statements {
  queue: number;
  statements: {
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
  }[];
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
  const [done, setDone] = useState<string | null>(null);
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
    setDone(null);
    setPending(null);
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

  /** Step three: the same text, now kept. */
  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post<{ newLines: number; matched: number; unmatched: number }>('/api/statements', {
        fileName: pending.fileName,
        text: pending.text,
      });
      setDone(t.statements.result(String(res.newLines), String(res.matched), String(res.unmatched)));
      setPending(null);
      reloadAll();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead wrap title={t.statements.title} sub={t.statements.count(statements.data?.statements.length ?? 0)} note={t.statements.uploadHint}>
        <label className="pill pill-sm pill-accent">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void choose(e.target.files)} />
          {busy ? t.common.checking : `+ ${t.statements.upload}`}
        </label>
      </PageHead>
      {done && <div className="hint">{done}</div>}
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
          <div className="row-actions">
            <button type="button" className="pill" onClick={() => setPending(null)} disabled={busy}>
              {t.actions.cancel}
            </button>
            <button type="button" className="pill pill-accent" onClick={() => void confirm()} disabled={busy || pending.preview.newLines === 0}>
              {busy ? t.common.checking : t.statements.previewConfirm}
            </button>
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
              <QueueItem key={l.id} line={l} onDone={reloadAll} onError={setErr} />
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <BlockHead title={t.statements.title} sub={statements.data ? t.statements.count(statements.data.statements.length) : undefined} />
        {!statements.data ? (
          statements.failure ? <LoadError failure={statements.failure} onRetry={statements.reload} /> : <Loading />
        ) : statements.data.statements.length === 0 ? (
          <Empty text={t.statements.none} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.statements.bank}</th>
                  <th>{t.statements.file}</th>
                  <th>{t.statements.period}</th>
                  <th className="num">{t.statements.lines}</th>
                  <th className="num">{t.statements.newLines}</th>
                  <th className="num">{t.statements.matched}</th>
                  <th>{t.statements.loadedBy}</th>
                </tr>
              </thead>
              <tbody>
                {statements.data.statements.map((s) => (
                  <tr key={s.id}>
                    <td>{t.statements.banks[s.bank]}</td>
                    <td className="muted">{s.fileName}</td>
                    <td className="mono">
                      {fmtDate(s.periodFrom)} — {fmtDate(s.periodTo)}
                    </td>
                    <td className="num mono">{s.lineCount}</td>
                    <td className="num mono">{s.newLines}</td>
                    <td className="num mono">{s.matched}</td>
                    <td>{s.uploadedBy ?? t.common.dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

/**
 * One unplaced line. Opening it asks the API what it might belong to, so
 * answering is a choice between named rentals rather than a search (PAY-03).
 */
export function QueueItem({ line, onDone, onError }: { line: QueueLine; onDone: () => void; onError: (e: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [reason, setReason] = useState('');

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onDone();
    } catch (e) {
      onError(errorText(e));
    }
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
            onClick={() => void act(() => api.post(`/api/statement-lines/${line.id}/assign`, { rentalId: line.hints[0].rentalId }))}
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
                    <button type="button" onClick={() => void act(() => api.post(`/api/statement-lines/${line.id}/assign`, { rentalId: h.rentalId }))}>
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
                    <button
                      type="button"
                      className="pill pill-sm pill-accent"
                      disabled={!reason.trim()}
                      onClick={() => void act(() => api.post(`/api/statement-lines/${line.id}/ignore`, { reason }))}
                    >
                      {t.actions.confirm}
                    </button>
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
