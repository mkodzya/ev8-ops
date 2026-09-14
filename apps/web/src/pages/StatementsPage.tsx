import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading } from '../components/ui.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';

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

  const reloadAll = () => {
    statements.reload();
    queue.reload();
  };

  const upload = async (list: FileList | null) => {
    const file = list?.[0];
    if (!file) return;
    setBusy(true);
    setErr(null);
    setDone(null);
    try {
      // Read as text in the browser: the bank exports UTF-8 with a byte-order
      // mark and the parser on the other side wants characters, not bytes.
      const text = await file.text();
      const res = await api.post<{ newLines: number; matched: number; unmatched: number }>('/api/statements', {
        fileName: file.name,
        text,
      });
      setDone(t.statements.result(String(res.newLines), String(res.matched), String(res.unmatched)));
      reloadAll();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
      setBusy(false);
    }
  };

  return (
    <>
      <header className="page-head page-head-wrap">
        <h1>{t.statements.title}</h1>
        <span className="spacer" />
        <label className="pill pill-sm pill-accent">
          <input ref={fileRef} type="file" accept=".csv,text/csv" hidden onChange={(e) => void upload(e.target.files)} />
          {busy ? t.common.checking : `+ ${t.statements.upload}`}
        </label>
      </header>
      <p className="hint muted">{t.statements.uploadHint}</p>
      {done && <div className="hint">{done}</div>}
      {err && <div className="hint hint-bad">{err}</div>}

      <section className="card">
        <h2>
          {t.statements.queue} {statements.data ? <span className="mono muted">{statements.data.queue}</span> : null}
        </h2>
        {!queue.data ? (
          <Loading />
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
        <h2>{t.statements.title}</h2>
        {!statements.data ? (
          <Loading />
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
