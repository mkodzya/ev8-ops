import { JOB_PHOTOS_MAX, SERVICE_REASONS, WORK_QTY_MAX, worksTotal, type ServiceReason, type VehicleState } from '@ev8/shared';
import { Camera, Minus, Plus, ScanLine } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { ColorText, Loading, StateBadge, Vin } from '../components/ui.js';
import { Field, Wizard } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { DraftOffer } from '../ds/form/Form.js';
import { useDraft } from '../ds/form/drafts.js';
import { useOperation } from '../ds/form/operation.js';
import { formatGel } from '../format.js';
import { useLocale, useT } from '../i18n/index.js';
import { preparePhoto, toBase64, type PreparedPhoto } from '../lib/photos.js';
import { useLoad } from '../lib/use.js';
import { groupDigits, nameIn, normText, type WorkBook, type WorkType } from '../lib/workBook.js';
import { useSession } from '../session.js';
import './workshop-job.css';

// The mechanic's new repair (stage 2 of the mechanic plan; prototype
// mechanic-job-open-options.html, variant A, chosen by Mika on 20.10.2026):
// five short steps on the workshop tablet — the moped, the odometer, what
// happened, the works, a last look — and one write at the end that carries
// the photos with it, so a repair without its mileage or its photos is never
// half written.

interface FoundVehicle {
  id: string;
  vin: string;
  number: string | null;
  model: string;
  color: string | null;
  state: VehicleState;
  odometerKm: number | null;
  openJob: { id: string; number: string; status: string; reason: string; mechanic: string | null; takeable: boolean; mine: boolean } | null;
}

type Lower = '' | 'replaced' | 'mistake' | 'other';

export interface Line {
  workTypeId: string | null;
  freeText: string | null;
  qty: number;
}

/** What the draft keeps: everything but the photos, which a draft cannot hold. */
interface Draft {
  q: string;
  vehicle: FoundVehicle | null;
  jobId: string | null;
  km: string;
  lower: Lower;
  lowerWords: string;
  reasonKind: ServiceReason | '';
  reason: string;
  lines: Line[];
}

const BLANK: Draft = { q: '', vehicle: null, jobId: null, km: '', lower: '', lowerWords: '', reasonKind: '', reason: '', lines: [] };

/** Which step a field the server refused lives on. */
const STEP_OF: Record<string, number> = { vehicleId: 0, odometerKm: 1, odometerPhoto: 1, odometerReason: 1, reasonKind: 2, reason: 2, photos: 2, works: 3 };

/** The text of a sticker's QR, or of anything else that names a moped: /m/EV-014 → EV-014. */
function stickerCode(text: string): string {
  const m = /\/m\/([^/?#\s]+)/.exec(text);
  return decodeURIComponent(m ? m[1]! : text).trim();
}

interface Detector {
  detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (opts: { formats: string[] }) => Detector;
/** The browser's own QR reader (Chrome on Android has it); without it the button is not shown. */
const QrDetector: DetectorClass | null = typeof window !== 'undefined' && 'BarcodeDetector' in window ? ((window as unknown as { BarcodeDetector: DetectorClass }).BarcodeDetector) : null;

export function WorkshopJobWizard() {
  const t = useT();
  const { locale } = useLocale();
  const { can } = useSession();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const book = useLoad<WorkBook>('/api/work-book');
  // «＋ ТО» and the workshop group's «Пора на ТО» open the repair planned (ADR-0038).
  const planned = params.get('reason') === 'planned';
  const initial = useMemo<Draft>(() => ({ ...BLANK, q: params.get('q') ?? '', reasonKind: params.get('reason') === 'planned' ? 'planned' : '' }), [params]);
  const [f, setF] = useState<Draft>(initial);
  const [step, setStep] = useState(0);
  const [odoPhoto, setOdoPhoto] = useState<PreparedPhoto | null>(null);
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [own, setOwn] = useState<Record<string, string>>({});
  const op = useOperation();
  const drafts = useDraft({ id: 'workshop-job', value: f, initial, hold: op.state === 'done' });
  const approver = can('service.approve');

  // A refusal names a field: go back to the step it lives on.
  useEffect(() => {
    const field = op.failure?.field;
    if (field && STEP_OF[field] != null) setStep(STEP_OF[field]!);
  }, [op.failure]);

  // What a planned maintenance is, by the spec: the fleet's diagnostics, DG-03 — put on the
  // list once, for the mechanic to keep or change.
  useEffect(() => {
    if (!planned || !book.data) return;
    const dg = book.data.works.find((w) => w.code === 'DG-03' && w.active);
    if (dg) setF((x) => (x.lines.length === 0 ? { ...x, lines: [{ workTypeId: dg.id, freeText: null, qty: 1 }] } : x));
  }, [planned, book.data]);

  if (drafts.offer) {
    return (
      <div className="wjob">
        <DraftOffer at={drafts.offer.at} words={`${drafts.offer.value.vehicle?.number ?? ''} ${t.wjob.photosLost}`} onContinue={() => drafts.accept(setF)} onDiscard={drafts.discard} />
      </div>
    );
  }
  if (!book.data && book.failure) return <LoadError failure={book.failure} onRetry={book.reload} />;
  if (!book.data) return <Loading />;
  const wb = book.data;

  const set = (patch: Partial<Draft>) => setF((x) => ({ ...x, ...patch }));
  const lastKm = f.vehicle?.odometerKm ?? null;
  const km = f.km.trim() === '' ? null : Number(f.km.replace(/\s/g, ''));
  const lower = km != null && lastKm != null && km < lastKm;
  const typeOf = (id: string | null) => (id ? wb.works.find((w) => w.id === id) ?? null : null);
  const priced = f.lines.map((l) => ({ qty: l.qty, normSec: typeOf(l.workTypeId)?.normSec ?? null, rateTetri: wb.rateTetri }));
  const total = worksTotal(priced);

  /** What keeps a step from going on, in the words for the field. */
  const problems = (s: number): Record<string, string> => {
    const p: Record<string, string> = {};
    if (s === 0 && !f.vehicle) p.vehicle = t.wjob.needMoped;
    if (s === 1) {
      if (km == null || !Number.isInteger(km) || km < 0) p.km = t.wjob.needKm;
      if (!odoPhoto) p.odoPhoto = t.wjob.needOdoPhoto;
      if (lower && (!f.lower || (f.lower === 'other' && !f.lowerWords.trim()))) p.lower = t.wjob.needWhy;
    }
    if (s === 2) {
      if (!f.reasonKind) p.reasonKind = t.wjob.needReason;
      if (!f.reason.trim()) p.reason = t.wjob.needWhat;
      if (photos.length === 0) p.photos = t.wjob.needPhoto;
    }
    if (s === 3 && f.lines.length === 0) p.works = t.wjob.needWorks;
    return p;
  };
  const [shown, setShown] = [own, setOwn];
  const next = () => {
    const p = problems(step);
    setShown(p);
    if (Object.keys(p).length === 0) setStep(step + 1);
  };
  const back = () => {
    setShown({});
    if (step === 0) navigate('/service');
    else setStep(step - 1);
  };

  const lowerText = f.lower === 'other' ? f.lowerWords.trim() : f.lower ? t.wjob.lowerReasons[f.lower] : '';
  const submit = async () => {
    const res = await op.run(async (key) => {
      const body = {
        vehicleId: f.vehicle!.id,
        jobId: f.jobId,
        reasonKind: f.reasonKind,
        reason: f.reason.trim(),
        odometerKm: km,
        odometerReason: lower ? lowerText : null,
        odometerPhoto: odoPhoto ? { mimeType: odoPhoto.mimeType, dataBase64: await toBase64(odoPhoto.blob) } : null,
        photos: await Promise.all(photos.map(async (p) => ({ mimeType: p.mimeType, dataBase64: await toBase64(p.blob) }))),
        works: f.lines,
      };
      return api.post<{ id: string; number: string; status: string }>('/api/service/workshop', body, { key });
    });
    if (!res.ok) return;
    drafts.drop();
    toast({ text: res.value.status === 'draft' ? t.wjob.sent(res.value.number) : t.wjob.opened(res.value.number) });
    navigate(`/service/${res.value.id}`, { replace: true });
  };

  const last = step === t.wjob.steps.length - 1;
  return (
    <div className="wjob">
      <Wizard
        title={f.jobId && f.vehicle?.openJob ? t.wjob.continuing(f.vehicle.openJob.number) : t.wjob.newJob}
        steps={t.wjob.steps}
        step={step}
        onBack={back}
        onNext={last ? () => void submit() : next}
        submit={last ? { state: op.state, failure: op.failure, label: approver ? t.wjob.openRepair : t.wjob.send } : undefined}
        failure={op.failure}
        footNote={
          step === 3 ? (
            <>
              {t.wjob.picked(f.lines.length, total.unnormed)}
              <b className="mono">
                {t.wjob.min(normText(total.seconds, locale))} · {formatGel(total.tetri)}
              </b>
            </>
          ) : undefined
        }
      >
        {step === 0 && (
          <MopedStep
            q={f.q}
            chosen={f.vehicle}
            jobId={f.jobId}
            error={shown.vehicle}
            onQuery={(q) => set({ q })}
            onPick={(v, jobId) => {
              setShown({});
              set({ vehicle: v, jobId, reason: jobId && v.openJob ? v.openJob.reason : f.reason, km: '', lower: '', lowerWords: '' });
            }}
          />
        )}
        {step === 1 && (
          <div className="wjob-step">
            <h2 className="wjob-q">{t.wjob.mileageQ}</h2>
            <div className="wjob-odo">
              <Field label={t.wjob.km} name="odometerKm" error={shown.km} hint={lastKm != null ? t.wjob.wasKm(groupDigits(lastKm)) : t.wjob.noKmYet}>
                <input className="input wjob-big" inputMode="numeric" autoFocus value={f.km} onChange={(e) => set({ km: e.target.value.replace(/[^\d\s]/g, '') })} />
              </Field>
              <OnePhoto label={t.wjob.odometerPhoto} tag={t.wjob.photoTags.odometer!} photo={odoPhoto} onChange={setOdoPhoto} error={shown.odoPhoto} />
            </div>
            {lower && (
              <div className="wjob-lower" data-field="odometerReason">
                <p>{t.wjob.lowerKm(groupDigits(lastKm!))}</p>
                <div className="wjob-chips">
                  {(['replaced', 'mistake', 'other'] as const).map((k) => (
                    <button key={k} type="button" className={`wjob-chip wjob-chip-sm ${f.lower === k ? 'on' : ''}`} aria-pressed={f.lower === k} onClick={() => set({ lower: k })}>
                      {t.wjob.lowerReasons[k]}
                    </button>
                  ))}
                </div>
                {f.lower === 'other' && (
                  <Field label={t.wjob.lowerWords}>
                    <input className="input" value={f.lowerWords} onChange={(e) => set({ lowerWords: e.target.value })} />
                  </Field>
                )}
                {shown.lower && <span className="field-err">{shown.lower}</span>}
                <p className="hint muted">{t.wjob.lowerNote}</p>
              </div>
            )}
          </div>
        )}
        {step === 2 && (
          <div className="wjob-step">
            <h2 className="wjob-q">{t.wjob.damageQ}</h2>
            <div className="field" data-field="reasonKind">
              <span className="lbl">{t.wjob.reason}</span>
              <div className="wjob-chips">
                {SERVICE_REASONS.map((r) => (
                  <button key={r} type="button" className={`wjob-chip ${f.reasonKind === r ? 'on' : ''}`} aria-pressed={f.reasonKind === r} onClick={() => set({ reasonKind: r })}>
                    {t.wjob.reasons[r]}
                  </button>
                ))}
              </div>
              {shown.reasonKind && <span className="field-err">{shown.reasonKind}</span>}
            </div>
            <Field label={t.wjob.what} name="reason" error={shown.reason}>
              <input className="input wjob-text" placeholder={t.wjob.whatPlaceholder} value={f.reason} onChange={(e) => set({ reason: e.target.value })} />
            </Field>
            <Photos photos={photos} onChange={setPhotos} error={shown.photos} />
          </div>
        )}
        {step === 3 && (
          <WorksStep book={wb} lines={f.lines} update={(fn) => setF((x) => ({ ...x, lines: fn(x.lines) }))} error={shown.works} />
        )}
        {step === 4 && f.vehicle && (
          <div className="wjob-step">
            <h2 className="wjob-q">{t.wjob.checkQ}</h2>
            <dl className="wjob-kv">
              <dt>{t.repair.vehicle}</dt>
              <dd>
                <b>{f.vehicle.number ?? ''}</b> {f.vehicle.model} <Vin vin={f.vehicle.vin} />
                <span className="muted wjob-sub">{f.jobId ? f.vehicle.openJob?.number : f.vehicle.state === 'rented' ? t.wjob.staysRented : t.wjob.toService}</span>
              </dd>
              <dt>{t.wjob.km}</dt>
              <dd>
                {groupDigits(km ?? 0)}
                {lastKm != null && (
                  <span className="muted">
                    {' '}
                    · {t.wjob.wasKm(groupDigits(lastKm))}
                    {lower && lowerText ? ` — ${lowerText}` : ''}
                  </span>
                )}
              </dd>
              <dt>{t.wjob.reason}</dt>
              <dd>
                {f.reasonKind ? t.wjob.reasons[f.reasonKind] : ''} — {f.reason}
              </dd>
              <dt>{t.repair.photos}</dt>
              <dd>
                <div className="thumbs">
                  {[...(odoPhoto ? [{ p: odoPhoto, tag: t.wjob.photoTags.odometer }] : []), ...photos.map((p) => ({ p, tag: t.wjob.photoTags.before }))].map(({ p, tag }) => (
                    <span key={p.previewUrl} className="thumb wjob-thumb">
                      <img src={p.previewUrl} alt="" />
                      <span className="wjob-tag">{tag}</span>
                    </span>
                  ))}
                </div>
              </dd>
            </dl>
            <WorkLines lines={f.lines.map((l, i) => ({ key: String(i), type: typeOf(l.workTypeId), freeText: l.freeText, qty: l.qty, amount: priced[i]!.normSec == null ? null : Math.round((l.qty * priced[i]!.normSec! * wb.rateTetri) / 3600) }))} />
            <div className="wjob-total">
              <span>{t.wjob.byNorm}</span>
              <span className="mono">
                {t.wjob.min(normText(total.seconds, locale))} · {formatGel(total.tetri)}
              </span>
            </div>
            <p className="hint muted">{approver ? t.wjob.openNote : t.wjob.sendNote}</p>
          </div>
        )}
      </Wizard>
    </div>
  );
}

/** Step 1: the moped, by the VIN's last characters, the sticker's number or its QR. */
function MopedStep({
  q,
  chosen,
  jobId,
  error,
  onQuery,
  onPick,
}: {
  q: string;
  chosen: FoundVehicle | null;
  jobId: string | null;
  error?: string;
  onQuery: (q: string) => void;
  onPick: (v: FoundVehicle, jobId: string | null) => void;
}) {
  const t = useT();
  const [typed, setTyped] = useState(q);
  const [asked, setAsked] = useState(q.trim());
  const [qrError, setQrError] = useState(false);
  const qrInput = useRef<HTMLInputElement>(null);
  // Asked a quarter of a second after the last key, not on every one.
  useEffect(() => {
    const id = window.setTimeout(() => setAsked(typed.trim()), 250);
    return () => window.clearTimeout(id);
  }, [typed]);
  const found = useLoad<{ vehicles: FoundVehicle[] }>(asked ? `/api/service/vehicles?q=${encodeURIComponent(asked)}` : null);
  const list = found.data?.vehicles ?? [];
  // One moped for what was asked — from a sticker, most often — is the one meant.
  useEffect(() => {
    if (!chosen && list.length === 1 && !list[0]!.openJob) onPick(list[0]!, null);
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps

  const readQr = async (files: FileList | null) => {
    const file = files?.[0];
    if (qrInput.current) qrInput.current.value = '';
    if (!file || !QrDetector) return;
    setQrError(false);
    try {
      const codes = await new QrDetector({ formats: ['qr_code'] }).detect(await createImageBitmap(file));
      const text = codes[0]?.rawValue;
      if (!text) return setQrError(true);
      const code = stickerCode(text);
      setTyped(code);
      onQuery(code);
    } catch {
      setQrError(true);
    }
  };

  return (
    <div className="wjob-step">
      <h2 className="wjob-q">{t.wjob.whichMoped}</h2>
      <Field label={t.wjob.searchLabel} name="vehicleId" hint={t.wjob.searchHint} error={error}>
        <input
          className="input wjob-big"
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            onQuery(e.target.value);
          }}
        />
      </Field>
      {QrDetector && (
        <label className="wjob-btn">
          <input ref={qrInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void readQr(e.target.files)} />
          <ScanLine size={24} strokeWidth={1.75} aria-hidden="true" />
          {t.wjob.scanQr}
        </label>
      )}
      {qrError && <p className="field-err">{t.wjob.qrNotRead}</p>}
      {asked && found.data && list.length === 0 && <p className="empty">{t.wjob.nothingFound(asked)}</p>}
      <ul className="wjob-mopeds">
        {list.map((v) => {
          const job = v.openJob;
          const picked = chosen?.id === v.id;
          const pickable = !job || job.takeable;
          return (
            <li key={v.id}>
              <button
                type="button"
                className={`wjob-moped ${picked ? 'on' : ''}`}
                aria-pressed={picked}
                disabled={!pickable}
                onClick={() => onPick(v, job ? job.id : null)}
              >
                <span className="wjob-moped-head">
                  <span>
                    <b className="mono">{v.number ?? ''}</b> {v.model} <ColorText of={v.color} named />
                  </span>
                  <StateBadge state={v.state} />
                </span>
                <Vin vin={v.vin} />
                <span className="muted">{v.odometerKm != null ? t.wjob.lastKm(groupDigits(v.odometerKm)) : t.wjob.noKmYet}</span>
                {job && (
                  <span className="wjob-has">
                    <span>
                      {t.wjob.hasJob(job.number)}
                      {job.mechanic && !job.mine ? ` · ${t.wjob.carriedBy(job.mechanic)}` : ''}
                    </span>
                    {job.takeable && <span className="wjob-link">{picked && jobId ? '✓' : t.wjob.carryOn}</span>}
                  </span>
                )}
              </button>
              {/* His own repair on this moped: he opens it, he does not write it again. */}
              {job?.mine && (
                <Link className="wjob-link wjob-open-own" to={`/service/${job.id}`}>
                  {t.wjob.openOwn(job.number)}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The odometer: one photo, taken with the tablet's camera. */
function OnePhoto({ label, tag, photo, onChange, error }: { label: string; tag: string; photo: PreparedPhoto | null; onChange: (p: PreparedPhoto | null) => void; error?: string }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const take = async (files: FileList | null) => {
    const file = files?.[0];
    if (ref.current) ref.current.value = '';
    if (!file) return;
    try {
      onChange(await preparePhoto(file));
    } catch {
      /* a file the browser cannot read is not a photo; the field still asks for one */
    }
  };
  return (
    <div className={`field ${error ? 'field-bad' : ''}`} data-field="odometerPhoto">
      <span className="lbl">{label}</span>
      <label className={`wjob-pic ${photo ? '' : 'wjob-pic-add'}`}>
        <input ref={ref} type="file" accept="image/*" capture="environment" hidden onChange={(e) => void take(e.target.files)} />
        {photo ? (
          <>
            <img src={photo.previewUrl} alt="" />
            <span className="wjob-tag">{tag}</span>
          </>
        ) : (
          <>
            <Camera size={28} strokeWidth={1.75} aria-hidden="true" />
            {t.wjob.takePhoto}
          </>
        )}
      </label>
      {photo && (
        <button type="button" className="pill pill-sm" onClick={() => ref.current?.click()}>
          {t.wjob.retake}
        </button>
      )}
      {error && <span className="field-err">{error}</span>}
    </div>
  );
}

/**
 * Photos taken with the tablet's camera: of the damage — one at least, four at
 * most — or, at closing, after the repair (stage 3: `label`, `tag`, `max`).
 */
export function Photos({
  photos,
  onChange,
  error,
  label,
  tag,
  max = JOB_PHOTOS_MAX,
}: {
  photos: PreparedPhoto[];
  onChange: Dispatch<SetStateAction<PreparedPhoto[]>>;
  error?: string | null;
  label?: string;
  tag?: string;
  max?: number;
}) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const add = async (files: FileList | null) => {
    const list = [...(files ?? [])].slice(0, max - photos.length);
    if (ref.current) ref.current.value = '';
    const out: PreparedPhoto[] = [];
    for (const file of list) {
      try {
        out.push(await preparePhoto(file));
      } catch {
        /* skipped: not a picture the browser can read */
      }
    }
    // Against the list as it is when they are ready, not as it was when the camera opened:
    // a second photo taken while the first is still being made smaller is not lost.
    onChange((now) => [...now, ...out].slice(0, max));
  };
  return (
    <div className={`field ${error ? 'field-bad' : ''}`} data-field="photos">
      <span className="lbl">{label ?? t.wjob.damagePhotos(photos.length, max)}</span>
      <div className="wjob-pics">
        {photos.map((p, i) => (
          <span key={p.previewUrl} className="wjob-pic">
            <img src={p.previewUrl} alt="" />
            <span className="wjob-tag">{tag ?? t.wjob.photoTags.before}</span>
            <button type="button" className="thumb-x" aria-label={t.photos.remove} onClick={() => onChange(photos.filter((_, j) => j !== i))}>
              ×
            </button>
          </span>
        ))}
        {photos.length < max && (
          <label className="wjob-pic wjob-pic-add">
            <input ref={ref} type="file" accept="image/*" multiple capture="environment" hidden onChange={(e) => void add(e.target.files)} />
            <Camera size={28} strokeWidth={1.75} aria-hidden="true" />
            {t.wjob.takePhoto}
          </label>
        )}
      </div>
      {error && <span className="field-err">{error}</span>}
    </div>
  );
}

/** Step 4: the works, from the book by category or by search, and words for one it lacks. */
export function WorksStep({ book, lines, update, error }: { book: WorkBook; lines: Line[]; update: (fn: (now: Line[]) => Line[]) => void; error?: string }) {
  const t = useT();
  const { locale } = useLocale();
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<string | null>(null);
  const [free, setFree] = useState<string | null>(null);
  const qty = (id: string) => lines.find((l) => l.workTypeId === id)?.qty ?? 0;
  // Against the lines as they are when the tap lands: two quick taps on two works keep both.
  const setQty = (id: string, n: number) =>
    update((now) => {
      if (n <= 0) return now.filter((l) => l.workTypeId !== id);
      return now.some((l) => l.workTypeId === id) ? now.map((l) => (l.workTypeId === id ? { ...l, qty: n } : l)) : [...now, { workTypeId: id, freeText: null, qty: n }];
    });
  const needle = q.trim().toLowerCase();
  const shown = book.works.filter(
    (w) => w.active && (cat == null || w.category === cat) && (!needle || w.code.toLowerCase().includes(needle) || [w.nameKa, w.nameRu, w.nameEn].some((n) => n?.toLowerCase().includes(needle))),
  );
  const freeLines = lines.map((l, i) => ({ l, i })).filter(({ l }) => !l.workTypeId);
  return (
    <div className="wjob-step">
      <input className="input wjob-text" placeholder={t.wjob.searchWorks} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="wjob-cats" role="group">
        <button type="button" className={`wjob-chip wjob-chip-sm ${cat == null ? 'on' : ''}`} aria-pressed={cat == null} onClick={() => setCat(null)}>
          {t.wjob.all}
        </button>
        {book.categories.map((c) => (
          <button key={c.code} type="button" className={`wjob-chip wjob-chip-sm ${cat === c.code ? 'on' : ''}`} aria-pressed={cat === c.code} onClick={() => setCat(c.code)}>
            {nameIn(c, locale)}
          </button>
        ))}
      </div>
      {error && <span className="field-err" data-field="works">{error}</span>}
      {freeLines.map(({ l, i }) => (
        <div key={`free-${i}`} className="wjob-work on">
          <span className="wjob-code">—</span>
          <span className="wjob-name">{l.freeText}</span>
          <span className="wjob-nonorm">{t.wjob.noNorm}</span>
          <button type="button" className="wjob-round" aria-label={t.photos.remove} onClick={() => update((now) => now.filter((_, j) => j !== i))}>
            <Minus size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      ))}
      <ul className="wjob-works">
        {shown.map((w) => (
          <WorkRow key={w.id} w={w} qty={qty(w.id)} onQty={(n) => setQty(w.id, n)} />
        ))}
      </ul>
      {shown.length === 0 && <p className="empty">{t.wjob.nothingInBook}</p>}
      {free == null ? (
        <button type="button" className="wjob-btn" onClick={() => setFree('')}>
          <Plus size={22} strokeWidth={1.75} aria-hidden="true" />
          {t.wjob.addFree}
        </button>
      ) : (
        <div className="wjob-free">
          <input className="input wjob-text" autoFocus placeholder={t.wjob.freePlaceholder} value={free} onChange={(e) => setFree(e.target.value)} />
          <button
            type="button"
            className="pill pill-accent"
            disabled={!free.trim()}
            onClick={() => {
              const text = free.trim();
              update((now) => [...now, { workTypeId: null, freeText: text, qty: 1 }]);
              setFree(null);
            }}
          >
            {t.wjob.addLine}
          </button>
        </div>
      )}
    </div>
  );
}

function WorkRow({ w, qty, onQty }: { w: WorkType; qty: number; onQty: (n: number) => void }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <li className={`wjob-work ${qty > 0 ? 'on' : ''}`}>
      <span className="wjob-code">{w.code}</span>
      <span className="wjob-name">{nameIn(w, locale)}</span>
      <span className="wjob-min mono">{t.wjob.min(normText(w.normSec, locale))}</span>
      {qty > 0 ? (
        <span className="wjob-qty">
          <button type="button" aria-label="−" onClick={() => onQty(qty - 1)}>
            <Minus size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
          <b className="mono">{qty}</b>
          <button type="button" aria-label="+" disabled={qty >= WORK_QTY_MAX} onClick={() => onQty(qty + 1)}>
            <Plus size={22} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </span>
      ) : (
        <button type="button" className="wjob-round" aria-label={t.wjob.addLine} onClick={() => onQty(1)}>
          <Plus size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

/** Lines of work as they will be written: code, name, quantity, minutes, the mechanic's sum. */
export function WorkLines({ lines }: { lines: { key: string; type: Pick<WorkType, 'code' | 'nameKa' | 'nameRu' | 'nameEn' | 'normSec'> | null; freeText: string | null; qty: number; amount?: number | null; normSec?: number | null }[] }) {
  const t = useT();
  const { locale } = useLocale();
  return (
    <ul className="wjob-lines">
      {lines.map((l) => {
        const sec = l.normSec !== undefined ? l.normSec : l.type?.normSec ?? null;
        return (
          <li key={l.key}>
            <span className="wjob-code">{l.type?.code ?? '—'}</span>
            <span className="wjob-name">
              {l.type ? nameIn(l.type, locale) : l.freeText} × {l.qty}
            </span>
            {sec != null ? <span className="mono">{t.wjob.min(normText(sec * l.qty, locale))}</span> : <span className="wjob-nonorm">{t.wjob.noNorm}</span>}
            {l.amount !== undefined && <span className="mono wjob-gel">{l.amount != null ? formatGel(l.amount) : '—'}</span>}
          </li>
        );
      })}
    </ul>
  );
}
