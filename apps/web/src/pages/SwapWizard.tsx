import { KEY_FEE_TETRI, handOverActOf, readFleetNumber, todayISO } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { DocumentRow } from '../components/Documents.js';
import { LoadError } from '../components/LoadError.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { FleetNo, Loading, Vin } from '../components/ui.js';
import { Field, Wizard } from '../components/Wizard.js';
import { DraftOffer } from '../ds/form/Form.js';
import { useDraft } from '../ds/form/drafts.js';
import { useOperation } from '../ds/form/operation.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { uploadAll, type PreparedPhoto } from '../lib/photos.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { SumRow, VehicleList, type FleetRow } from './PickupWizard.js';
import type { RentalCard } from './RentalPage.js';
import { lastPoint, rememberPoint } from './ReturnWizard.js';

type ItemState = 'ok' | 'damaged' | 'missing';
const ITEM_STATES: ItemState[] = ['ok', 'damaged', 'missing'];
type Items = Record<string, { state: ItemState; note: string }>;
/** The act of the moped given back lists the moped and its key; the batteries and chargers stay with the customer. */
const KIT = ['moped', 'key'] as const;

/** What the old moped's card says that the swap needs: its last reading, and a repair already open on it. */
interface OldMoped {
  vehicle: { odometerKm: number | null };
  serviceJobs: { id: string; number: string; status: string }[];
}

/** A number typed with spaces or without; empty is none. */
const typedKm = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(/\s/g, '')));
const highest = (...ks: (number | null | undefined)[]): number | null => {
  const known = ks.filter((k): k is number => k != null);
  return known.length > 0 ? Math.max(...known) : null;
};

// «Заменить мопед» (ADR-0040) in four screens and «Готово»: the moped given
// back — its act, and why it is changed → the moped taken — from the free
// ones → where the old one goes → the summary. One operation: the rental
// stays, with its weeks, deposit, debt and pay day; the photos of the two
// acts follow it. «Готово» offers the contract with the new VIN to sign.
export function SwapWizard() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const owner = can('deposit.decide');
  const card = useLoad<RentalCard>(id ? `/api/rentals/${id}` : null);
  const oldId = card.data?.rental.vehicle?.id ?? null;
  const oldMoped = useLoad<OldMoped>(oldId ? `/api/fleet/${oldId}` : null);
  const fleet = useLoad<{ vehicles: FleetRow[] }>('/api/fleet');
  const points = useLoad<{ locations: { id: string; name: string }[] }>('/api/locations');
  const steps = [t.swap.steps.out, t.swap.steps.in, t.swap.steps.where, t.swap.steps.summary];

  const start = {
    step: 0,
    swappedOn: todayISO(),
    reason: '',
    outOdometer: '',
    outOdometerReason: '',
    outCondition: '',
    items: {} as Items,
    vehicleId: null as string | null,
    moveFromSale: false,
    inOdometer: '',
    inOdometerReason: '',
    inCondition: '',
    toService: null as boolean | null,
    locationId: lastPoint(),
  };
  const [initial] = useState(start);
  const [f, setF] = useState(start);
  const set = (patch: Partial<typeof start>) => setF((x) => ({ ...x, ...patch }));
  // Not in the draft: pictures stay on no device (B4-02).
  const [outPhotos, setOutPhotos] = useState<PreparedPhoto[]>([]);
  const [inPhotos, setInPhotos] = useState<PreparedPhoto[]>([]);
  const [vq, setVq] = useState('');
  const [showSale, setShowSale] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  // The last readings the server named when it refused a lower one: read since this screen opened, maybe.
  const [refused, setRefused] = useState<{ out: number | null; in: number | null }>({ out: null, in: null });
  const [result, setResult] = useState<{ serviceJobId: string | null; point: string | null } | null>(null);
  // The swap is recorded before the photos go; a photo that did not reach an act is said on «Готово», as at a hand-over.
  const [photoTrouble, setPhotoTrouble] = useState(false);
  const op = useOperation();
  const drafts = useDraft({ id: id ? `swap:${id}` : undefined, value: f, initial, hold: result != null });

  // A refusal goes back to the step whose field it names, where the words sit under it.
  useEffect(() => {
    const failure = op.failure;
    if (!failure) return;
    const byField: Record<string, number> = { swappedOn: 0, reason: 0, outOdometerKm: 0, outOdometerReason: 0, vehicleId: 1, inOdometerKm: 1, inOdometerReason: 1, locationId: 2 };
    const byCode: Record<string, number> = { swap_before_last_event: 0, odometer_below_pickup: 0, same_vehicle: 1, vehicle_not_available: 1, vehicle_in_sale_pool: 1 };
    const to = (failure.field ? byField[failure.field] : undefined) ?? (failure.code ? byCode[failure.code] : undefined);
    if (to != null) set({ step: to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.failure]);

  if (card.failure) return <LoadError failure={card.failure} onRetry={card.reload} />;
  if (oldMoped.failure) return <LoadError failure={oldMoped.failure} onRetry={oldMoped.reload} />;
  if (result && card.data) return <SwapDone rentalId={card.data.rental.id} serviceJobId={result.serviceJobId} point={result.point} photoTrouble={photoTrouble} />;
  if (!card.data || (oldId && !oldMoped.data)) return <Loading />;
  const r = card.data.rental;
  // The rental's number holds together: at 375 px it broke at its hyphen, «R-» / «00480» (QA 21.10.2026).
  const title = (
    <>
      {t.swap.title} · <span className="nobr">{r.number}</span>
    </>
  );

  // Nothing to change: a closed rental, or one handed over without a VIN — its moped is given in «Изменить условия».
  const old = r.vehicle;
  if (r.status === 'returned' || !old) {
    return (
      <div className="wizard">
        <header className="wizard-head">
          <h1>{title}</h1>
        </header>
        <p className="hint warn-text">{r.status === 'returned' ? t.errors.codes.already_returned : t.errors.codes.swap_no_vehicle}</p>
        <div className="row-actions">
          <Link to={`/rentals/${r.id}`} className="pill">
            {t.hand.openRental}
          </Link>
        </div>
      </div>
    );
  }

  if (drafts.offer) {
    return (
      <Wizard title={title} steps={steps} step={0}>
        <DraftOffer at={drafts.offer.at} words={r.customer.name} onContinue={() => drafts.accept((d) => setF({ ...d, step: Math.min(d.step, 3) }))} onDiscard={drafts.discard} />
      </Wizard>
    );
  }

  const today = todayISO();
  // The act that handed out the moped the customer has: the hand-over, or an earlier swap.
  const handOver = handOverActOf(
    card.data.acts.map((a) => ({ ...a, vehicleId: a.vehicle?.id ?? null })),
    old.id,
  );
  const handedOn = handOver?.occurredOn ?? r.pickedUpOn;
  const pickupKm = handOver?.odometerKm ?? null;
  const openJob = oldMoped.data?.serviceJobs.find((j) => j.status === 'open' || j.status === 'draft') ?? null;

  // ---- the moped given back -------------------------------------------------
  const item = (k: string) => f.items[k] ?? { state: 'ok' as ItemState, note: '' };
  const setItem = (k: string, patch: Partial<{ state: ItemState; note: string }>) => set({ items: { ...f.items, [k]: { ...item(k), ...patch } } });
  const itemName = (k: string) => (k === 'moped' ? t.back.items.moped : t.back.items.key);
  const damaged = KIT.some((k) => item(k).state === 'damaged');
  const keyMissing = item('key').state === 'missing';
  const outKm = typedKm(f.outOdometer);
  const outBelowPickup = outKm != null && pickupKm != null && outKm < pickupKm;
  const outLastKm = highest(oldMoped.data?.vehicle.odometerKm, refused.out);
  const outLower = !outBelowPickup && outKm != null && outLastKm != null && outKm < outLastKm;
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(f.swappedOn) && f.swappedOn <= today && (!handedOn || f.swappedOn >= handedOn);
  const outOk =
    dateOk && f.reason.trim().length > 0 && outKm != null && Number.isInteger(outKm) && outKm >= 0 && !outBelowPickup && (!outLower || f.outOdometerReason.trim().length > 0);

  // ---- the moped taken ------------------------------------------------------
  const vehicles = fleet.data?.vehicles ?? [];
  const vinNeedle = vq.trim().toUpperCase();
  // The number on the sticker or a piece of the VIN, as at a hand-over.
  const noNeedle = readFleetNumber(vq, { digitsToo: true });
  const free = vehicles.filter((v) => v.id !== old.id && v.state === 'available' && (!vinNeedle || v.vin.includes(vinNeedle) || (noNeedle != null && v.fleetNo === noNeedle)));
  const forRent = free.filter((v) => v.pool !== 'sale');
  const forSale = free.filter((v) => v.pool === 'sale');
  const fresh = vehicles.find((v) => v.id === f.vehicleId) ?? null;
  const inSale = fresh?.pool === 'sale';
  const inKm = typedKm(f.inOdometer);
  const inLastKm = highest(fresh?.odometerKm, refused.in);
  const inLower = inKm != null && inLastKm != null && inKm < inLastKm;
  const inOk = !!fresh && (!inSale || (owner && f.moveFromSale)) && inKm != null && Number.isInteger(inKm) && inKm >= 0 && (!inLower || f.inOdometerReason.trim().length > 0);

  // ---- where the old one goes ---------------------------------------------------
  // A repair already open on it takes it; damage in the act sends it to service, as at a return.
  const locations = points.data?.locations ?? [];
  const locationId = locations.some((l) => l.id === f.locationId) ? f.locationId : locations[0]?.id ?? '';
  const toService = !openJob && (damaged || (f.toService ?? false));
  const whereOk = !!openJob || toService || locations.length === 0 || !!locationId;
  const ok = [outOk, inOk, whereOk, true][f.step];
  const pointName = locations.find((l) => l.id === locationId)?.name ?? null;
  const kitProblems = KIT.filter((k) => item(k).state !== 'ok').map((k) => `${itemName(k)} — ${t.returnItems.states[item(k).state]}`);

  const submit = async () => {
    const res = await op.run(async (key) => {
      const out = await api
        .post<{ outActId: string; inActId: string; serviceJobId: string | null; adoptedJob: boolean }>(
          `/api/rentals/${r.id}/swap`,
          {
            swappedOn: f.swappedOn,
            reason: f.reason.trim(),
            outOdometerKm: outKm,
            outOdometerReason: outLower ? f.outOdometerReason.trim() : null,
            outCondition: f.outCondition.trim() || null,
            items: Object.fromEntries(KIT.map((k) => [k, { state: item(k).state, note: item(k).note.trim() || null }])),
            toService,
            locationId: openJob || toService ? null : locationId || null,
            vehicleId: f.vehicleId,
            moveFromSale: f.moveFromSale,
            inOdometerKm: inKm,
            inOdometerReason: inLower ? f.inOdometerReason.trim() : null,
            inCondition: f.inCondition.trim() || null,
          },
          { key },
        )
        .catch((e: unknown) => {
          if (e instanceof ApiError && e.code === 'odometer_below' && typeof e.extra.lastKm === 'number') {
            const lastKm = e.extra.lastKm;
            const theNewOne = e.extra.field === 'inOdometerReason';
            setRefused((x) => (theNewOne ? { ...x, in: lastKm } : { ...x, out: lastKm }));
          }
          throw e;
        });
      drafts.drop();
      if (!openJob && !toService && locationId) rememberPoint(locationId);
      const total = outPhotos.length + inPhotos.length;
      const failed = () => {
        setPhotoTrouble(true);
        return [];
      };
      await uploadAll(`/api/acts/${out.outActId}/photos`, outPhotos, (n) => setProgress(t.hand.photosUploading(n, total)), `${key}-out`).catch(failed);
      await uploadAll(`/api/acts/${out.inActId}/photos`, inPhotos, (n) => setProgress(t.hand.photosUploading(outPhotos.length + n, total)), `${key}-in`).catch(failed);
      return out;
    });
    setProgress(null);
    if (res.ok) setResult({ serviceJobId: res.value.serviceJobId, point: openJob || toService ? null : pointName });
  };
  const onFinish = () => void submit();

  return (
    <Wizard
      title={title}
      steps={steps}
      step={f.step}
      submit={f.step === 3 ? { state: op.state, failure: op.failure, label: t.swap.finish } : undefined}
      failure={f.step === 3 ? null : op.failure}
      onBack={f.step > 0 ? () => set({ step: f.step - 1 }) : undefined}
      onNext={f.step === 3 ? onFinish : () => set({ step: f.step + 1 })}
      nextLabel={f.step === 2 ? t.hand.toSummary : undefined}
      nextDisabled={!ok}
    >
      {f.step === 0 && (
        <>
          <section className="card">
            <b>{r.customer.name}</b>
            <p className="muted">
              {t.swap.has}: <FleetNo n={old.fleetNo} /> {old.model} <Vin vin={old.vin} /> · {t.swap.since(fmtDate(handedOn))}
            </p>
          </section>
          {/* Rows of their own: beside the date, the long mileage label wraps at 375 px and the two boxes stand at different heights. */}
          <Field label={t.swap.swappedOn} name="swappedOn">
            <input className="input mono" type="date" max={today} min={handedOn ?? undefined} value={f.swappedOn} onChange={(e) => set({ swappedOn: e.target.value })} />
          </Field>
          <Field label={t.swap.outOdometer} hint={pickupKm != null ? t.back.odometerMin(String(pickupKm), fmtDate(handedOn)) : undefined} name="outOdometerKm">
            <input className="input mono" value={f.outOdometer} onChange={(e) => set({ outOdometer: e.target.value })} inputMode="numeric" />
          </Field>
          {outBelowPickup && <p className="field-err">{t.swap.outOdometerBelow}</p>}
          {outLower && (
            <>
              {outLastKm != null && <p className="warn-text">{t.back.odometerBelowLast(String(outLastKm))}</p>}
              <Field label={t.hand.odometerReason} hint={t.hand.odometerReasonHint} name="outOdometerReason">
                <input className="input" value={f.outOdometerReason} onChange={(e) => set({ outOdometerReason: e.target.value })} />
              </Field>
            </>
          )}
          <Field label={t.swap.reason} hint={t.swap.reasonHint} name="reason">
            <input className="input" value={f.reason} onChange={(e) => set({ reason: e.target.value })} />
          </Field>
          <ul className="item-list">
            {KIT.map((k) => (
              <li key={k}>
                <span className="item-name">{itemName(k)}</span>
                <span className="chips">
                  {ITEM_STATES.map((st) => (
                    <button key={st} type="button" className={`pill pill-sm ${item(k).state === st ? 'on' : ''}`} onClick={() => setItem(k, { state: st })}>
                      {t.returnItems.states[st]}
                    </button>
                  ))}
                </span>
                {item(k).state === 'damaged' && (
                  <input className="input" placeholder={t.back.damagedWhat} aria-label={t.back.damagedWhat} value={item(k).note} onChange={(e) => setItem(k, { note: e.target.value })} />
                )}
              </li>
            ))}
          </ul>
          <p className="hint muted">{t.swap.kitHint}</p>
          {keyMissing && <p className="warn-text">{t.swap.sumKey(formatGel(KEY_FEE_TETRI, { decimals: false }))}</p>}
          <PhotoPicker photos={outPhotos} onChange={setOutPhotos} label={t.swap.outPhotos} />
          <Field label={t.swap.outCondition} name="outCondition">
            <textarea className="input textarea" rows={2} value={f.outCondition} onChange={(e) => set({ outCondition: e.target.value })} />
          </Field>
        </>
      )}

      {f.step === 1 && (
        <>
          <span className="lbl">{t.swap.pick}</span>
          <input className="input mono" placeholder={t.hand.vinSearch} aria-label={t.hand.vinSearch} value={vq} onChange={(e) => setVq(e.target.value)} />
          {!fleet.data && (fleet.failure ? <LoadError failure={fleet.failure} onRetry={fleet.reload} /> : <Loading rows={3} />)}
          {fleet.data && forRent.length === 0 && <p className="empty">{t.hand.noAvailable}</p>}
          {/* What is chosen, said above the list, as at a hand-over (Mika, 19.10.2026). */}
          {fresh && (
            <p className="pick-chosen">
              <span aria-hidden="true">✓</span> {t.hand.chosenVehicle} <FleetNo n={fresh.fleetNo} /> {fresh.model} <Vin vin={fresh.vin} />
            </p>
          )}
          <VehicleList
            list={fresh && !inSale ? [fresh, ...forRent.filter((v) => v.id !== fresh.id)] : forRent}
            chosen={f.vehicleId}
            disabled={false}
            onPick={(vid) => set({ vehicleId: vid, moveFromSale: false })}
          />
          {forSale.length > 0 && (
            <button type="button" className="pill pill-sm" onClick={() => setShowSale(!showSale)}>
              {showSale ? t.hand.hideSale : t.hand.showSale(forSale.length)}
            </button>
          )}
          {showSale && (
            <>
              <VehicleList list={forSale} chosen={f.vehicleId} disabled={!owner} onPick={(vid) => set({ vehicleId: vid, moveFromSale: false })} />
              {!owner && <p className="hint muted">{t.hand.saleOwnerOnly}</p>}
            </>
          )}
          {inSale && owner && (
            <label className="check">
              <input type="checkbox" checked={f.moveFromSale} onChange={(e) => set({ moveFromSale: e.target.checked })} />
              <span>{t.hand.saleConfirm}</span>
            </label>
          )}
          {fresh && (
            <>
              <Field label={t.swap.inOdometer} name="inOdometerKm">
                <input className="input mono" value={f.inOdometer} onChange={(e) => set({ inOdometer: e.target.value })} inputMode="numeric" />
              </Field>
              {inLower && (
                <>
                  {inLastKm != null && <p className="warn-text">{t.hand.odometerBelow(String(inLastKm))}</p>}
                  <Field label={t.hand.odometerReason} hint={t.hand.odometerReasonHint} name="inOdometerReason">
                    <input className="input" value={f.inOdometerReason} onChange={(e) => set({ inOdometerReason: e.target.value })} />
                  </Field>
                </>
              )}
              <PhotoPicker photos={inPhotos} onChange={setInPhotos} label={`${t.swap.inPhotos} · ${t.hand.photosCount(inPhotos.length)}`} />
              <Field label={t.swap.inCondition} name="inCondition">
                <textarea className="input textarea" rows={2} value={f.inCondition} onChange={(e) => set({ inCondition: e.target.value })} />
              </Field>
            </>
          )}
        </>
      )}

      {f.step === 2 && (
        <>
          <section className="card">
            <p>
              <FleetNo n={old.fleetNo} /> {old.model} <Vin vin={old.vin} />
            </p>
          </section>
          {openJob ? (
            <p className="hint">{t.swap.openJob(openJob.number)}</p>
          ) : (
            <>
              <span className="lbl">{t.back.state}</span>
              <div className="chips">
                {/* Damage in the act sends the moped to service, as at a return. */}
                <button type="button" className={`pill ${!toService ? 'on' : ''}`} disabled={damaged} onClick={() => set({ toService: false })}>
                  {t.back.free}
                </button>
                <button type="button" className={`pill ${toService ? 'on' : ''}`} onClick={() => set({ toService: true })}>
                  {t.back.toService}
                </button>
              </div>
              {!toService &&
                (locations.length === 0 ? (
                  <p className="hint warn-text">{can('settings.manage') ? <Link to="/fleet/points">{t.back.noPoints}</Link> : t.back.noPoints}</p>
                ) : (
                  <>
                    <span className="lbl">{t.back.point}</span>
                    <div className="chips">
                      {locations.map((l) => (
                        <button key={l.id} type="button" className={`pill ${locationId === l.id ? 'on' : ''}`} onClick={() => set({ locationId: l.id })}>
                          {l.name}
                        </button>
                      ))}
                    </div>
                  </>
                ))}
            </>
          )}
        </>
      )}

      {f.step === 3 && (
        <section className="card summary-card">
          <SumRow k={t.swap.sumDate} v={<span className="mono">{fmtDate(f.swappedOn)}</span>} go={() => set({ step: 0 })} />
          <SumRow k={t.swap.sumReason} v={f.reason.trim()} go={() => set({ step: 0 })} />
          <SumRow
            k={t.swap.sumOut}
            v={
              <span>
                <FleetNo n={old.fleetNo} /> <Vin vin={old.vin} /> · <span className="mono">{outKm} {t.back.km}</span> · {kitProblems.length > 0 ? kitProblems.join(' · ') : t.back.kitOk}
              </span>
            }
            go={() => set({ step: 0 })}
          />
          <SumRow
            k={t.swap.sumIn}
            v={
              fresh ? (
                <span>
                  <FleetNo n={fresh.fleetNo} /> {fresh.model} <Vin vin={fresh.vin} /> · <span className="mono">{inKm} {t.back.km}</span>
                </span>
              ) : (
                t.common.dash
              )
            }
            go={() => set({ step: 1 })}
          />
          <SumRow
            k={t.swap.sumWhere}
            v={openJob ? t.swap.doneRepair(openJob.number) : toService ? t.back.toService : `${t.back.free} · ${pointName ?? t.common.dash}`}
            go={() => set({ step: 2 })}
          />
          {keyMissing && <p className="warn-text">{t.swap.sumKey(formatGel(KEY_FEE_TETRI, { decimals: false }))}</p>}
          <p className="hint muted">
            {t.swap.sumContract}: {t.swap.contractNote}
          </p>
          <p className="hint muted">{t.swap.stays}</p>
          {progress && <p className="hint muted">{progress}</p>}
        </section>
      )}
    </Wizard>
  );
}

/** «Готово»: the rental with its new moped, where the old one went, and the contract with the new VIN to sign. */
function SwapDone({ rentalId, serviceJobId, point, photoTrouble }: { rentalId: string; serviceJobId: string | null; point: string | null; photoTrouble: boolean }) {
  const t = useT();
  const { data, reload } = useLoad<RentalCard>(`/api/rentals/${rentalId}`);
  const job = useLoad<{ job: { number: string } }>(serviceJobId ? `/api/service/${serviceJobId}` : null);
  if (!data) return <Loading />;
  const r = data.rental;
  return (
    <div className="wizard">
      <header className="wizard-head">
        <h1>{t.swap.done}</h1>
      </header>
      <section className="card">
        <p>
          {t.swap.doneLine(r.number)}
          {r.vehicle && (
            <>
              {' '}
              <FleetNo n={r.vehicle.fleetNo} /> {r.vehicle.model} <Vin vin={r.vehicle.vin} />
            </>
          )}
        </p>
        <p className="muted">{serviceJobId ? t.swap.doneRepair(job.data?.job.number ?? '') : point ? t.swap.doneFree(point) : ''}</p>
        {/* Above the contract: its §3 says «photos: yes/no» from the act of the moped handed out. */}
        {photoTrouble && <p className="warn-text">{t.swap.photosFailed}</p>}
      </section>
      <section className="card">
        <DocumentRow rentalId={r.id} kind="contract" title={t.swap.contract} state={data.documents.contract} customerId={r.customer.id} onChanged={reload} />
      </section>
      <div className="row-actions">
        {serviceJobId && (
          <Link to={`/service/${serviceJobId}`} className="pill">
            {t.swap.openRepair}
          </Link>
        )}
        <Link to="/" className="pill">
          {t.hand.toToday}
        </Link>
        <Link to={`/rentals/${r.id}`} className="pill pill-accent">
          {t.hand.openRental}
        </Link>
      </div>
    </div>
  );
}
