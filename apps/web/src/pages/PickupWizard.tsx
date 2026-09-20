import { acquiringFee, acquiringNet, addDays, CUSTOMER_SOURCES, DEFAULT_DEPOSIT_TETRI, gelFromTetri, parseGel, todayISO, type VehiclePool, type VehicleState } from '@ev8/shared';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { DocumentRow } from '../components/Documents.js';
import { LoadError } from '../components/LoadError.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { ColorText, CustomerName, Loading, Vin } from '../components/ui.js';
import { Field, Row, Wizard } from '../components/Wizard.js';
import { DraftOffer } from '../ds/form/Form.js';
import { useDraft } from '../ds/form/drafts.js';
import { useOperation } from '../ds/form/operation.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { toBase64, uploadAll, type PreparedPhoto } from '../lib/photos.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import type { RentalCard } from './RentalPage.js';

interface DebtPart {
  kind: string;
  id: string;
  number: string;
  owesTetri: number;
}
interface CustomerRow {
  id: string;
  name: string;
  nameKa: string | null;
  nameLat: string | null;
  phone: string | null;
  isSupplier: boolean;
  rentals: number;
  debtTetri: number;
  debtIn: DebtPart[];
}
interface FleetRow {
  id: string;
  vin: string;
  model: string;
  weeklyRateTetri: number | null;
  color: string | null;
  state: VehicleState;
  pool: VehiclePool | null;
  location: { id: string; name: string } | null;
  odometerKm: number | null;
}
type Channel = 'cash' | 'acquiring' | 'transfer' | 'later';

const digitsOf = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');
/** The part of a phone number that tells two people apart, with or without +995. */
const phoneKey = (s: string | null | undefined) => digitsOf(s).slice(-9);
const short = (iso: string) => fmtDate(iso).slice(0, 5);
const days = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const gel = (tetri: number) => gelFromTetri(tetri).toString();

/** +995 595 12 34 56 — spaced when the field is left, the way it is read aloud. */
function formatPhone(s: string): string {
  const d = digitsOf(s);
  const local = d.startsWith('995') ? d.slice(3) : d;
  if (local.length !== 9) return s.trim();
  return `+995 ${local.slice(0, 3)} ${local.slice(3, 5)} ${local.slice(5, 7)} ${local.slice(7)}`;
}

async function photoBody(p: PreparedPhoto | null) {
  return p ? { mimeType: p.mimeType, dataBase64: await toBase64(p.blob) } : undefined;
}

// Hand-over in six screens and "Done" (wave 3 §3.1): customer → moped → terms →
// act → payment → summary. One button at the end writes all of it under one key.
export function PickupWizard() {
  const t = useT();
  const [params] = useSearchParams();
  const { can } = useSession();
  const openMoney = useMoneyForm();
  const owner = can('deposit.decide');
  const takesTransfers = can('payments.reconcile');
  const steps = [t.hand.steps.customer, t.hand.steps.vehicle, t.hand.steps.terms, t.hand.steps.act, t.hand.steps.payment, t.hand.steps.summary];
  const presetVehicle = params.get('vehicle');
  const presetCustomer = params.get('customer');

  const customers = useLoad<{ customers: CustomerRow[] }>('/api/customers');
  const fleet = useLoad<{ vehicles: FleetRow[] }>('/api/fleet');
  const recentRentals = useLoad<{ rentals: { customer: { id: string } }[] }>('/api/rentals');
  const batteries = useLoad<{ showroom: number }>('/api/batteries');

  const today = todayISO();
  const start = {
    step: presetCustomer ? 1 : 0,
    customerId: presetCustomer,
    creating: false,
    ncPhone: '+995 ',
    ncName: '',
    ncSource: '',
    why: '',
    vehicleId: presetVehicle,
    noVin: false,
    vinNote: '',
    moveFromSale: false,
    rate: '',
    rateTouched: false,
    deposit: gel(DEFAULT_DEPOSIT_TETRI),
    pickedUpOn: today,
    expectedReturnOn: '',
    nightParking: '',
    batteries: 2,
    chargers: 2,
    transfer: false,
    paidThrough: '',
    depositBefore: gel(DEFAULT_DEPOSIT_TETRI),
    odometer: '',
    odometerReason: '',
    condition: '',
    channel: null as Channel | null,
    amount: '',
  };
  const [initial] = useState(start);
  const [f, setF] = useState(start);
  const set = (patch: Partial<typeof start>) => setF((x) => ({ ...x, ...patch }));
  // Not in the draft (B4-02): the personal number and the pictures stay on no device.
  const [ncPersonalId, setNcPersonalId] = useState('');
  const [idPhoto, setIdPhoto] = useState<PreparedPhoto[]>([]);
  const [licencePhoto, setLicencePhoto] = useState<PreparedPhoto[]>([]);
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [photosLost, setPhotosLost] = useState(false);
  const [docsLost, setDocsLost] = useState(false);
  const [fewOk, setFewOk] = useState(false);
  const [askFew, setAskFew] = useState(false);
  const [q, setQ] = useState('');
  const [vq, setVq] = useState('');
  const [showSale, setShowSale] = useState(false);
  const [twin, setTwin] = useState<{ id: string; name: string } | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [photoTrouble, setPhotoTrouble] = useState(false);
  const [result, setResult] = useState<{ id: string; number: string } | null>(null);
  const op = useOperation();

  const drafts = useDraft({ id: 'pickup', value: f, initial, hold: result != null });
  const restore = (d: typeof start) => {
    // A new customer's personal number and ID photo were not kept (B4-02): back to them first (QA-W3-02).
    if (d.creating) {
      setF({ ...d, step: 0 });
      setDocsLost(true);
    } else setF({ ...d, step: Math.min(d.step, 4) });
    if (d.step >= 3) setPhotosLost(true);
  };

  // ---- what has been chosen ------------------------------------------------
  const allCustomers = customers.data?.customers ?? [];
  const customer = allCustomers.find((c) => c.id === f.customerId) ?? null;
  const vehicles = fleet.data?.vehicles ?? [];
  const vehicle = vehicles.find((v) => v.id === f.vehicleId) ?? null;
  const inSale = vehicle?.pool === 'sale';

  // The model's rate, until somebody types another (B4-05).
  useEffect(() => {
    if (vehicle?.weeklyRateTetri != null && !f.rateTouched) set({ rate: gel(vehicle.weeklyRateTetri) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, vehicle?.weeklyRateTetri]);

  const shownCustomers = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const needleDigits = digitsOf(q);
    const people = allCustomers.filter((c) => !c.isSupplier || c.rentals > 0);
    if (!needle) {
      // Five most recent: the latest hand-overs' customers.
      const ids: string[] = [];
      for (const r of recentRentals.data?.rentals ?? []) if (!ids.includes(r.customer.id)) ids.push(r.customer.id);
      return ids
        .slice(0, 5)
        .map((id) => people.find((c) => c.id === id))
        .filter((c): c is CustomerRow => !!c);
    }
    return people
      .filter((c) => [c.name, c.nameKa, c.nameLat].some((s) => s?.toLowerCase().includes(needle)) || (needleDigits.length >= 3 && digitsOf(c.phone).includes(needleDigits)))
      .slice(0, 20);
  }, [allCustomers, recentRentals.data, q]);

  const vinNeedle = vq.trim().toUpperCase();
  const free = vehicles.filter((v) => v.state === 'available' && (!vinNeedle || v.vin.includes(vinNeedle)));
  const forRent = free.filter((v) => v.pool !== 'sale');
  const forSale = free.filter((v) => v.pool === 'sale');

  // ---- money --------------------------------------------------------------
  const rateTetri = parseGel(f.rate || '0') ?? -1;
  const depositTetri = parseGel(f.deposit || '0') ?? -1;
  const depositBeforeTetri = parseGel(f.depositBefore || '0') ?? -1;
  const transfer = owner && f.transfer;
  const weeksTotal = f.pickedUpOn <= today ? Math.floor(days(f.pickedUpOn, today) / 7) + 1 : 1;
  const paidWeeks = transfer && f.paidThrough ? Math.round((days(f.pickedUpOn, f.paidThrough) + 1) / 7) : 0;
  const weekEnds = Array.from({ length: weeksTotal }, (_, i) => addDays(f.pickedUpOn, 7 * (i + 1) - 1));
  const owedWeeks = Math.max(0, weeksTotal - paidWeeks);
  const dueTetri = transfer
    ? owedWeeks * Math.max(0, rateTetri) + Math.max(0, depositTetri - Math.max(0, depositBeforeTetri))
    : Math.max(0, rateTetri) + Math.max(0, depositTetri);
  const amountTetri = f.amount ? parseGel(f.amount) : dueTetri;
  const paymentNeeded = !transfer || dueTetri > 0;
  // What the money closes, the way the server spreads it: the deposit first, then the weeks (Q6).
  const depositDue = transfer ? Math.max(0, depositTetri - Math.max(0, depositBeforeTetri)) : Math.max(0, depositTetri);
  const weeksDue = Math.max(0, dueTetri - depositDue);
  const closesDeposit = Math.min(Math.max(0, amountTetri ?? 0), depositDue);
  const closesWeeks = Math.min(Math.max(0, (amountTetri ?? 0) - closesDeposit), weeksDue);

  // ---- what each step needs ---------------------------------------------------
  const ncPhoneOk = phoneKey(f.ncPhone).length === 9;
  const ncOk = ncPhoneOk && f.ncName.trim().length > 0 && ncPersonalId.trim().length > 0 && idPhoto.length > 0 && !twin;
  const debt = !f.creating && customer && customer.debtTetri > 0 ? customer : null;
  const customerOk = f.creating ? ncOk : !!customer && (!debt || (owner && f.why.trim().length > 0));
  const vehicleOk = f.noVin ? f.vinNote.trim().length > 0 : !!vehicle && (!inSale || (owner && f.moveFromSale));
  const termsOk =
    rateTetri >= 0 &&
    depositTetri >= 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(f.pickedUpOn) &&
    f.pickedUpOn <= today &&
    (!f.expectedReturnOn || f.expectedReturnOn >= f.pickedUpOn) &&
    f.nightParking.trim().length > 0 &&
    (!transfer || (f.pickedUpOn < today && depositBeforeTetri >= 0 && depositBeforeTetri <= depositTetri));
  const pickedUpError = f.pickedUpOn > today ? t.hand.notAfterToday : transfer && f.pickedUpOn >= today ? t.hand.transferBefore : null;
  const lastKm = vehicle?.odometerKm ?? null;
  const km = f.odometer.trim() === '' ? null : Number(f.odometer.replace(/\s/g, ''));
  const kmValid = km == null || (Number.isInteger(km) && km >= 0);
  const below = km != null && lastKm != null && km < lastKm;
  const actOk = kmValid && (transfer || km != null) && (!below || f.odometerReason.trim().length > 0);
  const paymentOk = !paymentNeeded || f.channel === 'later' || (f.channel != null && amountTetri != null && amountTetri > 0);
  const ok = [customerOk, vehicleOk, termsOk, actOk, paymentOk, true][f.step];

  const next = () => {
    if (f.step === 3 && !transfer && photos.length < 4 && !fewOk) {
      setAskFew(true);
      return;
    }
    if (f.step === 0 && presetVehicle && vehicle) return set({ step: 2 });
    set({ step: f.step + 1 });
  };
  const back = () => {
    if (f.step === 2 && presetVehicle && vehicle) return set({ step: 0 });
    set({ step: f.step - 1 });
  };

  // A refusal about a field goes back to the step it is on, where the words sit under it.
  const stepOfField: Record<string, number> = {
    customerId: 0, name: 0, phone: 0, personalId: 0, idPhoto: 0, debtOverrideReason: 0,
    vehicleId: 1, vinNote: 1,
    weeklyRateTetri: 2, depositTetri: 2, pickedUpOn: 2, expectedReturnOn: 2, nightParkingAddress: 2, batteries: 2, chargers: 2, paidThrough: 2, depositReceivedTetri: 2,
    odometerKm: 3, odometerReason: 3,
    payment: 4, channel: 4, amountTetri: 4,
  };
  const stepOfCode: Record<string, number> = { customer_in_debt: 0, duplicate_customer: 0, vehicle_not_available: 1, vehicle_in_sale_pool: 1, reconcile_required: 4 };
  useEffect(() => {
    const failure = op.failure;
    if (!failure) return;
    const to = (failure.field ? stepOfField[failure.field] : undefined) ?? (failure.code ? stepOfCode[failure.code] : undefined);
    if (to != null) set({ step: to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.failure]);

  const transferBody = transfer ? { paidThrough: f.paidThrough || null, depositReceivedTetri: depositBeforeTetri } : undefined;
  const submit = async () => {
    const res = await op.run(async (key) => {
      const body = {
        customerId: f.creating ? undefined : f.customerId,
        newCustomer: f.creating
          ? { name: f.ncName.trim(), phone: formatPhone(f.ncPhone), personalId: ncPersonalId.trim(), source: f.ncSource || null, idPhoto: await photoBody(idPhoto[0] ?? null), licencePhoto: await photoBody(licencePhoto[0] ?? null) }
          : undefined,
        vehicleId: f.noVin ? null : f.vehicleId,
        vinNote: f.noVin ? f.vinNote.trim() : null,
        moveFromSale: inSale && f.moveFromSale,
        weeklyRateTetri: rateTetri,
        depositTetri,
        pickedUpOn: f.pickedUpOn,
        expectedReturnOn: f.expectedReturnOn || null,
        nightParkingAddress: f.nightParking.trim(),
        batteries: f.batteries,
        chargers: f.chargers,
        odometerKm: km,
        odometerReason: below ? f.odometerReason.trim() : null,
        condition: f.condition.trim() || null,
        payment: !paymentNeeded ? undefined : f.channel === 'later' ? { later: true } : { later: false, channel: f.channel, amountTetri },
        transfer: transferBody,
        debtOverrideReason: debt && owner ? f.why.trim() : undefined,
      };
      let r: { id: string; number: string; actId: string };
      try {
        r = await api.post<{ id: string; number: string; actId: string }>('/api/pickups', body, { key });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'duplicate_customer') {
          const existing = e.extra.existing as { id: string; name: string } | undefined;
          if (existing) setTwin(existing);
        }
        throw e;
      }
      setResult({ id: r.id, number: r.number });
      drafts.drop();
      try {
        await uploadAll(`/api/acts/${r.actId}/photos`, photos, (n) => setProgress(t.hand.photosUploading(n, photos.length)), `${key}-photo`);
      } catch {
        setPhotoTrouble(true);
      }
      return r;
    });
    setProgress(null);
    if (res.ok) set({ step: 6 });
  };

  if (drafts.offer) {
    return (
      <Wizard title={t.hand.title} steps={steps} step={0}>
        <DraftOffer
          at={drafts.offer.at}
          words={allCustomers.find((c) => c.id === drafts.offer!.value.customerId)?.name ?? drafts.offer.value.ncName}
          onContinue={() => drafts.accept(restore)}
          onDiscard={drafts.discard}
        />
      </Wizard>
    );
  }

  if (f.step === 6 && result) return <PickupDone id={result.id} number={result.number} photoTrouble={photoTrouble} />;

  const customerName = f.creating ? f.ncName : customer?.name ?? '';
  const vehicleCell = f.noVin ? (
    <span className="warn-text">{t.rentals.vinUnconfirmed}</span>
  ) : vehicle ? (
    <>
      {vehicle.model} <Vin vin={vehicle.vin} />
    </>
  ) : (
    ''
  );
  const channelWord = f.channel === 'later' ? t.hand.payLater : f.channel ? t.payments.channels[f.channel] : '';
  const firstDebt = debt?.debtIn[0] ?? null;

  return (
    <Wizard
      title={t.hand.title}
      steps={steps}
      step={f.step}
      submit={f.step === 5 ? { state: op.state, failure: op.failure, label: t.hand.handOver } : undefined}
      failure={f.step === 5 ? null : op.failure}
      onBack={f.step > 0 ? back : undefined}
      onNext={f.step === 5 ? () => void submit() : next}
      nextLabel={f.step === 4 ? t.hand.toSummary : f.step === 0 && f.creating ? t.hand.saveAndNext : undefined}
      nextDisabled={!ok}
    >
      {f.step === 0 && (
        <>
          {!f.creating && (
            <>
              <input className="input" placeholder={t.hand.searchHint} aria-label={t.hand.search} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
              <button type="button" className="pill pill-sm" onClick={() => set({ creating: true, customerId: null, why: '' })}>
                ＋ {t.hand.newCustomer}
              </button>
              {!customers.data && (customers.failure ? <LoadError failure={customers.failure} onRetry={customers.reload} /> : <Loading rows={3} />)}
              {!q.trim() && shownCustomers.length > 0 && <h2 className="sub">{t.hand.recent}</h2>}
              <ul className="pick-list">
                {shownCustomers.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={c.id === f.customerId ? 'on' : ''} onClick={() => set({ customerId: c.id, why: '' })}>
                      <span className="pick-main">
                        <CustomerName of={c} />
                        <span className="mono muted">{c.phone ?? ''}</span>
                      </span>
                      <span className={c.debtTetri > 0 ? 'crit-text' : 'muted'}>{c.debtTetri > 0 ? t.hand.debt(formatGel(c.debtTetri, { decimals: false })) : t.hand.noDebt}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {debt && (
                <section className="card card-warn">
                  <p>
                    <b>{t.hand.debtLine(formatGel(debt.debtTetri, { decimals: false }), [...new Set(debt.debtIn.map((p) => p.number))].join(', '))}</b>
                    {!owner && <> {t.hand.ownerOnly}</>}
                  </p>
                  {!owner && can('cash.record') && firstDebt && (
                    <button
                      type="button"
                      className="pill pill-sm pill-accent"
                      onClick={() =>
                        openMoney({
                          target: {
                            kind: firstDebt.kind === 'sale' ? 'sale' : firstDebt.kind === 'service' ? 'service' : 'rent',
                            rentalId: firstDebt.kind === 'sale' || firstDebt.kind === 'service' ? undefined : firstDebt.id,
                            saleId: firstDebt.kind === 'sale' ? firstDebt.id : undefined,
                            serviceJobId: firstDebt.kind === 'service' ? firstDebt.id : undefined,
                            number: firstDebt.number,
                            customerId: debt.id,
                            customer: debt.name,
                          },
                        })
                      }
                    >
                      {t.hand.takeCash(formatGel(debt.debtTetri, { decimals: false }))}
                    </button>
                  )}
                  {owner && (
                    <Field label={t.hand.why} hint={t.hand.whyHint} name="debtOverrideReason">
                      <input className="input" value={f.why} onChange={(e) => set({ why: e.target.value })} />
                    </Field>
                  )}
                </section>
              )}
            </>
          )}
          {f.creating && docsLost && <p className="hint warn-text">{t.hand.docsLost}</p>}
          {f.creating && (
            <section className="card">
              <div className="row-actions row-between">
                <h2 className="sub">{t.hand.newCustomer}</h2>
                <button type="button" className="pill pill-sm" onClick={() => set({ creating: false })}>
                  {t.back.cancel}
                </button>
              </div>
              <Field label={t.hand.phone} name="phone">
                <input
                  className="input mono"
                  inputMode="tel"
                  value={f.ncPhone}
                  onChange={(e) => {
                    set({ ncPhone: e.target.value });
                    setTwin(null);
                  }}
                  onBlur={() => {
                    set({ ncPhone: formatPhone(f.ncPhone) });
                    const key = phoneKey(f.ncPhone);
                    const found = key.length === 9 ? allCustomers.find((c) => phoneKey(c.phone) === key) : null;
                    setTwin(found ? { id: found.id, name: found.name } : null);
                  }}
                />
              </Field>
              {twin && (
                <p className="warn-text">
                  {t.hand.exists(twin.name)}{' '}
                  <button
                    type="button"
                    className="pill pill-sm"
                    onClick={() => {
                      set({ creating: false, customerId: twin.id });
                      setTwin(null);
                    }}
                  >
                    {t.hand.openExisting}
                  </button>
                </p>
              )}
              <Field label={t.hand.name} hint={t.hand.nameHint} name="name">
                <input className="input" value={f.ncName} onChange={(e) => set({ ncName: e.target.value })} />
              </Field>
              <Field label={t.hand.personalId} hint={t.hand.personalIdHint} name="personalId">
                <input className="input mono" inputMode="numeric" value={ncPersonalId} onChange={(e) => setNcPersonalId(e.target.value)} />
              </Field>
              <Field label={t.customerW4.source} name="source">
                <div className="chips">
                  {CUSTOMER_SOURCES.map((s) => (
                    <button key={s} type="button" className={`pill pill-sm ${f.ncSource === s ? 'on' : ''}`} onClick={() => set({ ncSource: f.ncSource === s ? '' : s })}>
                      {t.customerW4.sources[s]}
                    </button>
                  ))}
                </div>
              </Field>
              <p className="hint muted">{t.hand.docs}</p>
              <div className="two-col two-col-tight">
                <PhotoPicker photos={idPhoto} onChange={(p) => setIdPhoto(p.slice(-1))} label={t.hand.idPhoto} hint={t.hand.docsHint} />
                <PhotoPicker photos={licencePhoto} onChange={(p) => setLicencePhoto(p.slice(-1))} label={t.hand.licencePhoto} hint={t.hand.docsHint} />
              </div>
              {idPhoto.length === 0 && (
                <span className="hint warn-text" data-field="idPhoto">
                  {t.hand.idPhoto}: {t.hand.required}
                </span>
              )}
            </section>
          )}
        </>
      )}

      {f.step === 1 && (
        <>
          <input className="input mono" placeholder={t.hand.vinSearch} aria-label={t.hand.vinSearch} value={vq} onChange={(e) => setVq(e.target.value)} disabled={f.noVin} />
          {!fleet.data && (fleet.failure ? <LoadError failure={fleet.failure} onRetry={fleet.reload} /> : <Loading rows={3} />)}
          {fleet.data && forRent.length === 0 && !f.noVin && <p className="empty">{t.hand.noAvailable}</p>}
          <VehicleList list={forRent} chosen={f.vehicleId} disabled={f.noVin} onPick={(id) => set({ vehicleId: id, moveFromSale: false, noVin: false })} />
          {forSale.length > 0 && (
            <button type="button" className="pill pill-sm" onClick={() => setShowSale(!showSale)}>
              {showSale ? t.hand.hideSale : t.hand.showSale(forSale.length)}
            </button>
          )}
          {showSale && (
            <>
              <VehicleList list={forSale} chosen={f.vehicleId} disabled={f.noVin || !owner} onPick={(id) => set({ vehicleId: id, moveFromSale: false, noVin: false })} />
              {!owner && <p className="hint muted">{t.hand.saleOwnerOnly}</p>}
            </>
          )}
          {inSale && owner && (
            <label className="check">
              <input type="checkbox" checked={f.moveFromSale} onChange={(e) => set({ moveFromSale: e.target.checked })} />
              <span>{t.hand.saleConfirm}</span>
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={f.noVin} onChange={(e) => set({ noVin: e.target.checked })} />
            <span>{t.hand.noVin}</span>
          </label>
          {f.noVin && (
            <Field label={t.hand.noVinReason} name="vinNote">
              <input className="input" value={f.vinNote} onChange={(e) => set({ vinNote: e.target.value })} />
            </Field>
          )}
        </>
      )}

      {f.step === 2 && (
        <>
          <section className="card">
            <Row k={t.hand.steps.vehicle} v={vehicleCell} />
          </section>
          {owner && (
            <label className="check">
              <input
                type="checkbox"
                checked={f.transfer}
                onChange={(e) => set({ transfer: e.target.checked, pickedUpOn: e.target.checked && f.pickedUpOn >= today ? addDays(today, -7) : f.pickedUpOn, paidThrough: '' })}
              />
              <span>
                <b>{t.hand.transfer}</b>
                <span className="muted"> · {t.hand.transferHint}</span>
              </span>
            </label>
          )}
          <div className="two-col two-col-tight">
            <Field label={t.hand.rate} hint={t.hand.rateHint} name="weeklyRateTetri">
              <input className="input input-amount mono" value={f.rate} onChange={(e) => set({ rate: e.target.value, rateTouched: true })} inputMode="decimal" />
            </Field>
            <Field label={t.hand.deposit} name="depositTetri">
              <input className="input input-amount mono" value={f.deposit} onChange={(e) => set({ deposit: e.target.value })} inputMode="decimal" />
            </Field>
          </div>
          <Field label={t.hand.pickedUpOn} hint={!transfer ? t.hand.firstWeek(short(f.pickedUpOn), short(addDays(f.pickedUpOn, 6))) : undefined} name="pickedUpOn" error={pickedUpError}>
            <input className="input mono" type="date" max={transfer ? addDays(today, -1) : today} value={f.pickedUpOn} onChange={(e) => set({ pickedUpOn: e.target.value, paidThrough: '' })} />
          </Field>
          {transfer && (
            <>
              <Field label={t.hand.paidThrough} hint={t.hand.paidThroughHint} name="paidThrough">
                <select className="input mono" value={f.paidThrough} onChange={(e) => set({ paidThrough: e.target.value })}>
                  <option value="">{t.hand.notPaid}</option>
                  {weekEnds.map((d) => (
                    <option key={d} value={d}>
                      {fmtDate(d)}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t.hand.depositBefore} name="depositReceivedTetri">
                <input className="input input-amount mono" value={f.depositBefore} onChange={(e) => set({ depositBefore: e.target.value })} inputMode="decimal" />
              </Field>
              <section className="card">
                <Row k={t.hand.weeks} v={<span className="mono">{weeksTotal}</span>} />
                <Row k={t.hand.paidBefore} v={<span className="mono">{paidWeeks}</span>} />
                <Row k={t.hand.debtNow} v={<span className="mono">{formatGel(owedWeeks * Math.max(0, rateTetri))}</span>} />
              </section>
            </>
          )}
          <Field label={t.hand.nightParking} hint={t.hand.nightParkingHint} name="nightParkingAddress">
            <input className="input" value={f.nightParking} onChange={(e) => set({ nightParking: e.target.value })} />
          </Field>
          <div className="two-col two-col-tight">
            <Stepper label={t.hand.batteries} value={f.batteries} onChange={(n) => set({ batteries: n })} />
            <Stepper label={t.hand.chargers} value={f.chargers} onChange={(n) => set({ chargers: n })} />
          </div>
          {batteries.data && (
            <p className={`hint ${batteries.data.showroom < f.batteries ? 'warn-text' : 'muted'}`}>
              {t.bat.shortInPickup(batteries.data.showroom)} · {t.bat.afterPickup(batteries.data.showroom - f.batteries)}
              {batteries.data.showroom < f.batteries ? ` · ${t.bat.tooFew}` : ''}
            </p>
          )}
          <Field label={t.hand.expectedReturn} hint={t.hand.expectedReturnHint} name="expectedReturnOn" error={f.expectedReturnOn && f.expectedReturnOn < f.pickedUpOn ? t.hand.notBeforePickup : null}>
            <input className="input mono" type="date" min={f.pickedUpOn} value={f.expectedReturnOn} onChange={(e) => set({ expectedReturnOn: e.target.value })} />
          </Field>
        </>
      )}

      {f.step === 3 && (
        <>
          {photosLost && <p className="hint warn-text">{t.hand.photosLost}</p>}
          <Field label={t.hand.odometer} name="odometerKm">
            <input className="input mono" value={f.odometer} onChange={(e) => set({ odometer: e.target.value })} inputMode="numeric" />
          </Field>
          {below && (
            <>
              <p className="warn-text">{t.hand.odometerBelow(String(lastKm))}</p>
              <Field label={t.hand.odometerReason} hint={t.hand.odometerReasonHint} name="odometerReason">
                <input className="input" value={f.odometerReason} onChange={(e) => set({ odometerReason: e.target.value })} />
              </Field>
            </>
          )}
          <PhotoPicker
            photos={photos}
            onChange={(p) => {
              setPhotos(p);
              setAskFew(false);
            }}
            label={`${t.hand.photos} · ${t.hand.photosCount(photos.length)}`}
          />
          {askFew && (
            <div className="form-banner form-banner-warn" role="alert">
              <div>{t.hand.fewPhotos}</div>
              <button
                type="button"
                className="pill pill-sm"
                onClick={() => {
                  setFewOk(true);
                  setAskFew(false);
                  set({ step: 4 });
                }}
              >
                {t.hand.fewPhotosYes}
              </button>
            </div>
          )}
          <Field label={t.hand.condition} name="condition">
            <textarea className="input textarea" rows={3} value={f.condition} onChange={(e) => set({ condition: e.target.value })} />
          </Field>
        </>
      )}

      {f.step === 4 && (
        <>
          <section className="card due-card">
            <span className="lbl">{t.hand.dueToday}</span>
            <span className="due-sum t-money">{formatGel(dueTetri)}</span>
            {!transfer ? (
              <>
                <Row k={t.hand.week(short(f.pickedUpOn), short(addDays(f.pickedUpOn, 6)))} v={<span className="mono">{formatGel(rateTetri)}</span>} />
                <Row k={t.hand.depositLine} v={<span className="mono">{formatGel(depositTetri)}</span>} />
              </>
            ) : (
              <>
                <Row k={t.hand.weeksOwed(owedWeeks)} v={<span className="mono">{formatGel(owedWeeks * rateTetri)}</span>} />
                <Row k={t.hand.depositLine} v={<span className="mono">{formatGel(Math.max(0, depositTetri - depositBeforeTetri))}</span>} />
              </>
            )}
          </section>
          {!paymentNeeded ? (
            <p className="hint muted">{t.hand.nothingDue}</p>
          ) : (
            <>
              <span className="lbl">{t.hand.how}</span>
              <div className="chips" role="radiogroup" aria-label={t.hand.how}>
                {(['cash', 'acquiring', ...(takesTransfers ? (['transfer'] as const) : []), 'later'] as Channel[]).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={f.channel === c} className={`pill ${f.channel === c ? 'on' : ''}`} onClick={() => set({ channel: c })}>
                    {c === 'later' ? t.hand.later : t.payments.channels[c]}
                  </button>
                ))}
              </div>
              {f.channel == null && <p className="hint muted">{t.hand.chooseHow}</p>}
              {f.channel === 'later' && <p className="hint muted">{t.hand.laterNote}</p>}
              {f.channel === 'transfer' && <p className="hint muted">{t.hand.transferNote}</p>}
              {f.channel && f.channel !== 'later' && (
                <>
                  <Field label={t.hand.paid} hint={t.hand.partialHint} name="amountTetri">
                    <input className="input input-amount mono" value={f.amount || gel(dueTetri)} onChange={(e) => set({ amount: e.target.value })} inputMode="decimal" />
                  </Field>
                  {amountTetri != null && amountTetri > dueTetri && <p className="hint">{t.hand.overpay(formatGel(amountTetri - dueTetri))}</p>}
                  {amountTetri != null && amountTetri > 0 && amountTetri < dueTetri && (
                    <p className="hint">{t.hand.closes(formatGel(closesDeposit), formatGel(depositDue), formatGel(closesWeeks), formatGel(weeksDue))}</p>
                  )}
                  {f.channel === 'acquiring' && amountTetri != null && amountTetri > 0 && (
                    <p className="hint muted">{t.hand.cardNet(formatGel(acquiringNet(amountTetri)), formatGel(acquiringFee(amountTetri)))}</p>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}

      {f.step === 5 && (
        <section className="card summary-card">
          <SumRow k={t.hand.steps.customer} v={customerName} go={() => set({ step: 0 })} />
          <SumRow
            k={t.hand.steps.vehicle}
            v={
              <>
                {vehicleCell}
                {vehicle?.location ? <span className="muted"> · {vehicle.location.name}</span> : null}
              </>
            }
            go={() => set({ step: presetVehicle && vehicle ? 0 : 1 })}
          />
          <SumRow k={`${t.hand.rate} · ${t.hand.deposit}`} v={<span className="mono">{formatGel(rateTetri, { decimals: false })} · {formatGel(depositTetri, { decimals: false })}</span>} go={() => set({ step: 2 })} />
          <SumRow k={t.hand.pickedUpOn} v={<span className="mono">{fmtDate(f.pickedUpOn)}</span>} go={() => set({ step: 2 })} />
          {transfer && (
            <>
              <SumRow k={t.hand.transfer} v={<span className="mono">{t.hand.paidThrough} {f.paidThrough ? fmtDate(f.paidThrough) : t.hand.notPaid}</span>} go={() => set({ step: 2 })} />
              <SumRow k={t.hand.paidBefore} v={<span className="mono">{paidWeeks} / {weeksTotal}</span>} go={() => set({ step: 2 })} />
              <SumRow k={t.hand.depositBefore} v={<span className="mono">{formatGel(Math.max(0, depositBeforeTetri))}</span>} go={() => set({ step: 2 })} />
            </>
          )}
          <SumRow k={t.hand.nightParking} v={f.nightParking} go={() => set({ step: 2 })} />
          <SumRow k={t.hand.batteries} v={t.hand.kit(f.batteries, f.chargers)} go={() => set({ step: 2 })} />
          <SumRow k={t.hand.steps.act} v={t.hand.actLine(km != null ? String(km) : '—', photos.length)} go={() => set({ step: 3 })} />
          <SumRow
            k={t.hand.steps.payment}
            v={!paymentNeeded ? t.hand.noPayment : f.channel === 'later' ? t.hand.payLater : <span className="mono">{formatGel(amountTetri ?? 0)} {channelWord}</span>}
            go={() => set({ step: 4 })}
          />
          {progress && <p className="hint muted">{progress}</p>}
        </section>
      )}
    </Wizard>
  );
}

export function SumRow({ k, v, go }: { k: string; v: ReactNode; go: () => void }) {
  return (
    <button type="button" className="sum-row" onClick={go}>
      <span className="kv-k">{k}</span>
      <span className="kv-v">{v}</span>
      <span className="sum-go" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

function Stepper({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  const t = useT();
  return (
    <div className="field">
      <span className="lbl">{label}</span>
      <div className="stepper">
        <button type="button" className="pill pill-sm" aria-label={t.hand.less} onClick={() => onChange(Math.max(0, value - 1))} disabled={value <= 0}>
          −
        </button>
        <span className="mono stepper-n">{value}</span>
        <button type="button" className="pill pill-sm" aria-label={t.hand.more} onClick={() => onChange(Math.min(9, value + 1))}>
          +
        </button>
      </div>
    </div>
  );
}

function VehicleList({ list, chosen, disabled, onPick }: { list: FleetRow[]; chosen: string | null; disabled: boolean; onPick: (id: string) => void }) {
  const t = useT();
  return (
    <ul className={`pick-list ${disabled ? 'dim' : ''}`}>
      {list.map((v) => (
        <li key={v.id}>
          <button type="button" className={v.id === chosen ? 'on' : ''} disabled={disabled} onClick={() => onPick(v.id)}>
            <span className="pick-main">
              <span>
                {v.model}
                {v.color && (
                  <span className="muted">
                    {' '}
                    · <ColorText of={v.color} named />
                  </span>
                )}
              </span>
              <Vin vin={v.vin} />
            </span>
            <span className="muted">{v.pool == null ? t.hand.poolUndecided : v.location?.name ?? t.hand.noPoint}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** "Готово": what was handed over, the documents with their signatures, and where to go next. */
function PickupDone({ id, number, photoTrouble }: { id: string; number: string; photoTrouble: boolean }) {
  const t = useT();
  const { data, reload } = useLoad<RentalCard>(`/api/rentals/${id}`);
  if (!data) return <Loading />;
  const r = data.rental;
  const phone = digitsOf(r.customer.phone);
  return (
    <div className="wizard">
      <header className="wizard-head">
        <h1>{t.hand.handedOver(number)}</h1>
      </header>
      <section className="card">
        <p>
          {r.vehicle ? (
            <>
              {r.vehicle.model} <Vin vin={r.vehicle.vin} />
            </>
          ) : (
            <span className="warn-text">{t.rentals.vinUnconfirmed}</span>
          )}
        </p>
        <p className="muted">
          {r.status === 'awaiting_payment' ? t.hand.doneLater : t.hand.doneLine(fmtDate(r.paidThrough), formatGel(data.deposit?.paidTetri ?? 0, { decimals: false }))}
        </p>
        {photoTrouble && <p className="warn-text">{t.hand.photosFailed}</p>}
      </section>
      <section className="card">
        <DocumentRow rentalId={id} kind="contract" title={t.hand.contract} state={data.documents.contract} customerId={r.customer.id} onChanged={reload} />
      </section>
      <div className="row-actions">
        {phone && (
          <a className="pill" href={`https://wa.me/${phone}?text=${encodeURIComponent(t.hand.waText(number))}`} target="_blank" rel="noreferrer">
            {t.hand.whatsapp}
          </a>
        )}
        <Link to="/" className="pill">
          {t.hand.toToday}
        </Link>
        <Link to={`/rentals/${id}`} className="pill pill-accent">
          {t.hand.openRental}
        </Link>
      </div>
    </div>
  );
}
