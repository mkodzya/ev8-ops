import { countedName, debtAfterSale, formatGel, goodsLineNets, goodsTotals, parseGel, todayISO } from '@ev8/shared';
import { Minus, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../../api.js';
import { LoadError } from '../../components/LoadError.js';
import { Loading } from '../../components/ui.js';
import { Field, Wizard } from '../../components/Wizard.js';
import { useToast } from '../../ds/feedback/Toast.js';
import { DraftOffer } from '../../ds/form/Form.js';
import { useDraft } from '../../ds/form/drafts.js';
import { useOperation } from '../../ds/form/operation.js';
import { fmtDate } from '../../format.js';
import { useLocale, useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import { SumRow } from '../PickupWizard.js';
import './goods.css';

// «Продать товар» (issue #11, ADR-0045). Three steps: what is sold, to whom,
// and the money with the total. The price is final with the VAT inside, so
// the total is what the buyer pays and the VAT is said beside it. The step
// lives inside the form state, so a draft comes back to the step it left; one
// operation key covers the sale and the money paid at the counter; a refusal
// names its field and sends the person to the step that owns it.

type How = 'cash' | 'acquiring' | 'transfer' | 'later';

interface PartItem {
  partId: string;
  name: string;
  nameKa: string | null;
  sku: string | null;
  unit: string;
  onHand: number;
  salePriceTetri: number | null;
  lastCountOn: string | null;
  avgCostTetri: number | null;
}
interface Items {
  parts: PartItem[];
  counted: { item: 'charger' | 'battery'; showroom: number; lastCountOn: string | null }[];
}
interface CustomerRow {
  id: string;
  name: string;
  phone: string | null;
  debtTetri: number;
  /** His money nothing has taken yet: it comes off a new debt first (B7-02). */
  creditTetri?: number;
  dueTodayTetri?: number;
  archived?: boolean;
}

interface Line {
  /** A key of the screen's own: a part's id, or `charger:<n>`. */
  key: string;
  partId: string | null;
  countedItem: 'charger' | null;
  spec: string;
  qty: number;
  price: string;
  cost: string;
  shortReason: string;
  /** «Пересчёт dd.mm уже не видел этот товар?» — yes is chosen in advance. */
  countedAlready: boolean;
}

interface Preview {
  totals: { grossTetri: number; netTetri: number; vatTetri: number };
  lines: { index: number; available: number; decision: string; needsCountAnswer: boolean; lastCountOn: string | null; shelfPriceTetri: number | null; priceEdited: boolean; unitCostTetri: number | null; marginTetri: number | null }[];
  openTetri: number;
  paymentProblem: 'retail_must_pay' | 'goods_paid_over' | null;
  inBank: { lineId: string; bank: string; occurredOn: string; amountTetri: number; grossTetri: number; payer: string | null; purpose: string | null; payment: unknown }[];
}

const blank = () => ({
  step: 0,
  lines: [] as Line[],
  ours: false,
  customerId: '',
  buyerName: '',
  buyerPhone: '',
  how: 'cash' as How | null,
  cash: '',
  /** The seller typed the cash himself: from then on it no longer follows the total. */
  cashTyped: false,
  /** The bank line the owner said this money is; null — not come yet. */
  bankLineId: null as string | null,
  soldOn: todayISO(),
  backdateReason: '',
  notes: '',
});
type Form = ReturnType<typeof blank>;

export function GoodsSaleWizard() {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { can } = useSession();
  const owner = can('stock.count');
  const reconciles = can('payments.reconcile');
  const backdates = can('sales.manage');
  const seesCost = can('cost.view');
  const op = useOperation();

  const items = useLoad<Items>('/api/goods-sales/items');
  const customers = useLoad<{ customers: CustomerRow[] }>('/api/customers');
  const [f, setF] = useState<Form>(() => {
    const b = blank();
    const customer = params.get('customer');
    return customer ? { ...b, ours: true, customerId: customer } : b;
  });
  const [initial] = useState(f);
  const set = (patch: Partial<Form>) => setF((prev) => ({ ...prev, ...patch }));
  const [q, setQ] = useState('');
  const [cq, setCq] = useState('');
  const [done, setDone] = useState(false);
  const drafts = useDraft({ id: 'goods-sale', value: f, initial, hold: done });

  const parts = useMemo(() => new Map((items.data?.parts ?? []).map((p) => [p.partId, p])), [items.data]);
  const charger = items.data?.counted.find((c) => c.item === 'charger') ?? null;

  // A part asked for by the link (`?part=`, `?item=charger`): on the list as soon as the shelf is read.
  useEffect(() => {
    if (!items.data || f.lines.length > 0 || drafts.offer) return;
    const part = params.get('part');
    const p = part ? parts.get(part) : null;
    if (p) addPart(p);
    else if (params.get('item') === 'charger' && charger) addCharger();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.data]);

  const addPart = (p: PartItem) =>
    setF((prev) =>
      prev.lines.some((l) => l.partId === p.partId)
        ? prev
        : { ...prev, lines: [...prev.lines, { key: p.partId, partId: p.partId, countedItem: null, spec: '', qty: 1, price: p.salePriceTetri ? String(p.salePriceTetri / 100) : '', cost: '', shortReason: '', countedAlready: true }] },
    );
  const addCharger = () =>
    setF((prev) => ({
      ...prev,
      lines: [...prev.lines, { key: `charger:${Date.now()}`, partId: null, countedItem: 'charger', spec: '', qty: 1, price: '', cost: '', shortReason: '', countedAlready: true }],
    }));
  const editLine = (key: string, patch: Partial<Line>) => setF((prev) => ({ ...prev, lines: prev.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key: string) => setF((prev) => ({ ...prev, lines: prev.lines.filter((l) => l.key !== key) }));

  const priced = f.lines.map((l) => ({ qty: l.qty, unitPriceTetri: parseGel(l.price) ?? 0 }));
  const totals = goodsTotals(priced);
  const nets = goodsLineNets(priced);
  const retail = !f.ours;
  const cashTetri = f.how === 'cash' ? (parseGel(f.cash) ?? 0) : 0;
  const bankChosen = (f.how === 'acquiring' || f.how === 'transfer') && f.bankLineId != null;

  // The money at the counter: cash typed, or the bank line the owner said it is.
  const paidNow = (): { channel: 'cash'; amountTetri: number } | { statementLineId: string } | undefined => {
    if (f.how === 'cash' && cashTetri > 0) return { channel: 'cash', amountTetri: cashTetri };
    if (bankChosen && f.bankLineId) return { statementLineId: f.bankLineId };
    return undefined;
  };
  const body = (forPreview: boolean) => ({
    soldOn: f.soldOn,
    backdateReason: f.soldOn < todayISO() ? f.backdateReason.trim() || undefined : undefined,
    customerId: f.ours ? f.customerId || undefined : undefined,
    buyerName: retail ? f.buyerName.trim() || undefined : undefined,
    buyerPhone: retail ? f.buyerPhone.trim() || undefined : undefined,
    lines: f.lines.map((l, i) => ({
      partId: l.partId ?? undefined,
      countedItem: l.countedItem ?? undefined,
      spec: l.countedItem ? l.spec.trim() || undefined : undefined,
      qty: l.qty,
      unitPriceTetri: parseGel(l.price) ?? (forPreview ? 0 : undefined),
      unitCostTetri: l.countedItem && seesCost ? (parseGel(l.cost) ?? undefined) : undefined,
      shortReason: l.shortReason.trim() || undefined,
      // Asked only when the date is on or before the item's last count; yes is the default answer.
      countedAlready: preview?.lines[i]?.needsCountAnswer ? l.countedAlready : undefined,
    })),
    paidNow: paidNow(),
    promisedChannel: f.how === 'acquiring' || f.how === 'transfer' ? f.how : undefined,
    notes: f.notes.trim() || undefined,
  });

  // What there is, what it comes to, and what the bank may have sent: asked a moment after the form stops changing.
  const [preview, setPreview] = useState<Preview | null>(null);
  const previewKey = JSON.stringify([f.lines.map((l) => [l.partId, l.countedItem, l.spec, l.qty, l.price, l.cost, l.shortReason]), f.ours, f.customerId, f.how, f.cash, f.soldOn, f.bankLineId]);
  useEffect(() => {
    if (f.lines.length === 0) {
      setPreview(null);
      return;
    }
    let live = true;
    const id = window.setTimeout(() => {
      api
        .post<Preview>('/api/goods-sales/preview', body(true))
        .then((p) => {
          if (!live) return;
          setPreview(p);
          // The line chosen is offered only while it is exactly the sum left to the bank; once the lines change, it is not this money.
          setF((prev) => (prev.bankLineId && !p.inBank.some((l) => l.lineId === prev.bankLineId && !l.payment) ? { ...prev, bankLineId: null } : prev));
        })
        .catch(() => live && setPreview(null));
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey]);

  // Cash follows the total — a line changed on the first step changes it too — until somebody types another sum.
  useEffect(() => {
    if (f.how === 'cash' && !f.cashTyped && totals.grossTetri > 0 && parseGel(f.cash) !== totals.grossTetri) set({ cash: String(totals.grossTetri / 100) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.how, f.step, f.cashTyped, totals.grossTetri]);

  const foundParts = useMemo(() => {
    const text = q.trim().toLowerCase();
    const list = items.data?.parts ?? [];
    return (text ? list.filter((p) => [p.name, p.nameKa, p.sku].some((x) => x?.toLowerCase().includes(text))) : list).slice(0, text ? 30 : 12);
  }, [items.data, q]);
  const foundCustomers = useMemo(() => {
    const text = cq.trim().toLowerCase();
    const list = (customers.data?.customers ?? []).filter((c) => !c.archived);
    if (!text) return list.slice(0, 8);
    const digits = text.replace(/\D/g, '');
    return list.filter((c) => c.name.toLowerCase().includes(text) || (digits.length >= 3 && (c.phone ?? '').replace(/\D/g, '').includes(digits))).slice(0, 8);
  }, [customers.data, cq]);
  const customer = customers.data?.customers.find((c) => c.id === f.customerId) ?? null;

  const lineName = (l: Line): string => {
    if (l.countedItem) return countedName(l.countedItem, l.spec)[locale];
    const p = l.partId ? parts.get(l.partId) : null;
    return p ? (locale === 'ka' && p.nameKa ? p.nameKa : p.name) : '';
  };
  const decisionOf = (i: number) => preview?.lines[i]?.decision ?? 'ok';

  const linesOk =
    f.lines.length > 0 &&
    f.lines.every((l, i) => (parseGel(l.price) ?? 0) > 0 && decisionOf(i) !== 'refuse' && (decisionOf(i) !== 'need_reason' || l.shortReason.trim().length > 2));
  const buyerOk = retail || f.customerId !== '';
  const moneyOk =
    f.how != null &&
    !(f.how === 'later' && retail) &&
    !(f.how === 'cash' && retail && cashTetri < totals.grossTetri) &&
    cashTetri <= totals.grossTetri &&
    (f.soldOn >= todayISO() || f.backdateReason.trim().length > 2);
  const ok = [linesOk, buyerOk, moneyOk][f.step];

  const stepOfField = (field: string | null | undefined): number | undefined => {
    if (!field) return undefined;
    if (/^lines\[\d+\]\.countedAlready$/.test(field)) return 2;
    if (field.startsWith('lines')) return 0;
    if (['customerId', 'buyerName', 'buyerPhone'].includes(field)) return 1;
    if (['paidNow', 'paidNow.channel', 'soldOn', 'backdateReason', 'promisedChannel'].includes(field)) return 2;
    return undefined;
  };
  useEffect(() => {
    const byCode: Record<string, number> = {
      goods_no_lines: 0,
      goods_short: 0,
      goods_same_item: 0,
      goods_item_not_found: 0,
      goods_item_archived: 0,
      goods_item_not_sellable: 0,
      customer_not_found: 1,
      customer_archived: 1,
      retail_must_pay: 2,
      goods_paid_over: 2,
      goods_count_answer: 2,
      reconcile_required: 2,
      owner_only_backdate: 2,
      future_date: 2,
    };
    const to = stepOfField(op.failure?.field) ?? byCode[op.failure?.code ?? ''];
    if (to != null) set({ step: to });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [op.failure]);

  const submit = async () => {
    const res = await op.run(async (key) => api.post<{ id: string; number: string; openTetri: number }>('/api/goods-sales', body(false), { key }));
    if (!res.ok) return;
    setDone(true);
    drafts.drop();
    const sale = res.value;
    toast({ text: t.goods.wizard.done(sale.number), open: `/sales/goods/${sale.id}`, undo: () => api.post(`/api/goods-sales/${sale.id}/undo`) });
    navigate(`/sales/goods/${sale.id}`, { replace: true });
  };

  if (items.failure) return <LoadError failure={items.failure} onRetry={items.reload} />;
  if (!items.data || !customers.data) return <Loading />;

  if (drafts.offer) {
    return (
      <Wizard className="goods-wizard" title={t.goods.sell} steps={t.goods.wizard.steps} step={0}>
        <DraftOffer at={drafts.offer.at} words={null} onContinue={() => drafts.accept((v) => setF({ ...v, soldOn: v.soldOn < todayISO() && !backdates ? todayISO() : v.soldOn }))} onDiscard={drafts.discard} />
      </Wizard>
    );
  }

  const w = t.goods.wizard;
  const sum = formatGel(totals.grossTetri);
  // What is left after the money at the counter: the cash typed, or the customer's sum of the bank line chosen.
  const chosenLine = bankChosen ? (preview?.inBank ?? []).find((l) => l.lineId === f.bankLineId) : undefined;
  const restTetri = Math.max(0, totals.grossTetri - (bankChosen ? (chosenLine?.grossTetri ?? 0) : cashTetri));
  const asking = (preview?.lines ?? []).filter((p) => p.needsCountAnswer);
  // What is left after the counter: on an own customer's credit, awaited from the bank, or — a retail
  // buyer's cash short of the total, which the field refuses — simply open (QA 23.10.2026: it said «0»).
  const onCredit = !retail && (f.how === 'later' || (f.how === 'cash' && restTetri > 0));
  const toBank = (f.how === 'acquiring' || f.how === 'transfer') && restTetri > 0;
  // On credit, his whole figure as his card will say it: 750 → 850, not this sale's 100 alone.
  const debtWas = customer?.debtTetri ?? 0;
  const debtWill = customer ? debtAfterSale({ owesTetri: customer.debtTetri, creditTetri: customer.creditTetri ?? 0 }, restTetri) : 0;

  return (
    <Wizard
      className="goods-wizard"
      title={t.goods.sell}
      steps={w.steps}
      step={f.step}
      onBack={f.step > 0 ? () => set({ step: f.step - 1 }) : undefined}
      onNext={f.step === 2 ? () => void submit() : () => set({ step: f.step + 1 })}
      nextDisabled={!ok}
      submit={f.step === 2 ? { state: op.state, failure: op.failure, label: w.confirm(sum) } : undefined}
      failure={f.step === 2 ? null : op.failure}
      footNote={f.lines.length > 0 ? `${w.picked(f.lines.length)} · ${sum}` : undefined}
    >
      {f.step === 0 && (
        <>
          <input className="input" placeholder={w.find} aria-label={w.find} value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips goods-chips">
            {charger && (
              <button type="button" className="pill pill-sm" onClick={addCharger}>
                {w.charger} · {w.inShowroom(charger.showroom)}
              </button>
            )}
          </div>
          {foundParts.length === 0 && q.trim() !== '' && <p className="empty">{w.nothingFound}</p>}
          <ul className="pick-list">
            {foundParts.map((p) => (
              <li key={p.partId}>
                <button type="button" className={f.lines.some((l) => l.partId === p.partId) ? 'on' : ''} onClick={() => addPart(p)}>
                  <span className="pick-main">
                    <span>{locale === 'ka' && p.nameKa ? p.nameKa : p.name}</span>
                    <span className={`muted mono ${p.onHand <= 0 ? 'crit-text' : ''}`}>{w.onShelf(p.onHand)}</span>
                  </span>
                  <span className="muted mono">{p.salePriceTetri ? formatGel(p.salePriceTetri, { decimals: false }) : t.common.dash}</span>
                </button>
              </li>
            ))}
          </ul>
          {f.lines.length === 0 && <p className="hint muted">{w.pickHint}</p>}
          {f.lines.map((l, i) => {
            const pv = preview?.lines[i];
            const decision = decisionOf(i);
            const short = decision === 'refuse' || decision === 'need_reason' || decision === 'minus' || decision === 'found_then_sold';
            const part = l.partId ? parts.get(l.partId) : null;
            const shelf = part?.salePriceTetri ?? null;
            const price = parseGel(l.price) ?? 0;
            const cost = l.countedItem ? (parseGel(l.cost) ?? null) : (part?.avgCostTetri ?? pv?.unitCostTetri ?? null);
            const margin = seesCost && cost != null && price > 0 ? nets[i]! - l.qty * cost : null;
            return (
              <section key={l.key} className="card goods-line" data-field={`lines[${i}]`}>
                <div className="queue-head">
                  <h2>{lineName(l) || w.charger}</h2>
                  <button type="button" className="pill pill-sm" onClick={() => removeLine(l.key)}>
                    {w.remove}
                  </button>
                </div>
                <p className={`hint ${short ? 'crit-text' : 'muted'}`}>{l.countedItem ? w.inShowroom(pv?.available ?? charger?.showroom ?? 0) : w.onShelf(pv?.available ?? part?.onHand ?? 0)}</p>
                {l.countedItem && (
                  <Field label={w.model} hint={w.modelHint} name={`lines[${i}].spec`}>
                    <input className="input mono" value={l.spec} onChange={(e) => editLine(l.key, { spec: e.target.value })} />
                  </Field>
                )}
                <div className="goods-line-row">
                  <div className="field">
                    <span className="lbl">{t.wparts.qty}</span>
                    <span className="goods-qty">
                      <button type="button" aria-label={w.fewer} disabled={l.qty <= 1} onClick={() => editLine(l.key, { qty: Math.max(1, l.qty - 1) })}>
                        <Minus size={20} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                      <b className="mono">{l.qty}</b>
                      <button type="button" aria-label={w.more} disabled={l.qty >= 999} onClick={() => editLine(l.key, { qty: Math.min(999, l.qty + 1) })}>
                        <Plus size={20} strokeWidth={1.75} aria-hidden="true" />
                      </button>
                    </span>
                  </div>
                  <Field
                    label={w.price}
                    name={`lines[${i}].unitPriceTetri`}
                    hint={shelf && shelf !== price ? w.shelfPrice(formatGel(shelf, { decimals: false })) : !shelf && !l.countedItem ? w.noShelfPrice : undefined}
                  >
                    <input className="input input-amount mono" inputMode="decimal" value={l.price} onChange={(e) => editLine(l.key, { price: e.target.value })} />
                  </Field>
                </div>
                {l.countedItem && seesCost && (
                  <Field label={w.cost} name={`lines[${i}].unitCostTetri`}>
                    <input className="input input-amount mono" inputMode="decimal" value={l.cost} onChange={(e) => editLine(l.key, { cost: e.target.value })} />
                  </Field>
                )}
                {margin != null && <p className={`hint ${margin < 0 ? 'warn-text' : 'muted'}`}>{margin < 0 ? w.belowCost : w.margin(formatGel(margin), l.qty)}</p>}
                {decision === 'refuse' && <p className="warn-text">{w.shortManager(pv?.available ?? 0)}</p>}
                {(decision === 'need_reason' || ((decision === 'minus' || decision === 'found_then_sold') && owner)) && (
                  <Field label={w.shortReason} name={`lines[${i}].shortReason`}>
                    <input className="input" value={l.shortReason} onChange={(e) => editLine(l.key, { shortReason: e.target.value })} />
                  </Field>
                )}
              </section>
            );
          })}
        </>
      )}

      {f.step === 1 && (
        <>
          <div className="seg-row" role="radiogroup" aria-label={t.goods.cols.buyer}>
            {([false, true] as const).map((ours) => (
              <button key={String(ours)} type="button" role="radio" aria-checked={f.ours === ours} className={`seg ${f.ours === ours ? 'on' : ''}`} onClick={() => set({ ours, how: !ours && f.how === 'later' ? 'cash' : f.how })}>
                <span className="seg-lbl">{ours ? w.ours : t.goods.retail}</span>
              </button>
            ))}
          </div>
          {retail ? (
            <section className="card">
              <Field label={w.buyerName} name="buyerName">
                <input className="input" value={f.buyerName} onChange={(e) => set({ buyerName: e.target.value })} />
              </Field>
              <Field label={w.buyerPhone} name="buyerPhone">
                <input className="input mono" inputMode="tel" value={f.buyerPhone} onChange={(e) => set({ buyerPhone: e.target.value })} />
              </Field>
            </section>
          ) : (
            <>
              <input className="input" placeholder={w.findCustomer} aria-label={w.findCustomer} value={cq} onChange={(e) => setCq(e.target.value)} />
              <ul className="pick-list" data-field="customerId">
                {foundCustomers.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={c.id === f.customerId ? 'on' : ''} onClick={() => set({ customerId: c.id })}>
                      <span className="pick-main">
                        <span>{c.name}</span>
                        <span className="muted mono">{c.phone ?? ''}</span>
                      </span>
                      {c.debtTetri > 0 && <span className="crit-text mono">{w.owes(formatGel(c.debtTetri, { decimals: false }))}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {f.step === 2 && (
        <>
          <section className="card">
            <span className="lbl">{t.payments.channel}</span>
            <div className="chips" role="radiogroup" aria-label={t.payments.channel} data-field="paidNow">
              {(['cash', 'acquiring', 'transfer', 'later'] as const)
                .filter((h) => h !== 'later' || !retail)
                .map((h) => (
                  <button key={h} type="button" role="radio" aria-checked={f.how === h} className={`pill ${f.how === h ? 'on' : ''}`} onClick={() => set({ how: h, bankLineId: null })}>
                    {w.how[h]}
                  </button>
                ))}
            </div>
            {f.how === 'cash' && (
              <Field label={w.cashAmount} name="paidNow.amountTetri">
                <input className="input input-amount mono" inputMode="decimal" value={f.cash} onChange={(e) => set({ cash: e.target.value, cashTyped: true })} />
              </Field>
            )}
            {(f.how === 'acquiring' || f.how === 'transfer') &&
              (reconciles && (preview?.inBank ?? []).filter((l) => !l.payment).length > 0 ? (
                <div className="field" role="group" aria-label={w.bankLines}>
                  <span className="lbl">{w.bankLines}</span>
                  {(preview?.inBank ?? [])
                    .filter((l) => !l.payment)
                    .map((l) => (
                      <div key={l.lineId} className="money-bank-row">
                        <span>
                          <span className="mono">{fmtDate(l.occurredOn)}</span> · <span className="mono">{formatGel(l.grossTetri)}</span>
                          {(l.payer || l.purpose) && <span className="muted"> · {[l.payer, l.purpose].filter(Boolean).join(' · ')}</span>}
                        </span>
                        <button type="button" className={`pill pill-sm ${f.bankLineId === l.lineId ? 'on' : ''}`} aria-pressed={f.bankLineId === l.lineId} onClick={() => set({ bankLineId: f.bankLineId === l.lineId ? null : l.lineId })}>
                          {w.itsThis}
                        </button>
                      </div>
                    ))}
                  <button type="button" className={`pill pill-sm ${f.bankLineId == null ? 'on' : ''}`} onClick={() => set({ bankLineId: null })}>
                    {w.notYet}
                  </button>
                </div>
              ) : (
                <p className="hint muted">{w.bankHint}</p>
              ))}
            {retail && f.how === 'cash' && cashTetri < totals.grossTetri && <p className="field-err">{w.retailMustPay}</p>}
            {f.how === 'cash' && cashTetri > totals.grossTetri && <p className="field-err">{t.errors.codes.goods_paid_over}</p>}
          </section>

          {backdates && (
            <section className="card">
              <Field label={w.soldOn} name="soldOn">
                <input className="input mono" type="date" max={todayISO()} value={f.soldOn} onChange={(e) => set({ soldOn: e.target.value || todayISO() })} />
              </Field>
              {f.soldOn < todayISO() && (
                <Field label={w.backdateReason} name="backdateReason">
                  <input className="input" value={f.backdateReason} onChange={(e) => set({ backdateReason: e.target.value })} />
                </Field>
              )}
              {asking.map((pv) => {
                const l = f.lines[pv.index];
                if (!l) return null;
                return (
                  <fieldset key={l.key} className="split-week" data-field={`lines[${pv.index}].countedAlready`}>
                    <legend>
                      {lineName(l)} · {w.countQuestion(fmtDate(pv.lastCountOn))}
                    </legend>
                    {([true, false] as const).map((yes) => (
                      <label key={String(yes)} className={`split-radio ${l.countedAlready === yes ? 'on' : ''}`}>
                        <input type="radio" name={`count-${l.key}`} checked={l.countedAlready === yes} onChange={() => editLine(l.key, { countedAlready: yes })} />
                        <span>{yes ? w.countYes : w.countNo}</span>
                      </label>
                    ))}
                  </fieldset>
                );
              })}
            </section>
          )}

          {/* Rows the width of the card, so the dividers and the «›» line up; an item's name wraps between its words and its count stays with it (QA 23.10.2026). */}
          <section className="card summary-card">
            <span className="lbl">{w.lines}</span>
            {f.lines.map((l) => (
              <SumRow
                key={l.key}
                className="goods-sum-line"
                k={
                  <>
                    {lineName(l)} <span className="nobr">×{l.qty}</span>
                  </>
                }
                v={<span className="mono">{formatGel(l.qty * (parseGel(l.price) ?? 0))}</span>}
                go={() => set({ step: 0 })}
              />
            ))}
            <SumRow k={t.goods.cols.buyer} v={retail ? [t.goods.retail, f.buyerName.trim()].filter(Boolean).join(' · ') : customer?.name ?? ''} go={() => set({ step: 1 })} />
            <p className="t-money goods-total">{w.total(sum, formatGel(totals.vatTetri))}</p>
            <p className="hint">
              {onCredit ? (
                <span className="crit-text">{w.restDebt(formatGel(restTetri))}</span>
              ) : toBank ? (
                w.restBank(formatGel(restTetri))
              ) : restTetri === 0 ? (
                w.restNone
              ) : (
                <span className="crit-text">{w.restOpen(formatGel(restTetri))}</span>
              )}
            </p>
            {onCredit && customer && <p className="hint muted">{debtWill === debtWas ? t.sort.resDebtSame(formatGel(debtWas)) : t.sort.resDebt(formatGel(debtWas), formatGel(debtWill))}</p>}
          </section>
        </>
      )}
    </Wizard>
  );
}
