import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../api.js';
import { SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useT } from '../i18n/index.js';
import { Field } from './Wizard.js';

export type DocKind = 'contract' | 'return-act';

export interface DocState {
  signedAt: string | null;
  signedBy: string | null;
  gaps: string[];
}

/** 18.09 14:32 — when a document was signed, in the shape the prototype shows. */
export function signedAtText(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * One document of a rental with its signature (wave 3 §3.2, D17): signed or
 * not, "Sign on the screen", Signify waiting for its API key, and — when the
 * contract lacks something the customer must give — that field, filled here,
 * after which the contract is built again (B4-06).
 */
export function DocumentRow({
  rentalId,
  kind,
  title,
  sub,
  state,
  customerId,
  onChanged,
}: {
  rentalId: string;
  kind: DocKind;
  title: string;
  sub?: string;
  state: DocState;
  customerId: string;
  onChanged: () => void;
}) {
  const t = useT();
  const [signing, setSigning] = useState(false);
  const gaps = state.gaps;
  return (
    <div className="doc-row">
      <div className="doc-head">
        <a className="doc-title" href={`/api/rentals/${rentalId}/${kind}.pdf`} target="_blank" rel="noreferrer">
          {title}
        </a>
        <span className="muted">{sub ?? t.hand.lang}</span>
        <span className={`doc-state ${state.signedAt ? 'ok-text' : 'warn-text'}`}>{state.signedAt ? t.hand.signed(signedAtText(state.signedAt)) : t.hand.unsigned}</span>
      </div>
      {gaps.length > 0 && !state.signedAt && <GapFill customerId={customerId} gaps={gaps} onSaved={onChanged} />}
      {!state.signedAt && (
        <div className="row-actions">
          <button type="button" className="pill pill-sm pill-accent" disabled={gaps.length > 0} onClick={() => setSigning(true)}>
            {t.hand.signOnScreen}
          </button>
          <button type="button" className="pill pill-sm" disabled title={t.hand.signifyHint}>
            {t.hand.signify}
          </button>
          <span className="hint muted">{t.hand.signifyHint}</span>
        </div>
      )}
      {signing && (
        <SignScreen
          rentalId={rentalId}
          kind={kind}
          onClose={() => setSigning(false)}
          onSigned={() => {
            setSigning(false);
            onChanged();
          }}
        />
      )}
    </div>
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
export function SignScreen({ rentalId, kind, onClose, onSigned }: { rentalId: string; kind: DocKind; onClose: () => void; onSigned: () => void }) {
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
    const res = await op.run((key) => api.post(`/api/rentals/${rentalId}/${kind}/sign`, { agree: true, signaturePng: png }, { key }));
    if (res.ok) onSigned();
  };

  return createPortal(
    <div className="sign-screen" role="dialog" aria-modal="true" aria-label={t.sign.title}>
      <header className="sign-head">
        <b>{kind === 'contract' ? t.sign.contract : t.sign.returnAct}</b>
        <button type="button" className="pill pill-sm" onClick={onClose}>
          {t.sign.close}
        </button>
      </header>
      <iframe className="sign-doc" src={`/api/rentals/${rentalId}/${kind}.pdf#navpanes=0&view=FitH`} title={kind === 'contract' ? t.sign.contract : t.sign.returnAct} />
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
