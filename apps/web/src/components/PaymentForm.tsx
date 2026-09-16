import { parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { api } from '../api.js';
import { formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { Drawer } from './Drawer.js';
import { errorText } from '../lib/use.js';
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
  const [channel, setChannel] = useState<Channel>(bank ? 'transfer' : 'cash');
  const [byNet, setByNet] = useState(false);
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayISO());
  const [bankText, setBankText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const channels: Channel[] = bank ? ['transfer', 'acquiring', 'cash'] : ['cash'];
  const tetriValue = parseGel(amount);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post<{ allocated: number; leftover: number }>('/api/payments', {
        rentalId: rentalId ?? null,
        customerId: customerId ?? null,
        channel,
        ...(channel === 'acquiring' && byNet ? { netTetri: tetriValue } : { grossTetri: tetriValue }),
        occurredOn,
        bankText: bankText || null,
        note: note || null,
      });
      setDone(t.payments.recorded(formatGel(res.allocated), formatGel(res.leftover)));
      setAmount('');
      setBankText('');
      setNote('');
      setOpen(false);
      onDone();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="row-actions">
        <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
          + {t.payments.add}
        </button>
        {!bank && <span className="hint muted">{t.payments.cashOnly}</span>}
        {done && <span className="hint">{done}</span>}
      </div>
      {open && (
        <Drawer title={t.payments.add} onClose={() => setOpen(false)}>
          <form className="form" onSubmit={submit}>
      <Field label={t.payments.channel}>
        <div className="chips">
          {channels.map((c) => (
            <button key={c} type="button" className={`pill pill-sm ${channel === c ? 'on' : ''}`} onClick={() => setChannel(c)}>
              {t.payments.channels[c]}
            </button>
          ))}
        </div>
      </Field>
      {channel === 'acquiring' && (
        <label className="check">
          <input type="checkbox" checked={byNet} onChange={(e) => setByNet(e.target.checked)} />
          <span>{t.payments.net}</span>
        </label>
      )}
      <Field label={channel === 'acquiring' && byNet ? t.payments.net : t.payments.gross} hint={channel === 'acquiring' ? t.payments.feeHint : undefined}>
        <input className="input input-amount mono" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoFocus />
      </Field>
      <Field label={t.payments.date}>
        <input className="input mono" type="date" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} />
      </Field>
      {channel !== 'cash' && (
        <Field label={t.payments.bankText}>
          <input className="input" value={bankText} onChange={(e) => setBankText(e.target.value)} />
        </Field>
      )}
      <Field label={t.payments.note}>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {err && <div className="hint hint-bad">{err}</div>}
      <div className="row-actions">
        <button type="button" className="pill" onClick={() => setOpen(false)}>
          {t.actions.cancel}
        </button>
        <button className="pill pill-accent" disabled={busy || tetriValue == null || tetriValue <= 0}>
          {busy ? t.common.checking : t.actions.confirm}
        </button>
      </div>
          </form>
        </Drawer>
      )}
    </>
  );
}
