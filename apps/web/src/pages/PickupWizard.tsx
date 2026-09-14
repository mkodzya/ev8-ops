import { DEFAULT_DEPOSIT_TETRI, DEFAULT_WEEKLY_RATES_TETRI, gelFromTetri, parseGel, todayISO, type VehicleState } from '@ev8/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { StateBadge, Vin } from '../components/ui.js';
import { Field, Row, Wizard } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { CustomerForm } from './CustomerForm.js';

interface Customers {
  customers: { id: string; name: string; nameLat: string | null; phone: string | null }[];
}
interface Fleet {
  vehicles: { id: string; vin: string; model: string; color: string | null; state: VehicleState }[];
}

// Hand-over in five screens (RNT-01): customer → moped → terms → act → done.
export function PickupWizard() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const steps = [t.pickup.steps.customer, t.pickup.steps.vehicle, t.pickup.steps.terms, t.pickup.steps.act, t.pickup.steps.done];
  const [step, setStep] = useState(0);

  const customers = useLoad<Customers>('/api/customers');
  const fleet = useLoad<Fleet>('/api/fleet');

  const [customerId, setCustomerId] = useState<string | null>(params.get('customer'));
  const [creating, setCreating] = useState(false);
  const [q, setQ] = useState('');
  const [vehicleId, setVehicleId] = useState<string | null>(params.get('vehicle'));
  const [noVin, setNoVin] = useState(false);
  const [vinNote, setVinNote] = useState('');
  const [vq, setVq] = useState('');
  const [rate, setRate] = useState<string>(gelFromTetri(DEFAULT_WEEKLY_RATES_TETRI[1]).toString());
  const [deposit, setDeposit] = useState<string>(gelFromTetri(DEFAULT_DEPOSIT_TETRI).toString());
  const [pickedUpOn, setPickedUpOn] = useState(todayISO());
  const [expectedReturnOn, setExpectedReturnOn] = useState('');
  const [odometer, setOdometer] = useState('');
  const [condition, setCondition] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; number: string } | null>(null);

  // Arrived from a card with the customer or the moped already chosen: skip ahead.
  useEffect(() => {
    if (params.get('customer') && step === 0) setStep(1);
  }, [params, step]);

  const customer = customers.data?.customers.find((c) => c.id === customerId) ?? null;
  const vehicle = fleet.data?.vehicles.find((v) => v.id === vehicleId) ?? null;
  const shownCustomers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const all = customers.data?.customers ?? [];
    return (needle ? all.filter((c) => [c.name, c.nameLat, c.phone].some((s) => s?.toLowerCase().includes(needle))) : all).slice(0, 30);
  }, [customers.data, q]);
  const available = useMemo(() => {
    const needle = vq.trim().toUpperCase();
    return (fleet.data?.vehicles ?? []).filter((v) => v.state === 'available' && (!needle || v.vin.includes(needle)));
  }, [fleet.data, vq]);

  const rateTetri = parseGel(rate);
  const depositTetri = parseGel(deposit);
  const canNext = [
    !!customerId,
    !!vehicleId || (noVin && vinNote.trim().length > 0),
    rateTetri != null && rateTetri >= 0 && depositTetri != null && depositTetri >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(pickedUpOn),
    true,
    true,
  ][step];

  const vehicleCell = noVin ? (
    <span className="warn-text">{t.rentals.vinUnconfirmed}</span>
  ) : vehicle ? (
    <>
      <Vin vin={vehicle.vin} /> <span className="muted">{vehicle.model}</span>
    </>
  ) : (
    ''
  );

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ id: string; number: string }>('/api/rentals', {
        customerId,
        vehicleId: noVin ? null : vehicleId,
        vinNote: noVin ? vinNote : null,
        weeklyRateTetri: rateTetri,
        depositTetri,
        pickedUpOn,
        expectedReturnOn: expectedReturnOn || null,
        odometerKm: odometer ? Number(odometer) : null,
        condition: condition || null,
      });
      setResult(r);
      setStep(4);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Wizard
      title={t.pickup.title}
      steps={steps}
      step={step}
      error={err}
      busy={busy}
      onBack={step > 0 && step < 4 ? () => setStep(step - 1) : undefined}
      onNext={step < 3 ? () => setStep(step + 1) : step === 3 ? submit : () => navigate(`/rentals/${result!.id}`)}
      nextLabel={step === 4 ? t.actions.open : step === 3 ? t.actions.confirm : undefined}
      nextDisabled={!canNext}
    >
      {step === 0 && (
        <>
          <input className="input" placeholder={t.pickup.searchCustomer} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <ul className="pick-list">
            {shownCustomers.map((c) => (
              <li key={c.id}>
                <button type="button" className={c.id === customerId ? 'on' : ''} onClick={() => setCustomerId(c.id)}>
                  <span>{c.name}</span>
                  <span className="mono muted">{c.phone ?? ''}</span>
                </button>
              </li>
            ))}
          </ul>
          {!creating ? (
            <button type="button" className="pill pill-sm" onClick={() => setCreating(true)}>
              {t.actions.newCustomer}
            </button>
          ) : (
            <section className="card">
              <CustomerForm
                embedded
                onCreated={(id) => {
                  setCustomerId(id);
                  setCreating(false);
                  customers.reload();
                }}
              />
            </section>
          )}
        </>
      )}

      {step === 1 && (
        <>
          <input className="input mono" placeholder={t.fleet.searchHint} value={vq} onChange={(e) => setVq(e.target.value)} disabled={noVin} />
          {available.length === 0 && !noVin && <p className="empty">{t.pickup.noAvailable}</p>}
          <ul className={`pick-list ${noVin ? 'dim' : ''}`}>
            {available.map((v) => (
              <li key={v.id}>
                <button type="button" className={v.id === vehicleId ? 'on' : ''} disabled={noVin} onClick={() => setVehicleId(v.id)}>
                  <Vin vin={v.vin} />
                  <span className="muted">
                    {v.model} · {v.color ?? ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <label className="check">
            <input type="checkbox" checked={noVin} onChange={(e) => setNoVin(e.target.checked)} />
            <span>{t.pickup.noVehicle}</span>
          </label>
          {noVin && (
            <Field label={t.rentals.vinUnconfirmed} hint={t.pickup.noVehicleHint}>
              <input className="input" value={vinNote} onChange={(e) => setVinNote(e.target.value)} />
            </Field>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <Field label={t.pickup.rate}>
            <div className="chips">
              {DEFAULT_WEEKLY_RATES_TETRI.map((r) => (
                <button key={r} type="button" className={`pill pill-sm ${parseGel(rate) === r ? 'on' : ''}`} onClick={() => setRate(gelFromTetri(r).toString())}>
                  {formatGel(r, { decimals: false })}
                </button>
              ))}
              <input className="input input-amount mono" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
            </div>
          </Field>
          <Field label={t.pickup.deposit}>
            <input className="input input-amount mono" value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={t.pickup.pickedUpOn}>
            <input className="input mono" type="date" value={pickedUpOn} onChange={(e) => setPickedUpOn(e.target.value)} />
          </Field>
          <Field label={t.pickup.expectedReturnOn}>
            <input className="input mono" type="date" value={expectedReturnOn} onChange={(e) => setExpectedReturnOn(e.target.value)} />
          </Field>
        </>
      )}

      {step === 3 && (
        <>
          <Field label={t.pickup.odometer}>
            <input className="input mono" value={odometer} onChange={(e) => setOdometer(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={t.pickup.condition}>
            <textarea className="input textarea" rows={3} value={condition} onChange={(e) => setCondition(e.target.value)} />
          </Field>
          <p className="hint muted">{t.pickup.photosLater}</p>
          <section className="card">
            <h2>{t.pickup.summary}</h2>
            <Row k={t.rentals.customer} v={customer?.name ?? ''} />
            <Row k={t.rentals.vehicle} v={vehicleCell} />
            <Row k={t.pickup.rate} v={<span className="mono">{formatGel(rateTetri, { decimals: false })}{t.rentals.perWeek}</span>} />
            <Row k={t.pickup.deposit} v={<span className="mono">{formatGel(depositTetri, { decimals: false })}</span>} />
            <Row k={t.pickup.pickedUpOn} v={<span className="mono">{fmtDate(pickedUpOn)}</span>} />
          </section>
        </>
      )}

      {step === 4 && result && (
        <section className="card">
          <p>{t.pickup.created(result.number)}</p>
          {vehicle && (
            <p>
              <Vin vin={vehicle.vin} /> <StateBadge state="rented" />
            </p>
          )}
          <p>
            <Link to="/" className="pill pill-sm">
              {t.nav.today}
            </Link>
          </p>
        </section>
      )}
    </Wizard>
  );
}
