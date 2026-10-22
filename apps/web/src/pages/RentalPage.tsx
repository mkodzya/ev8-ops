import type { ActKind, DepositStatus, PeriodPayStatus, RentalStatus, WeekDue } from '@ev8/shared';
import { useState } from 'react';
import { MAX_SHIFT_DAYS, isoWeekday, parseGel, shiftDaysOffered, todayISO, waOffered, weekDue, weekShiftPlan, type VehicleState } from '@ev8/shared';
import { DocumentRow, signedAtText, type DocState } from '../components/Documents.js';
import { KommoField } from '../components/Kommo.js';
import { RecordHistory } from '../components/RecordHistory.js';
import { LoadError } from '../components/LoadError.js';
import { DecideSheet } from '../components/ReturnMoney.js';
import { RowMenu } from '../components/RowMenu.js';
import { WhatsappSheet } from '../components/Whatsapp.js';
import { Field } from '../components/Wizard.js';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { BlockHead, Empty, FleetNo, Loading, PageHead, RentalBadge, Vin } from '../components/ui.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { Row } from '../components/Wizard.js';
import { fmtDate, fmtDayMonth, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

/**
 * The colour of a week in the strip, by the due-day rule (ADR-0017): paid;
 * late — red from the day after its first day, part-paid or not; the week
 * awaited today — lime, orange once something is in; ahead and a week at
 * nothing — grey. It used to turn red only after the week's LAST day.
 */
function periodTone(kind: WeekDue, paidTetri: number): string {
  if (kind === 'paid') return 'paid';
  if (kind === 'late') return 'late';
  if (kind === 'due_today') return paidTetri > 0 ? 'partial' : 'current';
  if (kind === 'ahead') return paidTetri > 0 ? 'partial' : 'ahead';
  return 'ahead';
}

/**
 * How a rental's payment came: the money form's three, `deposit` — kept out of
 * the deposit at the return — and `offset`, rent closed by a mechanic's work
 * at his payout (0066).
 */
type Channel = 'transfer' | 'acquiring' | 'cash' | 'deposit' | 'offset';

export interface RentalCard {
  rental: {
    id: string;
    number: string;
    /** This rental's part of the customer's one debt figure. */
    debtTetri: number;
    /** Of debtTetri: awaited today and not late — nought unless the rental is due today (ADR-0017). */
    dueTodayTetri: number;
    nightParkingAddress?: string | null;
    kommoRef?: string | null;
    batteries?: number | null;
    chargers?: number | null;
    odooName: string | null;
    status: RentalStatus;
    storedStatus: RentalStatus;
    customer: { id: string; name: string; phone: string | null };
    vehicle: { id: string; vin: string; fleetNo?: number | null; model: string } | null;
    vinUnconfirmed: boolean;
    vinNote: string | null;
    weeklyRateTetri: number;
    depositTetri: number;
    pickedUpOn: string | null;
    expectedReturnOn: string | null;
    returnedOn: string | null;
    paidThrough: string | null;
    /** The weekday the rent is due on, ISO 1–7; null — the pickup's weekday (ADR-0022). */
    payWeekday: number | null;
    payOffsetDays: number;
    /** The days its weeks were made longer, and the day they run from now (ADR-0041); absent while an older API answers. */
    weekShiftDays?: number;
    weeksFromOn?: string | null;
    /** The day the next rent is due, for a running rental. */
    dueOn: string | null;
    buyoutTargetTetri: number | null;
    buyoutPerPaymentTetri: number | null;
    notes: string | null;
    transferredAt?: string | null;
    debtOverrideReason?: string | null;
    /** Until when an owner may take the return back (B5-08); null — not any more. */
    undoReturnUntil?: string | null;
    /** The renter's folder, contract and return act in Drive, as last read (ADR-0031). */
    drive?: { folderUrl: string | null; contractUrl: string | null; returnActUrl: string | null } | null;
    /** The mopeds it had, in order; the last is the one it has (ADR-0040). Absent while an older API answers. */
    mopeds?: { vehicle: { id: string; vin: string | null; fleetNo: number | null }; from: string; to: string | null; began: 'pickup' | 'swap_in'; ended: 'return' | 'swap_out' | null }[];
  };
  /** What a return charged beyond the weeks: a key, days of delay (wave 3 §3.4). */
  charges: { id: string; kind: string; amountTetri: number; note: string | null; paidTetri: number }[];
  /** One timeline of the rental: money, acts, documents, the journal (ux №7). */
  feed: { at: string; kind: 'payment' | 'act' | 'document' | 'log'; by: string | null; text: string; amountTetri: number | null; note: string | null }[];
  documents: { contract: DocState; returnAct: DocState | null };
  payments: { id: string; occurredOn: string; channel: Channel; grossTetri: number; feeTetri: number }[];
  deposit: { amountTetri: number; paidTetri: number; status: DepositStatus; returnedTetri: number; withheldTetri: number; withheldReason: string | null; withheldGrounds: string[]; returnedTo: string | null; returnedOn: string | null; decided: boolean; paidOutTetri: number; withholdings: { source: string; amountTetri: number; number: string; reason: string }[] } | null;
  periods: {
    seq: number;
    startsOn: string;
    endsOn: string;
    amountTetri: number;
    paidTetri: number;
    payStatus: PeriodPayStatus;
    /** Taken off by an owner, with a reason (migration 0040); absent while an older API answers. */
    discountTetri?: number;
    discountReason?: string | null;
    /** Made longer by an owner: the days, what they cost, why (ADR-0041); absent while an older API answers. */
    extraDays?: number;
    extraTetri?: number;
    shiftReason?: string | null;
    paidBeforeTransfer?: boolean;
  }[];
  acts: {
    id: string;
    kind: ActKind;
    /** The moped the act is about (migration 0063): after a swap they are two. */
    vehicle?: { id: string; number: string | null; vin: string } | null;
    occurredOn: string;
    odometerKm: number | null;
    condition: string | null;
    photos: { id: string; label: string }[];
    pdfUrl: string | null;
  }[];
}

export function RentalPage() {
  const { id } = useParams();
  const t = useT();
  const openMoney = useMoneyForm();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<RentalCard>(id ? `/api/rentals/${id}` : null);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState<null | 'edit' | 'status' | 'undo' | 'decide' | 'fine'>(params.get('decide') === '1' ? 'decide' : null);
  const [wa, setWa] = useState(false);
  const [feedFilter, setFeedFilter] = useState<'all' | 'payment' | 'act' | 'document' | 'log'>('all');
  const closeSheet = () => {
    setSheet(null);
    if (params.get('decide')) setParams({}, { replace: true });
  };
  // Which document is showing in the card, if any (U15). Printing is the last
  // step of every hand-over and every return, and a link that opens a new tab
  // is a step where people find out the PDF was wrong after they printed it.
  // Declared with the other hooks: below the early returns it would be called
  // on some renders and not others, which React counts and then throws on.
  const [preview, setPreview] = useState<'contract' | 'return-act' | null>(null);
  const [discounting, setDiscounting] = useState<RentalCard['periods'][number] | null>(null);
  const [shifting, setShifting] = useState<RentalCard['periods'][number] | null>(null);
  const [unfining, setUnfining] = useState<RentalCard['charges'][number] | null>(null);
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const r = data.rental;
  const today = todayISO();
  // What the state asks for first (§3.4): a return that is due beats taking money.
  const dueBack = !!r.expectedReturnOn && r.expectedReturnOn <= today && r.status !== 'returned';
  // Owed is the unpaid part of the weeks, the same arithmetic the list and
  // "Today" use. Nothing here is stored.
  const debtTetri = r.debtTetri;
  // The whole figure is awaited today and nothing in it is late: «К оплате
  // сегодня» in ink. Anything older in it — «Долг» in red, as before (ADR-0017).
  const awaited = debtTetri > 0 && r.dueTodayTetri >= debtTetri;
  // A week by the due-day rule. «Due today» is said only on a rental that IS
  // due today: on one returned, paused or disputed the week that began today
  // is plainly unpaid.
  const weekKind = (p: RentalCard['periods'][number]): WeekDue => {
    const due = weekDue(p, data.periods, today, r.payOffsetDays);
    return due === 'due_today' && r.status !== 'due_today' ? 'late' : due;
  };
  const d = data.deposit;
  const open = r.status !== 'returned';
  const owner = can('deposit.decide');
  const swappable = open && !!r.vehicle && can('rental.create') && can('rental.return');
  // The mopeds it had before the one it has, newest first (ADR-0040).
  const earlier = (r.mopeds ?? []).slice(0, -1).reverse();
  // Its weeks were made longer (ADR-0041): they start on another weekday than the pickup's.
  const moved = (r.weekShiftDays ?? 0) > 0;
  // Only the last week of a running rental is made longer (ADR-0041).
  const running = !r.returnedOn && (r.storedStatus === 'active' || r.storedStatus === 'overdue');
  const lastSeq = data.periods.reduce((n, p) => Math.max(n, p.seq), 0);
  const weekActions = (p: RentalCard['periods'][number]) => [
    ...(!p.paidBeforeTransfer && (p.paidTetri < p.amountTetri || (p.discountTetri ?? 0) > 0) ? [{ key: 'discount', label: t.rental.discount, onPick: () => setDiscounting(p) }] : []),
    // A week at nothing is not made longer; one moved already can always have its move changed or taken back.
    ...(running && p.seq === lastSeq && !p.paidBeforeTransfer && ((p.extraDays ?? 0) > 0 || p.amountTetri - (p.extraTetri ?? 0) > 0)
      ? [{ key: 'shift', label: t.weekShift.action, onPick: () => setShifting(p) }]
      : []),
  ];
  const menu = [
    ...(open && can('rental.create') ? [{ key: 'edit', label: t.rentalMenu.edit, onPick: () => setSheet('edit') }] : []),
    // Another moped in the same rental (ADR-0040): a return and a hand-over in one, so both rights.
    ...(swappable ? [{ key: 'swap', label: t.swap.menu, onPick: () => navigate(`/rentals/${r.id}/swap`) }] : []),
    ...(open && owner ? [{ key: 'status', label: t.rentalMenu.status, onPick: () => setSheet('status') }] : []),
    // A fine — damage, a dirty moped — while the rental runs or after it (ADR-0023).
    ...(owner ? [{ key: 'fine', label: t.rental.fine, onPick: () => setSheet('fine') }] : []),
    ...(!open && owner && r.undoReturnUntil ? [{ key: 'undo', label: t.rentalMenu.undo, onPick: () => setSheet('undo') }] : []),
    ...(!open && owner && d && !d.decided ? [{ key: 'decide', label: t.rentalMenu.decide, onPick: () => setSheet('decide') }] : []),
  ];

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
        {/* No button while there is no ready message for this rental — on the day it was handed over (ADR-0017). */}
        {r.customer.phone && waOffered(r.status, r.pickedUpOn, today) && (
          <button type="button" className="pill pill-sm" onClick={() => setWa(true)}>
            {t.customer.whatsapp}
          </button>
        )}
        {open && can('rental.return') && (
          <Link className={`pill pill-sm ${dueBack ? 'pill-accent' : ''}`} to={`/rentals/${r.id}/return`}>
            {t.actions.returnRental}
          </Link>
        )}
        {debtTetri > 0 && can('cash.record') && (
          <button
            type="button"
            className={`pill pill-sm ${dueBack ? '' : 'pill-accent'}`}
            onClick={() => openMoney({ target: { kind: 'rent', rentalId: r.id, number: r.number, customerId: r.customer.id, customer: r.customer.name } })}
          >
            {open ? t.today.actions.take_money : t.back.takeDebt(formatGel(debtTetri, { decimals: false }))}
          </button>
        )}
        <RowMenu actions={menu} />
      </PageHead>
      {sheet === 'edit' && (
        <RentalEdit
          rental={r}
          owner={owner}
          onClose={closeSheet}
          onSaved={() => {
            closeSheet();
            reload();
          }}
        />
      )}
      {sheet === 'fine' && <FineSheet rentalId={r.id} onClose={closeSheet} onDone={() => { closeSheet(); reload(); }} />}
      {unfining && (
        <UnfineSheet
          rentalId={r.id}
          charge={unfining}
          onClose={() => setUnfining(null)}
          onDone={() => {
            setUnfining(null);
            reload();
          }}
        />
      )}
      {discounting && (
        <DiscountSheet
          rentalId={r.id}
          week={discounting}
          onClose={() => setDiscounting(null)}
          onDone={() => {
            setDiscounting(null);
            reload();
          }}
        />
      )}
      {shifting && (
        <ShiftSheet
          rental={r}
          week={shifting}
          onClose={() => setShifting(null)}
          onDone={() => {
            setShifting(null);
            reload();
          }}
        />
      )}
      {sheet === 'status' && <StatusSheet rental={r} onClose={closeSheet} onDone={() => { closeSheet(); reload(); }} />}
      {sheet === 'undo' && r.undoReturnUntil && <UndoSheet rental={r} until={r.undoReturnUntil} onClose={closeSheet} onDone={() => { closeSheet(); reload(); }} />}
      {sheet === 'decide' && r.returnedOn && (
        <DecideSheet rentalId={r.id} number={r.number} returnedOn={r.returnedOn} paidThrough={r.paidThrough} onClose={closeSheet} onDone={() => { closeSheet(); reload(); }} />
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
            {/* The first line answers this rental's own question (§3.4). On
                the due day that is the sum awaited, in ink; how far it is
                paid goes under it as one phrase. */}
            <p className="t-label">{awaited ? t.hand.dueToday : r.status === 'returned' ? t.rentals.returned : t.rentals.paidThrough}</p>
            <p className="paid-date">
              {awaited ? formatGel(debtTetri, { decimals: false }) : r.status === 'returned' ? fmtDate(r.returnedOn) : fmtDate(r.paidThrough)}
            </p>
            {awaited && r.paidThrough && <p className="muted">{t.back.paidThrough(fmtDate(r.paidThrough))}</p>}
            {awaited && d && d.paidTetri < d.amountTetri && (
              <p className="muted">
                {t.rentals.deposit}: {t.rentalMoney.receivedOf(formatGel(d.paidTetri, { decimals: false }), formatGel(d.amountTetri, { decimals: false }))}
              </p>
            )}
          </div>
          {debtTetri > 0 && !awaited && (
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
                <li key={p.seq} className={`strip-seg strip-${periodTone(weekKind(p), p.paidTetri)}`} title={`${fmtDate(p.startsOn)} — ${fmtDate(p.endsOn)}`}>
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

      {data.charges.length > 0 && (
        <section className="card">
          {data.charges.map((c) => (
            <Row
              key={c.id}
              k={c.kind === 'fine' && c.note ? `${t.rentalMoney.charges.fine} · ${c.note}` : (t.rentalMoney.charges[c.kind] ?? c.kind)}
              v={
                <span>
                  <span className="mono">{formatGel(c.amountTetri, { decimals: false })}</span>
                  {c.paidTetri < c.amountTetri && c.paidTetri > 0 && <span className="muted"> · {t.rentalMoney.rest(formatGel(c.amountTetri - c.paidTetri, { decimals: false }))}</span>}
                  {owner && c.kind === 'fine' && c.paidTetri === 0 && <RowMenu actions={[{ key: 'unfine', label: t.rental.fineVoid, onPick: () => setUnfining(c) }]} />}
                </span>
              }
            />
          ))}
        </section>
      )}

      <section className="card">
        <BlockHead title={t.rentalMenu.documents} />
        <DocumentRow rentalId={r.id} kind="contract" title={t.hand.contract} state={data.documents.contract} customerId={r.customer.id} driveUrl={r.drive?.contractUrl} onChanged={reload} />
        {data.documents.returnAct && (
          <DocumentRow
            rentalId={r.id}
            kind="return-act"
            title={t.back.act}
            sub={d && !d.decided ? t.back.undecided : undefined}
            state={data.documents.returnAct}
            customerId={r.customer.id}
            onChanged={reload}
          />
        )}
      </section>

      <div className="two-col">
        <section className="card">
          <Row k={t.rentals.customer} v={<Link to={`/customers/${r.customer.id}`}>{r.customer.name}</Link>} />
          <Row
            k={t.rentals.vehicle}
            v={
              r.vehicle ? (
                <Link to={`/fleet/${r.vehicle.id}`}>
                  <FleetNo n={r.vehicle.fleetNo} /> <Vin vin={r.vehicle.vin} /> <span className="muted">{r.vehicle.model}</span>
                </Link>
              ) : (
                <span className="warn-text">
                  {t.rentals.vinUnconfirmed}
                  {r.vinNote && <span className="muted"> · {r.vinNote}</span>}
                </span>
              )
            }
          />
          {earlier.length > 0 && (
            <Row
              k={t.swap.earlier}
              v={
                <span>
                  {earlier.map((m, i) => (
                    <span key={`${m.vehicle.id}-${m.from}`}>
                      {i > 0 && <br />}
                      <Link to={`/fleet/${m.vehicle.id}`}>
                        <FleetNo n={m.vehicle.fleetNo} /> {m.vehicle.vin && <Vin vin={m.vehicle.vin} />}
                      </Link>{' '}
                      <span className="muted mono">{t.swap.span(fmtDate(m.from), fmtDate(m.to))}</span>
                    </span>
                  ))}
                </span>
              }
            />
          )}
          <Row k={t.rentals.rate} v={<span className="mono">{formatGel(r.weeklyRateTetri, { decimals: false })}{t.rentals.perWeek}</span>} />
          <Row k={t.rentals.pickedUp} v={<span className="mono">{fmtDate(r.pickedUpOn)}</span>} />
          <Row k={t.pickup.expectedReturnOn} v={<span className="mono">{fmtDate(r.expectedReturnOn)}</span>} />
          <Row k={t.rentals.returned} v={<span className="mono">{fmtDate(r.returnedOn)}</span>} />
          <Row k={t.rentals.paidThrough} v={<span className="mono">{fmtDate(r.paidThrough)}</span>} />
          {r.pickedUpOn && (
            // The weekday a week's rent is due on, and the next such day (ADR-0022).
            <Row
              k={t.payDay.label}
              v={
                <span>
                  {t.payDay.days[(r.payWeekday ?? isoWeekday(r.weeksFromOn ?? r.pickedUpOn)) - 1]}
                  <span className="muted"> · {r.payWeekday ? t.payDay.agreed : moved ? t.payDay.asWeekStart : t.payDay.asPickup}</span>
                  {/* The next pay day only while it is ahead or today: a late rental already says so in red above. */}
                  {r.dueOn && r.dueOn >= today && <span className="muted"> · {t.payDay.next(fmtDate(r.dueOn))}</span>}
                </span>
              }
            />
          )}
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
          {r.drive && (
            // Where the paper of this rental is filed (ADR-0031): Drive opens in a new tab.
            <Row
              k={t.drive.rentalFolder}
              v={
                <span>
                  {[
                    r.drive.contractUrl && { url: r.drive.contractUrl, label: t.drive.contract },
                    r.drive.returnActUrl && { url: r.drive.returnActUrl, label: t.drive.returnAct },
                    r.drive.folderUrl && { url: r.drive.folderUrl, label: t.drive.folder },
                  ]
                    .filter((x): x is { url: string; label: string } => !!x)
                    .map((x, i) => (
                      <span key={x.label}>
                        {i > 0 && ' · '}
                        <a href={x.url} target="_blank" rel="noreferrer">
                          {x.label}
                        </a>
                      </span>
                    ))}
                </span>
              }
            />
          )}
          {/* The front office's deal, one way only until the webhook tariff (B10-03). */}
          <Row k={t.kommo.label} v={<KommoField url={`/api/rentals/${r.id}`} value={r.kommoRef ?? null} onDone={reload} />} />
        </section>

        <section className="card">
          <BlockHead title={t.rentals.deposit} />
          {d ? (
            <>
              {/* Received of what the contract asks, what was kept line by line, handed back, on hand (B5-04, §3.3). */}
              <Row k={t.rental.paid} v={<span className="mono">{t.rentalMoney.receivedOf(formatGel(d.paidTetri, { decimals: false }), formatGel(d.amountTetri, { decimals: false }))}</span>} />
              {d.withholdings.map((w, i) => (
                <Row
                  key={i}
                  k={w.source === 'service' ? t.rentalMoney.keptRepair(w.number) : t.rentalMoney.keptReturn}
                  v={
                    <span>
                      <span className="mono">{formatGel(w.amountTetri, { decimals: false })}</span> <span className="muted">· {w.reason}</span>
                    </span>
                  }
                />
              ))}
              {d.paidOutTetri > 0 && <Row k={t.rentalMoney.paidOut} v={<span className="mono">{formatGel(d.paidOutTetri, { decimals: false })}</span>} />}
              <Row k={t.rentalMoney.onHand} v={<span className="mono">{formatGel(Math.max(0, d.paidTetri - d.withheldTetri - d.paidOutTetri), { decimals: false })}</span>} />
              {d.decided && d.returnedTo && <Row k={t.rental.returnedTo} v={d.returnedTo} />}
              {!open && !d.decided && (
                <div className="row-actions">
                  <span className="warn-text">{t.rentalMoney.undecided}</span>
                  {owner && (
                    <button type="button" className="pill pill-sm pill-accent" onClick={() => setSheet('decide')}>
                      {t.w3.decide}
                    </button>
                  )}
                </div>
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
                  {owner && <th aria-label={t.shell.openActions} />}
                </tr>
              </thead>
              <tbody>
                {data.periods.map((p) => {
                  const actions = weekActions(p);
                  // Why the week costs what it does: the discount's reason, the move's (ADR-0041).
                  const why = [p.discountReason, p.shiftReason].filter(Boolean).join(' · ');
                  return (
                    <tr key={p.seq}>
                      <td className="mono">{p.seq}</td>
                      <td className="mono">{fmtDate(p.startsOn)}</td>
                      <td className="mono">{fmtDate(p.endsOn)}</td>
                      <td className="num mono" title={why || undefined}>
                        {formatGel(p.amountTetri, { decimals: false })}
                        {/* On lines of their own: inline, they stretched a phone's table wider still (ux.md №12).
                            Each phrase holds together and the line breaks between them, after the dot: in a
                            75 px column «+3 дн. · доплата 64 ₾» fell into three lines (QA 21.10.2026). */}
                        {(p.discountTetri ?? 0) > 0 && (
                          <span className="muted cell-note">
                            <span className="nobr">{t.rental.discountShort(formatGel(p.discountTetri ?? 0, { decimals: false }))}</span>
                          </span>
                        )}
                        {(p.extraDays ?? 0) > 0 && (
                          <span className="muted cell-note">
                            <span className="nobr">{t.weekShift.shortDays(p.extraDays ?? 0)}&nbsp;·</span>{' '}
                            <span className="nobr">{t.weekShift.shortExtra(formatGel(p.extraTetri ?? 0, { decimals: false }))}</span>
                          </span>
                        )}
                      </td>
                      <td className="num mono">{formatGel(p.paidTetri, { decimals: false })}</td>
                      <WeekState kind={weekKind(p)} partPaid={p.paidTetri > 0} overdue={r.status === 'overdue'} />
                      {owner && <td>{actions.length > 0 && <RowMenu actions={actions} />}</td>}
                    </tr>
                  );
                })}
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
        <div className="queue-head">
          <h2>{t.customerW4.feed}</h2>
          <div className="chips">
            {/* No "Изменения" chip: the changes are a block of their own
                under this one (§3.8, уточнено 22.09.2026). */}
            {(['all', 'payment', 'act', 'document'] as const).map((f) => (
              <button key={f} type="button" className={`pill pill-sm ${feedFilter === f ? 'on' : ''}`} onClick={() => setFeedFilter(f)}>
                {f === 'act' ? t.rental.acts : t.customerW4.feedFilters[f]}
              </button>
            ))}
          </div>
        </div>
        <ul className="timeline">
          {data.feed
            // The feed says what happened to the rental; who changed it is
            // the block below (crit. 17а).
            .filter((e) => e.kind !== 'log')
            .filter((e) => feedFilter === 'all' || e.kind === feedFilter)
            .slice(0, 60)
            .map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <span className="mono muted">{fmtDate(e.at)}</span>
                <span>
                  {e.kind === 'payment' && (
                    <>
                      <span className="mono">{formatGel(e.amountTetri ?? 0)}</span> <span className="muted">{t.payments.channels[e.text as 'cash'] ?? e.text}</span>
                    </>
                  )}
                  {e.kind === 'act' && <span>{t.rental.actKind[e.text as 'pickup']}</span>}
                  {e.kind === 'document' && <span>{e.text === 'contract' ? t.hand.contract : t.back.act}</span>}
                  {e.kind === 'log' && <span>{t.feedWords[e.text] ?? e.text}</span>}
                  {e.note && <span className="muted"> · {e.note}</span>}
                  {e.by && <span className="muted"> · {e.by}</span>}
                </span>
              </li>
            ))}
        </ul>
      </section>

      <RecordHistory kind="rental" id={r.id} search={r.number} />

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
                  {/* Which moped: after a swap a rental's acts are about two (ADR-0040). */}
                  {a.vehicle && <span className="mono"> · {a.vehicle.number ?? `···${a.vehicle.vin.slice(-6)}`}</span>}
                  {a.odometerKm != null && (
                    <span className="muted">
                      {' · '}
                      {a.odometerKm} {t.back.km}
                    </span>
                  )}
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

      {wa && r.customer.phone && (
        <WhatsappSheet
          target={{ rentalId: r.id, number: r.number, name: r.customer.name, phone: r.customer.phone, paidThrough: r.paidThrough, dueOn: r.dueOn, debtTetri }}
          onClose={() => setWa(false)}
        />
      )}
    </>
  );
}


/**
 * The state of a week in the table, by the due-day rule (ADR-0017). Every
 * colour has its word: the three part-paid weeks — awaited today, late, ahead
 * — read differently in black and white too.
 */
function WeekState({ kind, partPaid, overdue }: { kind: WeekDue; partPaid: boolean; overdue: boolean }) {
  const t = useT();
  const word = t.rental.payStatus[partPaid ? 'partial' : 'unpaid'];
  switch (kind) {
    case 'paid':
      return <td className="state-available">{t.rental.payStatus.paid}</td>;
    // «· late» only on a rental that is overdue: one returned, paused or
    // disputed keeps the plain red word, as before.
    case 'late':
      return <td className="crit-text">{overdue ? `${word} · ${t.rental.weekLate}` : word}</td>;
    case 'due_today':
      return partPaid ? <td className="warn-text">{`${word} · ${t.calendar.said.due_today}`}</td> : <td>{t.rentalStatus.due_today}</td>;
    case 'ahead':
      return <td>{word}</td>;
    // A week at nothing — a pause lifted, a rate of 0 — asks for nothing.
    case 'none':
      return <td className="muted">{t.common.dash}</td>;
  }
}

interface FreeVehicles {
  vehicles: { id: string; vin: string; model: string; state: VehicleState }[];
}

/**
 * "Change terms" (wave 3 §3.7, B4-08): night parking, batteries, chargers, the
 * planned return — an owner or a manager, "was / became" in the journal. The
 * rate of a running rental does not change (Q12). Also here: giving a rental
 * its moped once the VIN is confirmed (RNT-06), the buy-out terms (RNT-07), notes.
 */
function RentalEdit({ rental, owner, onClose, onSaved }: { rental: RentalCard['rental']; owner: boolean; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const fleet = useLoad<FreeVehicles>(rental.vinUnconfirmed ? '/api/fleet' : null);
  // The pay day (ADR-0022): the weekday the weeks start on unless agreed otherwise — the
  // pickup's, or the one they moved to (ADR-0041). An owner's, with a reason.
  const weeksFrom = rental.weeksFromOn ?? rental.pickedUpOn;
  const pickupDay = weeksFrom ? isoWeekday(weeksFrom) : null;
  const moved = (rental.weekShiftDays ?? 0) > 0;
  const initial = {
    payDay: String(rental.payWeekday ?? pickupDay ?? ''),
    payReason: '',
    nightParking: rental.nightParkingAddress ?? '',
    batteries: rental.batteries != null ? String(rental.batteries) : '',
    chargers: rental.chargers != null ? String(rental.chargers) : '',
    expectedReturnOn: rental.expectedReturnOn ?? '',
    vehicleId: '',
    target: rental.buyoutTargetTetri ? String(rental.buyoutTargetTetri / 100) : '',
    per: rental.buyoutPerPaymentTetri ? String(rental.buyoutPerPaymentTetri / 100) : '',
    notes: rental.notes ?? '',
  };
  const [f, setF] = useState(initial);
  const free = (fleet.data?.vehicles ?? []).filter((v) => v.state === 'available');

  return (
    <FormSheet
      title={t.rentalMenu.editTitle(rental.number)}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={`rental-edit:${rental.id}`}
      onRestore={setF}
      label={t.actions.save}
      submit={async (key) => {
        const body: Record<string, unknown> = {};
        if (f.nightParking !== initial.nightParking) body.nightParkingAddress = f.nightParking.trim() || null;
        if (f.batteries !== initial.batteries) body.batteries = f.batteries === '' ? null : Number(f.batteries);
        if (f.chargers !== initial.chargers) body.chargers = f.chargers === '' ? null : Number(f.chargers);
        if (f.expectedReturnOn !== initial.expectedReturnOn) body.expectedReturnOn = f.expectedReturnOn || null;
        if (f.notes !== initial.notes) body.notes = f.notes || null;
        if (f.vehicleId) body.vehicleId = f.vehicleId;
        if (f.payDay !== initial.payDay) {
          body.payWeekday = Number(f.payDay);
          body.reason = f.payReason.trim();
        }
        if (f.target !== initial.target || f.per !== initial.per) {
          // As typed: the server reads the sum, and refuses one it cannot read
          // under its field — it no longer turns into «no buy-out» on the way.
          body.buyoutTargetTetri = f.target.trim() || null;
          body.buyoutPerPaymentTetri = f.per.trim() || null;
        }
        await api.patch(`/api/rentals/${rental.id}`, body, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onSaved}
    >
      <p className="hint muted">{t.rentalMenu.rateFixed(formatGel(rental.weeklyRateTetri, { decimals: false }))}</p>
      <Field label={t.hand.nightParking} name="nightParkingAddress">
        <input className="input" value={f.nightParking} onChange={(e) => setF({ ...f, nightParking: e.target.value })} />
      </Field>
      <div className="two-col two-col-tight">
        <Field label={t.hand.batteries} name="batteries">
          <input className="input input-amount mono" value={f.batteries} onChange={(e) => setF({ ...f, batteries: e.target.value })} inputMode="numeric" />
        </Field>
        <Field label={t.hand.chargers} name="chargers">
          <input className="input input-amount mono" value={f.chargers} onChange={(e) => setF({ ...f, chargers: e.target.value })} inputMode="numeric" />
        </Field>
      </div>
      <Field label={t.hand.expectedReturn} hint={t.hand.expectedReturnHint} name="expectedReturnOn">
        <input className="input mono" type="date" min={rental.pickedUpOn ?? undefined} value={f.expectedReturnOn} onChange={(e) => setF({ ...f, expectedReturnOn: e.target.value })} />
      </Field>
      {owner && pickupDay && (
        <Field label={t.payDay.label} hint={t.payDay.hint} name="payWeekday">
          <select className="input" value={f.payDay} onChange={(e) => setF({ ...f, payDay: e.target.value })}>
            {t.payDay.days.map((day, i) => (
              <option key={day} value={String(i + 1)}>
                {i + 1 !== pickupDay ? day : moved ? t.payDay.weekStartMark(day) : t.payDay.pickupMark(day)}
              </option>
            ))}
          </select>
        </Field>
      )}
      {f.payDay !== initial.payDay && (
        <Field label={t.payDay.reason} hint={t.payDay.reasonHint} name="reason">
          <input className="input" value={f.payReason} onChange={(e) => setF({ ...f, payReason: e.target.value })} />
        </Field>
      )}
      {/* A moped given already is changed by a swap, with its two acts (ADR-0040). */}
      {rental.vehicle && <p className="hint muted">{t.swap.editHint}</p>}
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
      <span className="lbl">{t.rentalEdit.buyout}</span>
      <div className="two-col two-col-tight">
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

/** Pause · Disputed · Active again — an owner, with a reason (§3.7, Q11). */
function StatusSheet({ rental, onClose, onDone }: { rental: RentalCard['rental']; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const current = rental.storedStatus === 'paused' || rental.storedStatus === 'disputed' ? rental.storedStatus : 'active';
  const initial = { status: current as 'active' | 'paused' | 'disputed', reason: '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={`${t.rentalMenu.statusTitle} · ${rental.number}`}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.rentalMenu.statusSet[f.status]}
      submit={async (key) => {
        await api.post(`/api/rentals/${rental.id}/status`, { status: f.status, reason: f.reason.trim() }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onDone}
    >
      <div className="chips">
        {(['active', 'paused', 'disputed'] as const).map((st) => (
          <button key={st} type="button" className={`pill pill-sm ${f.status === st ? 'on' : ''}`} onClick={() => setF({ ...f, status: st })}>
            {t.rentalStatus[st]}
          </button>
        ))}
      </div>
      <Field label={t.rentalMenu.reason} hint={f.status === 'active' ? t.rentalMenu.resumeHint : t.rentalMenu.statusHint} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/**
 * "Скидка на неделю" — an owner takes an amount off one week, with a reason
 * (meeting of 14.10.2026: a day in the workshop, 125 paid for a 150 week).
 * Only the unpaid part of the week can go; nought takes the discount away.
 */
function DiscountSheet({ rentalId, week, onClose, onDone }: { rentalId: string; week: RentalCard['periods'][number]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const full = week.amountTetri + (week.discountTetri ?? 0);
  const initial = { amount: week.discountTetri ? (week.discountTetri / 100).toFixed(2) : '', reason: week.discountReason ?? '' };
  const [f, setF] = useState(initial);
  const off = parseGel(f.amount) ?? 0;
  return (
    <FormSheet
      title={t.rental.discountTitle(week.seq, fmtDate(week.startsOn), fmtDate(week.endsOn))}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.rental.discount}
      submit={async (key) => {
        // Empty is no figure: 0 is typed to take a discount away, as the hint says (QA 21.10.2026).
        await api.post(`/api/rentals/${rentalId}/weeks/${week.seq}/discount`, { discountTetri: f.amount.trim(), reason: f.reason.trim() }, { key });
        return { toast: { text: t.rental.discountDone } };
      }}
      onDone={onDone}
    >
      <Field label={t.rental.discountAmount} hint={t.rental.discountHint(formatGel(full), formatGel(week.paidTetri), formatGel(Math.max(0, full - off)))} name="discountTetri">
        <input className="input mono" inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      </Field>
      <Field label={t.rental.discountReason} hint={t.rental.discountReasonHint} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/**
 * "Сдвинуть неделю" — an owner makes the running week 1–6 days longer, for an
 * extra a person types, with a reason (ADR-0041; the courier of 21.10.2026 who
 * paid three days late with the three days on top). The choice is the day the
 * next week starts; the suggestion is rate ÷ 7 × days, and the sheet says what
 * the week becomes and when the next one is due. On a week already moved, the
 * days start where they are, and «not moved» takes the move back.
 */
function ShiftSheet({ rental, week, onClose, onDone }: { rental: RentalCard['rental']; week: RentalCard['periods'][number]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const had = week.extraDays ?? 0;
  const plan = (days: number) => weekShiftPlan({ startsOn: week.startsOn, days, weeklyRateTetri: rental.weeklyRateTetri, payOffsetDays: rental.payOffsetDays });
  const gel = (tetri: number) => String(tetri / 100);
  // Offered first: the days he is late today, from the week's pay day — the
  // next pay day a week after the day he paid. A week already moved keeps its own.
  const offered = shiftDaysOffered({ startsOn: week.startsOn, payOffsetDays: rental.payOffsetDays, today: todayISO() });
  const guess = had || offered.days;
  // The sheet says why it offers that day, where the reason holds (ux.md №15).
  const guessed = had === 0 && offered.exact;
  const initial = { days: String(guess), extra: gel(had ? (week.extraTetri ?? 0) : plan(guess).suggestedExtraTetri), reason: '' };
  const [f, setF] = useState(initial);
  const days = Number(f.days);
  const p = plan(days);
  const price = week.amountTetri - (week.extraTetri ?? 0) + (days === 0 ? 0 : (parseGel(f.extra) ?? 0));
  // Weekdays inside a sentence, Sunday first.
  const weekday = (date: string) => t.calendar.weekdaysIn[isoWeekday(date) % 7];
  // A pay day of its own falls inside the week: its date too, so the choice
  // can be checked against the day he paid.
  const nextPayDay = p.nextDueOn === p.nextStartsOn ? weekday(p.nextDueOn) : [weekday(p.nextDueOn), fmtDayMonth(p.nextDueOn)].join(', ');
  const choices = Array.from({ length: MAX_SHIFT_DAYS + 1 }, (_, n) => n).filter((n) => n !== 0 || had !== 0);
  const pick = (value: string) => {
    // A suggestion left as it was follows the days; a sum typed by hand stays.
    const extra = f.extra === gel(plan(days).suggestedExtraTetri) ? gel(plan(Number(value)).suggestedExtraTetri) : f.extra;
    setF({ ...f, days: value, extra });
  };
  return (
    <FormSheet
      title={t.weekShift.title(week.seq, fmtDate(week.startsOn), fmtDate(week.endsOn))}
      onClose={onClose}
      value={f}
      initial={initial}
      label={days === 0 ? t.weekShift.undoAction : t.weekShift.action}
      submit={async (key) => {
        const body = days === 0 ? { days, reason: f.reason.trim() } : { days, extraTetri: f.extra.trim(), reason: f.reason.trim() };
        await api.post(`/api/rentals/${rental.id}/weeks/${week.seq}/shift`, body, { key });
        // Taking a move back is said in its own words.
        return { toast: { text: days === 0 ? t.weekShift.undone : t.weekShift.done } };
      }}
      onDone={onDone}
    >
      <p className="hint muted">{t.weekShift.intro}</p>
      <Field label={t.weekShift.nextFrom} hint={guessed ? t.weekShift.daysHint : undefined} name="days">
        <select className="input" value={f.days} onChange={(e) => pick(e.target.value)}>
          {choices.map((n) => {
            const next = plan(n).nextStartsOn;
            return (
              <option key={n} value={String(n)}>
                {n === 0 ? t.weekShift.asBefore(weekday(next), fmtDayMonth(next)) : t.weekShift.dayOption(weekday(next), fmtDayMonth(next), n)}
              </option>
            );
          })}
        </select>
      </Field>
      {days !== 0 && (
        <Field
          label={t.weekShift.extra}
          hint={t.weekShift.extraHint(formatGel(rental.weeklyRateTetri, { decimals: false }), days, formatGel(p.suggestedExtraTetri, { decimals: false }))}
          name="extraTetri"
        >
          <input className="input mono" inputMode="decimal" value={f.extra} onChange={(e) => setF({ ...f, extra: e.target.value })} />
        </Field>
      )}
      <Field label={t.weekShift.reason} hint={t.weekShift.reasonHint} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
      <p className="hint">
        {days === 0 ? t.weekShift.undo : t.weekShift.summary(week.seq, fmtDayMonth(week.startsOn), fmtDayMonth(p.endsOn), p.lengthDays, formatGel(price, { decimals: false }))}{' '}
        {t.weekShift.next(fmtDayMonth(p.nextStartsOn), weekday(p.nextStartsOn), nextPayDay)}
      </p>
    </FormSheet>
  );
}

/** "Начислить штраф" — an owner, with an amount and what it is for (ADR-0023). */
function FineSheet({ rentalId, onClose, onDone }: { rentalId: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { amount: '', reason: '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={t.rental.fine}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.rental.fine}
      submit={async (key) => {
        await api.post(`/api/rentals/${rentalId}/fines`, { amountTetri: f.amount.trim(), reason: f.reason.trim() }, { key });
        return { toast: { text: t.rental.fineDone } };
      }}
      onDone={onDone}
    >
      <p className="hint muted">{t.rental.fineHint}</p>
      <Field label={t.rental.fineAmount} name="amountTetri">
        <input className="input mono" inputMode="decimal" autoFocus value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
      </Field>
      <Field label={t.rental.fineReason} hint={t.rental.fineReasonHint} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/** A fine nobody has paid, taken back with a reason. */
function UnfineSheet({ rentalId, charge, onClose, onDone }: { rentalId: string; charge: RentalCard['charges'][number]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { reason: '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={`${t.rental.fineVoid} · ${formatGel(charge.amountTetri)}`}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.rental.fineVoid}
      submit={async (key) => {
        await api.post(`/api/rentals/${rentalId}/fines/${charge.id}/void`, { reason: f.reason.trim() }, { key });
        return { toast: { text: t.rental.fineVoidDone } };
      }}
      onDone={onDone}
    >
      <Field label={t.rental.fineVoidReason} name="reason">
        <input className="input" autoFocus value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/** "Cancel the return" — an owner, within a day, with a reason (§3.7, B5-08). */
function UndoSheet({ rental, until, onClose, onDone }: { rental: RentalCard['rental']; until: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { reason: '' };
  const [f, setF] = useState(initial);
  const untilText = signedAtText(until);
  return (
    <FormSheet
      title={t.rentalMenu.undoTitle(rental.number)}
      onClose={onClose}
      value={f}
      initial={initial}
      label={t.rentalMenu.undo}
      submit={async (key) => {
        await api.post(`/api/rentals/${rental.id}/return/undo`, { reason: f.reason.trim() }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onDone}
    >
      <Field label={t.rentalMenu.reason} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ reason: e.target.value })} />
      </Field>
      <p className="hint muted">{t.rentalMenu.undoUntil(untilText)}</p>
    </FormSheet>
  );
}
