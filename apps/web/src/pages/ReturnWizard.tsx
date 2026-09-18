import { gelFromTetri, parseGel, todayISO } from '@ev8/shared';

const RETURN_ITEMS = ['moped', 'key', 'battery_1', 'battery_2', 'charger_1', 'charger_2'] as const;
type Item = (typeof RETURN_ITEMS)[number];
const ITEM_STATES = ['ok', 'damaged', 'missing'] as const;
type ItemState = (typeof ITEM_STATES)[number];
const GROUNDS = ['rent_arrears', 'fines', 'moped_damage', 'incomplete_return', 'key_loss', 'charger_loss', 'cleaning', 'other'] as const;
type Ground = (typeof GROUNDS)[number];
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { Empty, Loading, Vin } from '../components/ui.js';
import { Field, Row, Wizard } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { DraftOffer } from '../ds/form/Form.js';
import { useDraft } from '../ds/form/drafts.js';
import { useOperation } from '../ds/form/operation.js';
import { uploadAll, type PreparedPhoto } from '../lib/photos.js';
import { PhotoPicker } from '../components/PhotoPicker.js';
import { useSession } from '../session.js';
import type { RentalCard } from './RentalPage.js';

type Decision = 'full' | 'part' | 'all';

// Return in three screens (RNT-04, RNT-05): act → deposit → done. The deposit
// screen appears only for roles that decide on it; a manager's return leaves
// the deposit held for an owner.
export function ReturnWizard() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<RentalCard>(id ? `/api/rentals/${id}` : null);
  const decides = can('deposit.decide');
  const steps = decides ? [t.ret.title, t.ret.depositDecision, t.pickup.steps.done] : [t.ret.title, t.pickup.steps.done];
  const [step, setStep] = useState(0);
  const [returnedOn, setReturnedOn] = useState(todayISO());
  const [odometer, setOdometer] = useState('');
  const [condition, setCondition] = useState('');
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [items, setItems] = useState<Record<Item, { state: ItemState; note: string }>>(
    () => Object.fromEntries(RETURN_ITEMS.map((i) => [i, { state: 'ok' as ItemState, note: '' }])) as Record<Item, { state: ItemState; note: string }>,
  );
  const [grounds, setGrounds] = useState<Ground[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [decision, setDecision] = useState<Decision>('full');
  const [withheld, setWithheld] = useState('');
  const [reason, setReason] = useState('');
  const [returnedTo, setReturnedTo] = useState('');
  const [done, setDone] = useState(false);
  const op = useOperation();

  // The draft: everything typed except the photos, which are files.
  const typed = { step, returnedOn, odometer, condition, items, grounds, decision, withheld, reason, returnedTo };
  const [start] = useState(() => typed);
  const drafts = useDraft({ id: id ? `return:${id}` : undefined, value: typed, initial: start, hold: done });
  const restore = (d: typeof typed) => {
    setStep(Math.min(d.step, decides ? 1 : 0));
    setReturnedOn(d.returnedOn);
    setOdometer(d.odometer);
    setCondition(d.condition);
    setItems(d.items);
    setGrounds(d.grounds);
    setDecision(d.decision);
    setWithheld(d.withheld);
    setReason(d.reason);
    setReturnedTo(d.returnedTo);
  };
  // A refusal about a field on the first screen goes back to it.
  useEffect(() => {
    const field = op.failure?.field;
    if (field && ['returnedOn', 'odometerKm', 'condition', 'items'].includes(field)) setStep(0);
  }, [op.failure]);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const r = data.rental;
  const amount = data.deposit?.amountTetri ?? r.depositTetri;
  const withheldTetri = decision === 'full' ? 0 : decision === 'all' ? amount : parseGel(withheld) ?? -1;
  const depositOk = !decides || (withheldTetri >= 0 && withheldTetri <= amount && (withheldTetri === 0 || reason.trim().length > 0));
  const lastStep = steps.length - 1;

  // One return, however many times the button is pressed: the act and each
  // photo carry keys, so a retry finds what is already stored.
  const submit = async () => {
    const res = await op.run(async (key) => {
      const { actId } = await api.post<{ ok: boolean; actId: string }>(
        `/api/rentals/${r.id}/return`,
        {
          returnedOn,
          odometerKm: odometer ? Number(odometer) : null,
          condition: condition || null,
          items,
          deposit: decides
            ? { returnedTetri: amount - withheldTetri, withheldTetri, withheldReason: reason || null, returnedTo: returnedTo || null, grounds }
            : undefined,
        },
        { key },
      );
      setDone(true);
      drafts.drop();
      await uploadAll(`/api/acts/${actId}/photos`, photos, (n) => setProgress(t.photos.uploading(n, photos.length)), `${key}-photo`);
    });
    setProgress(null);
    if (res.ok) setStep(lastStep);
  };

  if (drafts.offer) {
    return (
      <Wizard title={`${t.ret.title} · ${r.number}`} steps={steps} step={0}>
        <DraftOffer at={drafts.offer.at} words={r.customer.name} onContinue={() => drafts.accept(restore)} onDiscard={drafts.discard} />
      </Wizard>
    );
  }

  const confirmStep = decides ? 1 : 0;
  return (
    <Wizard
      title={`${t.ret.title} · ${r.number}`}
      steps={steps}
      step={step}
      submit={step === confirmStep ? { state: op.state, failure: op.failure, label: t.ret.finish } : undefined}
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
          <Field label={t.ret.returnedOn} name="returnedOn">
            <input className="input mono" type="date" value={returnedOn} onChange={(e) => setReturnedOn(e.target.value)} />
          </Field>
          <Field label={t.ret.odometer} name="odometerKm">
            <input className="input mono" value={odometer} onChange={(e) => setOdometer(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={t.ret.condition} name="condition">
            <textarea className="input textarea" rows={3} value={condition} onChange={(e) => setCondition(e.target.value)} />
          </Field>
          <h2 className="sub">{t.returnItems.title}</h2>
          <ul className="item-list">
            {RETURN_ITEMS.map((item) => (
              <li key={item}>
                <span className="item-name">{t.returnItems.items[item]}</span>
                <span className="chips">
                  {ITEM_STATES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={`pill pill-sm ${items[item].state === st ? 'on' : ''}`}
                      onClick={() => setItems({ ...items, [item]: { ...items[item], state: st } })}
                    >
                      {t.returnItems.states[st]}
                    </button>
                  ))}
                </span>
                {items[item].state === 'damaged' && (
                  <input
                    className="input"
                    placeholder={t.returnItems.note}
                    value={items[item].note}
                    onChange={(e) => setItems({ ...items, [item]: { ...items[item], note: e.target.value } })}
                  />
                )}
              </li>
            ))}
          </ul>
          <PhotoPicker photos={photos} onChange={setPhotos} label={t.pickup.photos} />
          {progress && <p className="hint muted">{progress}</p>}
          {!decides && <p className="hint muted">{t.ret.leaveToOwner}</p>}
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
            <>
              <span className="lbl">{t.grounds.title}</span>
              <div className="chips">
                {GROUNDS.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`pill pill-sm ${grounds.includes(g) ? 'on' : ''}`}
                    onClick={() => setGrounds(grounds.includes(g) ? grounds.filter((x) => x !== g) : [...grounds, g])}
                  >
                    {t.grounds[g]}
                  </button>
                ))}
              </div>
              <Field label={t.ret.withheldReason}>
                <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
            </>
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
