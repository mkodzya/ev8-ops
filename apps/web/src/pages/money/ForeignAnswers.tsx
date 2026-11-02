import { formatGel, formatMinor, parseGel } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api.js';
import { RowMenu } from '../../components/RowMenu.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { useOperation } from '../../ds/form/operation.js';
import { fmtDate } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { SupplierSheet, type Categories } from './ExpenseAnswers.js';

// A line of an account in another currency in «Разобрать» (stage 5 of
// docs/spec/usd-accounts-plan.md, migration 0076; Mika, 02.11.2026: «Да,
// начинай»). An owner's only. It is said in its own currency, with the sum in
// lari the bank sent for it — the National Bank of Georgia's official rate of
// its day — in a field the owner may correct; that sum is what the answer
// counts at in the reports (decision D2). Its answers are the ones that are no
// customer's money: rent, a sale, a repair, goods and a deposit are paid in
// lari, and the server refuses them for such a line.

export interface ForeignLine {
  id: string;
  bank: 'bog' | 'tbc' | 'credo';
  direction: 'in' | 'out';
  occurredOn: string;
  currency?: string;
  /** In minor units of `currency`: cents for dollars. */
  amountTetri: number;
  /** The bank's lari for the line; null when the bank sent none (TBC). */
  bankGelTetri?: number | null;
  payer: string | null;
  purpose: string | null;
  raw: string;
  lastCategoryId?: string | null;
  duplicateOf?: { id: string; occurredOn: string; docNo: string | null; status: string } | null;
}

/** A sum typed as lari, `1088.57` or `1 088,57`, as tetri; null for nothing or not a sum. */
const tetriOf = (text: string) => {
  const v = parseGel(text);
  return v != null && v > 0 ? v : null;
};

/** The card of a line in another currency: its sum, the lari it counts at, and its answers. */
export function ForeignLineCard({ line, cats, onNotOurs }: { line: ForeignLine; cats: Categories; onNotOurs: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const busy = op.state === 'busy';
  const currency = line.currency ?? 'USD';
  const sign = line.direction === 'out' ? '−' : '+';
  const bank = line.bankGelTetri ?? null;
  const [gelText, setGelText] = useState(bank != null ? (bank / 100).toFixed(2) : '');
  const [open, setOpen] = useState(false);
  const [pick, setPick] = useState<string | null>(line.lastCategoryId ?? null);
  const [supplier, setSupplier] = useState(false);
  const gel = tetriOf(gelText);
  const rate = gel != null && line.amountTetri > 0 ? `1 ${currency} = ${(gel / line.amountTetri).toFixed(4)} ₾` : null;
  const twin = line.duplicateOf ?? null;
  const restore = () => api.post(`/api/statement-lines/${line.id}/restore`, {});

  /** One tap, one answer, with the lari it counts at; «Отменить» puts the line back. */
  const answer = async (path: string, extra: Record<string, unknown>, text: string) => {
    const body = { ...extra, gelTetri: gel };
    const res = await op.run((key) => api.post(`/api/statement-lines/${line.id}/${path}`, body, { key }), `${path}:${JSON.stringify(body)}`);
    if (res.ok) toast({ text, undo: restore });
  };
  const noGel = gel == null;
  const words = (): string => {
    if (noGel) return bank == null ? t.bankCurrency.sortNoBank : t.bankCurrency.sortBadSum;
    if (bank != null && gel !== bank) return t.bankCurrency.sortCorrected(formatGel(bank));
    return t.bankCurrency.sortBankSum;
  };

  return (
    <article className={`sort-line ${busy ? 'busy' : ''}`} aria-busy={busy}>
      <div className="sort-line-head">
        <span className={`t-money ${line.direction === 'out' ? 'amt-out' : 'amt-in'}`}>
          {sign}
          {formatMinor(line.amountTetri, currency)}
        </span>
        <span className="sort-line-meta">
          {fmtDate(line.occurredOn)} · {t.statements.banks[line.bank]} · {currency}
        </span>
        {line.direction === 'out' && <RowMenu actions={[{ key: 'not', label: t.sort.notOurs, onPick: onNotOurs }]} />}
      </div>
      <p className="sort-line-text">{[line.payer, line.purpose].filter(Boolean).join(' · ') || line.raw}</p>

      {twin && (
        <>
          <p className="sort-reason">{t.dup.looksLike(fmtDate(twin.occurredOn), twin.docNo ?? '')}</p>
          <div className="sort-actions">
            <button type="button" className="pill pill-sm pill-accent" disabled={busy} onClick={() => void answer('duplicate', {}, t.dup.done)}>
              {t.dup.yes}
            </button>
          </div>
        </>
      )}

      <div className="fx-gel">
        <label className="fx-gel-label" htmlFor={`gel-${line.id}`}>
          {t.bankCurrency.sortInLari}
        </label>
        <input id={`gel-${line.id}`} className="input mono fx-gel-input" inputMode="decimal" value={gelText} onChange={(e) => setGelText(e.target.value)} aria-describedby={`gel-why-${line.id}`} />
        <p id={`gel-why-${line.id}`} className={noGel ? 'field-err' : 'hint muted'}>
          {words()}
          {rate && <span className="mono"> · {rate}</span>}
        </p>
      </div>

      {line.direction === 'out' ? (
        <div className="sort-actions">
          <button type="button" className={`pill pill-sm ${open ? 'on' : twin ? '' : 'pill-accent'}`} disabled={busy || noGel} onClick={() => setOpen(!open)} aria-expanded={open}>
            {t.exp.spend} {open ? '▾' : '▸'}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy || noGel} onClick={() => setSupplier(true)}>
            {t.exp.supplier}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy || noGel} onClick={() => void answer('fx-exchange', {}, t.bankCurrency.sortExchangeDone)}>
            {t.bankCurrency.sortExchange}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy || noGel} onClick={() => void answer('own-transfer', {}, t.exp.ownTransferDone)}>
            {t.exp.ownTransfer}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy || noGel} onClick={() => void answer('shareholder', {}, t.exp.shareholderDone)}>
            {t.exp.shareholder}
          </button>
        </div>
      ) : (
        <div className="sort-actions">
          <button type="button" className="pill pill-sm" disabled={busy || noGel} onClick={() => void answer('fx-exchange', {}, t.bankCurrency.sortExchangeDone)}>
            {t.bankCurrency.sortExchange}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy || noGel} onClick={() => void answer('own-transfer', {}, t.exp.ownTransferDone)}>
            {t.inc.kinds.own}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy || noGel} onClick={() => void answer('founder-equity', {}, t.inc.founderDone)}>
            {t.inc.kinds.founder}
          </button>
          <button type="button" className={`pill pill-sm ${open ? 'on' : ''}`} disabled={busy || noGel} onClick={() => setOpen(!open)} aria-expanded={open}>
            {t.inc.kinds.other} {open ? '▾' : '▸'}
          </button>
          <button type="button" className="pill pill-sm" disabled={busy} onClick={onNotOurs}>
            {t.sort.notOurs}
          </button>
        </div>
      )}

      {open && (
        <div className="exp-panel">
          <p className="hint muted">{line.direction === 'out' ? t.exp.forWhat : t.inc.otherWhat}</p>
          <div className="chips" role="radiogroup" aria-label={line.direction === 'out' ? t.exp.forWhat : t.inc.otherWhat}>
            {cats.list.map((c) => (
              <button key={c.id} type="button" role="radio" aria-checked={pick === c.id} className={`pill pill-sm ${pick === c.id ? 'on' : ''}`} onClick={() => setPick(c.id)}>
                {cats.nameOf(c.id)}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="pill pill-sm pill-accent pill-wide"
            disabled={busy || !pick || noGel}
            onClick={() => {
              if (!pick) return;
              const name = cats.nameOf(pick);
              if (line.direction === 'out') void answer('expense', { categoryId: pick }, t.exp.saved(name, 0));
              else void answer('other-income', { categoryId: pick }, t.inc.otherDone(name));
            }}
          >
            {pick ? (line.direction === 'out' ? t.exp.save(cats.nameOf(pick)) : t.inc.otherSave(cats.nameOf(pick))) : t.exp.chooseFirst}
          </button>
        </div>
      )}
      {supplier && gel != null && <SupplierSheet line={line} gelTetri={gel} onClose={() => setSupplier(false)} />}
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
    </article>
  );
}

/** A currency of the accounts in a report (0076), as the API says it. */
export interface ForeignInReport {
  currency: string;
  sortedMinor: number;
  sortedGelTetri: number;
  waitingMinor: number;
  waitingLines: number;
}

/**
 * «В валюте» under a report (migration 0076): what of each currency was
 * sorted, in its own sum and the lari it is counted at in the rows above, and
 * what still waits in «Разобрать» — that, in no total in lari.
 */
export function ForeignInReports({ foreign, sortTo, unsorted }: { foreign: ForeignInReport[] | undefined; sortTo: string; unsorted: (n: number) => string }) {
  const t = useT();
  const shown = (foreign ?? []).filter((f) => f.sortedMinor > 0 || f.waitingLines > 0);
  if (shown.length === 0) return null;
  return (
    <section className="card">
      <h2 className="t-h3">{t.bankCurrency.sortGroup}</h2>
      {shown.map((f) => (
        <div key={f.currency}>
          {f.sortedMinor > 0 && (
            <div className="kv">
              <span className="kv-k">{t.bankCurrency.reportSorted}</span>
              <span className="mono">
                {formatMinor(f.sortedMinor, f.currency)} = {formatGel(f.sortedGelTetri)}
              </span>
            </div>
          )}
          {f.waitingLines > 0 && (
            <div className="kv">
              <span className="kv-k">
                {unsorted(f.waitingLines)} · <Link to={sortTo}>{t.exp.openSort}</Link>
              </span>
              <span className="mono">{formatMinor(f.waitingMinor, f.currency)}</span>
            </div>
          )}
        </div>
      ))}
      <p className="hint muted">{t.bankCurrency.reportNote}</p>
    </section>
  );
}
