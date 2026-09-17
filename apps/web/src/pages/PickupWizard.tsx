import { DEFAULT_DEPOSIT_TETRI, DEFAULT_WEEKLY_RATES_TETRI, gelFromTetri, parseGel, todayISO, type VehicleState } from '@ev8/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { BlockHead, ColorText, Loading, StateBadge, Vin } from '../components/ui.js';
import { Field, Row, Wizard } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { DraftOffer } from '../ds/form/Form.js';
import { useDraft } from '../ds/form/drafts.js';
import { useOperation } from '../ds/form/operation.js';
import { uploadAll, type PreparedPhoto } from '../lib/photos.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { CustomerForm } from './CustomerForm.js';
import { LoadError } from '../components/LoadError.js';

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
  // Arrived from a card with the customer already chosen: the list step is skipped.
  const [step, setStep] = useState(params.get('customer') ? 1 : 0);

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
  const [nightParking, setNightParking] = useState('');
  const [batteries, setBatteries] = useState('2');
  const [chargers, setChargers] = useState('2');
  const [odometer, setOdometer] = useState('');
  const [condition, setCondition] = useState('');
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; number: string } | null>(null);
  const op = useOperation();

  // The draft: everything typed except the photos, which are files. A hand-over
  // interrupted by a call is picked up where it stopped (wave 1 §3.7).
  const typed = { step, customerId, noVin, vinNote, vehicleId, rate, deposit, pickedUpOn, expectedReturnOn, nightParking, batteries, chargers, odometer, condition };
  const [start] = useState(() => typed);
  const drafts = useDraft({ id: 'pickup', value: typed, initial: start, hold: result != null });
  const restore = (d: typeof typed) => {
    setStep(Math.min(d.step, 3));
    setCustomerId(d.customerId);
    setNoVin(d.noVin);
    setVinNote(d.vinNote);
    setVehicleId(d.vehicleId);
    setRate(d.rate);
    setDeposit(d.deposit);
    setPickedUpOn(d.pickedUpOn);
    setExpectedReturnOn(d.expectedReturnOn);
    setNightParking(d.nightParking);
    setBatteries(d.batteries);
    setChargers(d.chargers);
    setOdometer(d.odometer);
    setCondition(d.condition);
  };

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
    rateTetri != null &&
      rateTetri >= 0 &&
      depositTetri != null &&
      depositTetri >= 0 &&
      /^\d{4}-\d{2}-\d{2}$/.test(pickedUpOn) &&
      nightParking.trim().length > 0,
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

  // One hand-over, however many times the button is pressed: the rental and
  // each photo carry keys, so a retry after a lost answer or a failed photo
  // finds what is already stored instead of storing it twice.
  const submit = async () => {
    const res = await op.run(async (key) => {
      const r = await api.post<{ id: string; number: string; actId: string }>(
        '/api/rentals',
        {
          customerId,
          vehicleId: noVin ? null : vehicleId,
          vinNote: noVin ? vinNote : null,
          weeklyRateTetri: rateTetri,
          depositTetri,
          pickedUpOn,
          expectedReturnOn: expectedReturnOn || null,
          nightParkingAddress: nightParking || null,
          batteries: batteries === '' ? null : Number(batteries),
          chargers: chargers === '' ? null : Number(chargers),
          odometerKm: odometer ? Number(odometer) : null,
          condition: condition || null,
        },
        { key },
      );
      setResult(r);
      drafts.drop();
      await uploadAll(`/api/acts/${r.actId}/photos`, photos, (n) => setProgress(t.photos.uploading(n, photos.length)), `${key}-photo`);
      return r;
    });
    setProgress(null);
    if (res.ok) setStep(4);
  };
  // A refusal about a field on an earlier step goes back to that step, where the words sit under the field.
  const stepOfField: Record<string, number> = {
    customerId: 0,
    vehicleId: 1,
    vinNote: 1,
    weeklyRateTetri: 2,
    depositTetri: 2,
    pickedUpOn: 2,
    expectedReturnOn: 2,
    nightParkingAddress: 2,
    batteries: 2,
    chargers: 2,
  };
  useEffect(() => {
    const field = op.failure?.field;
    if (field && stepOfField[field] != null) setStep(stepOfField[field]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.failure]);

  if (drafts.offer) {
    return (
      <Wizard title={t.pickup.title} steps={steps} step={0}>
        <DraftOffer at={drafts.offer.at} words={customers.data?.customers.find((c) => c.id === drafts.offer!.value.customerId)?.name} onContinue={() => drafts.accept(restore)} onDiscard={drafts.discard} />
      </Wizard>
    );
  }

  return (
    <Wizard
      title={t.pickup.title}
      steps={steps}
      step={step}
      submit={step === 3 ? { state: op.state, failure: op.failure, label: t.pickup.handOver } : undefined}
      onBack={step > 0 && step < 4 ? () => setStep(step - 1) : undefined}
      onNext={step < 3 ? () => setStep(step + 1) : step === 3 ? submit : () => navigate(`/rentals/${result!.id}`)}
      nextLabel={step === 4 ? t.actions.open : step === 3 ? t.actions.confirm : undefined}
      nextDisabled={!canNext}
    >
      {step === 0 && (
        <>
          <input className="input" placeholder={t.pickup.searchCustomer} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          {/* The list is what stops a second card for somebody already here:
              when it cannot load, that is said, not shown as "nobody". */}
          {!customers.data && (customers.failure ? <LoadError failure={customers.failure} onRetry={customers.reload} /> : <Loading rows={3} />)}
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
          {!fleet.data && (fleet.failure ? <LoadError failure={fleet.failure} onRetry={fleet.reload} /> : <Loading rows={3} />)}
          {fleet.data && available.length === 0 && !noVin && <p className="empty">{t.pickup.noAvailable}</p>}
          <ul className={`pick-list ${noVin ? 'dim' : ''}`}>
            {available.map((v) => (
              <li key={v.id}>
                <button type="button" className={v.id === vehicleId ? 'on' : ''} disabled={noVin} onClick={() => setVehicleId(v.id)}>
                  <Vin vin={v.vin} />
                  <span className="muted">
                    {v.model}{v.color && <> · <ColorText of={v.color} named /></>}
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
            <Field label={t.rentals.vinUnconfirmed} hint={t.pickup.noVehicleHint} name="vinNote">
              <input className="input" value={vinNote} onChange={(e) => setVinNote(e.target.value)} />
            </Field>
          )}
        </>
      )}

      {step === 2 && (
        <>
          <Field label={t.pickup.rate} name="weeklyRateTetri">
            <div className="chips">
              {DEFAULT_WEEKLY_RATES_TETRI.map((r) => (
                <button key={r} type="button" className={`pill pill-sm ${parseGel(rate) === r ? 'on' : ''}`} onClick={() => setRate(gelFromTetri(r).toString())}>
                  {formatGel(r, { decimals: false })}
                </button>
              ))}
              <input className="input input-amount mono" value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
            </div>
          </Field>
          <Field label={t.pickup.deposit} name="depositTetri">
            <input className="input input-amount mono" value={deposit} onChange={(e) => setDeposit(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={t.pickup.pickedUpOn} name="pickedUpOn">
            <input className="input mono" type="date" value={pickedUpOn} onChange={(e) => setPickedUpOn(e.target.value)} />
          </Field>
          <Field label={t.pickup.expectedReturnOn} name="expectedReturnOn">
            <input className="input mono" type="date" value={expectedReturnOn} onChange={(e) => setExpectedReturnOn(e.target.value)} />
          </Field>
          <Field label={t.handover.nightParking} hint={t.handover.nightParkingHint} name="nightParkingAddress">
            <input className="input" value={nightParking} onChange={(e) => setNightParking(e.target.value)} />
          </Field>
          <div className="two-col">
            <Field label={t.handover.batteries} name="batteries">
              <input className="input input-amount mono" value={batteries} onChange={(e) => setBatteries(e.target.value)} inputMode="numeric" />
            </Field>
            <Field label={t.handover.chargers} name="chargers">
              <input className="input input-amount mono" value={chargers} onChange={(e) => setChargers(e.target.value)} inputMode="numeric" />
            </Field>
          </div>
        </>
      )}

      {step === 3 && (
        <>
          <Field label={t.pickup.odometer} name="odometerKm">
            <input className="input mono" value={odometer} onChange={(e) => setOdometer(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={t.pickup.condition} name="condition">
            <textarea className="input textarea" rows={3} value={condition} onChange={(e) => setCondition(e.target.value)} />
          </Field>
          <PhotoPicker photos={photos} onChange={setPhotos} label={t.pickup.photos} />
          {progress && <p className="hint muted">{progress}</p>}
          <section className="card">
            <BlockHead title={t.pickup.summary} />
            <Row k={t.rentals.customer} v={customer?.name ?? ''} />
            <Row k={t.rentals.vehicle} v={vehicleCell} />
            <Row k={t.pickup.rate} v={<span className="mono">{formatGel(rateTetri, { decimals: false })}{t.rentals.perWeek}</span>} />
            <Row k={t.pickup.deposit} v={<span className="mono">{formatGel(depositTetri, { decimals: false })}</span>} />
            <Row k={t.pickup.pickedUpOn} v={<span className="mono">{fmtDate(pickedUpOn)}</span>} />
            <Row k={t.handover.nightParking} v={nightParking} />
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
