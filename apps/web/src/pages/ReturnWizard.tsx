import { gelFromTetri, parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading, Vin } from '../components/ui.js';
import { Field, Row, Wizard } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import type { RentalCard } from './RentalPage.js';

type Decision = 'full' | 'part' | 'all';

// Return in three screens (RNT-04, RNT-05): act → deposit → done. The deposit
// screen appears only for roles that decide on it; a manager's return leaves
// the deposit held for the director.
export function ReturnWizard() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const { can } = useSession();
  const { data, error } = useLoad<RentalCard>(id ? `/api/rentals/${id}` : null);
  const decides = can('deposit.decide');
  const steps = decides ? [t.ret.title, t.ret.depositDecision, t.pickup.steps.done] : [t.ret.title, t.pickup.steps.done];
  const [step, setStep] = useState(0);
  const [returnedOn, setReturnedOn] = useState(todayISO());
  const [odometer, setOdometer] = useState('');
  const [condition, setCondition] = useState('');
  const [decision, setDecision] = useState<Decision>('full');
  const [withheld, setWithheld] = useState('');
  const [reason, setReason] = useState('');
  const [returnedTo, setReturnedTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const r = data.rental;
  const amount = data.deposit?.amountTetri ?? r.depositTetri;
  const withheldTetri = decision === 'full' ? 0 : decision === 'all' ? amount : parseGel(withheld) ?? -1;
  const depositOk = !decides || (withheldTetri >= 0 && withheldTetri <= amount && (withheldTetri === 0 || reason.trim().length > 0));
  const lastStep = steps.length - 1;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/api/rentals/${r.id}/return`, {
        returnedOn,
        odometerKm: odometer ? Number(odometer) : null,
        condition: condition || null,
        deposit: decides ? { returnedTetri: amount - withheldTetri, withheldTetri, withheldReason: reason || null, returnedTo: returnedTo || null } : undefined,
      });
      setStep(lastStep);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const confirmStep = decides ? 1 : 0;
  return (
    <Wizard
      title={`${t.ret.title} · ${r.number}`}
      steps={steps}
      step={step}
      error={err}
      busy={busy}
      onBack={step > 0 && step < lastStep ? () => setStep(step - 1) : undefined}
      onNext={step < confirmStep ? () => setStep(step + 1) : step === confirmStep ? submit : () => navigate(`/rentals/${r.id}`)}
      nextLabel={step === lastStep ? t.actions.open : step === confirmStep ? t.actions.confirm : undefined}
      nextDisabled={step === confirmStep && !depositOk}
    >
      {step === 0 && (
        <>
          <section className="card">
            <Row k={t.rentals.customer} v={r.customer.name} />
            <Row k={t.rentals.vehicle} v={r.vehicle ? <Vin vin={r.vehicle.vin} /> : <span className="warn-text">{t.rentals.vinUnconfirmed}</span>} />
            <Row k={t.rentals.pickedUp} v={<span className="mono">{fmtDate(r.pickedUpOn)}</span>} />
            <Row k={t.rentals.paidThrough} v={<span className="mono">{fmtDate(r.paidThrough)}</span>} />
          </section>
          <Field label={t.ret.returnedOn}>
            <input className="input mono" type="date" value={returnedOn} onChange={(e) => setReturnedOn(e.target.value)} />
          </Field>
          <Field label={t.ret.odometer}>
            <input className="input mono" value={odometer} onChange={(e) => setOdometer(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={t.ret.condition}>
            <textarea className="input textarea" rows={3} value={condition} onChange={(e) => setCondition(e.target.value)} />
          </Field>
          {!decides && <p className="hint muted">{t.ret.leaveToDirector}</p>}
        </>
      )}

      {decides && step === 1 && (
        <>
          <Row k={t.rentals.deposit} v={<span className="mono">{formatGel(amount, { decimals: false })}</span>} />
          <div className="chips">
            {(['full', 'part', 'all'] as Decision[]).map((d) => (
              <button key={d} type="button" className={`pill pill-sm ${decision === d ? 'on' : ''}`} onClick={() => setDecision(d)}>
                {d === 'full' ? t.ret.returnFull : d === 'part' ? t.ret.withholdPart : t.ret.withholdAll}
              </button>
            ))}
          </div>
          {decision === 'part' && (
            <Field label={t.ret.withheldAmount}>
              <input className="input input-amount mono" value={withheld} onChange={(e) => setWithheld(e.target.value)} inputMode="decimal" placeholder={gelFromTetri(amount).toString()} />
            </Field>
          )}
          {decision !== 'full' && (
            <Field label={t.ret.withheldReason}>
              <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {decision !== 'all' && (
            <Field label={t.ret.returnedTo}>
              <input className="input" value={returnedTo} onChange={(e) => setReturnedTo(e.target.value)} />
            </Field>
          )}
        </>
      )}

      {step === lastStep && (
        <section className="card">
          <p>{t.ret.done}</p>
        </section>
      )}
    </Wizard>
  );
}
