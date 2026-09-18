import type { ActKind, DepositStatus, PeriodPayStatus, RentalStatus } from '@ev8/shared';
import { useState } from 'react';
import { parseGel, todayISO, type VehicleState } from '@ev8/shared';
import { LoadError } from '../components/LoadError.js';
import { Field } from '../components/Wizard.js';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { BlockHead, Empty, Loading, PageHead, RentalBadge, Vin } from '../components/ui.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

/** Paid, part-paid, the week we are in, late, or not yet started. */
function periodTone(p: { startsOn: string; endsOn: string; payStatus: PeriodPayStatus }, today: string): string {
  if (p.payStatus === 'paid') return 'paid';
  if (p.payStatus === 'partial') return 'partial';
  if (p.endsOn < today) return 'late';
  if (p.startsOn <= today) return 'current';
  return 'ahead';
}

export interface RentalCard {
  rental: {
    id: string;
    number: string;
    /** This rental's part of the customer's one debt figure. */
    debtTetri: number;
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
  payments: { id: string; occurredOn: string; channel: 'transfer' | 'acquiring' | 'cash'; grossTetri: number; feeTetri: number }[];
  deposit: { amountTetri: number; paidTetri: number; status: DepositStatus; returnedTetri: number; withheldTetri: number; withheldReason: string | null; withheldGrounds: string[]; returnedTo: string | null; returnedOn: string | null; confirmed?: boolean | null } | null;
  periods: { seq: number; startsOn: string; endsOn: string; amountTetri: number; paidTetri: number; payStatus: PeriodPayStatus }[];
  acts: { id: string; kind: ActKind; occurredOn: string; odometerKm: number | null; condition: string | null; photos: { id: string; label: string }[]; pdfUrl: string | null }[];
}

export function RentalPage() {
  const { id } = useParams();
  const t = useT();
  const openMoney = useMoneyForm();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<RentalCard>(id ? `/api/rentals/${id}` : null);
  const [editing, setEditing] = useState(false);
  // Which document is showing in the card, if any (U15). Printing is the last
  // step of every hand-over and every return, and a link that opens a new tab
  // is a step where people find out the PDF was wrong after they printed it.
  // Declared with the other hooks: below the early returns it would be called
  // on some renders and not others, which React counts and then throws on.
  const [preview, setPreview] = useState<'contract' | 'return-act' | null>(null);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const r = data.rental;
  const today = todayISO();
  // Owed is the unpaid part of the weeks, the same arithmetic the list and
  // "Today" use. Nothing here is stored.
  const debtTetri = r.debtTetri;
  const d = data.deposit;
  const open = r.status !== 'returned';
  const decided = d && d.status !== 'held';

  return (
    <>
      <PageHead wrap title={r.number} badge={<RentalBadge status={r.status} />} sub={r.odooName ?? undefined}>
        <button type="button" className={`pill pill-sm ${preview === 'contract' ? 'on' : ''}`} onClick={() => setPreview((p) => (p === 'contract' ? null : 'contract'))}>
          {t.docs.contract}
        </button>
        {!open && can('rental.return') && (
          <button type="button" className={`pill pill-sm ${preview === 'return-act' ? 'on' : ''}`} onClick={() => setPreview((p) => (p === 'return-act' ? null : 'return-act'))}>
            {t.docs.returnAct}
          </button>
        )}
        {open && can('rental.create') && (
          <button type="button" className="pill pill-sm" onClick={() => setEditing(true)}>
            {t.rentalEdit.title}
          </button>
        )}
        {open && can('rental.return') && (
          <Link className="pill pill-sm pill-accent" to={`/rentals/${r.id}/return`}>
            {t.actions.returnRental}
          </Link>
        )}
      </PageHead>
      {editing && (
        <RentalEdit
          rental={r}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {can('deposit.decide') && (
        <p className="hint muted">
          {t.docs.note}{' '}
          <a href={`/api/rentals/${r.id}/contract.pdf?fresh=1`} target="_blank" rel="noreferrer">
            {t.docs.regenerate}
          </a>{' '}
          — {t.docs.regenerateHint}
        </p>
      )}

      {preview && (
        <section className="card doc-card">
          <BlockHead title={preview === 'contract' ? t.docs.contract : t.docs.returnAct}>
            <a className="pill pill-sm" href={`/api/rentals/${r.id}/${preview}.pdf`} target="_blank" rel="noreferrer">
              {t.docs.openTab}
            </a>
            <button type="button" className="pill pill-sm" onClick={() => setPreview(null)}>
              {t.actions.cancel}
            </button>
          </BlockHead>
          {/* The browser's own PDF viewer. It prints, and what it prints is
              the file the customer gets — not a picture of it. */}
          <iframe className="doc-frame" title={preview} src={`/api/rentals/${r.id}/${preview}.pdf`} />
        </section>
      )}

      {/* The answer first: paid through, what is owed, and the weeks as a
          strip you can read without counting rows (U6). The table with the
          amounts is one level down, where a list belongs (ux.md, 5). */}
      <section className="card paid-hero">
        <div className="paid-head">
          <div>
            <p className="t-label">{t.rentals.paidThrough}</p>
            <p className="paid-date">{fmtDate(r.paidThrough)}</p>
          </div>
          {debtTetri > 0 && (
            <div className="paid-debt">
              <p className="t-label">{t.rental.owed}</p>
              <p className="t-money crit-text paid-sum">{formatGel(debtTetri)}</p>
            </div>
          )}
        </div>
        {data.periods.length > 0 && (
          <>
            <ol className="strip">
              {data.periods.map((p) => (
                <li key={p.seq} className={`strip-seg strip-${periodTone(p, today)}`} title={`${fmtDate(p.startsOn)} — ${fmtDate(p.endsOn)}`}>
                  <span className="strip-seq">{p.seq}</span>
                </li>
              ))}
            </ol>
            <p className="t-label strip-ends">
              <span className="mono">{fmtDate(data.periods[0].startsOn)}</span>
              <span className="mono">{fmtDate(data.periods[data.periods.length - 1].endsOn)}</span>
            </p>
          </>
        )}
      </section>

      {!r.returnedOn && can('rental.return') && (
        <div className="page-actions">
          <Link className="pill pill-accent pill-wide" to={`/rentals/${r.id}/return`}>
            {t.actions.returnRental}
          </Link>
        </div>
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
          <BlockHead title={t.rentals.deposit} />
          {d ? (
            <>
              <Row k={t.rental.amount} v={<span className="mono">{formatGel(d.amountTetri, { decimals: false })}</span>} />
              <Row k={t.rental.paid} v={<span className="mono">{formatGel(d.paidTetri, { decimals: false })}</span>} />
              <Row k={t.fleet.state} v={t.rental.depositStatus[d.status]} />
              {decided && (
                <>
                  {d.returnedTetri > 0 && <Row k={t.rentals.returned} v={<span className="mono">{formatGel(d.returnedTetri, { decimals: false })} · {fmtDate(d.returnedOn)}</span>} />}
                  {d.withheldTetri > 0 && <Row k={t.rental.withheldReason} v={<span><span className="mono">{formatGel(d.withheldTetri, { decimals: false })}</span> · {d.withheldReason}</span>} />}
                  {d.returnedTo && <Row k={t.rental.returnedTo} v={d.returnedTo} />}
                </>
              )}
            </>
          ) : (
            <Empty text={t.common.dash} />
          )}
        </section>
      </div>

      <section className="card">
        <BlockHead title={t.rental.periods} sub={t.rental.periodsCount(data.periods.length)} />
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
        <BlockHead title={t.payments.title} sub={t.payments.count(data.payments.length)} />
        {data.payments.length === 0 ? (
          <Empty text={t.payments.none} />
        ) : (
          <ul className="timeline">
            {data.payments.map((p) => (
              <li key={p.id}>
                <span className="mono muted">{fmtDate(p.occurredOn)}</span>
                <span>
                  <span className="mono">{formatGel(p.grossTetri)}</span> <span className="muted">{t.payments.channels[p.channel]}</span>
                  {p.feeTetri > 0 && (
                    <span className="muted">
                      {' '}
                      · {t.payments.fee} <span className="mono">{formatGel(p.feeTetri)}</span>
                    </span>
                  )}{' '}
                  {can('payments.view') && (
                    <Link className="pill pill-sm" to={`/money/payments/${p.id}`}>
                      {t.sort.open}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/* One money form for everything (wave 2 §3.1); a returned rental with a debt still takes money. */}
        <div className="row-actions">
          {can('cash.record') && (
            <button type="button" className="pill pill-sm pill-accent" onClick={() => openMoney({ target: { kind: 'rent', rentalId: r.id, number: r.number, customerId: r.customer.id, customer: r.customer.name } })}>
              {can('payments.reconcile') ? t.money.take : t.money.takeCash}
            </button>
          )}
          {can('payments.reconcile') && d && d.returnedTetri > 0 && (
            <button type="button" className="pill pill-sm" onClick={() => openMoney({ target: { kind: 'deposit_payout', rentalId: r.id, number: r.number, customerId: r.customer.id, customer: r.customer.name } })}>
              {t.deposits.handBack}
            </button>
          )}
        </div>
      </section>

      <section className="card">
        <BlockHead title={t.rental.acts} sub={t.rental.actsCount(data.acts.length)} />
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
}: {
  rental: RentalCard['rental'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const fleet = useLoad<FreeVehicles>(rental.vinUnconfirmed ? '/api/fleet' : null);
  const initial = {
    vehicleId: '',
    status: rental.storedStatus === 'returned' ? 'active' : rental.storedStatus,
    reason: '',
    target: rental.buyoutTargetTetri ? String(rental.buyoutTargetTetri / 100) : '',
    per: rental.buyoutPerPaymentTetri ? String(rental.buyoutPerPaymentTetri / 100) : '',
    notes: rental.notes ?? '',
  };
  const [f, setF] = useState(initial);

  const free = (fleet.data?.vehicles ?? []).filter((v) => v.state === 'available');
  const statusChanged = f.status !== rental.storedStatus;
  const needsReason = statusChanged && f.status !== 'active';

  return (
    <FormSheet
      title={t.rentalEdit.title}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={`rental-edit:${rental.id}`}
      onRestore={setF}
      label={t.actions.save}
      submit={async (key) => {
        const body: Record<string, unknown> = { notes: f.notes || null };
        if (f.vehicleId) body.vehicleId = f.vehicleId;
        if (statusChanged) body.status = f.status;
        if (f.reason) body.reason = f.reason;
        body.buyoutTargetTetri = f.target ? parseGel(f.target) : null;
        body.buyoutPerPaymentTetri = f.per ? parseGel(f.per) : null;
        await api.patch(`/api/rentals/${rental.id}`, body, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onSaved}
    >
        {rental.vinUnconfirmed && (
          <Field label={t.rentalEdit.assignVehicle} hint={t.rentalEdit.assignHint} name="vehicleId">
            <select className="input" value={f.vehicleId} onChange={(e) => setF({ ...f, vehicleId: e.target.value })}>
              <option value="">{t.common.dash}</option>
              {free.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.vin} · {v.model}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={t.rentalEdit.status} name="status">
          <div className="chips">
            {(['active', 'paused', 'disputed'] as const).map((st) => (
              <button key={st} type="button" className={`pill pill-sm ${f.status === st ? 'on' : ''}`} onClick={() => setF({ ...f, status: st })}>
                {t.rentalStatus[st]}
              </button>
            ))}
          </div>
        </Field>
        {needsReason && (
          <Field label={t.rentalEdit.reason} hint={t.rentalEdit.reasonHint} name="reason">
            <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
          </Field>
        )}
        <span className="lbl">{t.rentalEdit.buyout}</span>
        <div className="two-col">
          <Field label={t.rentalEdit.buyoutTarget} name="buyoutTargetTetri">
            <input className="input input-amount mono" value={f.target} onChange={(e) => setF({ ...f, target: e.target.value })} inputMode="decimal" />
          </Field>
          <Field label={t.rentalEdit.buyoutPerPayment} name="buyoutPerPaymentTetri">
            <input className="input input-amount mono" value={f.per} onChange={(e) => setF({ ...f, per: e.target.value })} inputMode="decimal" />
          </Field>
        </div>
        <Field label={t.rentalEdit.notes} name="notes">
          <textarea className="input textarea" rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </Field>
    </FormSheet>
  );
}
