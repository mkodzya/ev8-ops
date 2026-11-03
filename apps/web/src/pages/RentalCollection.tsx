import { COLLECTION_GPS, COLLECTION_OUTCOMES, formatGel, todayISO, type CollectionGps, type CollectionOutcome, type CollectionStep } from '@ev8/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { BlockHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { FormSheet } from '../ds/form/Form.js';
import { fmtDayMonth } from '../format.js';
import { useT } from '../i18n/index.js';
import { useSession } from '../session.js';

/** What GET /api/rentals/:id says under «Взыскание» (ADR-0054); null — nothing to say. */
export interface RentalCollectionCard {
  state: { step: CollectionStep; stage: number | null; until?: string; blockedOn?: string } | null;
  lateDays: number | null;
  debtTetri: number;
  events: { kind: string; day: string | null; outcome: string | null; promisedOn: string | null; gps: string | null; place: string | null; note: string | null; by: string | null; at: string }[];
  tracker: { imeiTail: string; sim: boolean } | null;
}

type Sheet = 'call' | 'block' | 'unblock' | null;

/**
 * «Взыскание» on a rental's card (the director's scenario of 03.11.2026,
 * ADR-0054): the step after the reminders, the moped's tracker to look it up
 * by, what was written, and — for whoever calls by the schedule — the call,
 * the block and the block taken off. EV8 Ops sees neither the GPS nor the
 * block: the person does both in the tracker's app and marks it here.
 */
export function RentalCollection({ rentalId, card, onChanged }: { rentalId: string; card: RentalCollectionCard; onChanged: () => void }) {
  const t = useT();
  const c = t.coll;
  const { can } = useSession();
  const [sheet, setSheet] = useState<Sheet>(null);
  const ref = useRef<HTMLElement>(null);
  // «Сегодня» opens the card on this block.
  useEffect(() => {
    if (window.location.hash === '#collection') ref.current?.scrollIntoView({ block: 'start' });
  }, []);
  const may = can('payments.schedule');
  const step = card.state?.step ?? null;
  const stepWords =
    step === 'call'
      ? c.card.step.call
      : step === 'waiting'
        ? c.card.step.waiting(fmtDayMonth(card.state?.until ?? null))
        : step === 'block'
          ? c.card.step.block
          : step === 'pickup'
            ? c.card.step.pickup(fmtDayMonth(card.state?.blockedOn ?? null))
            : step === 'unblock'
              ? c.card.step.unblock(fmtDayMonth(card.state?.blockedOn ?? null))
              : c.card.none;
  const loud = step === 'block' || step === 'pickup' || step === 'unblock';

  const eventWords = (e: RentalCollectionCard['events'][number]): string => {
    if (e.kind === 'blocked') return [c.event.blocked, e.place].filter(Boolean).join(' · ');
    if (e.kind === 'unblocked') return c.event.unblocked;
    // «Звонок: не дозвонился» — the form's words, mid-sentence (Georgian has no capitals).
    const o = c.outcome[e.outcome ?? ''] ?? '';
    const bits = [c.event.call(o.charAt(0).toLowerCase() + o.slice(1))];
    if (e.promisedOn) bits.push(c.event.promised(fmtDayMonth(e.promisedOn)));
    if (e.gps) bits.push(c.event.gps(c.gps[e.gps] ?? e.gps));
    return bits.join(' · ');
  };

  return (
    <section className="card" id="collection" ref={ref}>
      <BlockHead title={c.title} />
      {card.state && card.lateDays != null && card.debtTetri > 0 && <p className="crit-text">{c.card.late(card.lateDays, formatGel(card.debtTetri, { decimals: false }))}</p>}
      <p className={loud ? 'warn-text' : 'hint'}>{stepWords}</p>
      <p className="hint muted">{card.tracker ? c.card.tracker(card.tracker.imeiTail) : c.card.noTracker}</p>
      {may && step && (
        <div className="chips">
          {(step === 'call' || step === 'waiting' || step === 'block') && (
            <button type="button" className={`pill pill-sm ${step === 'call' ? 'pill-accent' : ''}`} onClick={() => setSheet('call')}>
              {c.card.call}
            </button>
          )}
          {(step === 'call' || step === 'waiting' || step === 'block') && (
            <button type="button" className={`pill pill-sm ${step === 'block' ? 'pill-accent' : ''}`} onClick={() => setSheet('block')}>
              {c.card.block}
            </button>
          )}
          {step === 'pickup' && (
            <Link className="pill pill-sm pill-accent" to={`/rentals/${rentalId}/return`}>
              {c.card.takeBack}
            </Link>
          )}
          {(step === 'pickup' || step === 'unblock') && (
            <button type="button" className={`pill pill-sm ${step === 'unblock' ? 'pill-accent' : ''}`} onClick={() => setSheet('unblock')}>
              {c.card.unblock}
            </button>
          )}
        </div>
      )}
      {card.events.length > 0 && (
        <>
          <p className="lbl">{c.card.written}</p>
          <ul className="timeline">
            {card.events.map((e) => (
              <li key={e.at}>
                <span className="mono muted">{fmtDayMonth(e.day)}</span>
                <span>
                  {eventWords(e)}
                  {e.by && <span className="muted"> · {e.by}</span>}
                  {e.note && <span className="muted"> · {e.note}</span>}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      {sheet === 'call' && <CallSheet rentalId={rentalId} tracker={card.tracker} onClose={() => setSheet(null)} onDone={onChanged} />}
      {sheet === 'block' && <BlockSheet rentalId={rentalId} onClose={() => setSheet(null)} onDone={onChanged} />}
      {sheet === 'unblock' && <UnblockSheet rentalId={rentalId} onClose={() => setSheet(null)} onDone={onChanged} />}
    </section>
  );
}

interface CallForm {
  outcome: CollectionOutcome | null;
  promisedOn: string;
  gps: CollectionGps | null;
  note: string;
}

function CallSheet({ rentalId, tracker, onClose, onDone }: { rentalId: string; tracker: RentalCollectionCard['tracker']; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const c = t.coll;
  const empty: CallForm = { outcome: null, promisedOn: '', gps: null, note: '' };
  const [f, setF] = useState<CallForm>(empty);
  const today = todayISO(new Date(), 'Asia/Tbilisi');
  return (
    <FormSheet
      title={c.form.callTitle}
      onClose={onClose}
      value={f}
      initial={empty}
      label={c.form.save}
      submit={async (key) => {
        await api.post(
          `/api/rentals/${rentalId}/collection/call`,
          { outcome: f.outcome, promisedOn: f.outcome === 'promised' ? f.promisedOn : undefined, gps: f.gps ?? undefined, note: f.note.trim() || undefined },
          { key },
        );
        return { toast: { text: c.form.callDone } };
      }}
      onDone={onDone}
    >
      <Field label={c.form.outcome} hint={f.outcome ? c.outcomeHint[f.outcome] : undefined} name="outcome">
        <div className="chips-pick" role="radiogroup" aria-label={c.form.outcome}>
          {COLLECTION_OUTCOMES.map((o) => (
            <button key={o} type="button" role="radio" aria-checked={f.outcome === o} className="seg seg-sm" onClick={() => setF({ ...f, outcome: o })}>
              {c.outcome[o]}
            </button>
          ))}
        </div>
      </Field>
      {f.outcome === 'promised' && (
        <Field label={c.form.promisedOn} name="promisedOn">
          <input className="input" type="date" min={today} value={f.promisedOn} onChange={(e) => setF({ ...f, promisedOn: e.target.value })} />
        </Field>
      )}
      <Field label={c.form.gps} hint={tracker ? `${c.card.tracker(tracker.imeiTail)} · ${c.form.gpsHint}` : c.card.noTracker} name="gps">
        <div className="chips-pick" role="radiogroup" aria-label={c.form.gps}>
          {COLLECTION_GPS.map((g) => (
            <button key={g} type="button" role="radio" aria-checked={f.gps === g} className="seg seg-sm" onClick={() => setF({ ...f, gps: f.gps === g ? null : g })}>
              {c.gps[g]}
            </button>
          ))}
        </div>
      </Field>
      <Field label={c.form.note} name="note">
        <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

function BlockSheet({ rentalId, onClose, onDone }: { rentalId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const c = t.coll;
  const empty = { place: '', note: '' };
  const [f, setF] = useState(empty);
  return (
    <FormSheet
      title={c.form.blockTitle}
      onClose={onClose}
      value={f}
      initial={empty}
      label={c.form.blockSave}
      submit={async (key) => {
        await api.post(`/api/rentals/${rentalId}/collection/block`, { place: f.place.trim() || undefined, note: f.note.trim() || undefined }, { key });
        return { toast: { text: c.form.blockDone } };
      }}
      onDone={onDone}
    >
      <p className="hint">{c.form.blockHint}</p>
      <Field label={c.form.place} hint={c.form.placeHint} name="place">
        <input className="input" value={f.place} onChange={(e) => setF({ ...f, place: e.target.value })} />
      </Field>
      <Field label={c.form.note} name="note">
        <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

function UnblockSheet({ rentalId, onClose, onDone }: { rentalId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const c = t.coll;
  const [note, setNote] = useState('');
  return (
    <FormSheet
      title={c.form.unblockTitle}
      onClose={onClose}
      value={note}
      initial=""
      label={c.form.unblockSave}
      submit={async (key) => {
        await api.post(`/api/rentals/${rentalId}/collection/unblock`, { note: note.trim() || undefined }, { key });
        return { toast: { text: c.form.unblockDone } };
      }}
      onDone={onDone}
    >
      <p className="hint">{c.form.unblockHint}</p>
      <Field label={c.form.note} name="note">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormSheet>
  );
}
