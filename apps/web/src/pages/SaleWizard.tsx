import { acquiringFee, acquiringNet, instalmentSchedule, isISODate, parseGel, redateSale, scheduleGap, todayISO, warrantyUntil, type ISODate } from '@ev8/shared';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { ColorText, Loading, Vin } from '../components/ui.js';
import { Field, Wizard } from '../components/Wizard.js';
import { DraftOffer } from '../ds/form/Form.js';
import { useDraft } from '../ds/form/drafts.js';
import { useOperation } from '../ds/form/operation.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { SumRow } from './PickupWizard.js';

// Selling a moped (wave 5 §3.1). The same skeleton as the hand-over: the step
// lives inside the form state, so a draft comes back to the step it left; one
// operation key covers the whole sale; a refusal names its field and sends the
// person to the step that owns it.
//
// The schedule is the thing this screen exists for. A buyer agrees to dates
// and amounts, not to a number of months, so the rows are built as soon as
// there is a price and are edited line by line before anybody signs anything
// (B7-03).

type Channel = 'cash' | 'acquiring' | 'transfer';

interface FleetRow {
  id: string;
  vin: string;
  model: string;
  modelId: string;
  color: string | null;
  state: string;
  pool: 'rent' | 'sale' | null;
  location: { id: string; name: string } | null;
  salePriceTetri: number | null;
}

interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  debtTetri: number;
  /** Of debtTetri: awaited today and not late (ADR-0017). */
  dueTodayTetri: number;
}

interface Row {
  dueOn: ISODate;
  amount: string;
}

const blank = (vehicleId: string) => ({
  step: 0,
  vehicleId,
  customerId: '',
  price: '',
  extras: [] as { name: string; amount: string }[],
  instalments: false,
  down: '',
  months: '3',
  rows: [] as Row[],
  edited: false,
  transfer: false,
  soldOn: todayISO(),
  paidBefore: '',
  creating: false,
  ncName: '',
  ncPhone: '',
  ncPersonalId: '',
  channel: null as Channel | 'later' | null,
  prepayment: '',
  why: '',
  movePool: false,
});

type SaleForm = ReturnType<typeof blank>;

/**
 * A draft started on an earlier day, taken back today (call of 21.10.2026).
 * The day of an ordinary sale is not a field — it is the day the sale is
 * made — so a draft from yesterday would date today's sale yesterday and
 * nobody would see it. It is made today; lines edited by hand move with it by
 * the rule a correction on the sale's card uses (`redateSale`). A sale
 * carried over keeps the day it was given: that one is a field.
 */
function madeToday(v: SaleForm): SaleForm {
  const today = todayISO();
  if (v.transfer || v.soldOn === today) return v;
  if (!isISODate(v.soldOn)) return { ...v, soldOn: today };
  const plan = redateSale(
    { soldOn: v.soldOn, warrantyUntil: null, transferred: false, instalments: v.rows.flatMap((r, i) => (isISODate(r.dueOn) ? [{ seq: i + 1, dueOn: r.dueOn }] : [])) },
    today,
  );
  const to = new Map(plan.instalments.map((m) => [m.seq, m.to]));
  return { ...v, soldOn: today, rows: v.rows.map((r, i) => ({ ...r, dueOn: to.get(i + 1) ?? r.dueOn })) };
}

export function SaleWizard() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { can } = useSession();
  const owner = can('deposit.decide');
  const op = useOperation();

  const fleet = useLoad<{ vehicles: FleetRow[] }>('/api/fleet');
  const customers = useLoad<{ customers: CustomerRow[] }>('/api/customers');
  // Started from a deal in "Today" (ADR-0015): the buyer is already chosen, and the sale keeps the deal's link.
  const fromLead = params.get('lead');
  const [f, setF] = useState(() => ({ ...blank(params.get('vehicle') ?? ''), customerId: params.get('customer') ?? '' }));
  const [initial] = useState(f);
  const set = (patch: Partial<typeof f>) => setF((prev) => ({ ...prev, ...patch }));
  const [vq, setVq] = useState('');
  const [cq, setCq] = useState('');
  const [result, setResult] = useState<{ id: string; number: string } | null>(null);
  // The sale is written first and the prepayment after it: if the money fails
  // the sale still exists, and the screen says so instead of losing both.
  const [payTrouble, setPayTrouble] = useState(false);

  const drafts = useDraft({ id: 'sale', value: f, initial, hold: result != null });

  const vehicle = fleet.data?.vehicles.find((v) => v.id === f.vehicleId) ?? null;
  const customer = customers.data?.customers.find((c) => c.id === f.customerId) ?? null;

  // What may be sold: standing free, in the sale park or in none. A moped out
  // with a renter is not offered at all — the refusal for a direct link is the
  // API's, in words about selling (crit. 2).
  const forSale = useMemo(
    () => (fleet.data?.vehicles ?? []).filter((v) => v.state === 'available' && v.pool !== 'rent'),
    [fleet.data],
  );
  const rentPool = useMemo(
    () => (fleet.data?.vehicles ?? []).filter((v) => v.state === 'available' && v.pool === 'rent'),
    [fleet.data],
  );
  const offered = useMemo(() => {
    const list = owner ? [...forSale, ...rentPool] : forSale;
    const q = vq.trim().toUpperCase();
    return q ? list.filter((v) => v.vin.toUpperCase().includes(q) || v.model.toUpperCase().includes(q)) : list;
  }, [forSale, rentPool, owner, vq]);

  // The moped a direct link asked for, when it is not one that can be sold:
  // the screen says why rather than showing a list it is not in (crit. 2).
  const askedFor = useMemo(() => {
    const asked = params.get('vehicle');
    if (!asked || (fleet.data?.vehicles ?? []).length === 0) return null;
    if (offered.some((v) => v.id === asked)) return null;
    return (fleet.data?.vehicles ?? []).find((v) => v.id === asked) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleet.data, offered, params]);

  const foundCustomers = useMemo(() => {
    const q = cq.trim().toLowerCase();
    const list = customers.data?.customers ?? [];
    if (!q) return list.slice(0, 8);
    const digits = q.replace(/\D/g, '');
    return list
      .filter((c) => c.name.toLowerCase().includes(q) || (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits)))
      .slice(0, 8);
  }, [customers.data, cq]);

  // The price starts from the model's and is edited as often as not (SAL-01).
  useEffect(() => {
    if (!vehicle || f.price !== '') return;
    if (vehicle.salePriceTetri != null) set({ price: String(vehicle.salePriceTetri / 100) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]);

  const priceTetri = parseGel(f.price) ?? 0;
  const extrasTetri = f.extras.reduce((n, e) => n + (parseGel(e.amount) ?? 0), 0);
  const totalTetri = priceTetri + extrasTetri;
  const downTetri = parseGel(f.down) ?? 0;
  const months = Number(f.months) || 0;

  // Built from the price until somebody touches a line; after that the lines
  // are what was agreed and the system does not rewrite them.
  const built = useMemo(
    () =>
      instalmentSchedule({
        soldOn: f.soldOn,
        priceTetri: totalTetri,
        downPaymentTetri: f.instalments ? downTetri : 0,
        months: f.instalments ? months : 0,
      }),
    [f.soldOn, totalTetri, downTetri, months, f.instalments],
  );
  const rows: Row[] = f.edited && f.rows.length > 0 ? f.rows : built.map((r) => ({ dueOn: r.dueOn, amount: String(r.amountTetri / 100) }));
  const rowsTetri = rows.map((r) => ({ dueOn: r.dueOn, amountTetri: parseGel(r.amount) ?? 0 }));
  const gap = scheduleGap(totalTetri, rowsTetri);

  const editRow = (i: number, patch: Partial<Row>) => {
    const next = rows.map((r, k) => (k === i ? { ...r, ...patch } : r));
    set({ rows: next, edited: true });
  };

  // What is due today by the schedule: the prepayment field opens with it,
  // because that is the figure the buyer was just shown (§3.1, step 4).
  const firstDueTetri = rowsTetri[0]?.amountTetri ?? 0;
  const paidBeforeTetri = parseGel(f.paidBefore) ?? 0;
  const prepaymentTetri = parseGel(f.prepayment) ?? 0;
  const needsPrepayment = !f.transfer;
  const vehicleOk = f.vehicleId !== '' && (vehicle?.pool !== 'rent' || f.movePool);
  const priceOk = totalTetri > 0 && rows.length > 0 && rowsTetri.every((r) => r.amountTetri >= 0);
  // A sale with nothing paid today is an owner's decision and carries a
  // reason; anything else needs a channel and an amount (§3.1, step 4).
  const paymentOk = !needsPrepayment || (f.channel === 'later' ? owner && f.why.trim().length > 2 : f.channel != null && prepaymentTetri > 0);
  const buyerOk = f.creating ? f.ncName.trim().length > 1 && f.ncPhone.trim().length > 5 : f.customerId !== '';
  const ok = [vehicleOk, buyerOk, priceOk, paymentOk, true][f.step];

  const stepOfField: Record<string, number> = { vehicleId: 0, movePool: 0, customerId: 1, name: 1, phone: 1, personalId: 1, priceTetri: 2, downPaymentTetri: 2, paidBeforeTetri: 2, schedule: 2, channel: 3 };
  useEffect(() => {
    const code = op.failure?.code ?? '';
    const byCode: Record<string, number> = {
      vehicle_rented: 0,
      vehicle_sold: 0,
      vehicle_not_available: 0,
      vehicle_in_rent_pool: 0,
      customer_not_found: 1,
      duplicate_customer: 1,
      duplicate_personal_id: 1,
      down_payment_too_big: 2,
      paid_before_too_big: 2,
    };
    const to = stepOfField[op.failure?.field ?? ''] ?? byCode[code];
    if (to != null) set({ step: to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.failure]);

  const submit = async () => {
    const res = await op.run(async (key) => {
      // A card for the buyer first, then the sale: the sale needs an id, and
      // a customer written twice by a retry is what the key prevents.
      const customerId = f.creating
        ? (await api.post<{ id: string }>('/api/customers', { name: f.ncName.trim(), phone: f.ncPhone.trim(), personalId: f.ncPersonalId.trim() || undefined }, { key: `${key}-customer` })).id
        : f.customerId;
      const body = {
        customerId,
        vehicleId: f.vehicleId,
        priceTetri,
        extraLines: f.extras.filter((e) => e.name.trim() !== '').map((e) => ({ name: e.name.trim(), amountTetri: parseGel(e.amount) ?? 0 })),
        downPaymentTetri: f.instalments ? downTetri : 0,
        months: f.instalments ? months : 0,
        schedule: rowsTetri.map((r) => ({ dueOn: r.dueOn, amountTetri: r.amountTetri })),
        soldOn: f.soldOn,
        transferred: f.transfer,
        paidBeforeTetri: f.transfer ? paidBeforeTetri : 0,
        movePool: f.movePool,
        kommoRef: fromLead ?? undefined,
        notes: f.channel === 'later' && f.why.trim() ? f.why.trim() : undefined,
      };
      const sale = await api.post<{ id: string; number: string }>('/api/sales', body, { key });
      setResult(sale);
      drafts.drop();
      // The prepayment goes in as money of its own, through the one money
      // rule of wave 2 — so a card carries its fee (crit. 1, 8).
      if (needsPrepayment && f.channel && f.channel !== 'later' && prepaymentTetri > 0) {
        try {
          await api.post(`/api/sales/${sale.id}/payments`, { grossTetri: prepaymentTetri, channel: f.channel }, { key: `${key}-pay` });
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          setPayTrouble(true);
        }
      }
      return sale;
    });
    if (res.ok) set({ step: 5 });
  };

  if (fleet.failure) return <LoadError failure={fleet.failure} onRetry={fleet.reload} />;
  if (!fleet.data || !customers.data) return <Loading />;

  if (result && f.step === 5) {
    return <SaleDone id={result.id} number={result.number} rows={rowsTetri} payTrouble={payTrouble} />;
  }

  if (drafts.offer) {
    return (
      <Wizard title={t.sell.title} steps={t.sell.steps} step={0}>
        <DraftOffer at={drafts.offer.at} words={null} onContinue={() => drafts.accept((v) => setF(madeToday(v)))} onDiscard={drafts.discard} />
      </Wizard>
    );
  }

  const priceWord = vehicle?.salePriceTetri != null ? formatGel(vehicle.salePriceTetri, { decimals: false }) : t.sell.noPrice;

  return (
    <Wizard
      title={t.sell.title}
      steps={t.sell.steps}
      step={f.step}
      onBack={f.step > 0 ? () => set({ step: f.step - 1 }) : undefined}
      onNext={f.step === 4 ? () => void submit() : () => set({ step: f.step + 1, ...(f.step === 2 ? { prepayment: f.prepayment || String(firstDueTetri / 100) } : {}) })}
      nextDisabled={!ok}
      nextLabel={f.step === 4 ? t.sell.confirm(formatGel(totalTetri, { decimals: false })) : undefined}
      submit={f.step === 4 ? { state: op.state, failure: op.failure, label: t.sell.confirm(formatGel(totalTetri, { decimals: false })) } : undefined}
      failure={f.step === 4 ? null : op.failure}
    >
      {f.step === 0 && (
        <>
          {/* A link that names a moped nobody can sell used to open a list
              with nothing chosen and a grey button, and explain nothing
              (crit. 2, QA-W5-04). */}
          {askedFor && (
            <div className="card" data-field="vehicleId">
              <p className="warn-text">{askedFor.state === 'rented' ? t.sell.askedRented : t.sell.askedGone}</p>
              <p className="muted">
                {askedFor.model} <span className="mono">···{askedFor.vin.slice(-4)}</span>
              </p>
              <Link className="pill" to={`/fleet/${askedFor.id}`}>
                {t.sell.askedOpen}
              </Link>
            </div>
          )}
          <input className="input mono" placeholder={t.sell.vinSearch} aria-label={t.sell.vinSearch} value={vq} onChange={(e) => setVq(e.target.value)} />
          {offered.length === 0 && <p className="empty">{t.sell.noneForSale}</p>}
          <ul className="pick-list">
            {offered.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={v.id === f.vehicleId ? 'on' : ''}
                  // The price comes with the moped: picking another one puts
                  // its model's price in, not an empty field (SAL-01).
                  onClick={() => set({ vehicleId: v.id, movePool: v.pool !== 'rent', price: v.salePriceTetri != null ? String(v.salePriceTetri / 100) : '', edited: false })}
                >
                  <span className="pick-main">
                    <span>
                      {v.model}
                      {v.color && (
                        <span className="muted">
                          {' '}
                          · <ColorText of={v.color} named />
                        </span>
                      )}
                    </span>
                    <Vin vin={v.vin} />
                  </span>
                  <span className="muted">{v.salePriceTetri != null ? formatGel(v.salePriceTetri, { decimals: false }) : t.sell.noPrice}</span>
                </button>
              </li>
            ))}
          </ul>
          {vehicle?.pool === 'rent' && (
            <div className="card" data-field="movePool">
              <p className="warn-text">{t.sell.movePool}</p>
              <label className="check">
                <input type="checkbox" checked={f.movePool} onChange={(e) => set({ movePool: e.target.checked })} />
                <span>{t.sell.movePoolNote}</span>
              </label>
            </div>
          )}
        </>
      )}

      {f.step === 1 && (
        <>
          <input className="input" placeholder={t.sell.buyer} aria-label={t.sell.buyer} value={cq} onChange={(e) => setCq(e.target.value)} />
          <ul className="pick-list">
            {foundCustomers.map((c) => (
              <li key={c.id}>
                <button type="button" className={c.id === f.customerId ? 'on' : ''} onClick={() => set({ customerId: c.id })}>
                  <span className="pick-main">
                    <span>{c.name}</span>
                    <span className="muted mono">{c.phone ?? ''}</span>
                  </span>
                  {/* A debtor only: a figure that is all awaited today is not a debt, and an ink number with no word says nothing (ADR-0017). */}
                  {c.debtTetri - (c.dueTodayTetri ?? 0) > 0 && <span className="crit-text mono">{formatGel(c.debtTetri, { decimals: false })}</span>}
                </button>
              </li>
            ))}
          </ul>
          {customer && customer.debtTetri - (customer.dueTodayTetri ?? 0) > 0 && <p className="warn-text">{t.sell.debtor(formatGel(customer.debtTetri, { decimals: false }))}</p>}
          {/* A buyer nobody has a card for yet, made here rather than in
              another screen the wizard would have to be left for (§3.1). */}
          {!f.creating && (
            <button type="button" className="pill pill-sm" onClick={() => set({ creating: true, customerId: '' })}>
              {t.hand.newCustomer}
            </button>
          )}
          {f.creating && (
            <section className="card">
              <div className="row-actions row-between">
                <h2 className="sub">{t.hand.newCustomer}</h2>
                <button type="button" className="pill pill-sm" onClick={() => set({ creating: false })}>
                  {t.back.cancel}
                </button>
              </div>
              <Field label={t.hand.name} name="name">
                <input className="input" value={f.ncName} onChange={(e) => set({ ncName: e.target.value })} />
              </Field>
              <Field label={t.hand.phone} name="phone">
                <input className="input mono" inputMode="tel" value={f.ncPhone} onChange={(e) => set({ ncPhone: e.target.value })} />
              </Field>
              <Field label={t.hand.personalId} hint={t.hand.personalIdHint} name="personalId">
                <input className="input mono" inputMode="numeric" value={f.ncPersonalId} onChange={(e) => set({ ncPersonalId: e.target.value })} />
              </Field>
            </section>
          )}
        </>
      )}

      {f.step === 2 && (
        <>
          <section className="card">
            <Field label={t.sell.price} hint={`${t.sell.modelPrice}: ${priceWord}`} name="priceTetri">
              <input className="input input-amount mono" inputMode="decimal" value={f.price} onChange={(e) => set({ price: e.target.value, edited: false })} />
            </Field>
            <span className="lbl">{t.sell.extras}</span>
            {f.extras.map((e, i) => (
              <div className="two-col two-col-tight" key={i}>
                <input
                  className="input"
                  aria-label={t.sell.extraName}
                  value={e.name}
                  onChange={(ev) => set({ extras: f.extras.map((x, k) => (k === i ? { ...x, name: ev.target.value } : x)), edited: false })}
                />
                <input
                  className="input input-amount mono"
                  inputMode="decimal"
                  aria-label={t.sell.extraAmount}
                  value={e.amount}
                  onChange={(ev) => set({ extras: f.extras.map((x, k) => (k === i ? { ...x, amount: ev.target.value } : x)), edited: false })}
                />
              </div>
            ))}
            <button type="button" className="pill pill-sm" onClick={() => set({ extras: [...f.extras, { name: '', amount: '' }], edited: false })}>
              {t.sell.addExtra}
            </button>
            <p className="hint muted">{t.sell.extrasHint}</p>
            <Field label={t.sell.warranty} name="warrantyUntil">
              <input className="input mono" value={fmtDate(warrantyUntil(f.soldOn))} readOnly />
            </Field>
          </section>

          <section className="card">
            <span className="lbl">{t.sell.pay}</span>
            <div className="chips">
              <button type="button" className={`pill pill-sm ${!f.instalments ? 'on' : ''}`} onClick={() => set({ instalments: false, edited: false })}>
                {t.sell.payFull}
              </button>
              <button type="button" className={`pill pill-sm ${f.instalments ? 'on' : ''}`} onClick={() => set({ instalments: true, edited: false })}>
                {t.sell.payInstalments}
              </button>
            </div>
            {f.instalments && (
              <div className="two-col two-col-tight">
                <Field label={t.sell.down} name="downPaymentTetri">
                  <input className="input input-amount mono" inputMode="decimal" value={f.down} onChange={(e) => set({ down: e.target.value, edited: false })} />
                </Field>
                <Field label={t.sell.months} name="months">
                  <input className="input input-amount mono" inputMode="numeric" value={f.months} onChange={(e) => set({ months: e.target.value, edited: false })} />
                </Field>
              </div>
            )}
            {owner && (
              <label className="check">
                <input type="checkbox" checked={f.transfer} onChange={(e) => set({ transfer: e.target.checked, channel: null })} />
                <span>{t.sell.transfer}</span>
              </label>
            )}
            {f.transfer && (
              <>
                <p className="hint muted">{t.sell.transferHint}</p>
                <div className="two-col two-col-tight">
                  <Field label={t.sell.soldOn} name="soldOn">
                    <input className="input mono" type="date" value={f.soldOn} onChange={(e) => set({ soldOn: e.target.value, edited: false })} />
                  </Field>
                  <Field label={t.sell.paidBefore} hint={t.sell.paidBeforeHint} name="paidBeforeTetri">
                    <input className="input input-amount mono" inputMode="decimal" value={f.paidBefore} onChange={(e) => set({ paidBefore: e.target.value })} />
                  </Field>
                </div>
              </>
            )}
          </section>

          <section className="card" data-field="schedule">
            <div className="queue-head">
              <h2>{t.sell.schedule}</h2>
              <span className="muted mono">{t.sell.total(formatGel(rowsTetri.reduce((n, r) => n + r.amountTetri, 0)))}</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>{t.sell.seq}</th>
                  <th>{t.sell.dueOn}</th>
                  <th className="num">{t.sell.amount}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="mono">{i + 1}</td>
                    <td>
                      <input className="input mono" type="date" aria-label={t.sell.dueOn} value={r.dueOn} onChange={(e) => editRow(i, { dueOn: e.target.value })} />
                    </td>
                    <td className="num">
                      <input className="input input-amount mono" inputMode="decimal" aria-label={t.sell.amount} value={r.amount} onChange={(e) => editRow(i, { amount: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {gap !== 0 && <p className="warn-text">{gap > 0 ? t.sell.gapOver(formatGel(gap)) : t.sell.gapUnder(formatGel(-gap))}</p>}
          </section>
        </>
      )}

      {f.step === 3 && (
        <section className="card">
          {!needsPrepayment && <p className="hint muted">{t.sell.transferHint}</p>}
          {needsPrepayment && (
            <>
              <Field label={t.sell.prepayment} name="prepayment">
                <input
                  className="input input-amount mono"
                  inputMode="decimal"
                  value={f.prepayment}
                  onChange={(e) => set({ prepayment: e.target.value })}
                />
              </Field>
              <div className="chips" role="radiogroup" aria-label={t.sell.pay}>
                {(['cash', 'acquiring', 'transfer', 'later'] as const).map((c) => (
                  <button key={c} type="button" role="radio" aria-checked={f.channel === c} className={`pill ${f.channel === c ? 'on' : ''}`} onClick={() => set({ channel: c })}>
                    {c === 'later' ? t.sell.noPrepayment : t.payments.channels[c]}
                  </button>
                ))}
              </div>
              {f.channel == null && <p className="hint muted">{t.sell.chooseHow}</p>}
              {f.channel === 'acquiring' && prepaymentTetri > 0 && (
                <p className="hint muted">{t.sell.cardNet(formatGel(acquiringNet(prepaymentTetri)), formatGel(acquiringFee(prepaymentTetri)))}</p>
              )}
              {f.channel === 'later' && (
                <>
                  <p className="hint muted">{t.sell.noPrepaymentHint}</p>
                  <Field label={t.sell.why} name="why">
                    <input className="input" value={f.why} onChange={(e) => set({ why: e.target.value })} />
                  </Field>
                </>
              )}
            </>
          )}
        </section>
      )}

      {f.step === 4 && (
        <section className="card">
          <SumRow k={t.sell.moped} v={vehicle ? `${vehicle.model} ···${vehicle.vin.slice(-4)}` : ''} go={() => set({ step: 0 })} />
          <SumRow k={t.sell.buyer} v={customer?.name ?? ''} go={() => set({ step: 1 })} />
          {/* The day the sale is dated, said before it is made (call of 21.10.2026). */}
          <SumRow k={t.sell.soldOn} v={<span className="mono">{fmtDate(f.soldOn)}</span>} go={() => set({ step: 2 })} />
          <SumRow k={t.sell.price} v={<span className="mono">{formatGel(totalTetri)}</span>} go={() => set({ step: 2 })} />
          <SumRow
            k={t.sell.schedule}
            v={<span className="mono">{rows.length === 1 ? formatGel(rowsTetri[0]?.amountTetri ?? 0) : t.sell.doneSub(formatGel(rowsTetri[0]?.amountTetri ?? 0, { decimals: false }), rows.length - 1, formatGel(rowsTetri[1]?.amountTetri ?? 0, { decimals: false }))}</span>}
            go={() => set({ step: 2 })}
          />
          <SumRow
            k={t.sell.prepayment}
            v={!needsPrepayment ? t.saleCard.transferred : f.channel === 'later' ? t.sell.noPrepayment : <span className="mono">{formatGel(prepaymentTetri)}</span>}
            go={() => set({ step: 3 })}
          />
          <SumRow k={t.sell.warranty} v={<span className="mono">{fmtDate(warrantyUntil(f.soldOn))}</span>} go={() => set({ step: 2 })} />
        </section>
      )}
    </Wizard>
  );
}

/** What the sale left behind: its number, its paper and the way into it (B4-07). */
function SaleDone({ id, number, rows, payTrouble }: { id: string; number: string; rows: { amountTetri: number }[]; payTrouble: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const card = useLoad<{ documents: { docKind: string | null; signedAt: string | null }[] }>(`/api/sales/${id}`);
  const signed = card.data?.documents.some((d) => d.docKind === 'sale' && d.signedAt) ?? false;
  return (
    <div className="wizard">
      <header className="wizard-head">
        <h1>{t.sell.done(number)}</h1>
      </header>
      <section className="card">
        <p className="muted">
          {rows.length > 1
            ? t.sell.doneSub(formatGel(rows[0].amountTetri, { decimals: false }), rows.length - 1, formatGel(rows[1].amountTetri, { decimals: false }))
            : t.sell.doneFull(formatGel(rows[0]?.amountTetri ?? 0, { decimals: false }))}
        </p>
        {payTrouble && <p className="warn-text">{t.sell.payTrouble}</p>}
      </section>
      <section className="card">
        <div className="queue-head">
          <h2>{t.sell.document}</h2>
          <span className="muted">{signed ? t.saleCard.signedOn(fmtDate(card.data?.documents.find((d) => d.signedAt)?.signedAt?.slice(0, 10) ?? null)) : t.sell.unsigned}</span>
        </div>
        <p className="hint muted">{t.sell.documentSub}</p>
        <div className="row-actions">
          <a className="pill pill-sm" href={`/api/sales/${id}/contract.pdf`} target="_blank" rel="noreferrer">
            {t.sell.document}
          </a>
          <Link className="pill pill-sm" to={`/sales/${id}?sign=1`}>
            {t.sell.sign}
          </Link>
        </div>
      </section>
      <button type="button" className="pill pill-accent pill-wide" onClick={() => navigate(`/sales/${id}`)}>
        {t.sell.openSale}
      </button>
    </div>
  );
}
