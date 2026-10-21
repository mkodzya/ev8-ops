import { fleetNumber, imeiGroups, phoneAsOnCard, todayISO, type VehicleState } from '@ev8/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BlockHead } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { FormSheet } from '../ds/form/Form.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { useSession } from '../session.js';
import { TrackerFields } from './RepairParts.js';
import './vehicle-tracker.css';

// The tracker on the moped's card (ADR-0036, addendum 21.10.2026). Its IMEI
// and SIM stand in the card's first block, beside what the moped is, because
// they are what is searched for when it is stolen. An owner writes a tracker
// already on the moped without opening a repair, and corrects a digit typed
// wrong or a SIM changed. A manager reads neither number (§7): the API sends
// no trackers to them, and nothing here is drawn.

/** A tracker as the moped's card has it: the one on it now, or one it had. */
export interface CardTracker {
  id: string;
  imei: string;
  simPhone: string | null;
  installedOn: string;
  removedOn: string | null;
  job: { id: string; number: string } | null;
  removedJob: { id: string; number: string } | null;
  /** `card` — written on the card, with no repair behind it; absent while an older API answers. */
  source?: string | null;
}

/** What of the moped the tracker rows need. */
interface TrackerMoped {
  id: string;
  vin: string;
  fleetNo?: number | null;
  state: VehicleState;
  arrivedOn: string | null;
}

/**
 * The rows of the card's first block. With a tracker: its IMEI in threes,
 * since when and by what, and its SIM as a phone is written on a card. Without
 * one: a single row and the next action — not an empty block on every moped
 * (handoff, wave 4).
 */
export function TrackerRows({ v, trackers, onDone }: { v: TrackerMoped; trackers: CardTracker[]; onDone: () => void }) {
  const t = useT();
  const { can } = useSession();
  const [sheet, setSheet] = useState(false);
  const now = trackers.find((x) => x.removedOn == null) ?? null;
  const gone = v.state === 'sold' || v.state === 'out';
  // Whoever reads the IMEI writes it. A moped that left the fleet gets no new
  // tracker; the numbers of one still on it may be put right.
  const editable = can('service.manage') && (now != null || !gone);
  const action = editable ? (
    <button type="button" className="pill pill-sm" onClick={() => setSheet(true)}>
      {now ? t.wparts.fixTracker : t.wparts.writeTracker}
    </button>
  ) : null;

  return (
    <>
      {now ? (
        <>
          <Row
            k={t.wparts.imeiRow}
            v={
              <>
                <span className="mono">{imeiGroups(now.imei)}</span>
                <div className="hint">
                  {/* Written on the card, the day is one it surely was on — not its fitting day (addendum, item 3). */}
                  {now.source === 'card' ? t.wparts.onBy(fmtDate(now.installedOn)) : t.wparts.onSince(fmtDate(now.installedOn))}
                  {now.job ? (
                    <>
                      {' · '}
                      <Link to={`/service/${now.job.id}`} className="mono">
                        {now.job.number}
                      </Link>
                    </>
                  ) : (
                    now.source === 'card' && <span className="muted">{` · ${t.wparts.byCard}`}</span>
                  )}
                </div>
              </>
            }
          />
          <Row
            k={t.wparts.simRow}
            v={
              <div className="vtrack-line">
                <span className="mono">{now.simPhone ? phoneAsOnCard(now.simPhone) : t.common.dash}</span>
                {action}
              </div>
            }
          />
        </>
      ) : (
        <Row
          k={t.wparts.trackerRow}
          v={
            <div className="vtrack-line">
              <span className="place-unset">{t.wparts.trackerUnset}</span>
              {action}
            </div>
          }
        />
      )}
      {sheet && (
        <TrackerSheet
          v={v}
          now={now}
          onClose={() => setSheet(false)}
          onDone={() => {
            setSheet(false);
            onDone();
          }}
        />
      )}
    </>
  );
}

/** Refusals about the IMEI that come without a field are said under the IMEI. */
const IMEI_REFUSALS = { tracker_imei_in_use: 'imei', tracker_on_vehicle: 'imei' };

/**
 * Writing a tracker already on the moped, or correcting the one on it. The
 * IMEI is checked as it is typed, as in a repair. «Стоит с» is a day the
 * tracker was on the moped — today unless somebody knows: the day it was
 * fitted is often known to nobody, and it is not made up.
 */
function TrackerSheet({ v, now, onClose, onDone }: { v: TrackerMoped; now: CardTracker | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const today = todayISO();
  const writing = now == null;
  const initial = { imei: now?.imei ?? '', sim: now?.simPhone ?? '', on: today };
  const [f, setF] = useState(initial);
  const label = fleetNumber(v.fleetNo) ?? `···${v.vin.slice(-6)}`;
  return (
    <FormSheet
      title={writing ? t.wparts.writeTracker : t.wparts.fixTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      onRestore={setF}
      label={writing ? t.wparts.write : t.actions.save}
      fieldOf={IMEI_REFUSALS}
      submit={async (key) => {
        if (writing) {
          await api.post(`/api/fleet/${v.id}/tracker`, { imei: f.imei, sim: f.sim, installedOn: f.on }, { key });
          return { toast: { text: t.wparts.trackerWritten(f.imei.replace(/\D/g, '').slice(-4)) } };
        }
        const res = await api.patch<{ changed: boolean }>(`/api/fleet/${v.id}/tracker`, { imei: f.imei, sim: f.sim }, { key });
        return { toast: { text: res.changed ? t.wparts.trackerCorrected : t.wparts.trackerSame } };
      }}
      onDone={onDone}
    >
      <TrackerFields imei={f.imei} sim={f.sim} vehicle={label} onChange={(imei, sim) => setF({ ...f, imei, sim })} />
      {writing ? (
        <Field label={t.wparts.fittedOn} hint={t.wparts.fittedOnHint} name="installedOn">
          <input className="input mono" type="date" min={v.arrivedOn ?? undefined} max={today} value={f.on} onChange={(e) => setF({ ...f, on: e.target.value })} />
        </Field>
      ) : (
        <p className="hint muted">{t.wparts.fixNote}</p>
      )}
    </FormSheet>
  );
}

/**
 * The trackers the moped had: the one on it now is in the card's first
 * block, so this is only history, and a moped that never had another shows
 * nothing.
 */
export function TrackerHistory({ trackers }: { trackers: CardTracker[] }) {
  const t = useT();
  const before = trackers.filter((x) => x.removedOn != null);
  if (before.length === 0) return null;
  return (
    <section className="card">
      <BlockHead title={t.wparts.trackersEarlier} />
      <ul className="timeline">
        {before.map((x) => (
          <li key={x.id}>
            <span className="mono muted">{fmtDate(x.removedOn)}</span>
            <span>
              <span className="mono">{`···${x.imei.slice(-4)}`}</span>
              <span className="muted">{` · ${fmtDate(x.installedOn)}–${fmtDate(x.removedOn)}`}</span>
              {x.removedJob && (
                <>
                  {' · '}
                  <Link to={`/service/${x.removedJob.id}`} className="mono">
                    {x.removedJob.number}
                  </Link>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
