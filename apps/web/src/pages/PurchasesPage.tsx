import { numberMatches, parseGel, spellingMatches, todayISO } from '@ev8/shared';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { ModelDrawer, NEW_MODEL } from '../components/ModelDrawer.js';
import { Loading, PageHead } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { fmtDate } from '../format.js';
import { useT } from '../i18n/index.js';
import { DataList } from '../ds/list/DataList.js';
import { FormSheet } from '../ds/form/Form.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

// Закупки (wave 5 §3.4): the list of orders, and the order itself written the
// way it is read off an invoice — the factory, the invoice and its lines on
// one panel, with a factory nobody has ordered from before made inside the
// very field that asks for it.

export type PurchaseStatus = 'ordered' | 'received' | 'cancelled';

export interface PurchaseLine {
  id: string;
  model: { id: string; name: string } | null;
  partName: string | null;
  partId: string | null;
  /** False for a line that names no catalogue part: it will reach no shelf (B8-03). */
  onShelf: boolean;
  qty: number;
  unitPriceMinor: number;
  lineMinor: number;
  fobTetri: number;
  extrasTetri: number;
  totalTetri: number;
  unitCostTetri: number;
}

export interface PurchasePayment {
  id: string;
  occurredOn: string;
  grossTetri: number;
  netTetri: number;
  feeTetri: number;
  foreignMinor: number;
  foreignCurrency: string | null;
  channel: 'cash' | 'acquiring' | 'transfer';
  direction: 'in' | 'out';
}

export interface Purchase {
  id: string;
  number: string;
  invoiceNo: string | null;
  invoiceDate: string | null;
  currency: string;
  orderedOn: string;
  receivedOn: string | null;
  status: PurchaseStatus;
  supplier: { id: string; name: string };
  invoiceMinor: number;
  paidTetri: number;
  paidMinor: number;
  /** 0…100 of the invoice — the figure the «предварительно» note quotes (§7). */
  paidPercent: number;
  debtMinor: number;
  /** True while the invoice is not settled: every cost below still moves. */
  preliminary: boolean;
  extrasTetri: number;
  extrasNote: string | null;
  paidBeforeTetri: number;
  paidBeforeMinor: number;
  paidBeforeOn: string | null;
  rate: number | null;
  units: number;
  notes: string | null;
  lines: PurchaseLine[];
  payments: PurchasePayment[];
}

export interface Supplier {
  id: string;
  name: string;
  country: string | null;
  contact: string | null;
  phone: string | null;
  orders: number;
  debt: { currency: string; minor: number }[];
}

/** An amount in the seller's currency: minor units, two decimals, no lari sign. */
export function fmtForeign(minor: number, currency: string): string {
  const whole = Math.floor(Math.abs(minor) / 100);
  const frac = Math.abs(minor) % 100;
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${minor < 0 ? '-' : ''}${grouped}.${String(frac).padStart(2, '0')} ${currency}`;
}

/**
 * What an order is waiting for, in one word. The stored status says whether
 * the shipment has arrived; the money says whether it has been paid for. The
 * two stopped being the same question when Mika answered Q23 (§7).
 */
export function statusOf(p: Purchase): 'awaitingPayment' | 'ordered' | 'received' | 'cancelled' {
  if (p.status === 'cancelled') return 'cancelled';
  if (p.status === 'received') return 'received';
  return p.debtMinor > 0 ? 'awaitingPayment' : 'ordered';
}

/** The rate as a person here reads it: a comma, and no trailing zeroes. */
export function fmtRate(rate: number | null): string {
  return rate == null ? '' : String(rate).replace('.', ',');
}

export function PurchasesPage() {
  const t = useT();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<{ purchases: Purchase[] }>('/api/purchases');

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;

  return (
    <>
      <PageHead wrap title={t.buy.title} sub={t.buy.count(data.purchases.length)}>
        {can('purchases.manage') && <NewPurchase onDone={reload} />}
      </PageHead>
      <DataList
        rows={data.purchases}
        rowKey={(p) => p.id}
        href={(p) => `/purchases/${p.id}`}
        fallback={(a, b) => b.orderedOn.localeCompare(a.orderedOn) || a.number.localeCompare(b.number)}
        search={{
          placeholder: t.buy.search,
          match: (p, q) => numberMatches(q, p.number) || spellingMatches(q, [p.invoiceNo, p.supplier.name]),
        }}
        chips={[
          { key: 'unpaid', label: t.buy.chips.awaitingPayment, test: (p) => statusOf(p) === 'awaitingPayment' },
          { key: 'ordered', label: t.buy.chips.awaitingReceipt, test: (p) => p.status === 'ordered' },
          { key: 'received', label: t.buy.chips.arrived, test: (p) => p.status === 'received' },
          { key: 'cancelled', label: t.buy.chips.cancelled, test: (p) => p.status === 'cancelled' },
        ]}
        empty={{ text: t.buy.none }}
        card={(p) => ({
          title: p.supplier.name,
          sub: (
            <>
              {p.number}
              {p.invoiceNo && <> · {p.invoiceNo}</>}
            </>
          ),
          sub2: fmtDate(p.orderedOn),
          right: <span className="t-money">{fmtForeign(p.invoiceMinor, p.currency)}</span>,
          rightSub: (
            <span className={p.debtMinor > 0 && p.status !== 'cancelled' ? 'crit-text' : 'muted'}>{t.buy.statuses[statusOf(p)]}</span>
          ),
        })}
        columns={[
          { key: 'number', label: t.buy.number, cell: (p) => <span className="mono">{p.number}</span>, sort: { value: (p) => p.number } },
          { key: 'supplier', label: t.buy.supplier, cell: (p) => <span>{p.supplier.name}</span>, sort: { value: (p) => p.supplier.name } },
          { key: 'invoiceNo', label: t.buy.invoice, cell: (p) => <span className="muted">{p.invoiceNo ?? t.common.dash}</span>, sort: { value: (p) => p.invoiceNo } },
          { key: 'orderedOn', label: t.buy.orderedOn, cell: (p) => <span className="mono">{fmtDate(p.orderedOn)}</span>, sort: { value: (p) => p.orderedOn, first: 'desc' } },
          {
            key: 'invoiceTotal',
            label: t.buy.invoiceTotal,
            num: true,
            cell: (p) => <span className="mono">{fmtForeign(p.invoiceMinor, p.currency)}</span>,
            sort: { value: (p) => p.invoiceMinor, first: 'desc' },
          },
          {
            key: 'paid',
            label: t.buy.paidShare,
            num: true,
            cell: (p) => <span className="mono">{p.paidPercent} %</span>,
            sort: { value: (p) => p.paidPercent, first: 'desc' },
          },
          {
            key: 'debt',
            label: t.buy.debt,
            num: true,
            cell: (p) =>
              p.debtMinor > 0 && p.status !== 'cancelled' ? (
                <span className="mono crit-text">{fmtForeign(p.debtMinor, p.currency)}</span>
              ) : (
                <span className="muted">{t.common.dash}</span>
              ),
            sort: { value: (p) => p.debtMinor, first: 'desc' },
          },
          { key: 'status', label: t.buy.status, cell: (p) => <span className="muted">{t.buy.statuses[statusOf(p)]}</span>, sort: { value: (p) => statusOf(p) } },
        ]}
      />
    </>
  );
}

/** A line as it is being typed: one of a model, a catalogue part, or words. */
interface LineDraft {
  key: string;
  kind: 'model' | 'part';
  modelId: string;
  partId: string;
  partName: string;
  qty: string;
  price: string;
}

/** The whole panel as it is being filled in, drafts and all. */
interface OrderDraft {
  supplierId: string;
  invoiceNo: string;
  invoiceDate: string;
  currency: string;
  orderedOn: string;
  extras: string;
  extrasNote: string;
  lines: LineDraft[];
}

const NEW_SUPPLIER = '__new_supplier__';

let nextLineKey = 1;
const emptyLine = (): LineDraft => ({ key: `l${nextLineKey++}`, kind: 'model', modelId: '', partId: '', partName: '', qty: '1', price: '' });

/**
 * The line a new order starts with, and its key is fixed: an untouched form
 * has to compare equal to itself, or every open panel would leave a draft
 * behind and every Escape would ask whether to keep it.
 */
const blankPurchase = (supplierId = ''): OrderDraft => ({
  supplierId,
  invoiceNo: '',
  invoiceDate: '',
  currency: 'CNY',
  orderedOn: todayISO(),
  extras: '',
  extrasNote: '',
  lines: [{ key: 'l0', kind: 'model', modelId: '', partId: '', partName: '', qty: '1', price: '' }],
});

/** What a line comes to on the invoice, in the invoice's minor units. */
function lineMinor(l: LineDraft): number {
  const price = parseGel(l.price);
  const qty = Number(l.qty);
  if (price == null || !Number.isFinite(qty)) return 0;
  return Math.max(0, Math.round(qty)) * price;
}

const named = (l: LineDraft) => (l.kind === 'model' ? l.modelId !== '' : l.partId !== '' || l.partName.trim() !== '');

/**
 * Новый заказ (§3.4). Everything the invoice says, on one panel: the factory
 * — or a factory made here and now, because a supplier is remembered the
 * moment somebody orders from it (S1) — the invoice, and the lines.
 *
 * `supplier` fixes the factory: opened from a supplier's own card the field
 * is already answered, and the panel is about the invoice.
 */
export function NewPurchase({ supplier, onDone }: { supplier?: { id: string; name: string }; onDone: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const suppliers = useLoad<{ suppliers: Supplier[] }>(open && !supplier ? '/api/suppliers' : null);
  const models = useLoad<{ models: { id: string; brand: string; name: string }[] }>(open ? '/api/models' : null);
  const parts = useLoad<{ parts: { id: string; name: string }[] }>(open ? '/api/parts' : null);
  const [f, setF] = useState(() => blankPurchase(supplier?.id));
  const [addingSupplier, setAddingSupplier] = useState(false);
  const navigate = useNavigate();
  /** The order just written, to open once the sheet has closed itself. */
  const made = useRef<string | null>(null);
  // Which line asked for a model that is not in the catalogue yet (ADR-0011).
  const [addingModel, setAddingModel] = useState<string | null>(null);

  const setLine = (key: string, patch: Partial<LineDraft>) => setF((v) => ({ ...v, lines: v.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const filled = f.lines.filter(named);
  const total = filled.reduce((n, l) => n + lineMinor(l), 0);

  const close = () => {
    setOpen(false);
    setAddingSupplier(false);
    setAddingModel(null);
  };

  return (
    <>
      <button type="button" className="pill pill-sm pill-accent" onClick={() => setOpen(true)}>
        + {t.buy.newOrder}
      </button>
      {open && (
        <FormSheet
          title={t.buy.newOrder}
          onClose={close}
          value={f}
          initial={blankPurchase(supplier?.id)}
          draft={supplier ? `purchase-new:${supplier.id}` : 'purchase-new'}
          onRestore={setF}
          summary={(v) => [v.invoiceNo, v.currency].filter(Boolean).join(' · ')}
          label={t.buy.createFor(fmtForeign(total, f.currency))}
          submit={async (key) => {
            // An order with no lines has no invoice total and nothing to
            // receive; it is refused here rather than made and then edited.
            if (filled.length === 0) throw new ApiError(400, 'missing_field', t.buy.needLine, { field: 'lines', fieldText: t.buy.needLine });
            // A price that does not read as money would arrive as «no price»
            // and be refused by field name; said here, it names the lines.
            if (filled.some((l) => parseGel(l.price) == null)) throw new ApiError(400, 'bad_field', t.buy.needPrice, { field: 'lines', fieldText: t.buy.needPrice });
            const purchase = await api.post<{ id: string }>(
              '/api/purchases',
              {
                supplierId: f.supplierId,
                invoiceNo: f.invoiceNo || null,
                invoiceDate: f.invoiceDate || null,
                currency: f.currency,
                orderedOn: f.orderedOn,
                extrasTetri: f.extras ? parseGel(f.extras) : 0,
                extrasNote: f.extrasNote || null,
                lines: filled.map((l) => ({
                  modelId: l.kind === 'model' ? l.modelId : null,
                  partId: l.kind === 'part' && l.partId ? l.partId : null,
                  partName: l.kind === 'part' && !l.partId ? l.partName.trim() : null,
                  qty: Number(l.qty) || 1,
                  // The seller's own price, in the seller's own currency.
                  unitPrice: l.price,
                })),
              },
              { key },
            );
            made.current = purchase.id;
            return { toast: { text: t.buy.created } };
          }}
          onDone={() => {
            setF(blankPurchase(supplier?.id));
            onDone();
            // Creating opens the record (crit. 10, UX 4): the point of an
            // order is what happens on it next — pay, receive, correct the
            // logistics — and none of that is in the list it was made from.
            if (made.current) navigate(`/purchases/${made.current}`);
          }}
        >
          <Field label={t.buy.supplier} name="supplierId">
            {supplier ? (
              <input className="input" value={supplier.name} readOnly />
            ) : (
              <select
                className="input"
                value={f.supplierId}
                onChange={(e) => (e.target.value === NEW_SUPPLIER ? setAddingSupplier(true) : setF({ ...f, supplierId: e.target.value }))}
                required
              >
                <option value="">{t.common.dash}</option>
                {(suppliers.data?.suppliers ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
                <option value={NEW_SUPPLIER}>+ {t.buy.newSupplier}</option>
              </select>
            )}
          </Field>

          <div className="two-col">
            <Field label={t.buy.invoiceNo} name="invoiceNo">
              <input className="input" value={f.invoiceNo} onChange={(e) => setF({ ...f, invoiceNo: e.target.value })} />
            </Field>
            <Field label={t.buy.invoiceDate} name="invoiceDate">
              <input className="input mono" type="date" value={f.invoiceDate} onChange={(e) => setF({ ...f, invoiceDate: e.target.value })} />
            </Field>
            <Field label={t.buy.currency} name="currency">
              <input className="input input-amount mono" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} maxLength={3} />
            </Field>
            <Field label={t.buy.orderedOn} name="orderedOn">
              <input className="input mono" type="date" value={f.orderedOn} onChange={(e) => setF({ ...f, orderedOn: e.target.value })} />
            </Field>
          </div>

          <div className="field" data-field="lines">
            <span className="lbl">{t.buy.lines}</span>
            <div className="buy-lines">
              {f.lines.map((l) => (
                <div className="buy-line" key={l.key}>
                  <div className="buy-line-what">
                    <select className="input" value={l.kind} aria-label={t.buy.what} onChange={(e) => setLine(l.key, { kind: e.target.value as LineDraft['kind'] })}>
                      <option value="model">{t.buy.kindModel}</option>
                      <option value="part">{t.buy.kindPart}</option>
                    </select>
                    {l.kind === 'model' ? (
                      <select
                        className="input"
                        value={l.modelId}
                        aria-label={t.buy.kindModel}
                        onChange={(e) => (e.target.value === NEW_MODEL ? setAddingModel(l.key) : setLine(l.key, { modelId: e.target.value }))}
                      >
                        <option value="">{t.buy.pickModel}</option>
                        {(models.data?.models ?? []).map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.brand} {m.name}
                          </option>
                        ))}
                        <option value={NEW_MODEL}>+ {t.buy.newModel}</option>
                      </select>
                    ) : (
                      <>
                        <select className="input" value={l.partId} aria-label={t.buy.kindPart} onChange={(e) => setLine(l.key, { partId: e.target.value, partName: '' })}>
                          <option value="">{t.buy.freeText}</option>
                          {(parts.data?.parts ?? []).map((pt) => (
                            <option key={pt.id} value={pt.id}>
                              {pt.name}
                            </option>
                          ))}
                        </select>
                        {!l.partId && <input className="input" placeholder={t.buy.freeTextName} value={l.partName} onChange={(e) => setLine(l.key, { partName: e.target.value })} />}
                      </>
                    )}
                  </div>
                  <div className="buy-line-nums">
                    <input
                      className="input input-amount mono"
                      inputMode="numeric"
                      aria-label={t.buy.qty}
                      placeholder={t.buy.qty}
                      value={l.qty}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })}
                    />
                    <input
                      className="input input-amount mono"
                      inputMode="decimal"
                      aria-label={t.buy.price(f.currency)}
                      placeholder={t.buy.price(f.currency)}
                      value={l.price}
                      onChange={(e) => setLine(l.key, { price: e.target.value })}
                    />
                    <span className="mono buy-line-sum">{fmtForeign(lineMinor(l), f.currency)}</span>
                    {f.lines.length > 1 && (
                      <button type="button" className="pill pill-sm" aria-label={t.buy.removeLine} onClick={() => setF({ ...f, lines: f.lines.filter((x) => x.key !== l.key) })}>
                        ✕
                      </button>
                    )}
                  </div>
                  {/* On the invoice and nowhere else: a part typed rather than
                      picked lands on no shelf, and it says so while there is
                      still time to pick one (B8-03). */}
                  {l.kind === 'part' && !l.partId && l.partName.trim() !== '' && <p className="buy-note">{t.buy.notOnShelf(l.partName.trim())}</p>}
                </div>
              ))}
            </div>
            <button type="button" className="pill pill-sm" onClick={() => setF({ ...f, lines: [...f.lines, emptyLine()] })}>
              + {t.buy.addLine}
            </button>
          </div>

          <div className="two-col">
            <Field label={t.buy.extras} hint={t.buy.extrasHint} name="extrasTetri">
              <input className="input input-amount mono" value={f.extras} onChange={(e) => setF({ ...f, extras: e.target.value })} inputMode="decimal" />
            </Field>
            <Field label={t.buy.extrasNote} name="extrasNote">
              <input className="input" value={f.extrasNote} onChange={(e) => setF({ ...f, extrasNote: e.target.value })} />
            </Field>
          </div>
        </FormSheet>
      )}

      {addingSupplier && (
        <SupplierDrawer
          onClose={() => setAddingSupplier(false)}
          onSaved={(s) => {
            setAddingSupplier(false);
            suppliers.reload();
            setF((v) => ({ ...v, supplierId: s.id }));
          }}
        />
      )}
      {addingModel && (
        <ModelDrawer
          brands={(models.data?.models ?? []).map((m) => m.brand)}
          onClose={() => setAddingModel(null)}
          onSaved={(m) => {
            const line = addingModel;
            setAddingModel(null);
            models.reload();
            setLine(line, { kind: 'model', modelId: m.id });
          }}
        />
      )}
    </>
  );
}

/**
 * «+ Новый поставщик» (§3.4, B3-04, S1). Three things — the name, the country
 * and whoever answers there — because that is all an order needs and all the
 * card has room for. A name already on the books is said out loud rather than
 * refused: two factories really can share one, and only a person knows.
 */
export function SupplierDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: (s: { id: string; name: string }) => void }) {
  const t = useT();
  const initial = { name: '', country: '', contact: '', phone: '', force: false };
  const [f, setF] = useState(initial);
  const [twin, setTwin] = useState<string | null>(null);

  return (
    <FormSheet
      title={t.buy.supplierTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      draft="supplier-new"
      onRestore={setF}
      summary={(v) => v.name}
      label={t.buy.newSupplier}
      fieldOf={{ duplicate_supplier: 'name' }}
      submit={async (key) => {
        setTwin(null);
        try {
          const made = await api.post<{ id: string; name: string }>(
            '/api/suppliers',
            { name: f.name.trim(), country: f.country.trim() || null, contact: f.contact.trim() || null, phone: f.phone.trim() || null, force: f.force },
            { key },
          );
          onSaved(made);
          return { toast: { text: t.buy.supplierSaved } };
        } catch (e) {
          if (e instanceof ApiError && e.code === 'duplicate_supplier') {
            const existing = e.extra.existing as { name?: string } | undefined;
            setTwin(existing?.name ?? f.name.trim());
          }
          throw e;
        }
      }}
    >
      <Field label={t.buy.supplierName} name="name">
        <input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, force: false })} maxLength={200} required autoFocus />
      </Field>
      {twin && (
        <>
          <p className="buy-note">{t.buy.supplierTwin(twin)}</p>
          <label className="check">
            <input type="checkbox" checked={f.force} onChange={(e) => setF({ ...f, force: e.target.checked })} />
            <span>{t.buy.supplierForce}</span>
          </label>
        </>
      )}
      <div className="two-col">
        <Field label={t.buy.supplierCountry} name="country">
          <input className="input" value={f.country} onChange={(e) => setF({ ...f, country: e.target.value })} maxLength={200} />
        </Field>
        <Field label={t.buy.supplierPhone} name="phone">
          <input className="input mono" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={40} inputMode="tel" />
        </Field>
      </div>
      <Field label={t.buy.supplierContact} hint={t.buy.supplierContactHint} name="contact">
        <input className="input" value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} maxLength={1000} />
      </Field>
    </FormSheet>
  );
}
