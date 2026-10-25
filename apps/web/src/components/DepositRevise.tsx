import { GROUNDS, NO_DECISION, decisionBody, decisionOk, gelFromTetri, type DecisionState, type Ground } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { FormSheet } from '../ds/form/Form.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText } from '../lib/use.js';
import { Drawer } from './Drawer.js';
import { DepositDecision } from './ReturnMoney.js';
import { Field, Row } from './Wizard.js';

// «Пересмотреть решение по залогу» (issue #14, ADR-0046): the return's
// decision made again by an owner, from the same choice as at the return,
// with «было → станет» worked out by the server before anything is written.

interface Figures {
  withheldTetri: number;
  backTetri: number;
  paidOutTetri: number;
  onHandTetri: number;
  debtTetri: number;
}

/** What POST …/deposit/revise/preview answers. */
interface RevisionView {
  number: string;
  decidedOn: string | null;
  before: Figures;
  heldTetri: number;
  claimsTetri: number;
  current: { keptTetri: number; grounds: string[]; reason: string | null; returnedTo: string | null; returnedToReason: string | null };
  after: Figures | null;
  actSigned: boolean;
}

/** The form starts from the decision standing now. */
function startFrom(v: RevisionView): DecisionState {
  const c = v.current;
  const action = c.keptTetri === 0 ? 'return_all' : c.keptTetri === v.heldTetri ? 'keep_all' : 'keep_part';
  return {
    ...NO_DECISION,
    action,
    amount: action === 'keep_part' ? String(gelFromTetri(c.keptTetri)) : '',
    grounds: c.grounds.filter((g): g is Ground => (GROUNDS as readonly string[]).includes(g)),
    reason: c.reason ?? '',
    toOther: !!c.returnedTo,
    toName: c.returnedTo ?? '',
    toReason: c.returnedToReason ?? '',
  };
}

/**
 * The decision as the server reads it. One not finished yet is still sent as
 * it stands, so the server names the field it lacks — never a silent «вернуть всё».
 */
function bodyOf(d: DecisionState, held: number) {
  if (decisionOk(d, held)) return decisionBody(d, held);
  if (d.action == null) return {};
  return {
    action: d.action === 'return_all' ? ('return_all' as const) : ('withhold' as const),
    withheldTetri: d.action === 'keep_all' ? held : d.amount.trim(),
    grounds: d.grounds,
    reason: d.reason.trim(),
    ...(d.toOther ? { returnedTo: d.toName.trim(), returnedToReason: d.toReason.trim() } : {}),
  };
}

export function ReviseSheet({ rentalId, number, onClose, onDone }: { rentalId: string; number: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const w = t.depositRevise;
  const [base, setBase] = useState<RevisionView | null>(null);
  const [loadFailed, setLoadFailed] = useState<string | null>(null);
  const [initial, setInitial] = useState<{ d: DecisionState; why: string }>({ d: NO_DECISION, why: '' });
  const [f, setF] = useState(initial);
  const [after, setAfter] = useState<Figures | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .ask<RevisionView>(`/api/rentals/${rentalId}/deposit/revise/preview`, {})
      .then((v) => {
        if (!live) return;
        const start = { d: startFrom(v), why: '' };
        setBase(v);
        setInitial(start);
        setF(start);
      })
      .catch((e: unknown) => live && setLoadFailed(errorText(e)));
    return () => {
      live = false;
    };
  }, [rentalId]);

  const held = base?.heldTetri ?? 0;
  const ok = !!base && decisionOk(f.d, held);
  const asked = ok ? JSON.stringify(decisionBody(f.d, held)) : null;
  useEffect(() => {
    setAfter(null);
    setFailed(null);
    if (!asked) return;
    let live = true;
    api
      .ask<RevisionView>(`/api/rentals/${rentalId}/deposit/revise/preview`, JSON.parse(asked))
      .then((v) => live && setAfter(v.after))
      .catch((e: unknown) => live && setFailed(errorText(e)));
    return () => {
      live = false;
    };
  }, [rentalId, asked]);

  if (!base) {
    return (
      <Drawer title={w.title(number)} onClose={onClose}>
        <p className={loadFailed ? 'field-err' : 'muted'}>{loadFailed ?? '…'}</p>
      </Drawer>
    );
  }

  const before = base.before;
  const money = (n: number) => formatGel(n, { decimals: false });
  const line = (label: string, was: number, now: number | undefined, bad = false) => (
    <Row
      key={label}
      k={label}
      v={
        now == null || now === was ? (
          <span className="mono">{money(was)}</span>
        ) : (
          <span>
            <span className="mono muted">{money(was)}</span> → <span className={`mono ${bad ? 'crit-text' : ''}`}>{money(now)}</span>
          </span>
        )
      }
    />
  );
  const debtUp = after != null && after.debtTetri > before.debtTetri;

  return (
    <FormSheet
      title={w.title(number)}
      onClose={onClose}
      value={f}
      initial={initial}
      label={w.save}
      submit={async (key) => {
        await api.post(`/api/rentals/${rentalId}/deposit/revise`, { ...bodyOf(f.d, held), revisionReason: f.why.trim() }, { key });
        return { toast: { text: w.done } };
      }}
      onDone={onDone}
    >
      <p className="hint muted">{w.intro(fmtDate(base.decidedOn))}</p>
      {before.paidOutTetri > 0 && <p className="hint muted">{w.payouts}</p>}
      <DepositDecision value={f.d} onChange={(d) => setF({ ...f, d })} heldTetri={held} claimsTetri={base.claimsTetri} suggest={base.claimsTetri > 0 ? ['rent_arrears'] : []} />
      <Field label={w.why} hint={w.whyHint} name="revisionReason">
        <input className="input" value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} />
      </Field>
      <section className="card">
        <span className="lbl">{w.figures}</span>
        {line(w.rows.withheld, before.withheldTetri, after?.withheldTetri)}
        {line(w.rows.back, before.backTetri, after?.backTetri)}
        {line(w.rows.paidOut, before.paidOutTetri, after?.paidOutTetri)}
        {line(w.rows.onHand, before.onHandTetri, after?.onHandTetri)}
        {line(w.rows.debt, before.debtTetri, after?.debtTetri, debtUp)}
        {ok && !after && !failed && <p className="hint muted">{w.counting}</p>}
        {failed && <p className="field-err">{failed}</p>}
        {debtUp && <p className="crit-text">{w.debtUp(number, formatGel(after!.debtTetri))}</p>}
      </section>
      <p className="hint muted">{base.actSigned ? w.actSigned : w.actFresh}</p>
    </FormSheet>
  );
}
