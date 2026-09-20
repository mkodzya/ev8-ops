import type { ActKind, DepositStatus, PeriodPayStatus, RentalStatus } from '@ev8/shared';
import { useState } from 'react';
import { parseGel, todayISO, type VehicleState } from '@ev8/shared';
import { DocumentRow, signedAtText, type DocState } from '../components/Documents.js';
import { LoadError } from '../components/LoadError.js';
import { DecideSheet } from '../components/ReturnMoney.js';
import { RowMenu } from '../components/RowMenu.js';
import { WhatsappSheet } from '../components/Whatsapp.js';
import { Field } from '../components/Wizard.js';
import { Link, useParams, useSearchParams } from 'react-router-dom';
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
    transferredAt?: string | null;
    debtOverrideReason?: string | null;
    /** Until when an owner may take the return back (B5-08); null — not any more. */
    undoReturnUntil?: string | null;
  };
  /** What a return charged beyond the weeks: a key, days of delay (wave 3 §3.4). */
  charges: { kind: string; amountTetri: number; note: string | null; paidTetri: number }[];
  /** One timeline of the rental: money, acts, documents, the journal (ux №7). */
  feed: { at: string; kind: 'payment' | 'act' | 'document' | 'log'; by: string | null; text: string; amountTetri: number | null; note: string | null }[];
  documents: { contract: DocState; returnAct: DocState | null };
  payments: { id: string; occurredOn: string; channel: 'transfer' | 'acquiring' | 'cash'; grossTetri: number; feeTetri: number }[];
  deposit: { amountTetri: number; paidTetri: number; status: DepositStatus; returnedTetri: number; withheldTetri: number; withheldReason: string | null; withheldGrounds: string[]; returnedTo: string | null; returnedOn: string | null; decided: boolean; paidOutTetri: number; withholdings: { source: string; amountTetri: number; number: string; reason: string }[] } | null;
  periods: { seq: number; startsOn: string; endsOn: string; amountTetri: number; paidTetri: number; payStatus: PeriodPayStatus }[];
  acts: { id: string; kind: ActKind; occurredOn: string; odometerKm: number | null; condition: string | null; photos: { id: string; label: string }[]; pdfUrl: string | null }[];
}

export function RentalPage() {
  const { id } = useParams();
  const t = useT();
  const openMoney = useMoneyForm();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<RentalCard>(id ? `/api/rentals/${id}` : null);
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState<null | 'edit' | 'status' | 'undo' | 'decide'>(params.get('decide') === '1' ? 'decide' : null);
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
  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const r = data.rental;
  const today = todayISO();
  // What the state asks for first (§3.4): a return that is due beats taking money.
  const dueBack = !!r.expectedReturnOn && r.expectedReturnOn <= today && r.status !== 'returned';
  // Owed is the unpaid part of the weeks, the same arithmetic the list and
  // "Today" use. Nothing here is stored.
  const debtTetri = r.debtTetri;
  const d = data.deposit;
  const open = r.status !== 'returned';
  const owner = can('deposit.decide');
  const menu = [
    ...(open && can('rental.create') ? [{ key: 'edit', label: t.rentalMenu.edit, onPick: () => setSheet('edit') }] : []),
    ...(open && owner ? [{ key: 'status', label: t.rentalMenu.status, onPick: () => setSheet('status') }] : []),
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
        {r.customer.phone && (
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
          onClose={closeSheet}
          onSaved={() => {
            closeSheet();
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
            {/* The first line answers this rental's own question (§3.4). */}
            <p className="t-label">{r.status === 'awaiting_payment' ? t.hand.dueToday : r.status === 'returned' ? t.rentals.returned : t.rentals.paidThrough}</p>
            <p className="paid-date">
              {r.status === 'awaiting_payment' ? formatGel(debtTetri, { decimals: false }) : r.status === 'returned' ? fmtDate(r.returnedOn) : fmtDate(r.paidThrough)}
            </p>
            {r.status === 'awaiting_payment' && d && (
              <p className="muted">
                {t.rentals.deposit}: {t.rentalMoney.receivedOf(formatGel(d.paidTetri, { decimals: false }), formatGel(d.amountTetri, { decimals: false }))}
              </p>
            )}
          </div>
          {debtTetri > 0 && r.status !== 'awaiting_payment' && (
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

      {data.charges.length > 0 && (
        <section className="card">
          {data.charges.map((c, i) => (
            <Row
              key={i}
              k={t.rentalMoney.charges[c.kind] ?? c.kind}
              v={
                <span>
                  <span className="mono">{formatGel(c.amountTetri, { decimals: false })}</span>
                  {c.paidTetri < c.amountTetri && c.paidTetri > 0 && <span className="muted"> · {t.rentalMoney.rest(formatGel(c.amountTetri - c.paidTetri, { decimals: false }))}</span>}
                </span>
              }
            />
          ))}
        </section>
      )}

      <section className="card">
        <BlockHead title={t.rentalMenu.documents} />
        <DocumentRow rentalId={r.id} kind="contract" title={t.hand.contract} state={data.documents.contract} customerId={r.customer.id} onChanged={reload} />
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
        <div className="queue-head">
          <h2>{t.customerW4.feed}</h2>
          <div className="chips">
            {(['all', 'payment', 'act', 'document', 'log'] as const).map((f) => (
              <button key={f} type="button" className={`pill pill-sm ${feedFilter === f ? 'on' : ''}`} onClick={() => setFeedFilter(f)}>
                {f === 'act' ? t.rental.acts : t.customerW4.feedFilters[f]}
              </button>
            ))}
          </div>
        </div>
        <ul className="timeline">
          {data.feed
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
                  {e.kind === 'log' && <span className="muted">{e.text}</span>}
                  {e.note && <span className="muted"> · {e.note}</span>}
                  {e.by && <span className="muted"> · {e.by}</span>}
                </span>
              </li>
            ))}
        </ul>
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

      {wa && r.customer.phone && (
        <WhatsappSheet
          target={{ rentalId: r.id, number: r.number, name: r.customer.name, phone: r.customer.phone, paidThrough: r.paidThrough, debtTetri }}
          onClose={() => setWa(false)}
        />
      )}
    </>
  );
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
function RentalEdit({ rental, onClose, onSaved }: { rental: RentalCard['rental']; onClose: () => void; onSaved: () => void }) {
  const t = useT();
  const fleet = useLoad<FreeVehicles>(rental.vinUnconfirmed ? '/api/fleet' : null);
  const initial = {
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
        if (f.target !== initial.target || f.per !== initial.per) {
          body.buyoutTargetTetri = f.target ? parseGel(f.target) : null;
          body.buyoutPerPaymentTetri = f.per ? parseGel(f.per) : null;
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
