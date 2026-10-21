import { AFTER_PHOTOS_MAX } from '@ev8/shared';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { BlockHead, Loading } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { useToast } from '../ds/feedback/Toast.js';
import { FailureProvider, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useT } from '../i18n/index.js';
import { toBase64, type PreparedPhoto } from '../lib/photos.js';
import { useLoad } from '../lib/use.js';
import { groupDigits } from '../lib/workBook.js';
import { NormTotal, StatedLines, useWhen } from './RepairApproval.js';
import { PartLines } from './RepairParts.js';
import type { ServiceJob } from './ServicePage.js';
import { Photos } from './WorkshopJobWizard.js';
import './workshop-job.css';
import { DowntimeText } from '../components/Downtime.js';

interface Point {
  id: string;
  name: string;
  kind: string;
}

type Lower = '' | 'replaced' | 'mistake' | 'other';

/**
 * The reading a closing does not go below without its reason: the opening's or
 * the moped's last, whichever is higher (ADR-0038 §4). The server stays the
 * judge; this only asks on the screen before it is asked.
 */
export function lastKmOf(job: ServiceJob, refusedAt: number | null = null): number | null {
  // The moped's own reading came with stage 6; the shared type does not name it yet.
  const moped = (job.vehicle as { odometerKm?: number | null }).odometerKm ?? null;
  const known = [job.openedOdometerKm, moped, refusedAt].filter((k): k is number => k != null);
  return known.length > 0 ? Math.max(...known) : null;
}

/**
 * The last reading the server named when it refused a lower one — read since
 * the screen was loaded, maybe — or null for any other refusal. The screen
 * then asks against that reading: for as long as the typed one is below it,
 * not for as long as the refusal stands.
 */
export function refusedLastKm(e: unknown): number | null {
  return e instanceof ApiError && e.code === 'odometer_below' && typeof e.extra.lastKm === 'number' ? e.extra.lastKm : null;
}

/**
 * The mechanic closes his repair (stage 3; prototype mechanic-approval-options.html,
 * closing variant A — one screen): photos after the repair, the odometer, where
 * the moped is left, and a last look at the works. The photos travel with the
 * closing in one write, so a repair is never closed without them.
 */
export function RepairClosePage() {
  const { id } = useParams();
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  const when = useWhen();
  const { data, failure, reload } = useLoad<{ job: ServiceJob }>(id ? `/api/service/${id}` : null);
  const moved = data?.job.movedVehicle ?? false;
  const points = useLoad<{ locations: Point[] }>(moved ? '/api/service/locations' : null);
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [km, setKm] = useState('');
  const [lower, setLower] = useState<Lower>('');
  const [lowerWords, setLowerWords] = useState('');
  const [where, setWhere] = useState<string | null>(null);
  const [shown, setShown] = useState<Record<string, string>>({});
  const [refusedKm, setRefusedKm] = useState<number | null>(null);
  const op = useOperation();

  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const j = data.job;
  // Only a repair in work closes; anything else is read on its card.
  if (j.status !== 'open') return <Navigate to={`/service/${j.id}`} replace />;

  const had = j.photos.filter((p) => p.tag === 'after');
  const list = points.data?.locations ?? [];
  // The workshop is where a repaired moped mostly stands: chosen already when it is the only one (principle 13).
  const workshops = list.filter((p) => p.kind === 'workshop');
  const chosen = where ?? (workshops.length === 1 ? workshops[0]!.id : null);
  const kmValue = km.trim() === '' ? null : Number(km.replace(/\s/g, ''));
  const moped = j.vehicle.number ?? j.vehicle.model;
  // Asked as the opening asks it, against the higher of what the screen knew and what a refusal named.
  const lastKm = lastKmOf(j, refusedKm);
  const below = kmValue != null && lastKm != null && kmValue < lastKm;
  const lowerText = lower === 'other' ? lowerWords.trim() : lower ? t.wjob.lowerReasons[lower] : '';

  const close = async () => {
    const p: Record<string, string> = {};
    if (had.length + photos.length === 0) p.photos = t.wappr.needAfter;
    // «Плановое ТО» with no reading of its opening counts from this one (ADR-0038 §2), as the server asks.
    const needKm = moved || (j.reasonKind === 'planned' && j.openedOdometerKm == null);
    if (needKm && (kmValue == null || !Number.isInteger(kmValue) || kmValue < 0)) p.km = t.wappr.needKm;
    if (moved && !chosen) p.where = t.wappr.needWhere;
    if (below && !lowerText) p.lower = t.wjob.needWhy;
    setShown(p);
    if (Object.keys(p).length > 0) return;
    const res = await op.run(async (key) =>
      api
        .post(
          `/api/service/${j.id}/close`,
          {
            odometerKm: kmValue,
            odometerReason: below ? lowerText : null,
            locationId: moved ? chosen : null,
            photos: await Promise.all(photos.map(async (ph) => ({ mimeType: ph.mimeType, dataBase64: await toBase64(ph.blob) }))),
          },
          { key },
        )
        .catch((e: unknown) => {
          const named = refusedLastKm(e);
          if (named != null) setRefusedKm(named);
          throw e;
        }),
    );
    if (!res.ok) return;
    toast({ text: t.wappr.closed(j.number, moved ? moped : null) });
    navigate(`/service/${j.id}`, { replace: true });
  };

  const refused = op.failure?.field === 'photos' ? op.failure.fieldText : null;
  return (
    <div className="wjob">
      <div className="wizard">
        <header className="wizard-head">
          <h1>{t.wappr.closeTitle(j.number)}</h1>
          <span className="muted">
            {j.vehicle.number ? `${j.vehicle.number} · ` : ''}
            {j.vehicle.model}
          </span>
        </header>
        <FailureProvider value={op.failure}>
          <section className="wizard-body">
            <div className="wjob-step">
              {had.length > 0 && (
                <div className="thumbs">
                  {had.map((ph) => (
                    <a key={ph.id} className="thumb wjob-thumb" href={`/api/files/${ph.id}`} target="_blank" rel="noreferrer">
                      <img src={`/api/files/${ph.id}`} alt="" loading="lazy" />
                      <span className="wjob-tag">{t.wjob.photoTags.after}</span>
                    </a>
                  ))}
                </div>
              )}
              {had.length < AFTER_PHOTOS_MAX && (
                <Photos
                  photos={photos}
                  onChange={setPhotos}
                  error={shown.photos ?? refused}
                  label={`${t.wappr.afterPhotos(had.length + photos.length, AFTER_PHOTOS_MAX)}`}
                  tag={t.wjob.photoTags.after}
                  max={AFTER_PHOTOS_MAX - had.length}
                />
              )}
              <div className="wjob-odo">
                <Field label={t.wappr.closeKm} name="odometerKm" error={shown.km} hint={j.openedOdometerKm != null ? t.wappr.closeKmHint(groupDigits(j.openedOdometerKm)) : undefined}>
                  <input className="input wjob-big" inputMode="numeric" value={km} onChange={(e) => setKm(e.target.value.replace(/[^\d\s]/g, ''))} />
                </Field>
              </div>
              {below && (
                <div className="wjob-lower" data-field="odometerReason">
                  {lastKm != null && <p>{t.wjob.lowerKm(groupDigits(lastKm))}</p>}
                  <div className="wjob-chips">
                    {(['replaced', 'mistake', 'other'] as const).map((k) => (
                      <button key={k} type="button" className={`wjob-chip wjob-chip-sm ${lower === k ? 'on' : ''}`} aria-pressed={lower === k} onClick={() => setLower(k)}>
                        {t.wjob.lowerReasons[k]}
                      </button>
                    ))}
                  </div>
                  {lower === 'other' && (
                    <Field label={t.wjob.lowerWords}>
                      <input className="input" value={lowerWords} onChange={(e) => setLowerWords(e.target.value)} />
                    </Field>
                  )}
                  {(shown.lower ?? (op.failure?.field === 'odometerReason' ? op.failure.fieldText : null)) && (
                    <span className="field-err">{shown.lower ?? op.failure?.fieldText}</span>
                  )}
                </div>
              )}
              {moved && (
                <div className={`field ${shown.where ? 'field-bad' : ''}`} data-field="locationId">
                  <span className="lbl">{t.wappr.where}</span>
                  <div className="wjob-chips">
                    {list.map((pt) => (
                      <button key={pt.id} type="button" className={`wjob-chip ${chosen === pt.id ? 'on' : ''}`} aria-pressed={chosen === pt.id} onClick={() => setWhere(pt.id)}>
                        {pt.name}
                      </button>
                    ))}
                  </div>
                  {shown.where && <span className="field-err">{shown.where}</span>}
                </div>
              )}
              {j.works.length > 0 && (
                <section className="card">
                  <StatedLines job={j} lines={j.works} />
                  <NormTotal lines={j.works} />
                  {j.openedAt && <p className="hint muted">{t.wappr.timeline(when(j.openedAt), j.approved ? when(j.approved.at) : null)}</p>}
                  {/* The spec's «Итог: … простой» (ADR-0038): downtime at this minute. */}
                  {j.downtime && (
                    <p className="hint">
                      <DowntimeText d={j.downtime} />
                    </p>
                  )}
                </section>
              )}
              {/* The parts as a last look, not a form (stage 4, variant A): forgotten ones show here. */}
              <section className="card">
                <BlockHead title={t.wparts.block} sub={t.wparts.closeCheck} />
                {j.parts.length + j.batteries.length + j.trackers.removed.length > 0 && <PartLines job={j} />}
                <p className="hint muted">{t.wparts.closeForgot}</p>
              </section>
            </div>
          </section>
        </FailureProvider>
        {op.failure && !op.failure.field && (
          <div className="form-banner form-banner-bad" role="alert">
            <div>
              <b>{t.form.notSaved}</b> {op.failure.text}
            </div>
          </div>
        )}
        <footer className="wizard-foot">
          <span className="wizard-foot-note">
            {moved ? (
              <span>
                {t.wappr.backToFleet(moped)} <b>{t.wappr.available}</b>
              </span>
            ) : (
              <span>{t.wappr.staysRented}</span>
            )}
          </span>
          <Link className="pill" to={`/service/${j.id}`}>
            {t.actions.back}
          </Link>
          <SubmitButton type="button" className="pill-grow" state={op.state} label={t.wappr.closeCta} onClick={() => void close()} />
        </footer>
      </div>
    </div>
  );
}
