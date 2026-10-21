import { readImei, type ServicePartKind, type VehicleState } from '@ev8/shared';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api } from '../api.js';
import { Drawer } from '../components/Drawer.js';
import { BlockHead, Loading, StateBadge, Vin } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { Form, useFieldError } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { toBase64, type PreparedPhoto } from '../lib/photos.js';
import { TypedIn } from '../lib/typed.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import type { ServiceJob, ServiceJobPart } from './ServicePage.js';
import { Photos } from './WorkshopJobWizard.js';
import './workshop-job.css';

// Parts and trackers in the mechanic's repair (stage 4 of the mechanic plan;
// prototype mechanic-parts-options.html, variants A and A, chosen by Mika on
// 20.10.2026; ADR-0036): the parts are written on the repair's card as the
// work goes, and «＋ Деталь» asks first where the part came from — five big
// tiles — and then only what that kind needs.

/** A part as the workshop reads the shelf: how many, never what it cost. */
interface ShelfPart {
  id: string;
  sku: string | null;
  name: string;
  nameKa: string | null;
  unit: string;
  onHand: number;
  isTracker: boolean;
}

/** A moped found as a donor: the same search as «Новая заявка», written-off ones too. */
interface DonorMoped {
  id: string;
  vin: string;
  number: string | null;
  model: string;
  state: VehicleState;
}

type Choice = ServicePartKind | 'battery';

/** The last four of an IMEI or a SIM: enough to find the sticker, not the number. */
const tail = (s: string | null) => (s ? s.slice(-4) : '····');

/** Lines of parts, batteries and trackers on a repair, as the workshop reads them. */
export function PartLines({ job, onRemove }: { job: ServiceJob; onRemove?: (p: ServiceJobPart) => void }) {
  const t = useT();
  const { can } = useSession();
  const whole = job.rejected != null;
  return (
    <ul className="wjob-lines wparts-lines">
      {job.parts.map((p) => {
        const state = whole && p.state ? 'rejected' : p.state;
        const shade = state === 'waiting' && job.approved == null ? '' : state ? `wjob-line-${state}` : '';
        return (
          <li key={p.id} className={shade}>
            <span className="wparts-kind">{t.wparts.kinds[p.kind] ?? p.kind}</span>
            <span className="wjob-name">
              {p.name}
              <PartNote p={p} />
              {state === 'rejected' && !whole && p.rejectReason && (
                <span className="wjob-line-why">
                  <TypedIn words={t.wappr.lineRejected} text={p.rejectReason} />
                </span>
              )}
            </span>
            {state === 'waiting' && job.approved != null && <span className="wjob-wtag">{t.wappr.waitingTag}</span>}
            <span className="mono wparts-qty">× {p.qty}</span>
            {onRemove && !(p.kind === 'bought' && p.state === 'approved' && !can('service.approve')) && (
              <button type="button" className="wparts-x" aria-label={t.repair.removeLine} onClick={() => onRemove(p)}>
                ×
              </button>
            )}
          </li>
        );
      })}
      {job.batteries.map((b) => (
        <li key={b.id}>
          <span className="wparts-kind wparts-bat">{t.wparts.items[b.item] ?? b.item}</span>
          <span className="wjob-name">
            {t.wparts.batteryKinds[b.kind] ?? b.kind}
            <small className="wparts-sub">{t.wparts.batteryLine}</small>
          </span>
          <span className="mono wparts-qty">× {b.qty}</span>
        </li>
      ))}
      {job.trackers.removed.map((tr) => (
        <li key={tr.id}>
          <span className="wparts-kind">{t.wparts.trackerMark}</span>
          <span className="wjob-name">{t.wparts.trackerTakenOff(tail(tr.imei))}</span>
        </li>
      ))}
    </ul>
  );
}

/** The quiet line under a part: what makes this kind of line what it is. */
export function PartNote({ p }: { p: ServiceJobPart }) {
  const t = useT();
  const { me } = useSession();
  const bits: ReactNode[] = [];
  if (p.kind === 'bought' && p.paidTetri != null) {
    const mine = p.reimburseTo?.id === me?.id;
    bits.push(mine || !p.reimburseTo ? t.wparts.payBack(formatGel(p.paidTetri)) : t.wparts.payBackTo(formatGel(p.paidTetri), p.reimburseTo.name));
  }
  if (p.kind === 'donor' && p.donor) bits.push(t.wparts.donorFrom(p.donor.number ?? `···${p.donor.vin.slice(-4)}`));
  if (p.tracker) bits.push(`${t.wparts.imeiTail(tail(p.tracker.imei))} · ${t.wparts.simTail(tail(p.tracker.simPhone))}`);
  const receipt = p.receiptPhotoId ? (
    <a href={`/api/files/${p.receiptPhotoId}`} target="_blank" rel="noreferrer" className="wjob-link">
      {t.wparts.receiptTag}
    </a>
  ) : null;
  if (bits.length === 0 && !receipt) return null;
  return (
    <small className="wparts-sub">
      {bits.join(' · ')}
      {receipt && bits.length > 0 ? ' · ' : ''}
      {receipt}
    </small>
  );
}

/**
 * The block «Детали» on a repair the workshop carries (variant A): the lines,
 * and «＋ Деталь» beside «＋ Работа». A line written by mistake comes off with
 * its own movement, as on the owners' form.
 */
export function PartsBlock({ job, editable, onChanged }: { job: ServiceJob; editable: boolean; onChanged: () => void }) {
  const t = useT();
  const toast = useToast();
  const op = useOperation();
  const [adding, setAdding] = useState(false);
  const [offTracker, setOffTracker] = useState(false);
  const count = job.parts.length + job.batteries.length + job.trackers.removed.length;
  if (count === 0 && !editable) return null;
  const remove = async (p: ServiceJobPart) => {
    // The shelf's part goes back: say it before it is written (QA-W5-18).
    if (p.kind === 'stock' && p.partId && !window.confirm(t.repair.returnToStock(p.qty))) return;
    const res = await op.run((key) => api.del(`/api/service/${job.id}/parts/${p.id}`, { key }), `del:${p.id}`);
    if (!res.ok) return;
    toast({ text: p.kind === 'stock' && p.partId ? t.repair.partReturned(p.qty) : t.repair.partRemoved });
    onChanged();
  };
  return (
    <section className="card">
      <BlockHead title={t.wparts.block} sub={count > 0 ? t.wparts.lines(count) : undefined} />
      {count > 0 && <PartLines job={job} onRemove={editable ? (p) => void remove(p) : undefined} />}
      {op.failure && (
        <p className="field-err" role="alert">
          {op.failure.fieldText ?? op.failure.text}
        </p>
      )}
      {editable && (
        <div className="row-actions">
          <button type="button" className="wjob-btn" onClick={() => setAdding(true)}>
            + {t.wparts.add}
          </button>
          {job.vehicle.tracker && (
            <button type="button" className="pill" onClick={() => setOffTracker(true)}>
              {t.wparts.removeTracker} ···{tail(job.vehicle.tracker.imei)}
            </button>
          )}
        </div>
      )}
      {adding && <AddPartSheet job={job} onClose={() => setAdding(false)} onDone={onChanged} />}
      {offTracker && (
        <Drawer title={t.wparts.removeTracker} onClose={() => setOffTracker(false)}>
          <TrackerOffForm job={job} onBack={() => setOffTracker(false)} onDone={() => {
            setOffTracker(false);
            onChanged();
          }} />
        </Drawer>
      )}
    </section>
  );
}

/** «＋ Деталь»: first where it came from, then only what that kind needs. */
export function AddPartSheet({ job, onClose, onDone }: { job: ServiceJob; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [kind, setKind] = useState<Choice | null>(null);
  const done = () => {
    onClose();
    onDone();
  };
  const tiles: { k: Choice; g: string }[] = [
    { k: 'stock', g: '▤' },
    { k: 'bought', g: '₾' },
    { k: 'removed', g: '↩' },
    { k: 'donor', g: '⇄' },
    { k: 'battery', g: '⚡' },
  ];
  return (
    <Drawer title={kind ? t.wparts.tiles[kind].title : t.wparts.pickTitle} onClose={onClose}>
      {kind == null ? (
        <div className="wparts-tiles">
          {tiles.map(({ k, g }) => (
            <button key={k} type="button" className={`wparts-tile ${k === 'battery' ? 'wparts-tile-bat' : ''}`} onClick={() => setKind(k)}>
              <span className="wparts-glyph" aria-hidden="true">
                {g}
              </span>
              <b>{t.wparts.tiles[k].title}</b>
              <span className="muted">{t.wparts.tiles[k].note}</span>
            </button>
          ))}
        </div>
      ) : kind === 'battery' ? (
        <BatteryForm job={job} onBack={() => setKind(null)} onDone={done} />
      ) : (
        <PartForm job={job} kind={kind} onBack={() => setKind(null)} onDone={done} />
      )}
    </Drawer>
  );
}

interface PartDraft {
  partId: string | null;
  name: string;
  free: boolean;
  qty: number;
  paid: string;
  imei: string;
  sim: string;
  donorId: string | null;
  working: 'yes' | 'no' | null;
}
const BLANK: PartDraft = { partId: null, name: '', free: false, qty: 1, paid: '', imei: '', sim: '', donorId: null, working: null };

/** One kind's fields, one write. */
function PartForm({ job, kind, onBack, onDone }: { job: ServiceJob; kind: ServicePartKind; onBack: () => void; onDone: () => void }) {
  const t = useT();
  const { can } = useSession();
  const shelf = useLoad<{ parts: ShelfPart[] }>('/api/service/shelf');
  const [f, setF] = useState<PartDraft>(BLANK);
  const [receipt, setReceipt] = useState<PreparedPhoto[]>([]);
  const [donor, setDonor] = useState<DonorMoped | null>(null);
  const parts = shelf.data?.parts ?? [];
  const picked = parts.find((p) => p.id === f.partId) ?? null;
  const tracker = picked?.isTracker === true;
  const here = `${job.vehicle.number ?? `···${job.vehicle.vin.slice(-4)}`}, ${job.number}`;
  const approver = job.status === 'open' && can('service.approve');
  const offTracker = kind === 'removed' && tracker;

  if (!shelf.data) return <Loading />;
  if (offTracker) return <TrackerOffForm job={job} onBack={() => setF(BLANK)} onDone={onDone} />;

  const need = (field: string, words: string) => new ApiError(400, 'missing_field', words, { field, fieldText: words });
  const submit = async (key: string) => {
    if (kind === 'donor' && !donor) throw need('donorVehicleId', t.wparts.needDonor);
    if (!f.partId && !(f.free && f.name.trim())) throw need('partId', t.wparts.needPart);
    if (kind === 'bought' && !f.paid.trim()) throw need('paidTetri', t.wparts.needPaid);
    if (kind === 'bought' && receipt.length === 0) throw need('receiptPhoto', t.wparts.takeReceipt);
    if (kind === 'removed' && f.working !== 'yes') throw need('working', t.wparts.notWorkingNote);
    const body: Record<string, unknown> = { kind, qty: tracker ? 1 : f.qty };
    if (f.partId) body.partId = f.partId;
    else body.name = f.name.trim();
    if (kind === 'bought') {
      body.paidTetri = f.paid.trim();
      body.receiptPhoto = { mimeType: receipt[0]!.mimeType, dataBase64: await toBase64(receipt[0]!.blob) };
    }
    if (kind === 'donor') body.donorVehicleId = donor!.id;
    if (tracker) {
      body.imei = f.imei;
      body.sim = f.sim;
    }
    await api.post(`/api/service/${job.id}/parts`, body, { key });
    return { toast: { text: kind === 'bought' && !approver ? t.wparts.boughtSent : t.wparts.written } };
  };

  return (
    <Form
      value={{ ...f, donor: donor?.id ?? null, receipt: receipt.length }}
      initial={{ ...BLANK, donor: null, receipt: 0 }}
      submit={submit}
      label={kind !== 'removed' && !tracker && f.qty > 1 ? t.wparts.writeN(f.qty) : t.wparts.write}
      actions={
        <button type="button" className="pill" onClick={onBack}>
          {t.wparts.back}
        </button>
      }
      onDone={onDone}
      className="wparts-form"
    >
      {kind === 'donor' && <DonorPicker job={job} chosen={donor} onPick={setDonor} />}
      <PartPicker
        parts={parts}
        chosen={f.partId}
        free={kind === 'bought' || kind === 'donor' ? { on: f.free, name: f.name } : null}
        label={kind === 'bought' ? t.wparts.whatBought : kind === 'donor' ? t.wparts.donorWhat : t.wparts.search}
        onPick={(id) => setF({ ...f, partId: id, free: false, name: '' })}
        onFree={(on, name) => setF({ ...f, partId: null, free: on, name })}
        showShelf={kind === 'stock' || kind === 'removed'}
      />
      {!tracker && (f.partId || f.free) && <Qty value={f.qty} onChange={(qty) => setF({ ...f, qty })} />}
      {kind === 'stock' && picked && picked.onHand < f.qty && <p className="hint">{t.wparts.shortHint}</p>}
      {tracker && (kind === 'stock' || kind === 'bought' || kind === 'donor') && <TrackerFields imei={f.imei} sim={f.sim} onChange={(imei, sim) => setF({ ...f, imei, sim })} vehicle={job.vehicle.number ?? job.vehicle.model} />}
      {kind === 'bought' && (
        <>
          <Field label={t.wparts.paid} name="paidTetri">
            <input className="input wjob-big" inputMode="decimal" autoComplete="off" value={f.paid} onChange={(e) => setF({ ...f, paid: e.target.value.replace(/[^\d.,\s]/g, '') })} />
          </Field>
          <div data-field="receiptPhoto">
            <Photos photos={receipt} onChange={setReceipt} label={t.wparts.receipt} tag={t.wparts.receiptTag} max={1} />
            <FieldErr name="receiptPhoto" />
          </div>
          <p className="wparts-note">{approver ? t.wparts.boughtNoteApprover : t.wparts.boughtNote}</p>
        </>
      )}
      {kind === 'removed' && picked && (
        <div className="field" data-field="working">
          <span className="lbl">{t.wparts.working}</span>
          <div className="wjob-chips">
            <button type="button" className={`wjob-chip ${f.working === 'yes' ? 'on' : ''}`} aria-pressed={f.working === 'yes'} onClick={() => setF({ ...f, working: 'yes' })}>
              {t.wparts.yesWorking}
            </button>
            <button type="button" className={`wjob-chip ${f.working === 'no' ? 'on' : ''}`} aria-pressed={f.working === 'no'} onClick={() => setF({ ...f, working: 'no' })}>
              {t.wparts.no}
            </button>
          </div>
          {f.working != null && <span className="hint muted">{f.working === 'yes' ? t.wparts.toShelfNote(here) : t.wparts.notWorkingNote}</span>}
          <FieldErr name="working" />
        </div>
      )}
      {kind === 'donor' && donor && <p className="wparts-note">{t.wparts.donorNote(donor.number ?? `···${donor.vin.slice(-4)}`, here)}</p>}
    </Form>
  );
}

/** Search the shelf by name or article number, from the first letter (principle 8). */
function PartPicker({
  parts,
  chosen,
  free,
  label,
  onPick,
  onFree,
  showShelf,
}: {
  parts: ShelfPart[];
  chosen: string | null;
  free: { on: boolean; name: string } | null;
  label: string;
  onPick: (id: string) => void;
  onFree: (on: boolean, name: string) => void;
  showShelf: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [q, setQ] = useState('');
  const name = (p: ShelfPart) => (locale === 'ka' && p.nameKa) || p.name;
  const found = useMemo(() => {
    const s = q.trim().toLowerCase();
    const list = s ? parts.filter((p) => [p.name, p.nameKa ?? '', p.sku ?? ''].some((x) => x.toLowerCase().includes(s))) : parts;
    return list.slice(0, 8);
  }, [parts, q]);
  const picked = parts.find((p) => p.id === chosen) ?? null;
  return (
    <div className="field" data-field="partId">
      <span className="lbl">{label}</span>
      <input className="input wjob-text" autoComplete="off" placeholder={t.wparts.search} value={q} onChange={(e) => setQ(e.target.value)} />
      {parts.length === 0 && <p className="hint">{t.wparts.emptyShelf}</p>}
      {q.trim() && found.length === 0 && parts.length > 0 && <p className="hint muted">{t.wparts.nothing(q.trim())}</p>}
      <ul className="wparts-res">
        {(picked && !found.includes(picked) ? [picked, ...found] : found).map((p) => (
          <li key={p.id}>
            <button type="button" className={`wparts-row ${p.id === chosen ? 'on' : ''}`} aria-pressed={p.id === chosen} onClick={() => onPick(p.id)}>
              <span className="wjob-code">{p.sku ?? '—'}</span>
              <span className="wjob-name">
                {name(p)}
                {p.isTracker && <span className="wparts-mark">{t.wparts.trackerMark}</span>}
              </span>
              {showShelf && <span className={`wparts-on ${p.onHand <= 0 ? 'bad' : ''}`}>{t.wparts.onShelf(p.onHand)}</span>}
            </button>
          </li>
        ))}
        {free && (
          <li>
            <button type="button" className={`wparts-row wparts-free ${free.on ? 'on' : ''}`} aria-pressed={free.on} onClick={() => onFree(!free.on, free.name)}>
              <span className="wjob-name">{t.wparts.notListed}</span>
            </button>
          </li>
        )}
      </ul>
      {free?.on && (
        <input className="input wjob-text" autoFocus aria-label={t.wparts.typedName} placeholder={t.wparts.typedName} value={free.name} onChange={(e) => onFree(true, e.target.value)} />
      )}
      <FieldErr name="partId" />
    </div>
  );
}

/** The words a refusal put under a field that is a list rather than one input. */
function FieldErr({ name }: { name: string }) {
  const words = useFieldError(name);
  return words ? <span className="field-err">{words}</span> : null;
}

function Qty({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useT();
  return (
    <div className="field">
      <span className="lbl">{t.wparts.qty}</span>
      <span className="wjob-qty">
        <button type="button" aria-label="−" disabled={value <= 1} onClick={() => onChange(Math.max(1, value - 1))}>
          <Minus size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <b className="mono">{value}</b>
        <button type="button" aria-label="+" disabled={value >= 999} onClick={() => onChange(value + 1)}>
          <Plus size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

/** The IMEI off the sticker, checked as it is typed, and the SIM's number. */
export function TrackerFields({ imei, sim, vehicle, onChange }: { imei: string; sim: string; vehicle: string; onChange: (imei: string, sim: string) => void }) {
  const t = useT();
  const digits = imei.replace(/\D/g, '');
  const ok = readImei(imei) != null;
  return (
    <>
      <Field label={t.wparts.imei} name="imei">
        <input
          className="input wjob-big wparts-imei"
          inputMode="numeric"
          autoComplete="off"
          value={imei}
          onChange={(e) => onChange(e.target.value.replace(/[^\d\s-]/g, '').slice(0, 21), sim)}
        />
      </Field>
      {digits.length > 0 && (
        <p className={ok ? 'wparts-ok' : digits.length === 15 ? 'field-err' : 'hint muted'}>{ok ? `✓ ${t.wparts.imeiOk}` : digits.length === 15 ? t.wparts.imeiBad : t.wparts.imeiCount(digits.length)}</p>
      )}
      <Field label={t.wparts.sim} name="sim">
        <input className="input wjob-big" inputMode="tel" autoComplete="off" value={sim} onChange={(e) => onChange(imei, e.target.value.slice(0, 24))} />
      </Field>
      <p className="wparts-note">{t.wparts.trackerNote(vehicle)}</p>
    </>
  );
}

/** The donor: by the number on its sticker or the end of its VIN — a written-off one too. */
function DonorPicker({ job, chosen, onPick }: { job: ServiceJob; chosen: DonorMoped | null; onPick: (v: DonorMoped | null) => void }) {
  const t = useT();
  const [typed, setTyped] = useState('');
  const [asked, setAsked] = useState('');
  useEffect(() => {
    const id = window.setTimeout(() => setAsked(typed.trim()), 250);
    return () => window.clearTimeout(id);
  }, [typed]);
  const found = useLoad<{ vehicles: DonorMoped[] }>(asked ? `/api/service/vehicles?donor=1&q=${encodeURIComponent(asked)}` : null);
  const list = (found.data?.vehicles ?? []).filter((v) => v.id !== job.vehicle.id);
  return (
    <div className="field" data-field="donorVehicleId">
      <span className="lbl">{t.wparts.donorWhich}</span>
      <input className="input wjob-big" autoCapitalize="characters" autoComplete="off" value={typed} onChange={(e) => setTyped(e.target.value)} />
      {asked && found.data && list.length === 0 && <p className="hint muted">{t.wjob.nothingFound(asked)}</p>}
      <FieldErr name="donorVehicleId" />
      <ul className="wjob-mopeds">
        {(chosen && !list.some((v) => v.id === chosen.id) ? [chosen, ...list] : list).map((v) => (
          <li key={v.id}>
            <button type="button" className={`wjob-moped ${chosen?.id === v.id ? 'on' : ''}`} aria-pressed={chosen?.id === v.id} onClick={() => onPick(chosen?.id === v.id ? null : v)}>
              <span className="wjob-moped-head">
                <span>
                  <b className="mono">{v.number ?? ''}</b> {v.model}
                </span>
                <StateBadge state={v.state} />
              </span>
              <Vin vin={v.vin} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The tracker comes off: working — onto the shelf; broken — only closed on the
 * moped. One written on the moped's card never came off a shelf, so it goes
 * back to none, working or not (ADR-0036, addendum 21.10.2026, item 6).
 */
function TrackerOffForm({ job, onBack, onDone }: { job: ServiceJob; onBack: () => void; onDone: () => void }) {
  const t = useT();
  const [working, setWorking] = useState<boolean | null>(null);
  const tr = job.vehicle.tracker;
  const offHint = (yes: boolean) => (!yes ? t.wparts.trackerOffBroken : tr?.fromShelf === false ? t.wparts.trackerOffNoShelf : t.wparts.trackerOffWorking);
  if (!tr) {
    return (
      <div className="wparts-form">
        <p className="hint">{t.wparts.noTracker}</p>
        <button type="button" className="pill" onClick={onBack}>
          {t.wparts.back}
        </button>
      </div>
    );
  }
  return (
    <Form
      value={working}
      initial={null}
      submit={async (key) => {
        if (working == null) throw new ApiError(400, 'missing_field', t.wparts.trackerWorking, { field: 'working', fieldText: t.wparts.trackerWorking });
        await api.post(`/api/service/${job.id}/tracker/remove`, { working }, { key });
        return { toast: { text: t.wparts.trackerRemoved } };
      }}
      label={t.wparts.removeTracker}
      actions={
        <button type="button" className="pill" onClick={onBack}>
          {t.wparts.back}
        </button>
      }
      onDone={onDone}
      className="wparts-form"
    >
      <p className="wparts-q">{t.wparts.removeTrackerQ(tail(tr.imei))}</p>
      <div className="field" data-field="working">
        <span className="lbl">{t.wparts.trackerWorking}</span>
        <div className="wjob-chips">
          <button type="button" className={`wjob-chip ${working === true ? 'on' : ''}`} aria-pressed={working === true} onClick={() => setWorking(true)}>
            {t.wparts.yesWorking}
          </button>
          <button type="button" className={`wjob-chip ${working === false ? 'on' : ''}`} aria-pressed={working === false} onClick={() => setWorking(false)}>
            {t.wparts.no}
          </button>
        </div>
        {working != null && <span className="hint muted">{offHint(working)}</span>}
        <FieldErr name="working" />
      </div>
    </Form>
  );
}

/** A battery or a charger to repair or back: their own count, by number (ADR-0025). */
function BatteryForm({ job, onBack, onDone }: { job: ServiceJob; onBack: () => void; onDone: () => void }) {
  const t = useT();
  const [f, setF] = useState<{ item: 'battery' | 'charger'; kind: 'to_repair' | 'from_repair'; qty: number }>({ item: 'battery', kind: 'to_repair', qty: 1 });
  const chip = (on: boolean, label: string, pick: () => void) => (
    <button type="button" className={`wjob-chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={pick}>
      {label}
    </button>
  );
  return (
    <Form
      value={f}
      initial={{ item: 'battery', kind: 'to_repair', qty: 1 }}
      submit={async (key) => {
        await api.post(`/api/service/${job.id}/batteries`, f, { key });
        return { toast: { text: t.wparts.written } };
      }}
      label={t.wparts.write}
      actions={
        <button type="button" className="pill" onClick={onBack}>
          {t.wparts.back}
        </button>
      }
      onDone={onDone}
      className="wparts-form"
    >
      <div className="field">
        <span className="lbl">{t.wparts.batteryWhat}</span>
        <div className="wjob-chips">
          {chip(f.item === 'battery', t.wparts.battery, () => setF({ ...f, item: 'battery' }))}
          {chip(f.item === 'charger', t.wparts.charger, () => setF({ ...f, item: 'charger' }))}
        </div>
      </div>
      <div className="field">
        <span className="lbl">{t.wparts.batteryWhere}</span>
        <div className="wjob-chips">
          {chip(f.kind === 'to_repair', t.wparts.toRepair, () => setF({ ...f, kind: 'to_repair' }))}
          {chip(f.kind === 'from_repair', t.wparts.fromRepair, () => setF({ ...f, kind: 'from_repair' }))}
        </div>
      </div>
      <Qty value={f.qty} onChange={(qty) => setF({ ...f, qty })} />
      <p className="wparts-note">{t.wparts.batteryNote}</p>
    </Form>
  );
}
