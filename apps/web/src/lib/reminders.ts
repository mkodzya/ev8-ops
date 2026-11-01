import type { ReminderFailure, ReminderMode } from '@ev8/shared';
import type { Dict } from '../i18n/en.js';

/**
 * What came of a rent reminder, in words (ADR-0053): «отправлено»,
 * «пробно, не отправлено», «не ушло: нет сделки в Kommo».
 */
export function reminderModeText(t: Dict, mode: ReminderMode, failure: ReminderFailure | null): string {
  if (mode === 'sent') return t.rem.sent;
  if (mode === 'sending') return t.rem.sending;
  if (mode === 'failed') return failure ? `${t.rem.failed}: ${t.rem.failures[failure]}` : t.rem.failed;
  return t.rem.dryRun;
}
