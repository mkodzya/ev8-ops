import { addDays, localDateTime, monthOf, todayISO } from '@ev8/shared';
import { Fragment, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../../api.js';
import { LoadError } from '../../components/LoadError.js';
import { BlockHead, PageHead } from '../../components/ui.js';
import { SubmitButton } from '../../ds/form/Form.js';
import '../../ds/form/form.css';
import { useOperation } from '../../ds/form/operation.js';
import '../../ds/money/money.css';
import { Skeleton } from '../../ds/state/Skeleton.js';
import { fmtDate, fmtDateAt, fmtDayMonth, formatMinor } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { errorText, useLoad } from '../../lib/use.js';

type Bank = 'bog' | 'tbc' | 'credo';
type Why = 'unauthorized' | 'forbidden' | 'not_found' | 'user_inactive' | 'rate_limited' | 'http' | 'network' | 'bad_answer' | 'no_account' | 'mismatch';

/** A bank read through its API (B11-03; Bank of Georgia, TBC): how the link stands. */
interface BankApi {
  freshness: 'ok' | 'silent' | 'waiting';
  lastOkAt: string | null;
  failure: Why | null;
  nightThrough: string | null;
  nightFailure: Why | null;
  /** TBC: the first day whose movements did not add up to the bank's sums at the last nightly reading. */
  nightMismatchOn?: string | null;
}

/** An account of the bank in another currency (decision D1 of docs/spec/usd-accounts-plan.md), by its last four digits. */
interface Pair {
  last4: string;
  currency: string;
  api: BankApi;
}

interface Statements {
  queue: number;
  staleDays: number;
  limitBytes: number;
  /** Lines of the accounts in another currency kept; absent while an older API answers. */
  foreignLines?: number;
  banks: { bank: Bank; lastUploadAt: string | null; throughOn: string | null; daysOld: number | null; stale: boolean; never: boolean; api: BankApi | null; accounts?: Pair[] }[];
  statements: { id: string; bank: Bank; fileName: string; currency?: string; periodFrom: string | null; periodTo: string | null; lineCount: number; newLines: number; matched: number; uploadedBy: string | null; createdAt: string }[];
}

/** «Операции в валюте»: each account in another currency with what came in and went out of it in a period, in its own currency. */
interface Foreign {
  from: string;
  to: string;
  accounts: {
    bank: Bank;
    last4: string | null;
    currency: string;
    inMinor: number;
    outMinor: number;
    lines: { id: string; occurredOn: string; direction: 'in' | 'out'; amountMinor: number; payer: string | null; purpose: string | null; raw: string }[];
  }[];
}

/** An account as it is known on this screen: its bank, its currency, its last four digits. */
type Known = { bank: Bank; currency: string; last4: string | null };

/**
 * «Bank of Georgia · USD». The last four digits follow only when the bank has
 * two accounts in that currency: one is named by its currency alone.
 */
function accountName(bank: string, a: Known, known: Known[]): string {
  const twins = new Set(known.filter((k) => k.bank === a.bank && k.currency === a.currency).map((k) => k.last4)).size > 1;
  return [bank, a.currency, twins && a.last4 ? `··${a.last4}` : null].filter(Boolean).join(' · ');
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
function ApiLine({ bank, api }: { bank: 'bog' | 'tbc'; api: BankApi }) {
  const t = useT();
  const w = t.bankApi;
  const service = w.service[bank];
  const why = (f: Why | null) => w.why[f ?? 'http'];
  const at = api.lastOkAt ? localDateTime(api.lastOkAt) : null;
  // No account is a step of setting up, not the bank failing: one quiet line, and what to do meanwhile.
  // The last pull says whether it is still missing; a night that failed for it before it was set does not.
  if (api.failure === 'no_account') return <span className="muted">{w.noAccount(service)}</span>;
  const silent = api.freshness === 'silent';
  const mismatch = api.nightFailure === 'mismatch' && api.nightMismatchOn;
  return (
    <>
      {api.freshness === 'waiting' && <span className="muted">{w.waiting(service)}</span>}
      {api.freshness === 'ok' && at && <span className="muted">{w.freshAt(service, at.date, at.time)}</span>}
      {silent && <span className="warn-text">{at ? w.silentSince(service, why(api.failure), at.date, at.time) : w.silentNever(service, why(api.failure))}</span>}
      {/* The night's failure is said apart only when it is news: not the same reason the line above gives. */}
      {mismatch ? (
        <span className="warn-text">{w.nightMismatch(fmtDate(api.nightMismatchOn))}</span>
      ) : (
        api.nightFailure && api.nightFailure !== 'no_account' && !(silent && api.nightFailure === api.failure) && <span className="warn-text">{w.nightFailed(why(api.nightFailure))}</span>
      )}
    </>
  );
}

/** What «Прочитать сейчас» answers: what came of each bank that is on, account by account, by the last four digits. */
type ReadNow =
  | { status: 'off' }
  | { status: 'busy' }
  | {
      status: 'ok';
      /** When the stand may be asked again, in seconds. */
      seconds: number;
      banks: { bank: 'bog' | 'tbc'; failure: Why | null; accounts: { last4: string; currency: string; added: number; days: string[]; failure: Why | null; later?: boolean }[] }[];
    };

/**
 * «Прочитать сейчас» (Mika, 29.10.2026: «давай сделаем кнопку тоже»): both
 * banks asked at once for the day's operations and the past days not read yet,
 * instead of waiting for the worker; then what came, account by account. The
 * cards, the counts and «Операции в валюте» refresh as after any write. The
 * stand asks at most once a minute, whoever presses, and the button counts
 * the wait down.
 */
function ReadNowBlock({ known }: { known: Known[] }) {
  const t = useT();
  const r = t.bankReadNow;
  const op = useOperation();
  const [said, setSaid] = useState<ReadNow | null>(null);
  const [until, setUntil] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    if (until <= clock) return;
    const tick = window.setTimeout(() => setClock(Date.now()), 1000);
    return () => window.clearTimeout(tick);
  }, [until, clock]);
  const left = Math.max(0, Math.ceil((until - clock) / 1000));
  const wait = (seconds: number) => {
    const at = Date.now();
    setClock(at);
    setUntil(at + seconds * 1000);
  };

  const read = async () => {
    setSaid(null);
    const res = await op.run(async (key) => {
      try {
        return await api.post<ReadNow>('/api/statements/read-now', {}, { key });
      } catch (e) {
        // Asked within the minute, by this person or another: the wait is the server's.
        if (e instanceof ApiError && typeof e.extra.seconds === 'number') wait(e.extra.seconds);
        throw e;
      }
    });
    if (!res.ok) return;
    setSaid(res.value);
    if (res.value.status === 'ok') wait(res.value.seconds);
  };

  const why = (f: Why | null) => t.bankApi.why[f ?? 'http'];
  const banks = said?.status === 'ok' ? said.banks : [];
  const all = [...known, ...banks.flatMap((b) => b.accounts.map((a) => ({ bank: b.bank, currency: a.currency, last4: a.last4 })))];
  // The wait is on the button; once it is over, the words for it are no longer true.
  const failure = op.failure && !(op.failure.code === 'bank_read_too_soon' && left === 0) ? op.failure.text : null;
  return (
    <div className="bank-read">
      <button type="button" className="pill pill-sm" disabled={op.state === 'busy' || left > 0} onClick={() => void read()}>
        {op.state === 'busy' ? r.reading : left > 0 ? r.wait(left) : r.button}
      </button>
      {failure && (
        <p className="field-err" role="alert">
          {failure}
        </p>
      )}
      {said?.status === 'busy' && (
        <p className="warn-text" role="status">
          {r.busy}
        </p>
      )}
      {banks.length > 0 && (
        <ul className="bank-read-list" role="status">
          {banks.flatMap((b) => {
            const name = t.statements.banks[b.bank];
            if (b.accounts.length === 0) return [<li key={b.bank}>{`${name} — ${r.nothingCame(why(b.failure))}`}</li>];
            return b.accounts.map((a) => {
              const came = a.added > 0 || a.days.length > 0;
              const words = [
                a.added > 0 ? r.added(a.added) : came || !a.failure ? r.nothing : null,
                a.days.length > 0 ? r.days(fmtDayMonth(a.days[0]), fmtDayMonth(a.days[a.days.length - 1]), a.days.length) : null,
                a.later ? r.later : null,
                a.failure ? (came ? r.notAll(why(a.failure)) : r.nothingCame(why(a.failure))) : null,
              ];
              return <li key={`${b.bank} ${a.currency} ${a.last4}`}>{`${accountName(name, { bank: b.bank, ...a }, all)} — ${words.filter(Boolean).join(' · ')}`}</li>;
            });
          })}
        </ul>
      )}
    </div>
  );
}

/** A sum that came in or went out, in its own currency and with its sign; nothing has none. */
function signed(minor: number, currency: string, direction: 'in' | 'out'): string {
  return `${minor === 0 ? '' : direction === 'out' ? '−' : '+'}${formatMinor(minor, currency)}`;
}

/**
 * «Операции в валюте» (Mika, 29.10.2026, decision D1 «А» of
 * docs/spec/usd-accounts-plan.md): the lines of the accounts in another
 * currency, read only. Each account sums what came in and went out in its own
 * currency; two currencies are never added up, nor any of them to the lari,
 * and each account says it is in no total in ₾.
 */
function ForeignBlock({ known }: { known: Known[] }) {
  const t = useT();
  const [span, setSpan] = useState<'month' | 'last_month'>('month');
  const month = monthOf(todayISO());
  const period = span === 'month' ? month : monthOf(addDays(month.from, -1));
  const { data, failure, reload } = useLoad<Foreign>(`/api/statement-lines/foreign?from=${period.from}&to=${period.to}`);
  const all = [...known, ...(data?.accounts ?? [])];
  return (
    <section className="card">
      <BlockHead title={t.bankCurrency.title} sub={`${fmtDate(period.from)}–${fmtDate(period.to)}`} note={t.bankCurrency.note} />
      <div className="list-chips" role="tablist">
        {(['month', 'last_month'] as const).map((s) => (
          <button key={s} type="button" role="tab" aria-selected={span === s} className={`list-chip ${span === s ? 'on' : ''}`} onClick={() => setSpan(s)}>
            {t.exp.spans[s]}
          </button>
        ))}
      </div>
      {failure && <LoadError failure={failure} onRetry={reload} />}
      {!data && !failure && <Skeleton rows={2} />}
      {data && data.accounts.length === 0 && <p className="muted fx-empty">{t.bankCurrency.empty}</p>}
      {data?.accounts.map((a) => (
        <div key={`${a.bank} ${a.currency} ${a.last4 ?? ''}`} className="fx-account">
          <div className="fx-head">
            <b>{accountName(t.statements.banks[a.bank], a, all)}</b>
            <span className="muted">{t.bankCurrency.notInGel}</span>
          </div>
          <div className="till-row">
            <span>{t.bankCurrency.in}</span>
            <span className={a.inMinor ? 'mono nowrap amt-in' : 'mono nowrap'}>{signed(a.inMinor, a.currency, 'in')}</span>
          </div>
          <div className="till-row">
            <span>{t.bankCurrency.out}</span>
            <span className="mono nowrap">{signed(a.outMinor, a.currency, 'out')}</span>
          </div>
          <div className="fx-lines">
            {a.lines.map((l) => (
              <div key={l.id} className="till-row">
                <span className="fx-text">
                  {fmtDate(l.occurredOn)}
                  <span className="muted"> · {[l.payer, l.purpose].filter(Boolean).join(' · ') || l.raw}</span>
                </span>
                <span className={`mono nowrap ${l.direction === 'in' ? 'amt-in' : ''}`}>{signed(l.amountMinor, a.currency, l.direction)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
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
  const known: Known[] = (data?.banks ?? []).flatMap((b) => (b.accounts ?? []).map((p) => ({ bank: b.bank, currency: p.currency, last4: p.last4 })));

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
          {data.banks.map((b) => {
            const bank = b.bank;
            const pairs = bank === 'credo' ? [] : (b.accounts ?? []);
            return (
              <Fragment key={bank}>
                <div className={`bank-card ${b.stale ? 'stale' : ''}`}>
                  {/* Once the bank has an account in another currency, its own card says it is the lari's. */}
                  <b>{pairs.length > 0 ? `${t.statements.banks[bank]} · GEL` : t.statements.banks[bank]}</b>
                  {b.never ? (
                    <span className="muted">{t.statements.never}</span>
                  ) : (
                    <>
                      <span>
                        {t.statements.lastUpload(fmtDateAt(b.lastUploadAt))}, {t.statements.through(fmtDate(b.throughOn))}
                      </span>
                      <span className={b.stale ? 'warn-text' : 'muted'}>{b.daysOld != null ? t.statements.daysAgo(b.daysOld) : ''}</span>
                      {b.stale && <span className="warn-text">{t.statements.staleNote(data.staleDays)}</span>}
                    </>
                  )}
                  {b.api && bank !== 'credo' && <ApiLine bank={bank} api={b.api} />}
                </div>
                {bank !== 'credo' &&
                  pairs.map((p) => (
                    <div key={`${p.currency} ${p.last4}`} className="bank-card">
                      <b>{accountName(t.statements.banks[bank], { bank, ...p }, known)}</b>
                      <ApiLine bank={bank} api={p.api} />
                      <span className="muted">{t.bankCurrency.notInGel}</span>
                    </div>
                  ))}
              </Fragment>
            );
          })}
        </div>
      )}
      {/* With the cards: only when a bank comes by its API on this stand — a bank that is off is not asked. */}
      {data?.banks.some((b) => b.bank !== 'credo' && b.api) && <ReadNowBlock known={known} />}

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
            <Link className="pill pill-accent" to="/sort">
              {t.statements.sortN(done.unmatched)}
            </Link>
          )}
        </section>
      )}

      {/* Without an account in another currency, read or kept, the screen is what it was before them. */}
      {data && (known.length > 0 || (data.foreignLines ?? 0) > 0) && <ForeignBlock known={known} />}

      {data && data.statements.length > 0 && (
        <section className="card">
          <BlockHead title={t.statements.uploads} />
          {data.statements.map((s) => (
            <div key={s.id} className="till-row">
              <span>
                {t.statements.banks[s.bank]}
                {s.currency && s.currency !== 'GEL' && <> · {s.currency}</>} · {s.fileName}
                <span className="muted">
                  {' '}
                  · {[s.periodFrom ? `${fmtDate(s.periodFrom)}–${fmtDate(s.periodTo)}` : null, s.uploadedBy, fmtDateAt(s.createdAt)].filter(Boolean).join(' · ')}
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
