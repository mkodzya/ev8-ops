import type { ActKind, DepositStatus, PeriodPayStatus, RentalStatus } from '@ev8/shared';
import { useState } from 'react';
import { parseGel, type VehicleState } from '@ev8/shared';
import { Field } from '../components/Wizard.js';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Empty, Loading, RentalBadge, Vin } from '../components/ui.js';
import { Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

export interface RentalCard {
  rental: {
    id: string;
    number: string;
    nightParkingAddress?: string | null;
    batteries?: number | null;
    chargers?: number | null;
    odooName: string | null;
    status: RentalStatus;
    storedStatus: RentalStatus;
    customer: { id: string; name: string; phone: string | null };
    vehicle: { id: string; vin: string; model: string } | null;
    vinUnconfirmed: boolean;
    vinNote: string | null;
    weeklyRateTetri: number;
    depositTetri: number;
    pickedUpOn: string | null;
    expectedReturnOn: string | null;
    returnedOn: string | null;
    paidThrough: string | null;
    buyoutTargetTetri: number | null;
    buyoutPerPaymentTetri: number | null;
    notes: string | null;
  };
  deposit: { amountTetri: number; status: DepositStatus; returnedTetri: number; withheldTetri: number; withheldReason: string | null; withheldGrounds: string[]; returnedTo: string | null; returnedOn: string | null; confirmed?: boolean | null } | null;
  periods: { seq: number; startsOn: string; endsOn: string; amountTetri: number; paidTetri: number; payStatus: PeriodPayStatus }[];
  acts: { id: string; kind: ActKind; occurredOn: string; odometerKm: number | null; condition: string | null; photos: { id: string; label: string }[]; pdfUrl: string | null }[];
}

export function RentalPage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<RentalCard>(id ? `/api/rentals/${id}` : null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const r = data.rental;
  const d = data.deposit;
  const open = r.status !== 'returned';
  const decided = d && d.status !== 'held';

  const confirm = async () => {
    try {
      await api.post(`/api/rentals/${r.id}/deposit/confirm`);
      reload();
    } catch (e) {
      setErr(errorText(e));
    }
  };

  return (
    <>
      <header className="page-head page-head-wrap">
        <h1 className="mono">{r.number}</h1>
        <RentalBadge status={r.status} />
        {r.odooName && <span className="muted mono">{r.odooName}</span>}
        <span className="spacer" />
        <a className="pill pill-sm" href={`/api/rentals/${r.id}/contract.pdf`} target="_blank" rel="noreferrer">
          {t.docs.contract}
        </a>
        {!open && can('rental.return') && (
          <a className="pill pill-sm" href={`/api/rentals/${r.id}/return-act.pdf`} target="_blank" rel="noreferrer">
            {t.docs.returnAct}
          </a>
        )}
        {open && can('rental.create') && (
          <button type="button" className="pill pill-sm" onClick={() => setEditing((v) => !v)}>
            {t.rentalEdit.title}
          </button>
        )}
        {open && can('rental.return') && (
          <Link className="pill pill-sm pill-accent" to={`/rentals/${r.id}/return`}>
            {t.actions.returnRental}
          </Link>
        )}
      </header>
      {editing && (
        <RentalEdit
          rental={r}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
          onError={setErr}
        />
      )}
      {err && <div className="hint hint-bad">{err}</div>}
      {can('deposit.decide') && (
        <p className="hint muted">
          {t.docs.note}{' '}
          <a href={`/api/rentals/${r.id}/contract.pdf?fresh=1`} target="_blank" rel="noreferrer">
            {t.docs.regenerate}
          </a>{' '}
          — {t.docs.regenerateHint}
        </p>
      )}

      <div className="two-col">
        <section className="card">
          <Row k={t.rentals.customer} v={<Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link>} />
          <Row
            k={t.rentals.vehicle}
            v={
              r.vehicle ? (
                <Link to={`/fleet/${r.vehicle.id}`}>
                  <Vin vin={r.vehicle.vin} /> <span className="muted">{r.vehicle.model}</span>
                </Link>
              ) : (
                <span className="warn-text">
                  {t.rentals.vinUnconfirmed}
                  {r.vinNote && <span className="muted"> · {r.vinNote}</span>}
                </span>
              )
            }
          />
          <Row k={t.rentals.rate} v={<span className="mono">{formatGel(r.weeklyRateTetri, { decimals: false })}{t.rentals.perWeek}</span>} />
          <Row k={t.rentals.pickedUp} v={<span className="mono">{fmtDate(r.pickedUpOn)}</span>} />
          <Row k={t.pickup.expectedReturnOn} v={<span className="mono">{fmtDate(r.expectedReturnOn)}</span>} />
          <Row k={t.rentals.returned} v={<span className="mono">{fmtDate(r.returnedOn)}</span>} />
          <Row k={t.rentals.paidThrough} v={<span className="mono">{fmtDate(r.paidThrough)}</span>} />
          {r.buyoutTargetTetri && (
            <Row k={t.rental.buyout} v={t.rental.buyoutProgress(formatGel(r.buyoutTargetTetri, { decimals: false }), formatGel(r.buyoutPerPaymentTetri ?? 0, { decimals: false }))} />
          )}
          {r.nightParkingAddress && <Row k={t.handover.nightParking} v={r.nightParkingAddress} />}
          {(r.batteries != null || r.chargers != null) && (
            <Row
              k={`${t.handover.batteries} / ${t.handover.chargers}`}
              v={<span className="mono">{r.batteries ?? 0} / {r.chargers ?? 0}</span>}
            />
          )}
          {r.notes && <Row k={t.rental.notes} v={<span className="pre">{r.notes}</span>} />}
        </section>

        <section className="card">
          <h2>{t.rentals.deposit}</h2>
          {d ? (
            <>
              <Row k={t.rental.amount} v={<span className="mono">{formatGel(d.amountTetri, { decimals: false })}</span>} />
              <Row k={t.fleet.state} v={t.rental.depositStatus[d.status]} />
              {decided && (
                <>
                  {d.returnedTetri > 0 && <Row k={t.rentals.returned} v={<span className="mono">{formatGel(d.returnedTetri, { decimals: false })} · {fmtDate(d.returnedOn)}</span>} />}
                  {d.withheldTetri > 0 && <Row k={t.rental.withheldReason} v={<span><span className="mono">{formatGel(d.withheldTetri, { decimals: false })}</span> · {d.withheldReason}</span>} />}
                  {d.returnedTo && <Row k={t.rental.returnedTo} v={d.returnedTo} />}
                  {d.confirmed === false && (
                    <div className="row-actions">
                      <span className="warn-text">{t.rental.awaitingOwner}</span>
                      {can('deposit.confirm') && (
                        <button type="button" className="pill pill-sm pill-accent" onClick={confirm}>
                          {t.actions.confirmDeposit}
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          ) : (
            <Empty text={t.common.dash} />
          )}
        </section>
      </div>

      <section className="card">
        <h2>{t.rental.periods}</h2>
        {data.periods.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.rental.week}</th>
                  <th>{t.rental.from}</th>
                  <th>{t.rental.to}</th>
                  <th className="num">{t.rental.amount}</th>
                  <th className="num">{t.rental.paid}</th>
                  <th>{t.fleet.state}</th>
                </tr>
              </thead>
              <tbody>
                {data.periods.map((p) => (
                  <tr key={p.seq}>
                    <td className="mono">{p.seq}</td>
                    <td className="mono">{fmtDate(p.startsOn)}</td>
                    <td className="mono">{fmtDate(p.endsOn)}</td>
                    <td className="num mono">{formatGel(p.amountTetri, { decimals: false })}</td>
                    <td className="num mono">{formatGel(p.paidTetri, { decimals: false })}</td>
                    <td className={p.payStatus === 'paid' ? 'state-available' : p.payStatus === 'partial' ? 'warn-text' : 'crit-text'}>{t.rental.payStatus[p.payStatus]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t.rental.acts}</h2>
        {data.acts.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <ul className="timeline">
            {data.acts.map((a) => (
              <li key={a.id}>
                <span className="mono muted">{fmtDate(a.occurredOn)}</span>
                <span>
                  {t.rental.actKind[a.kind]}
                  {a.odometerKm != null && <span className="muted"> · {a.odometerKm} km</span>}
                  {a.condition && <span className="muted"> · {a.condition}</span>}
                  {a.photos.length > 0 && (
                    <span className="thumbs">
                      {a.photos.map((p) => (
                        <a key={p.id} className="thumb" href={`/api/files/${p.id}`} target="_blank" rel="noreferrer">
                          <img src={`/api/files/${p.id}`} alt="" loading="lazy" />
                        </a>
                      ))}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}


interface FreeVehicles {
  vehicles: { id: string; vin: string; model: string; state: VehicleState }[];
}

/**
 * The edits the rental requirements ask for after a hand-over: giving a
 * rental its moped once the VIN is confirmed (RNT-06), pausing or disputing
 * it with a reason (RNT-06), and the buy-out terms (RNT-07).
 */
function RentalEdit({
  rental,
  onClose,
  onSaved,
  onError,
}: {
  rental: RentalCard['rental'];
  onClose: () => void;
  onSaved: () => void;
  onError: (e: string) => void;
}) {
  const t = useT();
  const fleet = useLoad<FreeVehicles>(rental.vinUnconfirmed ? '/api/fleet' : null);
  const [vehicleId, setVehicleId] = useState('');
  const [status, setStatus] = useState(rental.storedStatus === 'returned' ? 'active' : rental.storedStatus);
  const [reason, setReason] = useState('');
  const [target, setTarget] = useState(rental.buyoutTargetTetri ? String(rental.buyoutTargetTetri / 100) : '');
  const [per, setPer] = useState(rental.buyoutPerPaymentTetri ? String(rental.buyoutPerPaymentTetri / 100) : '');
  const [notes, setNotes] = useState(rental.notes ?? '');
  const [busy, setBusy] = useState(false);

  const free = (fleet.data?.vehicles ?? []).filter((v) => v.state === 'available');
  const statusChanged = status !== rental.storedStatus;
  const needsReason = statusChanged && status !== 'active';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body: Record<string, unknown> = { notes: notes || null };
      if (vehicleId) body.vehicleId = vehicleId;
      if (statusChanged) body.status = status;
      if (reason) body.reason = reason;
      body.buyoutTargetTetri = target ? parseGel(target) : null;
      body.buyoutPerPaymentTetri = per ? parseGel(per) : null;
      await api.patch(`/api/rentals/${rental.id}`, body);
      onSaved();
    } catch (e) {
      onError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card card-drawer form" onSubmit={save}>
      {rental.vinUnconfirmed && (
        <Field label={t.rentalEdit.assignVehicle} hint={t.rentalEdit.assignHint}>
          <select className="input" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
            <option value="">{t.common.dash}</option>
            {free.map((v) => (
              <option key={v.id} value={v.id}>
                {v.vin} · {v.model}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t.rentalEdit.status}>
        <div className="chips">
          {(['active', 'paused', 'disputed'] as const).map((st) => (
            <button key={st} type="button" className={`pill pill-sm ${status === st ? 'on' : ''}`} onClick={() => setStatus(st)}>
              {t.rentalStatus[st]}
            </button>
          ))}
        </div>
      </Field>
      {needsReason && (
        <Field label={t.rentalEdit.reason} hint={t.rentalEdit.reasonHint}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      )}
      <span className="lbl">{t.rentalEdit.buyout}</span>
      <div className="two-col">
        <Field label={t.rentalEdit.buyoutTarget}>
          <input className="input input-amount mono" value={target} onChange={(e) => setTarget(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label={t.rentalEdit.buyoutPerPayment}>
          <input className="input input-amount mono" value={per} onChange={(e) => setPer(e.target.value)} inputMode="decimal" />
        </Field>
      </div>
      <Field label={t.rentalEdit.notes}>
        <textarea className="input textarea" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div className="row-actions">
        <button type="button" className="pill" onClick={onClose}>
          {t.actions.cancel}
        </button>
        <button className="pill pill-accent" disabled={busy || (needsReason && !reason.trim())}>
          {busy ? t.common.checking : t.actions.save}
        </button>
      </div>
    </form>
  );
}
