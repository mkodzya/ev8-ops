import { todayISO } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { DocumentRow } from '../components/Documents.js';
import { LoadError } from '../components/LoadError.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { claimsOf, decisionBody, decisionOk, DepositDecision, keptOf, NO_DECISION, SettlementLines, useReturnPreview, type DecisionState, type Ground } from '../components/ReturnMoney.js';
import { Loading, Vin } from '../components/ui.js';
import { Field, Wizard } from '../components/Wizard.js';
import { DraftOffer } from '../ds/form/Form.js';
import { useDraft } from '../ds/form/drafts.js';
import { useOperation } from '../ds/form/operation.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { uploadAll, type PreparedPhoto } from '../lib/photos.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { SumRow } from './PickupWizard.js';
import type { RentalCard } from './RentalPage.js';

type ItemState = 'ok' | 'damaged' | 'missing';
const ITEM_STATES: ItemState[] = ['ok', 'damaged', 'missing'];
type Items = Record<string, { state: ItemState; note: string }>;
const LAST_POINT = 'ev8-last-point';

function lastPoint(): string {
  try {
    return localStorage.getItem(LAST_POINT) ?? '';
  } catch {
    return '';
  }
}
function rememberPoint(id: string) {
  try {
    localStorage.setItem(LAST_POINT, id);
  } catch {
    /* no storage — nothing remembered */
  }
}

// Return in four screens and "Done" (wave 3 §3.4): act by what was handed over
// → the settlement (and, for an owner, the deposit) → where the moped stands →
// summary. A manager's return is recorded to the end; the deposit waits.
export function ReturnWizard() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const owner = can('deposit.decide');
  const card = useLoad<RentalCard>(id ? `/api/rentals/${id}` : null);
  const points = useLoad<{ locations: { id: string; name: string }[] }>('/api/locations');
  const steps = [t.back.steps.act, owner ? `${t.back.steps.calc} · ${t.back.steps.deposit}` : t.back.steps.calc, t.back.steps.where, t.back.steps.summary];

  const start = {
    step: 0,
    returnedOn: todayISO(),
    odometer: '',
    condition: '',
    items: {} as Items,
    lateChoice: null as 'week' | 'late' | null,
    decision: NO_DECISION,
    toService: null as boolean | null,
    locationId: lastPoint(),
  };
  const [initial] = useState(start);
  const [f, setF] = useState(start);
  const set = (patch: Partial<typeof start>) => setF((x) => ({ ...x, ...patch }));
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<{ serviceJobId: string | null; point: string | null } | null>(null);
  const op = useOperation();
  const drafts = useDraft({ id: id ? `return:${id}` : undefined, value: f, initial, hold: result != null });

  const { preview } = useReturnPreview(id, { returnedOn: f.returnedOn, keyMissing: f.items.key?.state === 'missing', lateChoice: f.lateChoice });

  // A refusal goes back to the step whose field it names.
  useEffect(() => {
    const field = op.failure?.field;
    if (field && ['returnedOn', 'odometerKm', 'condition'].includes(field)) set({ step: 0 });
    if (field && ['withheldTetri', 'grounds', 'reason', 'returnedTo', 'returnedToReason'].includes(field)) set({ step: 1 });
    if (field === 'locationId') set({ step: 2 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.failure]);

  if (card.failure) return <LoadError failure={card.failure} onRetry={card.reload} />;
  if (result && card.data) return <ReturnDone rentalId={card.data.rental.id} serviceJobId={result.serviceJobId} point={result.point} />;
  if (!card.data || !preview) return <Loading />;
  const r = card.data.rental;

  if (drafts.offer) {
    return (
      <Wizard title={`${t.back.title} · ${r.number}`} steps={steps} step={0}>
        <DraftOffer at={drafts.offer.at} words={r.customer.name} onContinue={() => drafts.accept((d) => setF({ ...d, step: Math.min(d.step, 3) }))} onDiscard={drafts.discard} />
      </Wizard>
    );
  }

  // The act lists what was handed over (B5-07, B10-02).
  const batteries = preview.batteries ?? 2;
  const chargers = preview.chargers ?? 2;
  const itemKeys = ['moped', 'key', ...Array.from({ length: batteries }, (_, i) => `battery_${i + 1}`), ...Array.from({ length: chargers }, (_, i) => `charger_${i + 1}`)];
  const itemName = (k: string) =>
    k === 'moped' ? t.back.items.moped : k === 'key' ? t.back.items.key : k.startsWith('battery_') ? t.back.items.battery(Number(k.slice(8))) : t.back.items.charger(Number(k.slice(8)));
  const item = (k: string) => f.items[k] ?? { state: 'ok' as ItemState, note: '' };
  const setItem = (k: string, patch: Partial<{ state: ItemState; note: string }>) => set({ items: { ...f.items, [k]: { ...item(k), ...patch } } });
  const damaged = item('moped').state === 'damaged';
  const lost = itemKeys.filter((k) => k !== 'moped' && k !== 'key' && item(k).state === 'missing').map(itemName);
  const toService = f.toService ?? damaged;

  const km = f.odometer.trim() === '' ? null : Number(f.odometer.replace(/\s/g, ''));
  const pickupKm = preview.pickupKm;
  const kmBelow = km != null && pickupKm != null && km < pickupKm;
  const actOk = km != null && Number.isInteger(km) && km >= 0 && !kmBelow && f.returnedOn <= todayISO();

  const claims = claimsOf(preview);
  const held = preview.deposit?.heldTetri ?? 0;
  const decided = preview.deposit?.decided ?? false;
  const decides = owner && !decided && !!preview.deposit;
  const calcOk = !decides || decisionOk(f.decision, held);
  const locations = points.data?.locations ?? [];
  const locationId = locations.some((l) => l.id === f.locationId) ? f.locationId : locations[0]?.id ?? '';
  const whereOk = toService || locations.length === 0 || !!locationId;
  const ok = [actOk, calcOk, whereOk, true][f.step];
  const kept = decides ? keptOf(f.decision, held) ?? 0 : 0;

  // What a withholding is likely for, offered as the grounds when an owner keeps money.
  const suggest: Ground[] = [];
  if (preview.settlement.weeks.length > 0) suggest.push('rent_arrears');
  if (preview.settlement.choice === 'late') suggest.push('fines');
  if (item('key').state === 'missing') suggest.push('key_loss');
  if (damaged) suggest.push('moped_damage');
  if (itemKeys.some((k) => k.startsWith('charger_') && item(k).state === 'missing')) suggest.push('charger_loss');
  if (itemKeys.some((k) => k.startsWith('battery_') && item(k).state === 'missing')) suggest.push('incomplete_return');

  const submit = async () => {
    setConfirming(false);
    const res = await op.run(async (key) => {
      const out = await api.post<{ actId: string; serviceJobId: string | null }>(
        `/api/rentals/${r.id}/return`,
        {
          returnedOn: f.returnedOn,
          odometerKm: km,
          condition: f.condition.trim() || null,
          items: Object.fromEntries(itemKeys.map((k) => [k, { state: item(k).state, note: item(k).note.trim() || null }])),
          toService,
          locationId: toService ? null : locationId || null,
          lateChoice: owner ? preview.settlement.choice : null,
          deposit: decides ? decisionBody(f.decision, held) : undefined,
        },
        { key },
      );
      drafts.drop();
      if (!toService && locationId) rememberPoint(locationId);
      await uploadAll(`/api/acts/${out.actId}/photos`, photos, (n) => setProgress(t.hand.photosUploading(n, photos.length)), `${key}-photo`).catch(() => undefined);
      return out;
    });
    setProgress(null);
    if (res.ok) setResult({ serviceJobId: res.value.serviceJobId, point: toService ? null : locations.find((l) => l.id === locationId)?.name ?? null });
  };
  // Keeping money is not undone by a tap: the sum and what stays owed, in words, first.
  const onFinish = () => (kept > 0 ? setConfirming(true) : void submit());

  const kitProblems = itemKeys.filter((k) => item(k).state !== 'ok').map((k) => `${itemName(k)} — ${t.returnItems.states[item(k).state]}`);

  return (
    <Wizard
      title={`${t.back.title} · ${r.number}`}
      steps={steps}
      step={f.step}
      submit={f.step === 3 ? { state: op.state, failure: op.failure, label: t.back.finish } : undefined}
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
              {r.vehicle ? (
                <>
                  {r.vehicle.model} <Vin vin={r.vehicle.vin} />
                </>
              ) : (
                t.rentals.vinUnconfirmed
              )}{' '}
              · {t.back.handedOn(fmtDate(r.pickedUpOn))} · {t.back.paidThrough(fmtDate(r.paidThrough))}
            </p>
          </section>
          <div className="two-col two-col-tight">
            <Field label={t.back.returnedOn} name="returnedOn">
              <input className="input mono" type="date" max={todayISO()} min={r.pickedUpOn ?? undefined} value={f.returnedOn} onChange={(e) => set({ returnedOn: e.target.value })} />
            </Field>
            <Field label={t.back.odometer} hint={pickupKm != null ? t.back.odometerMin(String(pickupKm), fmtDate(r.pickedUpOn)) : undefined} name="odometerKm">
              <input className="input mono" value={f.odometer} onChange={(e) => set({ odometer: e.target.value })} inputMode="numeric" />
            </Field>
          </div>
          {kmBelow && <p className="field-err">{t.back.odometerBelow}</p>}
          <ul className="item-list">
            {itemKeys.map((k) => (
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
          <PhotoPicker photos={photos} onChange={setPhotos} label={t.back.photos} />
          <Field label={t.back.condition} name="condition">
            <textarea className="input textarea" rows={2} value={f.condition} onChange={(e) => set({ condition: e.target.value })} />
          </Field>
        </>
      )}

      {f.step === 1 && (
        <>
          <SettlementLines preview={preview} paidThrough={r.paidThrough} lost={lost} onChoice={owner ? (c) => set({ lateChoice: c }) : undefined} />
          {decides ? (
            <DepositDecision value={f.decision} onChange={(d: DecisionState) => set({ decision: d })} heldTetri={held} claimsTetri={claims} suggest={suggest} />
          ) : (
            !decided && <p className="hint muted">{t.back.ownerDecides}</p>
          )}
        </>
      )}

      {f.step === 2 && (
        <>
          <span className="lbl">{t.back.state}</span>
          <div className="chips">
            <button type="button" className={`pill ${!toService ? 'on' : ''}`} onClick={() => set({ toService: false })}>
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

      {f.step === 3 && (
        <section className="card summary-card">
          <SumRow k={t.back.sumOdometer} v={<span className="mono">{km} km</span>} go={() => set({ step: 0 })} />
          <SumRow k={t.back.sumKit} v={kitProblems.length ? kitProblems.join(' · ') : t.back.kitOk} go={() => set({ step: 0 })} />
          <SumRow k={t.back.sumClaims} v={<span className="mono">{formatGel(claims)}</span>} go={() => set({ step: 1 })} />
          <SumRow k={t.back.sumDeposit} v={!decides ? t.back.decisionOwner : kept > 0 ? t.back.decisionKeep(formatGel(kept, { decimals: false })) : t.back.decisionReturn} go={() => set({ step: 1 })} />
          {decides && <SumRow k={t.back.sumDebt} v={<span className="mono">{formatGel(Math.max(0, claims - kept))}</span>} go={() => set({ step: 1 })} />}
          <SumRow k={t.back.sumWhere} v={toService ? t.back.toService : `${t.back.free} · ${locations.find((l) => l.id === locationId)?.name ?? '—'}`} go={() => set({ step: 2 })} />
          {progress && <p className="hint muted">{progress}</p>}
          {confirming && (
            <div className="form-banner form-banner-warn" role="alertdialog">
              <div>
                <b>{t.back.confirmKeep(formatGel(kept))}</b>
                <br />
                {claims - kept > 0 ? t.back.confirmDebt(formatGel(claims - kept)) : t.back.confirmNoDebt}
              </div>
              <div className="row-actions">
                <button type="button" className="pill pill-sm" onClick={() => setConfirming(false)}>
                  {t.back.cancel}
                </button>
                <button type="button" className="pill pill-sm pill-accent" onClick={() => void submit()}>
                  {t.back.keep} {formatGel(kept, { decimals: false })}
                </button>
              </div>
            </div>
          )}
        </section>
      )}
    </Wizard>
  );
}

/** "Готово": the moped and where it stands, what was kept, what is owed, the act to sign. */
function ReturnDone({ rentalId, serviceJobId, point }: { rentalId: string; serviceJobId: string | null; point: string | null }) {
  const t = useT();
  const openMoney = useMoneyForm();
  const { can } = useSession();
  const { data, reload } = useLoad<RentalCard>(`/api/rentals/${rentalId}`);
  const job = useLoad<{ job: { number: string } }>(serviceJobId ? `/api/service/${serviceJobId}` : null);
  if (!data) return <Loading />;
  const r = data.rental;
  const d = data.deposit;
  const toHandBack = d ? Math.max(0, d.returnedTetri - d.paidOutTetri) : 0;
  const target = { rentalId: r.id, number: r.number, customerId: r.customer.id, customer: r.customer.name };
  return (
    <div className="wizard">
      <header className="wizard-head">
        <h1>{t.back.done}</h1>
      </header>
      <section className="card">
        <p>
          <b>{r.number}</b>
          {r.vehicle && (
            <>
              {' '}
              · {r.vehicle.model} <Vin vin={r.vehicle.vin} />
            </>
          )}
        </p>
        <p className="muted">{serviceJobId ? t.back.doneService : point ? t.back.doneWhere(point) : ''}</p>
        {d?.decided && d.withheldTetri > 0 && <p>{t.back.kept(formatGel(d.withheldTetri, { decimals: false }))}</p>}
        {r.debtTetri > 0 && <p className="crit-text">{t.back.debt(formatGel(r.debtTetri, { decimals: false }))}</p>}
        {d && !d.decided && <p className="warn-text">{can('deposit.decide') ? t.rentalMoney.undecided : t.back.managerDone}</p>}
        {serviceJobId && (
          <p>
            <Link to={`/service/${serviceJobId}`}>{t.back.serviceOpened(job.data?.job.number ?? '')}</Link>
          </p>
        )}
      </section>
      {data.documents.returnAct && (
        <section className="card">
          <DocumentRow
            rentalId={r.id}
            kind="return-act"
            title={t.back.act}
            sub={d && !d.decided ? t.back.undecided : undefined}
            state={data.documents.returnAct}
            customerId={r.customer.id}
            onChanged={reload}
          />
        </section>
      )}
      <div className="row-actions">
        {toHandBack > 0 && can('payments.reconcile') && (
          <button type="button" className="pill pill-accent" onClick={() => openMoney({ target: { kind: 'deposit_payout', ...target } })}>
            {t.back.payOut(formatGel(toHandBack, { decimals: false }))}
          </button>
        )}
        {r.debtTetri > 0 && can('cash.record') && (
          <button type="button" className="pill pill-accent" onClick={() => openMoney({ target: { kind: 'rent', ...target } })}>
            {t.back.takeDebt(formatGel(r.debtTetri, { decimals: false }))}
          </button>
        )}
        <Link to="/" className="pill">
          {t.hand.toToday}
        </Link>
        <Link to={`/rentals/${r.id}`} className="pill">
          {t.hand.openRental}
        </Link>
      </div>
    </div>
  );
}
