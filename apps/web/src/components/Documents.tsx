import { localDateTime } from '@ev8/shared';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useT } from '../i18n/index.js';
import { useSession } from '../session.js';
import { RowMenu } from './RowMenu.js';
import { Field } from './Wizard.js';

export type DocKind = 'contract' | 'return-act';

/** A contract marked signed in Signify or on paper (ADR-0039): when, who marked it, what they added. */
export interface SignedElsewhere {
  at: string;
  by: string | null;
  note: string | null;
}

export interface DocState {
  signedAt: string | null;
  signedBy: string | null;
  gaps: string[];
  /** The contract only; null — not marked. Absent on the return act and from an older API. */
  signedElsewhere?: SignedElsewhere | null;
}

/** 18.09 14:32 — when a document was signed, in the shape the prototype shows. */
export function signedAtText(iso: string): string {
  const { date, time } = localDateTime(iso);
  return `${date.slice(0, 5)} ${time}`;
}

/**
 * One document of a rental with its signature (wave 3 §3.2, D17): signed or
 * not, "Sign on the screen", and — when the contract lacks something the
 * customer must give — that field, filled here, after which the contract is
 * built again (B4-06). A contract signed in Signify is marked so beside "Sign
 * on the screen" by whoever hands mopeds over, and an owner takes the mark
 * back with a reason (ADR-0039); the return act keeps Signify waiting for
 * its API key.
 */
export function DocumentRow({
  rentalId,
  kind,
  title,
  sub,
  state,
  customerId,
  driveUrl,
  onChanged,
}: {
  rentalId: string;
  kind: DocKind;
  title: string;
  sub?: string;
  state: DocState;
  customerId: string;
  /** The contract filed in Drive, as last read (ADR-0031): shown in the sheet as what the mark rests on. */
  driveUrl?: string | null;
  onChanged: () => void;
}) {
  const t = useT();
  const { can } = useSession();
  const [signing, setSigning] = useState(false);
  const [sheet, setSheet] = useState<null | 'mark' | 'unmark'>(null);
  const gaps = state.gaps;
  const elsewhere = kind === 'contract' ? (state.signedElsewhere ?? null) : null;
  const signed = !!state.signedAt || !!elsewhere;
  let stateText = t.hand.unsigned;
  if (state.signedAt) stateText = t.hand.signed(signedAtText(state.signedAt));
  else if (elsewhere) stateText = t.signedElsewhere.state(signedAtText(elsewhere.at), elsewhere.by);
  const done = (after: 'signing' | 'sheet') => {
    if (after === 'signing') setSigning(false);
    else setSheet(null);
    onChanged();
  };
  return (
    <div className="doc-row">
      <div className="doc-head">
        <a className="doc-title" href={`/api/rentals/${rentalId}/${kind}.pdf`} target="_blank" rel="noreferrer">
          {title}
        </a>
        <span className="muted">{sub ?? t.hand.lang}</span>
        <span className={`doc-state ${signed ? 'ok-text' : 'warn-text'}`}>{stateText}</span>
        {elsewhere && !state.signedAt && can('deposit.decide') && <RowMenu actions={[{ key: 'unmark', label: t.signedElsewhere.undo, onPick: () => setSheet('unmark') }]} />}
      </div>
      {elsewhere?.note && !state.signedAt && <p className="hint muted">{elsewhere.note}</p>}
      {gaps.length > 0 && !signed && <GapFill customerId={customerId} gaps={gaps} onSaved={onChanged} />}
      {!signed && (
        <div className="row-actions">
          <button type="button" className="pill pill-sm pill-accent" disabled={gaps.length > 0} onClick={() => setSigning(true)}>
            {t.hand.signOnScreen}
          </button>
          {kind === 'contract' && can('rental.create') ? (
            <button type="button" className="pill pill-sm" onClick={() => setSheet('mark')}>
              {t.signedElsewhere.mark}
            </button>
          ) : (
            <>
              <button type="button" className="pill pill-sm" disabled title={t.hand.signifyHint}>
                {t.hand.signify}
              </button>
              <span className="hint muted">{t.hand.signifyHint}</span>
            </>
          )}
        </div>
      )}
      {signing && <SignScreen rentalId={rentalId} kind={kind} onClose={() => setSigning(false)} onSigned={() => done('signing')} />}
      {sheet === 'mark' && <MarkSignedSheet rentalId={rentalId} driveUrl={driveUrl ?? null} onClose={() => setSheet(null)} onDone={() => done('sheet')} />}
      {sheet === 'unmark' && <UnmarkSignedSheet rentalId={rentalId} onClose={() => setSheet(null)} onDone={() => done('sheet')} />}
    </div>
  );
}

/**
 * "Подписан в Signify" (ADR-0039): the customer signed the contract outside
 * EV8 Ops, and the person who knows says so. The contract in Drive, when it
 * was found, is one tap away — what the mark rests on; nothing reads it for
 * the person (ADR-0034 §5).
 */
function MarkSignedSheet({ rentalId, driveUrl, onClose, onDone }: { rentalId: string; driveUrl: string | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { note: '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={t.signedElsewhere.title}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.signedElsewhere.submit}
      submit={async (key) => {
        await api.post(`/api/rentals/${rentalId}/contract/signed-elsewhere`, { note: f.note.trim() }, { key });
        return { toast: { text: t.signedElsewhere.done } };
      }}
      onDone={onDone}
    >
      <p className="hint muted">{t.signedElsewhere.hint}</p>
      {driveUrl && (
        <p>
          <a href={driveUrl} target="_blank" rel="noreferrer">
            {t.signedElsewhere.drive}
          </a>
        </p>
      )}
      <Field label={t.signedElsewhere.note} hint={t.signedElsewhere.noteHint} name="note">
        <input className="input" maxLength={500} value={f.note} onChange={(e) => setF({ note: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/** The mark taken back — an owner's, with a reason (ADR-0039): the contract is asked for again. */
function UnmarkSignedSheet({ rentalId, onClose, onDone }: { rentalId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { reason: '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={t.signedElsewhere.undoTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.signedElsewhere.undo}
      submit={async (key) => {
        await api.post(`/api/rentals/${rentalId}/contract/signed-elsewhere/undo`, { reason: f.reason.trim() }, { key });
        return { toast: { text: t.signedElsewhere.undone } };
      }}
      onDone={onDone}
    >
      <p className="hint muted">{t.signedElsewhere.undoHint}</p>
      <Field label={t.signedElsewhere.reason} hint={t.signedElsewhere.reasonHint} name="reason">
        <input className="input" autoFocus maxLength={500} value={f.reason} onChange={(e) => setF({ reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/** "В договоре пусто: личный номер" — the field itself, saved to the customer's card. */
function GapFill({ customerId, gaps, onSaved }: { customerId: string; gaps: string[]; onSaved: () => void }) {
  const t = useT();
  const op = useOperation();
  const [values, setValues] = useState<Record<string, string>>({});
  const ready = gaps.every((g) => (values[g] ?? '').trim().length > 0);
  const save = async () => {
    const res = await op.run((key) => api.patch(`/api/customers/${customerId}`, Object.fromEntries(gaps.map((g) => [g, values[g]!.trim()])), { key }));
    if (res.ok) onSaved();
  };
  return (
    <div className="doc-gap">
      <p className="warn-text">{t.hand.gap(gaps.map((g) => t.hand.gapFields[g] ?? g).join(', '))}</p>
      {gaps.map((g) => (
        <Field key={g} label={t.hand.gapFields[g] ?? g} name={g}>
          <input className="input" value={values[g] ?? ''} onChange={(e) => setValues({ ...values, [g]: e.target.value })} inputMode={g === 'phone' ? 'tel' : 'text'} />
        </Field>
      ))}
      {op.failure && <p className="field-err">{op.failure.text}</p>}
      {ready && <SubmitButton small type="button" state={op.state} label={t.hand.saveAndRebuild} onClick={() => void save()} />}
    </div>
  );
}

/**
 * The phone in the customer's hands: the document large, Georgian first, a
 * field to sign with a finger, "Clear", "I agree", "Sign". The drawing goes
 * into the PDF with the time and who took it (D17).
 */
export function SignScreen({
  rentalId,
  kind,
  title,
  base,
  onClose,
  onSigned,
}: {
  rentalId: string;
  kind: DocKind;
  /** What the header calls it; the rental's two documents name themselves. */
  title?: string;
  /** The record the document belongs to: rentals by default, a sale in wave 5. */
  base?: 'rentals' | 'sales';
  onClose: () => void;
  onSigned: () => void;
}) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(false);
  const [agree, setAgree] = useState(false);
  const op = useOperation();

  // The canvas is as wide as it is drawn, in device pixels, so a line is not blurred.
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * ratio);
    c.height = Math.round(rect.height * ratio);
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Black on white in any theme: the drawing goes into a printed PDF.
    ctx.strokeStyle = 'black';
  }, []);

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    setDrawn(true);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  const up = () => {
    drawing.current = false;
  };
  const clear = () => {
    const c = canvas.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  };
  const sign = async () => {
    const png = canvas.current?.toDataURL('image/png') ?? '';
    const res = await op.run((key) => api.post(`/api/${base ?? 'rentals'}/${rentalId}/${kind}/sign`, { agree: true, signaturePng: png }, { key }));
    if (res.ok) onSigned();
  };

  return createPortal(
    <div className="sign-screen" role="dialog" aria-modal="true" aria-label={t.sign.title}>
      <header className="sign-head">
        <b>{title ?? (kind === 'contract' ? t.sign.contract : t.sign.returnAct)}</b>
        <button type="button" className="pill pill-sm" onClick={onClose}>
          {t.sign.close}
        </button>
      </header>
      <iframe
        className="sign-doc"
        src={`/api/${base ?? 'rentals'}/${rentalId}/${kind}.pdf#navpanes=0&view=FitH`}
        title={title ?? (kind === 'contract' ? t.sign.contract : t.sign.returnAct)}
      />
      <p className="hint muted">{t.sign.scroll}</p>
      <div className="sign-pad">
        <span className="lbl">{t.sign.field}</span>
        <canvas ref={canvas} className="sign-canvas" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
      </div>
      {op.failure && <p className="field-err">{op.failure.text}</p>}
      <footer className="sign-foot">
        <label className="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>{t.sign.agree}</span>
        </label>
        <button type="button" className="pill" onClick={clear} disabled={!drawn}>
          {t.sign.clear}
        </button>
        {drawn && agree ? (
          <SubmitButton type="button" className="pill-grow" state={op.state} label={t.sign.sign} onClick={() => void sign()} />
        ) : (
          <button type="button" className="pill pill-accent pill-grow" disabled>
            {t.sign.sign}
          </button>
        )}
      </footer>
    </div>,
    document.body,
  );
}
