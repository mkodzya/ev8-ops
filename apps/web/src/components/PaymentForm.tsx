import { parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { FormSheet } from '../ds/form/Form.js';
import { useSession } from '../session.js';
import { Field } from './Wizard.js';

type Channel = 'transfer' | 'acquiring' | 'cash';

/**
 * Recording a payment. A manager sees cash only — that is the whole of
 * PAY-05 — and whoever reconciles the bank sees all three channels.
 *
 * For a card payment the figure asked for is the one at hand: at the
 * counter it is what the customer paid, from a statement it is what the
 * bank credited. The other is worked out and shown before saving.
 */
export function PaymentForm({
  rentalId,
  customerId,
  onDone,
}: {
  rentalId?: string;
  customerId?: string;
  onDone: () => void;
}) {
  const t = useT();
  const { can } = useSession();
  const bank = can('payments.reconcile');
  const [open, setOpen] = useState(false);
  const blank = { channel: (bank ? 'transfer' : 'cash') as Channel, byNet: false, amount: '', occurredOn: todayISO(), bankText: '', note: '' };
  const [f, setF] = useState(blank);
  const channels: Channel[] = bank ? ['transfer', 'acquiring', 'cash'] : ['cash'];
  const draft = `payment-new:${rentalId ?? customerId ?? 'loose'}`;

  return (
    <>
      <div className="row-actions">
        <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
          + {t.payments.add}
        </button>
        {!bank && <span className="hint muted">{t.payments.cashOnly}</span>}
      </div>
      {open && (
        <FormSheet
          title={t.payments.add}
          onClose={() => setOpen(false)}
          value={f}
          initial={blank}
          draft={draft}
          onRestore={setF}
          summary={(v) => v.amount}
          label={t.payments.record}
          submit={async (key) => {
            const tetri = parseGel(f.amount);
            const byNet = f.channel === 'acquiring' && f.byNet;
            const res = await api.post<{ allocated: number; leftover: number }>(
              '/api/payments',
              {
                rentalId: rentalId ?? null,
                customerId: customerId ?? null,
                channel: f.channel,
                ...(byNet ? { netTetri: tetri } : { grossTetri: tetri }),
                occurredOn: f.occurredOn,
                bankText: f.channel === 'cash' ? null : f.bankText || null,
                note: f.note || null,
              },
              { key },
            );
            return { toast: { text: t.payments.recorded(formatGel(res.allocated), formatGel(res.leftover)) } };
          }}
          onDone={() => {
            setF(blank);
            onDone();
          }}
        >
          <Field label={t.payments.channel} name="channel">
            <div className="chips">
              {channels.map((c) => (
                <button key={c} type="button" className={`pill pill-sm ${f.channel === c ? 'on' : ''}`} onClick={() => setF({ ...f, channel: c })}>
                  {t.payments.channels[c]}
                </button>
              ))}
            </div>
          </Field>
          {f.channel === 'acquiring' && (
            <label className="check">
              <input type="checkbox" checked={f.byNet} onChange={(e) => setF({ ...f, byNet: e.target.checked })} />
              <span>{t.payments.net}</span>
            </label>
          )}
          <Field
            label={f.channel === 'acquiring' && f.byNet ? t.payments.net : t.payments.gross}
            hint={f.channel === 'acquiring' ? t.payments.feeHint : undefined}
            name={f.channel === 'acquiring' && f.byNet ? 'netTetri' : 'grossTetri'}
          >
            <input className="input input-amount mono" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} inputMode="decimal" autoFocus />
          </Field>
          <Field label={t.payments.date} name="occurredOn">
            <input className="input mono" type="date" value={f.occurredOn} onChange={(e) => setF({ ...f, occurredOn: e.target.value })} />
          </Field>
          {f.channel !== 'cash' && (
            <Field label={t.payments.bankText} name="bankText">
              <input className="input" value={f.bankText} onChange={(e) => setF({ ...f, bankText: e.target.value })} />
            </Field>
          )}
          <Field label={t.payments.note} name="note">
            <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          </Field>
        </FormSheet>
      )}
    </>
  );
}
