import { chargeNoteKey } from '@ev8/shared';
import type { Dict } from '../i18n/en.js';

/**
 * A charge in words: its kind, then its note — the code's own note
 * (`CHARGE_NOTES`) in the reader's language, a person's as it was typed. The
 * «Разнести» sheet printed the stored «contract §6» on Russian and Georgian
 * screens (QA after issue #9); the stored row is left as it is.
 */
export function chargeWords(t: Dict, kind: string | null | undefined, note?: string | null): string {
  const code = chargeNoteKey(note);
  const said = code ? t.rentalMoney.notes[code] : (note ?? '').trim();
  const what = kind ? t.rentalMoney.charges[kind] ?? kind : '';
  return [what, said].filter(Boolean).join(' · ');
}
