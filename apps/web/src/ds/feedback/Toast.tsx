import { Check } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { holdNumbers } from '../../format.js';
import { useT } from '../../i18n/index.js';
import { errorText } from '../../lib/use.js';
import './feedback.css';

export interface ToastSpec {
  text: string;
  /** Where "Open" leads — for a record just created (ux №4). */
  open?: string;
  /** "Undo" for what can be taken back; the message then stays 10 s with a draining line. */
  undo?: () => Promise<unknown>;
}

interface Shown extends ToastSpec {
  id: number;
}

const ToastContext = createContext<(spec: ToastSpec) => void>(() => {});

/** The message at the bottom after a write (wave 1 §3.7): one at a time, the newest wins. */
export function useToast(): (spec: ToastSpec) => void {
  return useContext(ToastContext);
}

const LIFE_MS = 5000;
const UNDO_MS = 10000;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<Shown | null>(null);
  const seq = useRef(0);
  const show = useCallback((spec: ToastSpec) => setShown({ ...spec, id: ++seq.current }), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {shown && <ToastView key={shown.id} toast={shown} onGone={() => setShown((s) => (s?.id === shown.id ? null : s))} replace={show} />}
    </ToastContext.Provider>
  );
}

function ToastView({ toast, onGone, replace }: { toast: Shown; onGone: () => void; replace: (spec: ToastSpec) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [undoing, setUndoing] = useState(false);
  const life = toast.undo ? UNDO_MS : LIFE_MS;

  useEffect(() => {
    const id = window.setTimeout(onGone, life);
    return () => window.clearTimeout(id);
  }, [life, onGone]);

  return (
    <ToastCard
      text={toast.text}
      life={life}
      onOpen={
        toast.open
          ? () => {
              onGone();
              navigate(toast.open!);
            }
          : undefined
      }
      onUndo={
        toast.undo
          ? async () => {
              if (undoing) return;
              setUndoing(true);
              try {
                await toast.undo!();
                replace({ text: t.form.undone });
              } catch (e) {
                replace({ text: errorText(e) });
              }
            }
          : undefined
      }
    />
  );
}

/** The message as it looks, with no timer behind it — also what the design catalogue shows. */
export function ToastCard({ text, life = LIFE_MS, onOpen, onUndo, still = false }: { text: string; life?: number; onOpen?: () => void; onUndo?: () => void; still?: boolean }) {
  const t = useT();
  return (
    <div className={`toast ${still ? 'toast-still' : ''}`} role="status" aria-live="polite">
      <Check size={18} strokeWidth={2} aria-hidden="true" />
      {/* A record's number named in the message stays on one line (QA 23.10.2026). */}
      <span className="toast-text">{holdNumbers(text)}</span>
      {onOpen && (
        <button type="button" className="toast-act" onClick={onOpen}>
          {t.form.open}
        </button>
      )}
      {onUndo && (
        <button type="button" className="toast-act" onClick={onUndo}>
          {t.form.undo}
        </button>
      )}
      {onUndo && <span className="toast-drain" style={{ animationDuration: `${life}ms` }} />}
    </div>
  );
}
