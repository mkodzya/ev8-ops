import { FailureProvider, SubmitButton, useFieldError } from '../ds/form/Form.js';
import type { Failure, SubmitState } from '../ds/form/operation.js';
import { useEffect, type ReactNode } from 'react';
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
  /** The write at the end: the button shows its four states and the refusal reaches the fields (wave 1 §3.7). */
  submit?: { state: SubmitState; failure: Failure | null; label: string };
}) {
  const t = useT();
  const last = props.step >= props.steps.length - 1;
  // A new step starts at its top, not where the last one was scrolled to.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [props.step]);
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
      <FailureProvider value={props.submit?.failure ?? null}>
        <section className="wizard-body">{props.children}</section>
      </FailureProvider>
      {props.submit?.failure && (
        <div className="form-banner form-banner-bad" role="alert">
          <div>
            <b>{t.form.notSaved}</b> {props.submit.failure.text}
          </div>
        </div>
      )}
      {props.error && <div className="hint hint-bad">{props.error}</div>}
      <footer className="wizard-foot">
        {props.onBack && (
          <button type="button" className="pill" onClick={props.onBack} disabled={props.busy}>
            {t.actions.back}
          </button>
        )}
        {props.onNext && props.submit && (
          <SubmitButton type="button" className="pill-grow" state={props.submit.state} label={props.submit.label} onClick={props.onNext} />
        )}
        {props.onNext && !props.submit && (
          <button type="button" className="pill pill-accent pill-grow" onClick={props.onNext} disabled={props.nextDisabled || props.busy}>
            {props.busy ? t.common.checking : props.nextLabel ?? (last ? t.actions.confirm : t.actions.next)}
          </button>
        )}
      </footer>
    </div>
  );
}

/**
 * A labelled field. `name` is the API's name for it: when the server refuses
 * the form naming that field, the words come under it (QA-1-08).
 */
export function Field({ label, children, hint, name }: { label: string; children: ReactNode; hint?: string; name?: string }) {
  const error = useFieldError(name);
  return (
    <label className={`field ${error ? 'field-bad' : ''}`} data-field={name}>
      <span className="lbl">{label}</span>
      {children}
      {error ? <span className="field-err">{error}</span> : hint && <span className="hint muted">{hint}</span>}
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
