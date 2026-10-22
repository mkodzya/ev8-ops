import { GROUNDS, NO_DECISION, decisionBody, decisionOk, gelFromTetri, keptOf, type DecisionState, type Ground } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Drawer } from './Drawer.js';
import { SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { Field, Row } from './Wizard.js';

// What a return comes to and what happens to the deposit (wave 3 §3.4 step 2,
// §3.5): the same lines and the same choice in the wizard and in "Decide later".

// The grounds, the decision and its rules live in `@ev8/shared`, where they
// have tests: they decide money (QA-W6-16).
export { GROUNDS, NO_DECISION, decisionBody, decisionOk, keptOf, needsConfirming, type DecisionState, type Ground } from '@ev8/shared';

export interface ReturnPreview {
  batteries: number | null;
  chargers: number | null;
  pickupKm: number | null;
  /** The day the moped coming back was handed out — the hand-over, or the swap that brought it (ADR-0040); absent while an older API answers. */
  pickupOn?: string | null;
  expectedReturnOn: string | null;
  settlement: {
    weeks: { id: string; seq: number; startsOn: string; endsOn: string; owesTetri: number }[];
    replacedWeeks: { id: string; seq: number; owesTetri: number }[];
    late: null | { days: number; perDayTetri: number; amountTetri: number; weekTetri: number; startsOn: string; endsOn: string };
    choice: 'week' | 'late' | null;
    keyTetri: number;
    claimsTetri: number;
  };
  otherChargesTetri: number;
  deposit: null | {
    amountTetri: number;
    receivedTetri: number;
    withholdings: { source: string; amountTetri: number; number: string | null; reason: string }[];
    withheldTetri: number;
    paidOutTetri: number;
    heldTetri: number;
    decided: boolean;
  };
}

/** Everything owed at the return: the weeks or the delay, the key, what earlier returns charged. */
export const claimsOf = (p: ReturnPreview) => p.settlement.claimsTetri + p.otherChargesTetri;

const short = (iso: string) => fmtDate(iso).slice(0, 5);
const money = (n: number) => <span className="mono">{formatGel(n)}</span>;

/** The settlement, line by line (B5-04, B5-05, Q17). `onChoice` only for an owner. */
export function SettlementLines({
  preview,
  paidThrough,
  lost = [],
  onChoice,
}: {
  preview: ReturnPreview;
  paidThrough: string | null;
  lost?: string[];
  onChoice?: (c: 'week' | 'late') => void;
}) {
  const t = useT();
  const s = preview.settlement;
  const replaced = new Set(s.replacedWeeks.map((w) => w.id));
  const d = preview.deposit;
  return (
    <section className="card settle">
      {s.weeks
        .filter((w) => !replaced.has(w.id))
        .map((w) => (
          <Row key={w.id} k={`${t.back.weekLine(short(w.startsOn), short(w.endsOn))} · ${t.back.weekBegun}`} v={money(w.owesTetri)} />
        ))}
      {s.late && (
        <div className="late-choice">
          <span className="lbl">{t.back.lateTitle(fmtDate(paidThrough))}</span>
          {(['week', 'late'] as const).map((c) => {
            const label = c === 'week' ? t.back.lateWeek(short(s.late!.startsOn), short(s.late!.endsOn)) : t.back.lateDays(s.late!.days, formatGel(s.late!.perDayTetri, { decimals: false }));
            return (
              <label key={c} className={`radio-row ${s.choice === c ? 'on' : ''}`}>
                <input type="radio" name="late" checked={s.choice === c} disabled={!onChoice} onChange={() => onChoice?.(c)} />
                <span>{label}</span>
                {money(c === 'week' ? s.late!.weekTetri : s.late!.amountTetri)}
              </label>
            );
          })}
          <span className="hint muted">
            {t.back.latePlanned(fmtDate(preview.expectedReturnOn))} {!onChoice && t.back.lateOwner}
          </span>
        </div>
      )}
      {s.keyTetri > 0 && <Row k={t.back.keyFee} v={money(s.keyTetri)} />}
      {lost.map((what) => (
        <Row key={what} k={t.back.lostNoSum(what)} v={<span className="muted">—</span>} />
      ))}
      {preview.otherChargesTetri > 0 && <Row k={t.back.otherCharges} v={money(preview.otherChargesTetri)} />}
      {d?.withholdings.map((w, i) => <Row key={i} k={t.back.alreadyWithheld(w.number ?? '')} v={<span className="mono muted">{formatGel(w.amountTetri)}</span>} />)}
      <div className="kv kv-total">
        <span className="kv-k">{t.back.claims}</span>
        <span className="kv-v t-money">{formatGel(claimsOf(preview))}</span>
      </div>
      {d && (
        <>
          <Row k={t.back.depositReceived} v={money(d.receivedTetri)} />
          <Row k={t.back.depositLeft} v={money(d.heldTetri)} />
        </>
      )}
    </section>
  );
}


/** Return all · keep part · keep all — no default (B5-02); one owner decides (D18). */
export function DepositDecision({ value, onChange, heldTetri, claimsTetri, suggest }: { value: DecisionState; onChange: (d: DecisionState) => void; heldTetri: number; claimsTetri: number; suggest: Ground[] }) {
  const t = useT();
  const set = (patch: Partial<DecisionState>) => onChange({ ...value, ...patch });
  const kept = keptOf(value, heldTetri);
  const over = kept != null && kept > heldTetri;
  return (
    <section className="card">
      <span className="lbl">{t.back.deposit}</span>
      <div className="chips" role="radiogroup" aria-label={t.back.deposit}>
        {(['return_all', 'keep_part', 'keep_all'] as const).map((a) => (
          <button
            key={a}
            type="button"
            role="radio"
            aria-checked={value.action === a}
            className={`pill ${value.action === a ? 'on' : ''}`}
            onClick={() => set({ action: a, grounds: a !== 'return_all' && value.grounds.length === 0 ? suggest : value.grounds })}
          >
            {a === 'return_all' ? t.back.returnAll : a === 'keep_part' ? t.back.keepPart : t.back.keepAll}
          </button>
        ))}
      </div>
      {value.action == null && <p className="hint muted">{t.back.noDefault}</p>}
      {value.action === 'keep_part' && (
        <Field label={t.back.keep} name="withheldTetri">
          <input className="input input-amount mono" value={value.amount} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" placeholder={gelFromTetri(Math.min(heldTetri, claimsTetri)).toString()} />
        </Field>
      )}
      {over && <p className="field-err">{t.back.overHeld(formatGel(heldTetri))}</p>}
      {value.action && value.action !== 'return_all' && (
        <>
          <span className="lbl">{t.back.grounds}</span>
          <div className="chips">
            {GROUNDS.map((g) => (
              <button
                key={g}
                type="button"
                className={`pill pill-sm ${value.grounds.includes(g) ? 'on' : ''}`}
                onClick={() => set({ grounds: value.grounds.includes(g) ? value.grounds.filter((x) => x !== g) : [...value.grounds, g] })}
              >
                {t.grounds[g]}
              </button>
            ))}
          </div>
          {value.grounds.length === 0 && <p className="field-err">{t.back.groundsNeeded}</p>}
          <Field label={t.back.reason} hint={t.back.reasonHint} name="reason">
            <input className="input" value={value.reason} onChange={(e) => set({ reason: e.target.value })} />
          </Field>
        </>
      )}
      {kept != null && !over && (
        <>
          <Row k={t.back.keep} v={money(kept)} />
          <Row k={t.back.backToCustomer} v={money(heldTetri - kept)} />
          <Row k={t.back.debtAfter} v={<span className={`mono ${claimsTetri - kept > 0 ? 'crit-text' : ''}`}>{formatGel(Math.max(0, claimsTetri - kept))}</span>} />
        </>
      )}
      {kept != null && kept < heldTetri && (
        <>
          <span className="lbl">{t.back.to}</span>
          <div className="chips">
            <button type="button" className={`pill pill-sm ${!value.toOther ? 'on' : ''}`} onClick={() => set({ toOther: false })}>
              {t.back.toPayer}
            </button>
            <button type="button" className={`pill pill-sm ${value.toOther ? 'on' : ''}`} onClick={() => set({ toOther: true })}>
              {t.back.toOther}
            </button>
          </div>
          {value.toOther && (
            <div className="two-col two-col-tight">
              <Field label={t.back.toOtherName} name="returnedTo">
                <input className="input" value={value.toName} onChange={(e) => set({ toName: e.target.value })} />
              </Field>
              <Field label={t.back.toOtherReason} name="returnedToReason">
                <input className="input" value={value.toReason} onChange={(e) => set({ toReason: e.target.value })} />
              </Field>
            </div>
          )}
        </>
      )}
    </section>
  );
}

/** Loads what a return comes to; again whenever the question changes. */
export function useReturnPreview(rentalId: string | undefined, q: { returnedOn: string; keyMissing: boolean; lateChoice: 'week' | 'late' | null }) {
  const [preview, setPreview] = useState<ReturnPreview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!rentalId) return;
    let live = true;
    api
      .post<ReturnPreview>(`/api/rentals/${rentalId}/return/preview`, q)
      .then((p) => live && (setPreview(p), setFailed(null)))
      .catch((e: unknown) => live && setFailed(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [rentalId, q.returnedOn, q.keyMissing, q.lateChoice]);
  return { preview, failed };
}

/** "Решить": a deposit a manager's return left waiting (§3.5) — the wizard's step 2 in a sheet. */
export function DecideSheet({ rentalId, number, returnedOn, paidThrough, onClose, onDone }: { rentalId: string; number: string; returnedOn: string; paidThrough: string | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { preview } = useReturnPreview(rentalId, { returnedOn, keyMissing: false, lateChoice: null });
  const [d, setD] = useState<DecisionState>(NO_DECISION);
  const op = useOperation();
  const held = preview?.deposit?.heldTetri ?? 0;
  // Nothing received, or all of it kept already: there is nothing to choose, only to close (designer's question 1).
  const nothing = !!preview && held === 0;
  const ok = !!preview && (nothing || decisionOk(d, held));
  const decide = async () => {
    const res = await op.run((key) => api.post(`/api/rentals/${rentalId}/deposit/decide`, nothing ? { action: 'return_all' } : decisionBody(d, held), { key }));
    if (res.ok) onDone();
  };
  return (
    <Drawer title={t.back.decideTitle(number)} onClose={onClose}>
      {!preview ? (
        <p className="muted">…</p>
      ) : (
        <>
          <SettlementLines preview={preview} paidThrough={paidThrough} />
          {nothing ? (
            <p className="hint muted">{t.back.nothingHeld}</p>
          ) : (
            <DepositDecision value={d} onChange={setD} heldTetri={held} claimsTetri={claimsOf(preview)} suggest={claimsOf(preview) > 0 ? ['rent_arrears'] : []} />
          )}
          {op.failure && <p className="field-err">{op.failure.text}</p>}
          {ok ? (
            <SubmitButton type="button" state={op.state} label={t.back.decide} onClick={() => void decide()} />
          ) : (
            <button type="button" className="pill pill-accent" disabled>
              {t.back.decide}
            </button>
          )}
        </>
      )}
    </Drawer>
  );
}
