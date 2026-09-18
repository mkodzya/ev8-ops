import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, newOperationKey } from '../../api.js';
import { currentDict } from '../../i18n/index.js';
import { errorText } from '../../lib/use.js';
import { useSession } from '../../session.js';

export type SubmitState = 'idle' | 'busy' | 'done' | 'failed';

export interface Failure {
  /** The words for the whole form: why it did not write. */
  text: string;
  /** The field the server named, when it named one (QA-1-08). */
  field: string | null;
  /** The words under that field: what to do. */
  fieldText: string | null;
  code: string | null;
  network: boolean;
}

/** What a refusal says, and where. `fieldOf` maps a code the server sends without a field to the field it is about. */
export function failureOf(e: unknown, fieldOf: Record<string, string> = {}): Failure {
  const t = currentDict();
  const text = errorText(e);
  const network = text === t.errors.network;
  if (!(e instanceof ApiError)) return { text, field: null, fieldText: null, code: null, network };
  const named = typeof e.extra.field === 'string' ? e.extra.field : null;
  const field = named ?? fieldOf[e.code] ?? null;
  // A generic "field is wrong" reads as what to do under the field itself.
  const fieldText = !field ? null : e.code === 'missing_field' ? t.form.fieldMissing : e.code === 'bad_field' ? t.form.fieldBad : text;
  return { text, field, fieldText, code: e.code, network };
}

/**
 * One write with an operation key (build plan Р5, wave 1 §3.7).
 *
 * The key is made when the form opens and lives until a write succeeds, so a
 * retry after a lost answer returns the record the first attempt made instead
 * of making a second. A second press while the first is on its way does
 * nothing — the ref, not the state, answers that, because two clicks 8 ms
 * apart both see the state from before either of them (QA-1-03).
 */
export function useOperation(fieldOf?: Record<string, string>) {
  const key = useRef(newOperationKey());
  const fields = useRef(fieldOf);
  fields.current = fieldOf;
  const running = useRef(false);
  const lastScope = useRef('');
  const [state, setState] = useState<SubmitState>('idle');
  const [failure, setFailure] = useState<Failure | null>(null);

  const run = useCallback(
    async <R,>(write: (key: string) => Promise<R>, scope = ''): Promise<{ ok: true; value: R } | { ok: false }> => {
      if (running.current) return { ok: false };
      running.current = true;
      // One key, one write: a different action from the same place (adding a
      // line, then removing another) gets its own, or the server would take
      // it for a retry of the first and refuse it.
      if (scope !== lastScope.current) key.current = newOperationKey();
      lastScope.current = scope;
      setState('busy');
      setFailure(null);
      try {
        const value = await write(key.current);
        key.current = newOperationKey();
        setState('done');
        return { ok: true, value };
      } catch (e) {
        const f = failureOf(e, fields.current);
        setFailure(f);
        // A refusal about one field is fixed in that field: the button stays
        // as it was, it is not a write that "did not go through" (prototype
        // wave-1-forms-states.html, "Отказ по полю").
        setState(f.field ? 'idle' : 'failed');
        return { ok: false };
      } finally {
        running.current = false;
      }
    },
    [],
  );

  const reset = useCallback(() => {
    setState('idle');
    setFailure(null);
  }, []);

  // "The session ended" is no longer true once the person has signed in over
  // the page: the form is back at rest, what was typed still in it (QA-W1-08).
  const { ended } = useSession();
  const wasEnded = useRef(ended);
  useEffect(() => {
    if (wasEnded.current && !ended && failure?.code === 'unauthenticated') reset();
    wasEnded.current = ended;
  }, [ended, failure, reset]);

  return { state, failure, run, reset };
}
