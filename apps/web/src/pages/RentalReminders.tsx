import { formatGel, type ReminderFailure, type ReminderMode, type ReminderSendMode, type ReminderTemplate } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { BlockHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { FormSheet } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { fmtDateAt, fmtDayMonth } from '../format.js';
import { useT } from '../i18n/index.js';
import { reminderModeText } from '../lib/reminders.js';
import { useSession } from '../session.js';

/** What GET /api/rentals/:id says of its rent reminders (issue #20, ADR-0052). */
export interface RentalRemindersCard {
  off: { reason: string; at: string | null; by: string | null } | null;
  recent: { day: string | null; slot: string; template: ReminderTemplate; lang: string; amountTetri: number; mode: ReminderMode; failure: ReminderFailure | null }[];
  lang: 'ka' | 'ru' | 'en';
  /** Whether they go (ADR-0053): the stand's mode, or an owner's pause. */
  sending: ReminderSendMode | 'paused';
  /** The rental or its customer names a Kommo deal. */
  deal: boolean;
}

/**
 * A rental's rent reminders (issue #20 of the director, ADR-0052, ADR-0053;
 * MSG-02): when they go, whether they are sent, the last ones and what came
 * of each, and — for
 * whoever calls by the schedule — the switch, off with a reason it must have.
 */
export function RentalReminders({ rentalId, card, running, onChanged }: { rentalId: string; card: RentalRemindersCard; running: boolean; onChanged: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const { can } = useSession();
  const [asking, setAsking] = useState(false);
  const mayToggle = can('payments.schedule');
  const mode = (x: RentalRemindersCard['recent'][number]) => reminderModeText(t, x.mode, x.failure);
  if (!running && card.recent.length === 0) return null;
  return (
    <section className="card">
      <BlockHead title={t.rem.card.title}>
        {mayToggle && running && card.off && (
          <button
            type="button"
            className="pill pill-sm"
            disabled={op.state === 'busy'}
            onClick={async () => {
              const res = await op.run((key) => api.post(`/api/rentals/${rentalId}/reminders`, { off: false }, { key }), 'on');
              if (res.ok) {
                toast({ text: t.rem.card.onDone });
                onChanged();
              }
            }}
          >
            {t.rem.card.switchOn}
          </button>
        )}
        {mayToggle && running && !card.off && (
          <button type="button" className="pill pill-sm" onClick={() => setAsking(true)}>
            {t.rem.card.switchOff}
          </button>
        )}
      </BlockHead>
      {card.off ? (
        <p className="warn-text">
          {t.rem.card.offWhy(card.off.reason)}
          {card.off.by && card.off.at && <span className="muted"> · {t.rem.card.offBy(card.off.by, fmtDateAt(card.off.at))}</span>}
        </p>
      ) : (
        running && <p className="hint">{t.rem.card.on}</p>
      )}
      <p className="hint muted">
        {t.rem.card.sending[card.sending]} {t.rem.card.lang(t.rem.lang.names[card.lang])}
      </p>
      {running && !card.off && !card.deal && <p className="warn-text">{t.rem.card.noDeal}</p>}
      {card.recent.length > 0 ? (
        <>
          <p className="lbl">{t.rem.card.recent}</p>
          <ul className="timeline">
            {card.recent.map((x) => (
              <li key={`${x.day}:${x.slot}`}>
                <span className="mono muted">{fmtDayMonth(x.day)}</span>
                <span>{t.rem.card.row('', x.slot, t.rem.templates[x.template], formatGel(x.amountTetri), mode(x)).trim()}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">{t.rem.card.none}</p>
      )}
      {op.failure && <p className="field-err" role="alert">{op.failure.text}</p>}
      {asking && <OffSheet rentalId={rentalId} onClose={() => setAsking(false)} onDone={onChanged} />}
    </section>
  );
}

function OffSheet({ rentalId, onClose, onDone }: { rentalId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <FormSheet
      title={t.rem.card.offTitle}
      onClose={onClose}
      value={reason}
      initial=""
      label={t.rem.card.switchOff}
      submit={async (key) => {
        await api.post(`/api/rentals/${rentalId}/reminders`, { off: true, reason }, { key });
        return { toast: { text: t.rem.card.offDone } };
      }}
      onDone={onDone}
    >
      <Field label={t.rem.card.offReason} hint={t.rem.card.offHint} name="reason">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
    </FormSheet>
  );
}
