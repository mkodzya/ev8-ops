import { VEHICLE_COLORS, VEHICLE_POOLS, checkVinList, parseGel, todayISO, type VehicleState, type VinFault } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { LoadError } from '../components/LoadError.js';
import { ModelDrawer, NEW_MODEL } from '../components/ModelDrawer.js';
import { ColorPicker } from '../components/ColorPicker.js';
import { RowMenu } from '../components/RowMenu.js';
import { FormSheet, SubmitButton } from '../ds/form/Form.js';
import { useOperation } from '../ds/form/operation.js';
import { useToast } from '../ds/feedback/Toast.js';
import { BlockHead, Empty, Loading, PageHead, StateBadge, Vin } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { fmtDate, formatForeign, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { noteWords } from '../lib/journal.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import { fmtRate, statusOf, type Purchase, type PurchaseLine } from './PurchasesPage.js';

// Карточка заказа (wave 5 §3.5–3.6). Two currencies on one screen: the
// invoice is the factory's, the money that left the bank is ours, and the
// rate between them is not a figure anybody types — it is what the payments
// worked out to. Until the invoice is settled every cost here is preliminary
// and says so, because the mopeds are already out earning (§7).

interface Card {
  purchase: Purchase;
  vehicles: { id: string; vin: string; state: VehicleState; costTetri: number | null; model: string }[];
  /** Corrections to the order: logistics, a recost, money stated as paid before. */
  journal: { id: string; at: string; occurredOn: string | null; action: string; by: string | null; note: string | null; after: unknown }[];
}

type JournalRow = Card['journal'][number];

type Sheet = 'receive' | 'extras' | 'paidBefore' | 'cancel';

export function PurchasePage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, failure, reload } = useLoad<Card>(id ? `/api/purchases/${id}` : null);
  const mayManage = can('purchases.manage');
  const models = useLoad<{ models: { id: string; brand: string; name: string }[] }>(mayManage ? '/api/models' : null);
  const parts = useLoad<{ parts: { id: string; name: string }[] }>(mayManage ? '/api/parts' : null);
  const [line, setLine] = useState({ modelId: '', partId: '', partName: '', qty: '1', price: '', asPart: false });
  const openMoney = useMoneyForm();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  // Lines are added and removed in place; one operation at a time, its refusal under the lines.
  const lineOp = useOperation();
  const toast = useToast();
  // The model on the invoice may not be in the catalogue yet; it is made
  // here, over the order, rather than by leaving a half-typed line behind.
  const [addingModel, setAddingModel] = useState(false);

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const p = data.purchase;
  const open = p.status === 'ordered';
  const live = p.status !== 'cancelled';
  const mayEdit = open && mayManage;
  const owner = can('deposit.decide');
  const state = statusOf(p);
  // The debt is what keeps «Оплатить поставщику» on the screen — the shipment
  // having arrived does not settle it (B8-01, crit. 19).
  const owing = live && p.debtMinor > 0;

  const act = async (fn: (key: string) => Promise<unknown>, scope = 'add') => {
    const res = await lineOp.run(fn, scope);
    if (res.ok) reload();
  };
  const done = () => {
    setSheet(null);
    reload();
  };

  const menu = [
    ...(live && owner ? [{ key: 'paidBefore', label: t.orderCard.menu.paidBefore, onPick: () => setSheet('paidBefore') }] : []),
    ...(open && mayManage ? [{ key: 'cancel', label: t.orderCard.menu.cancel, onPick: () => setSheet('cancel') }] : []),
  ];

  return (
    <>
      <PageHead
        wrap
        title={p.number}
        sub={p.invoiceNo ? `${p.supplier.name} · ${p.invoiceNo}` : p.supplier.name}
        badge={<span className={owing ? 'crit-text' : 'muted'}>{t.buy.statuses[state]}</span>}
      >
        {owing && can('payments.reconcile') && (
          <button
            type="button"
            className="pill pill-sm"
            onClick={() => openMoney({ target: { kind: 'supplier', purchaseId: p.id, number: p.number, customerId: p.supplier.id, customer: p.supplier.name } })}
          >
            {t.orderCard.pay}
          </button>
        )}
        {mayEdit && p.lines.length > 0 && (
          <button type="button" className="pill pill-sm pill-accent" onClick={() => setSheet('receive')}>
            {t.orderCard.receive}
          </button>
        )}
        <RowMenu actions={menu} />
      </PageHead>

      <div className="num-strip">
        <span className="num">
          <span className="num-v">{formatForeign(p.invoiceMinor, p.currency)}</span>
          <span className="num-l">{t.orderCard.invoice}</span>
        </span>
        <span className="num">
          <span className="num-v">{formatGel(p.paidTetri, { decimals: false })}</span>
          <span className="num-l">{p.paidTetri > 0 ? t.orderCard.paidOf(p.paidPercent) : t.orderCard.paidNothing}</span>
        </span>
        <span className={`num ${owing ? 'num-crit' : ''}`}>
          <span className="num-v">{formatForeign(p.debtMinor, p.currency)}</span>
          <span className="num-l">{t.orderCard.debt}</span>
        </span>
        <span className="num">
          <span className="num-v">{p.rate == null ? t.common.dash : fmtRate(p.rate)}</span>
          <span className="num-l">{p.rate == null ? t.orderCard.rateNone : t.orderCard.rateUnit(p.currency)}</span>
        </span>
      </div>

      <div className="two-col">
        <section className="card">
          <Row k={t.buy.supplier} v={<Link to={`/purchases/suppliers/${p.supplier.id}`}>{p.supplier.name}</Link>} />
          <Row k={t.orderCard.invoiceNo} v={p.invoiceNo ?? t.common.dash} />
          <Row k={t.orderCard.invoiceDate} v={<span className="mono">{fmtDate(p.invoiceDate)}</span>} />
          <Row k={t.orderCard.orderedOn} v={<span className="mono">{fmtDate(p.orderedOn)}</span>} />
          <Row k={t.orderCard.receivedOn} v={<span className="mono">{fmtDate(p.receivedOn)}</span>} />
          {p.notes && <Row k={t.orderCard.notes} v={<span className="pre">{p.notes}</span>} />}
        </section>
        <section className="card">
          <Row
            k={t.orderCard.paid}
            v={
              <span className="mono">
                {formatGel(p.paidTetri)}
                {p.paidMinor > 0 && <> = {formatForeign(p.paidMinor, p.currency)}</>} · {p.paidPercent} %
              </span>
            }
          />
          {p.paidBeforeTetri > 0 && (
            <Row
              k={t.orderCard.paidBeforeTitle}
              v={
                <span className="mono">
                  {formatGel(p.paidBeforeTetri)} = {formatForeign(p.paidBeforeMinor, p.currency)} · {fmtDate(p.paidBeforeOn)}
                </span>
              }
            />
          )}
          <Row
            k={t.orderCard.rate}
            v={p.rate == null ? <span className="muted">{t.orderCard.rateNone}</span> : <span className="mono">{fmtRate(p.rate)} {t.orderCard.rateUnit(p.currency)}</span>}
          />
          {/* Logistics move the cost of every moped in the shipment, so they
              are changed here and the change is journalled (B8-03, crit. 13). */}
          <Row
            k={t.orderCard.extras}
            v={
              <span className="buy-extras-v">
                <span className="mono">{formatGel(p.extrasTetri)}</span>
                {live && mayManage && (
                  <button type="button" className="pill pill-sm" onClick={() => setSheet('extras')}>
                    {t.orderCard.extrasEdit}
                  </button>
                )}
              </span>
            }
          />
          {p.extrasNote && <Row k={t.orderCard.extrasNote} v={<span className="muted">{p.extrasNote}</span>} />}
        </section>
      </div>

      <section className="card">
        <BlockHead title={t.orderCard.lines} sub={t.orderCard.linesCount(p.lines.length)} />
        {p.lines.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <div className="table-wrap table-flat">
            {/* Five money columns with long names: the headings wrap so the
                numbers fit the card instead of scrolling out of it. */}
            <table className="table table-heads-wrap">
              <thead>
                <tr>
                  <th>{t.orderCard.what}</th>
                  <th className="num nowrap">{t.orderCard.qty}</th>
                  <th className="num">{t.orderCard.price(p.currency)}</th>
                  <th className="num">{t.orderCard.lineTotal(p.currency)}</th>
                  <th className="num">{t.orderCard.unitCost}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {p.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <LineName line={l} />
                    </td>
                    <td className="num mono">{l.qty}</td>
                    <td className="num mono">{formatForeign(l.unitPriceMinor, p.currency)}</td>
                    <td className="num mono">{formatForeign(l.lineMinor, p.currency)}</td>
                    {/* «≈» is not decoration: until the factory is paid in full
                        this number is worked out at the rate so far (§7). */}
                    <td className="num mono">
                      {p.preliminary && <span className="muted">≈ </span>}
                      {formatGel(l.unitCostTetri)}
                    </td>
                    <td className="num">
                      {mayEdit && (
                        <button
                          type="button"
                          className="pill pill-sm"
                          aria-label={t.buy.removeLine}
                          onClick={() => void act((key) => api.del(`/api/purchases/${p.id}/lines/${l.id}`, { key }), `del:${l.id}`)}
                        >
                          ✕
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {p.lines.length > 0 && <p className="hint muted">{p.preliminary ? t.orderCard.preliminary(p.paidPercent) : t.orderCard.settled}</p>}
        {mayEdit && (
          <div className="row-actions">
            {line.asPart ? (
              <>
                {/* A line that names a part from the catalogue lands on the
                    shelf when the shipment arrives; a typed one does not. */}
                <select className="input input-inline" aria-label={t.buy.kindPart} value={line.partId} onChange={(e) => setLine({ ...line, partId: e.target.value, partName: '' })}>
                  <option value="">{t.buy.freeText}</option>
                  {(parts.data?.parts ?? []).map((pt) => (
                    <option key={pt.id} value={pt.id}>
                      {pt.name}
                    </option>
                  ))}
                </select>
                {!line.partId && (
                  <input className="input input-inline" placeholder={t.buy.freeTextName} value={line.partName} onChange={(e) => setLine({ ...line, partName: e.target.value })} />
                )}
              </>
            ) : (
              <select
                className="input input-inline"
                aria-label={t.buy.kindModel}
                value={line.modelId}
                onChange={(e) => (e.target.value === NEW_MODEL ? setAddingModel(true) : setLine({ ...line, modelId: e.target.value }))}
              >
                <option value="">{t.buy.pickModel}</option>
                {(models.data?.models ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.brand} {m.name}
                  </option>
                ))}
                <option value={NEW_MODEL}>+ {t.buy.newModel}</option>
              </select>
            )}
            <input className="input input-amount mono" placeholder={t.buy.qty} value={line.qty} onChange={(e) => setLine({ ...line, qty: e.target.value })} inputMode="numeric" />
            <input
              className="input input-amount mono"
              placeholder={t.buy.price(p.currency)}
              value={line.price}
              onChange={(e) => setLine({ ...line, price: e.target.value })}
              inputMode="decimal"
            />
            <label className="check">
              <input type="checkbox" checked={line.asPart} onChange={(e) => setLine({ ...line, asPart: e.target.checked })} />
              <span>{t.buy.kindPart}</span>
            </label>
            <SubmitButton
              small
              type="button"
              state={lineOp.state}
              label={`+ ${t.buy.addLine}`}
              onClick={() =>
                void act(async (key) => {
                  await api.post(
                    `/api/purchases/${p.id}/lines`,
                    {
                      modelId: line.asPart ? null : line.modelId || null,
                      partId: line.asPart && line.partId ? line.partId : null,
                      partName: line.asPart && !line.partId ? line.partName : null,
                      qty: Number(line.qty) || 1,
                      unitPrice: parseGel(line.price),
                    },
                    { key },
                  );
                  setLine({ ...line, partName: '', partId: '', qty: '1', price: '' });
                  toast({ text: t.orderCard.saved });
                })
              }
            />
          </div>
        )}
        {mayEdit && lineOp.failure && (
          <p className="field-err" role="alert">
            {lineOp.failure.fieldText ?? lineOp.failure.text}
          </p>
        )}
      </section>

      {data.vehicles.length > 0 && (
        <section className="card">
          <BlockHead title={t.orderCard.vehicles} sub={t.fleet.count(data.vehicles.length)} />
          <div className="table-wrap table-flat">
            <table className="table">
              <thead>
                <tr>
                  <th>{t.fleet.vin}</th>
                  <th>{t.fleet.model}</th>
                  <th>{t.fleet.state}</th>
                  <th className="num">{t.orderCard.cost}</th>
                </tr>
              </thead>
              <tbody>
                {data.vehicles.map((v) => (
                  <tr key={v.id}>
                    <td>
                      <Link to={`/fleet/${v.id}`}>
                        <Vin vin={v.vin} />
                      </Link>
                    </td>
                    <td>{v.model}</td>
                    <td>
                      <StateBadge state={v.state} />
                    </td>
                    <td className="num mono">
                      {p.preliminary && <span className="muted">≈ </span>}
                      {formatGel(v.costTetri)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <Feed purchase={p} vehicles={data.vehicles.length} journal={data.journal} />

      {sheet === 'receive' && mayEdit && <ReceiveSheet purchase={p} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === 'extras' && <ExtrasSheet purchase={p} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === 'paidBefore' && <PaidBeforeSheet purchase={p} onClose={() => setSheet(null)} onDone={done} />}
      {sheet === 'cancel' && <CancelSheet purchase={p} onClose={() => setSheet(null)} onDone={done} />}

      {addingModel && (
        <ModelDrawer
          brands={(models.data?.models ?? []).map((m) => m.brand)}
          onClose={() => setAddingModel(false)}
          onSaved={(m) => {
            setAddingModel(false);
            models.reload();
            setLine((l) => ({ ...l, modelId: m.id, asPart: false }));
          }}
        />
      )}
    </>
  );
}

/** What the line bought, and — for a part nobody picked — where it will not go. */
function LineName({ line }: { line: PurchaseLine }) {
  const t = useT();
  if (line.model) return <>{line.model.name}</>;
  if (line.partId) return <Link to={`/stock/parts/${line.partId}`}>{line.partName}</Link>;
  return (
    <>
      <span className="muted">{line.partName}</span> <span className="buy-note-inline">{t.buy.notOnShelfShort}</span>
    </>
  );
}

/**
 * Лента заказа (§3.5). Built from what the card carries — the day it was
 * placed, the payments, the money carried over, the day the shipment landed
 * — plus the order's own journal, so a correction of the logistics or a cost
 * worked out again is visible where it happened (crit. 13, 19 — QA-W5-01).
 */
/**
 * Journal entries the feed already tells from the order itself. The order
 * was created, the shipment arrived, money was stated as paid before the
 * move: each of those has its own row, on the day it happened. The journal
 * knows the same events, but only the day somebody wrote them down — so the
 * pair read as two events and the journal's half sat on the wrong date
 * (QA-W5-22). What is left is what nothing else shows: a correction.
 */
const TOLD_ALREADY = new Set(['purchase.create', 'purchase.receive', 'purchase.paid_before']);

function Feed({ purchase: p, vehicles, journal }: { purchase: Purchase; vehicles: number; journal: JournalRow[] }) {
  const t = useT();
  const rows: { at: string; text: string; amount?: string; note?: string }[] = [
    ...journal
      .filter((l) => !TOLD_ALREADY.has(l.action) && !l.action.startsWith('payment.'))
      .map((l) => ({
        at: l.occurredOn ?? p.orderedOn,
        text: t.feedWords[l.action] ?? l.action,
        amount: recostUnits(l.after) ?? undefined,
        note: [noteWords(t, l.note), l.by].filter(Boolean).join(' · ') || undefined,
      })),
    { at: p.orderedOn, text: t.orderCard.words.created, amount: formatForeign(p.invoiceMinor, p.currency) },
    ...p.payments
      .filter((x) => x.direction === 'out')
      .map((x) => ({
        at: x.occurredOn,
        text: t.orderCard.words.payment,
        amount: formatGel(x.grossTetri),
        note: x.foreignMinor > 0 ? formatForeign(x.foreignMinor, x.foreignCurrency ?? p.currency) : t.money.how[x.channel],
      })),
    ...(p.paidBeforeTetri > 0 && p.paidBeforeOn
      ? [{ at: p.paidBeforeOn, text: t.orderCard.words.paidBefore, amount: formatGel(p.paidBeforeTetri), note: formatForeign(p.paidBeforeMinor, p.currency) }]
      : []),
    ...(p.receivedOn ? [{ at: p.receivedOn, text: t.orderCard.words.received, note: vehicles > 0 ? t.orderCard.feedUnits(vehicles) : undefined }] : []),
  ].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));

  return (
    <section className="card">
      <div className="queue-head">
        <h2>{t.orderCard.feed}</h2>
      </div>
      {rows.length === 0 ? (
        <Empty text={t.common.dash} />
      ) : (
        <ul className="timeline">
          {rows.map((row, i) => (
            <li key={`${row.at}-${i}`}>
              <span className="mono muted">{fmtDate(row.at)}</span>
              <span>
                <span>{row.text}</span>
                {row.amount && <span className="mono"> · {row.amount}</span>}
                {row.note && <span className="muted"> · {row.note}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Пересчитана себестоимость" says how many mopeds and parts it moved. */
function recostUnits(after: unknown): string | null {
  if (!after || typeof after !== 'object') return null;
  const a = after as { vehicles?: unknown; parts?: unknown };
  const n = (typeof a.vehicles === 'number' ? a.vehicles : 0) + (typeof a.parts === 'number' ? a.parts : 0);
  return n > 0 ? String(n) : null;
}

/** One VIN of the paste, as the screen has judged it. */
interface VinRow {
  line: number;
  vin: string;
  fault: VinFault | null;
}

/** What a single moped may be told that the rest of the shipment is not (B8-02). */
interface ReceiptRow {
  color: string;
  year: string;
  pool: string;
  locationId: string;
}

interface ReceiptForm {
  receivedOn: string;
  color: string;
  year: string;
  pool: string;
  locationId: string;
  /** The paste of each model line, by line id — kept as typed. */
  vins: Record<string, string>;
  /** Corrections, by VIN: a row absent here takes the shipment's answers. */
  rows: Record<string, ReceiptRow>;
}

/**
 * Приёмка партии (§3.6). The VINs come off the CMR by the listful, and every
 * one of them is judged here, by line number, before anything is sent — the
 * same rule the API applies, so nobody meets it for the first time as a
 * refusal (`packages/shared/src/vin.ts`, crit. 14, 15).
 *
 * Colour, year, park and point are one answer for the whole shipment, with a
 * row corrected where a moped differs (B8-02). A shipment may be taken in at
 * any state of payment; what it cost is then preliminary and says so (§7).
 */
function ReceiveSheet({ purchase: p, onClose, onDone }: { purchase: Purchase; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const locations = useLoad<{ locations: { id: string; name: string }[] }>('/api/locations');
  // Every VIN the fleet already holds: a repeat stops the whole receipt, and
  // it is better seen while typing than met as a refusal (crit. 15).
  const fleet = useLoad<{ vehicles: { vin: string }[] }>('/api/fleet');
  const initial: ReceiptForm = { receivedOn: todayISO(), color: '', year: '', pool: '', locationId: '', vins: {}, rows: {} };
  const [f, setF] = useState(initial);
  const [perRow, setPerRow] = useState(false);

  const modelLines = p.lines.filter((l) => l.model);
  const partLines = p.lines.filter((l) => l.partId);
  const known = (fleet.data?.vehicles ?? []).map((v) => v.vin);

  // Judged in the order the boxes are read, so a VIN pasted twice into two
  // different lines is caught as the repeat it is and not as a stranger.
  const seen = new Set<string>();
  const checked = modelLines.map((l) => {
    const rows: VinRow[] = checkVinList(f.vins[l.id] ?? '', known).map((c) => {
      const fault = c.fault ?? (seen.has(c.vin) ? ('duplicate' as VinFault) : null);
      seen.add(c.vin);
      return { line: c.line, vin: c.vin, fault };
    });
    return { line: l, rows };
  });

  const faultText = (row: VinRow): string =>
    row.fault === 'length'
      ? t.receipt.badLength(row.line, row.vin.length)
      : row.fault === 'letters'
        ? t.receipt.badLetters(row.line)
        : row.fault === 'known'
          ? t.receipt.badKnown(row.line, row.vin)
          : t.receipt.badDuplicate(row.line);

  // Only the VINs that would actually be received: a 16-character line is
  // not a moped, and "Мопедов 2 из 2" over one good VIN was a lie (QA-W5-09).
  const givenUnits = checked.reduce((n, c) => n + c.rows.filter((r) => !r.fault).length, 0);
  const wantedUnits = modelLines.reduce((n, l) => n + l.qty, 0);
  const partQty = partLines.reduce((n, l) => n + l.qty, 0);
  const allRows = checked.flatMap((c) => c.rows);
  const rowOf = (vin: string): ReceiptRow => f.rows[vin] ?? { color: '', year: '', pool: '', locationId: '' };
  const setRow = (vin: string, patch: Partial<ReceiptRow>) => setF((v) => ({ ...v, rows: { ...v.rows, [vin]: { ...rowOf(vin), ...patch } } }));

  return (
    <FormSheet
      title={t.receipt.title(p.number)}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={`purchase-receive:${p.id}`}
      onRestore={setF}
      label={wantedUnits > 0 ? t.receipt.cta(givenUnits) : t.receipt.ctaParts}
      submit={async (key) => {
        // The refusals the screen can see are raised here, with the line
        // number in them, so the paste is corrected rather than resent.
        for (const { line, rows } of checked) {
          const bad = rows.find((r) => r.fault);
          // The line itself already carries this message, under the box, put
          // there while it was typed. Naming the field again replaced the
          // box's own label with a second copy of it (QA-W5-09), so the
          // refusal goes under the button, where a refusal goes.
          if (bad) throw new ApiError(400, 'bad_vin_line', faultText(bad));
          if (rows.length !== line.qty) {
            const text = t.receipt.countWrong(line.model!.name, line.qty, rows.length);
            throw new ApiError(400, 'vins_count', text, { field: 'vins', fieldText: text });
          }
        }
        await api.post(
          `/api/purchases/${p.id}/receive`,
          {
            receivedOn: f.receivedOn,
            color: f.color || null,
            year: f.year ? Number(f.year) : null,
            pool: f.pool || null,
            locationId: f.locationId || null,
            vins: Object.fromEntries(
              checked.map(({ line, rows }) => [
                line.id,
                rows.map((r) => {
                  const o = f.rows[r.vin];
                  // A row sent as a bare VIN takes the shipment's answers; an
                  // object is sent only where somebody corrected one.
                  if (!o || (!o.color && !o.year && !o.pool && !o.locationId)) return r.vin;
                  return {
                    vin: r.vin,
                    color: o.color || f.color || null,
                    year: o.year ? Number(o.year) : f.year ? Number(f.year) : null,
                    pool: o.pool || f.pool || null,
                    locationId: o.locationId || f.locationId || null,
                  };
                }),
              ]),
            ),
          },
          { key },
        );
        return { toast: { text: t.receipt.done } };
      }}
      onDone={onDone}
    >
      <Field label={t.receipt.receivedOn} name="receivedOn">
        <input className="input mono" type="date" value={f.receivedOn} onChange={(e) => setF({ ...f, receivedOn: e.target.value })} />
      </Field>

      <div>
        {modelLines.length === 0 ? (
          <p className="hint muted">{partQty > 0 ? t.receipt.partsToShelf : t.receipt.nothing}</p>
        ) : (
          // The first box carries the name the API's own refusals use, so a
          // refusal this screen did not foresee still lands on the paste.
          checked.map(({ line, rows }, i) => (
            <Field key={line.id} name={i === 0 ? 'vins' : undefined} label={t.receipt.vinsFor(line.model!.name, line.qty)} hint={t.receipt.vins}>
              <textarea
                className="input textarea mono"
                rows={Math.min(Math.max(line.qty, 2), 8)}
                value={f.vins[line.id] ?? ''}
                onChange={(e) => setF({ ...f, vins: { ...f.vins, [line.id]: e.target.value } })}
              />
              {rows
                .filter((r) => r.fault)
                .map((r) => (
                  <span className="field-err" key={r.line} role="alert">
                    {faultText(r)}
                  </span>
                ))}
            </Field>
          ))
        )}
      </div>

      {modelLines.length > 0 && (
        <>
          <p className="hint muted">{t.receipt.batch}</p>
          <ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} />
          <div className="two-col two-col-tight">
            <Field label={t.receipt.year} name="year">
              <input className="input input-amount mono" inputMode="numeric" maxLength={4} value={f.year} onChange={(e) => setF({ ...f, year: e.target.value })} />
            </Field>
            <Field label={t.receipt.pool} name="pool">
              <select className="input" value={f.pool} onChange={(e) => setF({ ...f, pool: e.target.value })}>
                <option value="">{t.pools.none}</option>
                {VEHICLE_POOLS.map((pool) => (
                  <option key={pool} value={pool}>
                    {t.pools[pool]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label={t.receipt.point} name="locationId">
            <select className="input" value={f.locationId} onChange={(e) => setF({ ...f, locationId: e.target.value })}>
              <option value="">{t.common.dash}</option>
              {(locations.data?.locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </Field>

          {allRows.length > 0 && (
            <>
              <button type="button" className="pill pill-sm" onClick={() => setPerRow(!perRow)}>
                {perRow ? t.receipt.perRowHide : t.receipt.perRow}
              </button>
              {perRow && (
                <div className="table-wrap table-flat">
                  <table className="table table-heads-wrap">
                    <thead>
                      <tr>
                        <th>{t.receipt.rowVin}</th>
                        <th>{t.models.color}</th>
                        <th className="num">{t.receipt.year}</th>
                        <th>{t.receipt.pool}</th>
                        <th>{t.receipt.point}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allRows.map((r, i) => (
                        <tr key={`${r.vin}-${i}`}>
                          <td className="mono">{r.vin}</td>
                          <td>
                            <select className="input input-inline" aria-label={t.models.color} value={rowOf(r.vin).color} onChange={(e) => setRow(r.vin, { color: e.target.value })}>
                              <option value="">{t.receipt.sameForAll}</option>
                              {VEHICLE_COLORS.map((c) => (
                                <option key={c} value={c}>
                                  {t.colors[c]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="num">
                            <input
                              className="input input-amount input-inline mono"
                              inputMode="numeric"
                              maxLength={4}
                              aria-label={t.receipt.year}
                              value={rowOf(r.vin).year}
                              onChange={(e) => setRow(r.vin, { year: e.target.value })}
                            />
                          </td>
                          <td>
                            <select className="input input-inline" aria-label={t.receipt.pool} value={rowOf(r.vin).pool} onChange={(e) => setRow(r.vin, { pool: e.target.value })}>
                              <option value="">{t.receipt.sameForAll}</option>
                              {VEHICLE_POOLS.map((pool) => (
                                <option key={pool} value={pool}>
                                  {t.pools[pool]}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              className="input input-inline"
                              aria-label={t.receipt.point}
                              value={rowOf(r.vin).locationId}
                              onChange={(e) => setRow(r.vin, { locationId: e.target.value })}
                            >
                              <option value="">{t.receipt.sameForAll}</option>
                              {(locations.data?.locations ?? []).map((l) => (
                                <option key={l.id} value={l.id}>
                                  {l.name}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="card card-quiet">
        <div className="queue-head">
          <h2>{t.receipt.summary}</h2>
        </div>
        {wantedUnits > 0 && (
          <Row
            k={t.receipt.units}
            v={<span className={`mono ${givenUnits === wantedUnits ? '' : 'crit-text'}`}>{t.receipt.ofTotal(givenUnits, wantedUnits)}</span>}
          />
        )}
        {partQty > 0 && <Row k={t.receipt.partsToShelf} v={<span className="mono">{partQty}</span>} />}
        <Row k={t.receipt.cost} v={<span className={p.preliminary ? 'warn-text' : 'muted'}>{p.preliminary ? t.receipt.costPreliminary(p.paidPercent) : t.receipt.costFinal}</span>} />
      </div>
    </FormSheet>
  );
}

/** Логистика и растаможка (§3.5): changing it re-costs every moped of the batch. */
function ExtrasSheet({ purchase: p, onClose, onDone }: { purchase: Purchase; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { extras: String(p.extrasTetri / 100), note: p.extrasNote ?? '' };
  const [f, setF] = useState(initial);
  return (
    <FormSheet
      title={t.orderCard.extras}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={`purchase-extras:${p.id}`}
      onRestore={setF}
      label={t.orderCard.extrasSave}
      submit={async (key) => {
        await api.patch(`/api/purchases/${p.id}`, { extrasTetri: parseGel(f.extras) ?? 0, extrasNote: f.note.trim() || null }, { key });
        return { toast: { text: t.orderCard.saved } };
      }}
      onDone={onDone}
    >
      <Field label={t.orderCard.extrasAmount} hint={t.orderCard.extrasHint} name="extrasTetri">
        <input className="input input-amount mono" inputMode="decimal" value={f.extras} onChange={(e) => setF({ ...f, extras: e.target.value })} autoFocus />
      </Field>
      <Field label={t.orderCard.extrasNote} name="extrasNote">
        <input className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={1000} />
      </Field>
    </FormSheet>
  );
}

/**
 * «Оплачено до переноса» (§3.5, B3-04). Money that went out before this
 * system existed: what left the account, what it bought at the factory, and
 * when. It is stated once and it is an owner's word for it.
 */
function PaidBeforeSheet({ purchase: p, onClose, onDone }: { purchase: Purchase; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = {
    amount: p.paidBeforeTetri ? String(p.paidBeforeTetri / 100) : '',
    foreign: p.paidBeforeMinor ? String(p.paidBeforeMinor / 100) : '',
    occurredOn: p.paidBeforeOn ?? '',
  };
  const [f, setF] = useState(initial);
  const gel = parseGel(f.amount);
  const minor = parseGel(f.foreign);
  // The same arithmetic the order will do: GEL that left over what they bought.
  const rate = gel != null && minor != null && minor > 0 ? Math.round((gel / minor) * 1e6) / 1e6 : null;

  return (
    <FormSheet
      title={t.orderCard.paidBeforeTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      draft={`purchase-paid-before:${p.id}`}
      onRestore={setF}
      label={t.orderCard.paidBeforeSave}
      submit={async (key) => {
        await api.post(
          `/api/purchases/${p.id}/paid-before`,
          { amountTetri: f.amount, foreignAmount: f.foreign, occurredOn: f.occurredOn || null },
          { key },
        );
        return { toast: { text: t.orderCard.saved } };
      }}
      onDone={onDone}
    >
      <Field label={t.orderCard.paidBeforeAmount} name="amountTetri">
        <input className="input input-amount mono" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus />
      </Field>
      <Field label={t.orderCard.paidBeforeForeign(p.currency)} name="foreignAmount">
        <input className="input input-amount mono" inputMode="decimal" value={f.foreign} onChange={(e) => setF({ ...f, foreign: e.target.value })} />
      </Field>
      {rate != null && <p className="hint muted">{t.orderCard.paidBeforeRate(fmtRate(rate))}</p>}
      <Field label={t.orderCard.paidBeforeOn} name="occurredOn">
        <input className="input mono" type="date" value={f.occurredOn} onChange={(e) => setF({ ...f, occurredOn: e.target.value })} />
      </Field>
      <p className="hint muted">{t.orderCard.paidBeforeHint}</p>
    </FormSheet>
  );
}

/** An order that never happened: only while no money has touched it. */
function CancelSheet({ purchase: p, onClose, onDone }: { purchase: Purchase; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <FormSheet
      title={t.orderCard.cancelTitle}
      onClose={onClose}
      value={reason}
      initial=""
      onRestore={setReason}
      label={t.orderCard.cancelTitle}
      submit={async (key) => {
        await api.post(`/api/purchases/${p.id}/cancel`, { reason: reason.trim() }, { key });
        return { toast: { text: t.orderCard.cancelled } };
      }}
      onDone={onDone}
    >
      <Field label={t.orderCard.cancelReason} name="reason">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
      </Field>
      <p className="hint muted">{t.orderCard.cancelNote}</p>
    </FormSheet>
  );
}
