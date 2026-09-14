import type { ReactNode } from 'react';
import { useT } from '../i18n/index.js';

// One step per screen, one button at the bottom, reachable with a thumb
// (spec §9.2). On a laptop the same frame sits in a narrow column.
export function Wizard(props: {
  title: string;
  steps: string[];
  step: number; // 0-based
  children: ReactNode;
  onBack?: () => void;
  onNext?: () => void;
  nextLabel?: string;
  nextDisabled?: boolean;
  busy?: boolean;
  error?: string | null;
}) {
  const t = useT();
  const last = props.step >= props.steps.length - 1;
  return (
    <div className="wizard">
      <header className="wizard-head">
        <h1>{props.title}</h1>
        <span className="muted">{t.pickup.stepOf(props.step + 1, props.steps.length)}</span>
      </header>
      <ol className="wizard-steps" aria-hidden="true">
        {props.steps.map((s, i) => (
          <li key={s} className={i < props.step ? 'done' : i === props.step ? 'on' : ''}>
            {s}
          </li>
        ))}
      </ol>
      <section className="wizard-body">{props.children}</section>
      {props.error && <div className="hint hint-bad">{props.error}</div>}
      <footer className="wizard-foot">
        {props.onBack && (
          <button type="button" className="pill" onClick={props.onBack} disabled={props.busy}>
            {t.actions.back}
          </button>
        )}
        {props.onNext && (
          <button type="button" className="pill pill-accent pill-grow" onClick={props.onNext} disabled={props.nextDisabled || props.busy}>
            {props.busy ? t.common.checking : props.nextLabel ?? (last ? t.actions.confirm : t.actions.next)}
          </button>
        )}
      </footer>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="lbl">{label}</span>
      {children}
      {hint && <span className="hint muted">{hint}</span>}
    </label>
  );
}

export function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
    </div>
  );
}
