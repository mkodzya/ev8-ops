import { localDateTime } from '@ev8/shared';
import { Check, CloudOff, History } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Drawer } from '../../components/Drawer.js';
import { useT } from '../../i18n/index.js';
import { useToast, type ToastSpec } from '../feedback/Toast.js';
import { sameValue, useDraft } from './drafts.js';
import { useOperation, type Failure, type SubmitState } from './operation.js';
import './form.css';

/** What a successful write hands back to the form. */
export interface Done {
  toast?: ToastSpec;
  /** The id of a record just created: the list behind lights it for two seconds. */
  created?: string;
}

const FieldErrors = createContext<Failure | null>(null);

/** For a step-by-step wizard, which is not a <Form>: its refusal reaches the fields the same way. */
export const FailureProvider = FieldErrors.Provider;

/** The words under a field, when the last refusal named it (QA-1-08). */
export function useFieldError(name: string | undefined): string | null {
  const failure = useContext(FieldErrors);
  return name && failure?.field === name ? failure.fieldText : null;
}

export interface FormProps<V> {
  value: V;
  /** What an untouched form holds: a draft is kept only when the value differs. */
  initial: V;
  /** Draft storage id (`ev8-draft:<id>`); none — no draft. */
  draft?: string;
  onRestore?: (value: V) => void;
  /** A few words naming the draft in the offer: «Зеркало левое». */
  summary?: (value: V) => string | null | undefined;
  submit: (key: string) => Promise<Done | void>;
  label: string;
  onCancel?: () => void;
  onDone?: (done: Done | void) => void;
  /** API codes that come without a field but are about one: `{ duplicate_sku: 'sku' }`. */
  fieldOf?: Record<string, string>;
  /** Extra buttons beside submit. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Every form of the product (wave 1 §3.7): an operation key, the submit button
 * in four states, the refusal inside this form (not over the page, QA-1-06) or
 * under the field the server named, a draft, and the message after.
 */
export function Form<V>({
  value,
  initial,
  draft,
  onRestore,
  summary,
  submit,
  label,
  onCancel,
  onDone,
  fieldOf,
  actions,
  className,
  children,
}: FormProps<V>) {
  const t = useT();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const op = useOperation(fieldOf);
  const formRef = useRef<HTMLFormElement>(null);
  const drafts = useDraft({ id: onRestore ? draft : undefined, value, initial, hold: op.state === 'done' });

  // The field the server named takes the focus.
  useEffect(() => {
    const field = op.failure?.field;
    if (!field || !formRef.current) return;
    const el = formRef.current.querySelector<HTMLElement>(`[data-field="${CSS.escape(field)}"] :is(input, select, textarea, button)`);
    el?.focus();
  }, [op.failure]);

  // A refusal said for the whole form stands above it. Pressed at the foot of a
  // long sheet, it was out of sight and only «Не записалось — повторить» was
  // read (QA before 1.17.0, a second repair on one moped): it comes into view.
  const bannerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (op.failure) bannerRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [op.failure]);

  // A refusal about one field is answered by changing the form: once it
  // changes, the words under the field go (QA-W2-10). The next attempt asks again.
  const shape = JSON.stringify(value);
  const refusedAt = useRef<string | null>(null);
  useEffect(() => {
    if (op.failure?.field) {
      if (refusedAt.current == null) refusedAt.current = shape;
      else if (refusedAt.current !== shape) {
        refusedAt.current = null;
        op.reset();
      }
    } else refusedAt.current = null;
  }, [shape, op.failure, op.reset]);

  // After "Done", an inline form goes back to rest; a sheet has closed by then.
  useEffect(() => {
    if (op.state !== 'done') return;
    const id = window.setTimeout(op.reset, 1500);
    return () => window.clearTimeout(id);
  }, [op.state, op.reset]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const res = await op.run(submit);
    if (!res.ok) return;
    drafts.drop();
    const done = res.value;
    if (done?.created) navigate(location.pathname + location.search, { replace: true, state: { created: done.created } });
    if (done?.toast) toast(done.toast);
    onDone?.(done);
  };

  if (drafts.offer && onRestore) {
    return <DraftOffer at={drafts.offer.at} words={summary?.(drafts.offer.value)} onContinue={() => drafts.accept(onRestore)} onDiscard={drafts.discard} />;
  }

  const general = op.failure && !(op.failure.field && op.failure.fieldText && formHas(formRef.current, op.failure.field)) ? op.failure : null;

  return (
    <FieldErrors.Provider value={op.failure}>
      <form ref={formRef} className={`form ${className ?? ''}`} onSubmit={onSubmit} noValidate>
        {general && (
          <div ref={bannerRef} className="form-banner form-banner-bad" role="alert">
            {general.network && <CloudOff size={18} strokeWidth={1.75} aria-hidden="true" />}
            <div>
              <b>{t.form.notSaved}</b> {general.text}
              {general.network && draft ? ` ${t.form.draftKept}` : ''}
            </div>
          </div>
        )}
        {children}
        <div className="row-actions">
          {onCancel && (
            <button type="button" className="pill" onClick={onCancel}>
              {t.actions.cancel}
            </button>
          )}
          {actions}
          <SubmitButton state={op.state} label={label} />
        </div>
      </form>
    </FieldErrors.Provider>
  );
}

/** «Черновик от HH:MM · …» with Continue / Start over — for forms and wizards alike. */
export function DraftOffer({ at, words, onContinue, onDiscard }: { at: string; words?: string | null; onContinue: () => void; onDiscard: () => void }) {
  const t = useT();
  const time = localDateTime(at).time;
  return (
    <div className="draft-offer">
      <div className="form-banner form-banner-ok">
        <History size={18} strokeWidth={1.75} aria-hidden="true" />
        <div>
          <b>{t.form.draftFrom(time)}</b>
          {words ? <> · «{words}»</> : null}
        </div>
      </div>
      <button type="button" className="pill pill-accent pill-lg submit-wide" onClick={onContinue}>
        {t.form.continueDraft}
      </button>
      <button type="button" className="pill submit-wide submit-quiet" onClick={onDiscard}>
        {t.form.startOver}
      </button>
    </div>
  );
}

function formHas(form: HTMLFormElement | null, field: string): boolean {
  return !!form?.querySelector(`[data-field="${CSS.escape(field)}"]`);
}

/** The submit button in its four states (ux.md «Кнопка отправки»). */
export function SubmitButton({
  state,
  label,
  type = 'submit',
  onClick,
  small = false,
  className = '',
  disabled = false,
}: {
  state: SubmitState;
  label: string;
  type?: 'submit' | 'button';
  onClick?: () => void;
  small?: boolean;
  className?: string;
  /** Nothing to send yet: a batch with nothing chosen, a reason not written (wave 6 §3.7). */
  disabled?: boolean;
}) {
  const t = useT();
  const busy = state === 'busy' || disabled;
  return (
    <button
      type={type}
      className={`pill ${small ? 'pill-sm' : ''} submit submit-${state} ${state === 'failed' ? '' : 'pill-accent'} ${className}`}
      aria-disabled={busy || undefined}
      aria-busy={state === 'busy' || undefined}
      onClick={(e) => {
        if (busy) {
          e.preventDefault();
          return;
        }
        onClick?.();
      }}
    >
      {state === 'done' && <Check size={16} strokeWidth={2} aria-hidden="true" />}
      {state === 'busy' ? t.form.saving : state === 'done' ? t.form.saved : state === 'failed' ? t.form.retry : label}
    </button>
  );
}

/**
 * A short form in a sheet (phone) or a panel (laptop). Closing it with
 * something typed asks first — what was typed stays a draft either way.
 */
export function FormSheet<V>({ title, onClose, ...form }: FormProps<V> & { title: string; onClose: () => void }) {
  // Worked out on this render, not reported from an effect: an Escape pressed
  // right after the last keystroke must already see the form as filled.
  const dirty = !sameValue(form.value, form.initial);
  return (
    <Drawer title={title} onClose={onClose} confirmClose={dirty}>
      <Form
        {...form}
        onDone={(done) => {
          form.onDone?.(done);
          onClose();
        }}
      />
    </Drawer>
  );
}
