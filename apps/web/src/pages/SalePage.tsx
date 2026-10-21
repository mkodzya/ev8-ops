import { isISODate, parseGel, redateSale, saleState, scheduleGap, todayISO, type ISODate } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../api.js';
import { LoadError } from '../components/LoadError.js';
import { KommoField } from '../components/Kommo.js';
import { RecordHistory } from '../components/RecordHistory.js';
import { RowMenu } from '../components/RowMenu.js';
import { SignScreen, signedAtText } from '../components/Documents.js';
import { Empty, Loading, PageHead, Vin } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { FormSheet } from '../ds/form/Form.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import type { Sale } from './SalesPage.js';

// One sale (wave 5 §3.2): what is owed now and what is still ahead, the
// schedule with its marks, the paper, and one timeline of everything that
// happened to it. The two money figures never mix — an instalment that has
// not fallen due is not a debt (Q21).

interface FeedRow {
  at: string;
  kind: 'payment' | 'document' | 'log';
  by: string | null;
  text: string;
  amountTetri: number | null;
  note: string | null;
}

interface SaleCard {
  sale: Sale & { aheadTetri: number; lateDays: number; transferred: boolean; paidBeforeTetri: number; kommoRef: string | null };
  /** The sale date on the signed sale document; null while nothing is signed (B4-06). */
  signedSoldOn: ISODate | null;
  documents: { id: string; docKind: string | null; signedAt: string | null; signedBy: string | null }[];
  feed: FeedRow[];
  payments: { id: string; occurredOn: string; channel: 'transfer' | 'acquiring' | 'cash'; direction: 'in' | 'out'; grossTetri: number }[];
}

export function SalePage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const [params, setParams] = useSearchParams();
  const { data, failure, reload } = useLoad<SaleCard>(id ? `/api/sales/${id}` : null);
  const [sheet, setSheet] = useState<'cancel' | 'schedule' | 'date' | null>(null);
  const [signing, setSigning] = useState(params.get('sign') === '1');
  const openMoney = useMoneyForm();

  if (failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const s = data.sale;
  const gap = scheduleGap(s.priceTetri, s.instalments);
  // The feed says what happened to the sale; who changed it is the block
  // below it (§3.8, crit. 17а).
  const feed = data.feed.filter((row) => row.kind !== 'log');
  const live = s.status === 'active';
  const owner = can('deposit.decide');
  const doc = data.documents.find((d) => d.docKind === 'sale') ?? null;
  const late = live && s.overdueTetri > 0;
  const badge = late ? t.saleCard.lateBy(s.lateDays) : t.sales.statuses[s.status];

  const menu = [
    ...(live && can('sales.manage') && s.vehicle
      ? [
          {
            key: 'buyback',
            label: t.saleCard.menu.buyback,
            onPick: () => openMoney({ target: { kind: 'buyback', saleId: s.id, number: s.number, customerId: s.customer.id, customer: s.customer.name } }),
          },
        ]
      : []),
    // The day it was entered on is not always the day it was sold (call of 21.10.2026).
    ...(live && owner ? [{ key: 'date', label: t.saleDate.menu, onPick: () => setSheet('date') }] : []),
    ...(live && owner ? [{ key: 'schedule', label: t.saleCard.menu.schedule, onPick: () => setSheet('schedule') }] : []),
    ...(live && can('sales.manage') ? [{ key: 'cancel', label: t.saleCard.menu.cancel, onPick: () => setSheet('cancel') }] : []),
  ];

  const closeSign = () => {
    setSigning(false);
    if (params.get('sign')) setParams({}, { replace: true });
  };

  return (
    <>
      <PageHead wrap title={s.number} sub={`${s.customer.name} · ${fmtDate(s.soldOn)}`} badge={<span className={late ? 'crit-text' : 'muted'}>{badge}</span>}>
        {live && can('cash.record') && (
          <button
            type="button"
            className="pill pill-sm pill-accent"
            onClick={() => openMoney({ target: { kind: 'sale', saleId: s.id, number: s.number, customerId: s.customer.id, customer: s.customer.name } })}
          >
            {t.saleCard.takeInstalment}
          </button>
        )}
        {s.customer.phone && (
          <a className="pill pill-sm" href={`tel:${s.customer.phone}`} aria-label={t.today.call}>
            ☎
          </a>
        )}
        <RowMenu actions={menu} />
      </PageHead>

      <div className="num-strip">
        <span className={`num ${late ? 'num-crit' : ''}`}>
          <span className="num-v">{formatGel(s.overdueTetri, { decimals: false })}</span>
          <span className="num-l">{t.saleCard.debt}</span>
        </span>
        <span className="num">
          <span className="num-v">{formatGel(s.aheadTetri, { decimals: false })}</span>
          <span className="num-l">{t.saleCard.ahead}</span>
        </span>
        <span className="num">
          <span className="num-v">{formatGel(s.priceTetri, { decimals: false })}</span>
          <span className="num-l">{t.saleCard.price}</span>
        </span>
        <span className="num">
          <span className="num-v">{formatGel(s.paidTetri, { decimals: false })}</span>
          <span className="num-l">{t.saleCard.paid}</span>
        </span>
      </div>

      <section className="card">
        <Row
          k={t.sell.moped}
          v={
            s.vehicle ? (
              <Link to={`/fleet/${s.vehicle.id}`}>
                <Vin vin={s.vehicle.vin} /> <span className="muted">{s.vehicle.model}</span>
              </Link>
            ) : (
              <span className="muted">{s.vinNote}</span>
            )
          }
        />
        <Row k={t.sell.buyer} v={<Link to={`/customers/${s.customer.id}`}>{s.customer.name}</Link>} />
        {s.extras && <Row k={t.sell.extras} v={s.extras} />}
        <Row k={t.sell.soldOn} v={<span className="mono">{fmtDate(s.soldOn)}</span>} />
        <Row k={t.saleCard.warranty} v={<span className="mono">{fmtDate(s.warrantyUntil)}</span>} />
        {s.transferred && <Row k={t.saleCard.transferred} v={t.saleCard.paidBefore(formatGel(s.paidBeforeTetri))} />}
        {s.boughtBackOn && <Row k={t.saleCard.menu.buyback} v={<span className="mono">{fmtDate(s.boughtBackOn)}</span>} />}
        {/* The front office's deal, one way only until the webhook tariff (B10-03). */}
        <Row k={t.kommo.label} v={<KommoField url={`/api/sales/${s.id}`} value={s.kommoRef ?? null} onDone={reload} />} />
      </section>

      <section className="card">
        <div className="queue-head">
          <h2>{t.saleCard.schedule}</h2>
          <span className="muted">{s.instalments.length}</span>
        </div>
        {/* A schedule that does not come to the price is allowed — somebody
            may be rounding a last instalment on purpose — but it is never
            allowed to be a surprise (crit. 4 of wave 5, QA-W6-13). The wizard
            says so before the sale is made; the card says so ever after. */}
        {gap !== 0 && <p className="warn-text">{gap > 0 ? t.sell.gapOver(formatGel(gap)) : t.sell.gapUnder(formatGel(-gap))}</p>}
        <div className="table-wrap table-flat">
          <table className="table">
            <thead>
              <tr>
                <th>{t.sell.seq}</th>
                <th>{t.sell.dueOn}</th>
                <th className="num">{t.sell.amount}</th>
                <th className="num">{t.saleCard.paid}</th>
                <th>{t.fleet.state}</th>
              </tr>
            </thead>
            <tbody>
              {s.instalments.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.seq}</td>
                  <td className="mono">{fmtDate(i.dueOn)}</td>
                  <td className="num mono">{formatGel(i.amountTetri)}</td>
                  <td className="num mono">{formatGel(i.paidTetri)}</td>
                  <td className={i.state === 'overdue' ? 'crit-text' : 'muted'}>{i.state === 'overdue' ? t.saleCard.lateBy(i.days) : t.saleCard.states[i.state]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="queue-head">
          <h2>{t.saleCard.documents}</h2>
          <span className={doc?.signedAt ? 'ok-text' : 'warn-text'}>{doc?.signedAt ? t.saleCard.signedOn(signedAtText(doc.signedAt)) : t.sell.unsigned}</span>
        </div>
        <div className="row-actions">
          <a className="pill pill-sm" href={`/api/sales/${s.id}/contract.pdf`} target="_blank" rel="noreferrer">
            {t.sell.document}
          </a>
          {!doc?.signedAt && can('sales.manage') && (
            <button type="button" className="pill pill-sm" onClick={() => setSigning(true)}>
              {t.sell.sign}
            </button>
          )}
        </div>
        {/* What the buyer signed does not change (B4-06): after the sale's
            date is put right the two disagree, and the card says so. */}
        {data.signedSoldOn && data.signedSoldOn !== s.soldOn && <p className="warn-text">{t.saleDate.paperDiffers(fmtDate(data.signedSoldOn))}</p>}
        <p className="hint muted">{t.sell.documentSub}</p>
      </section>

      <section className="card">
        <div className="queue-head">
          <h2>{t.saleCard.feed}</h2>
        </div>
        {feed.length === 0 ? (
          <Empty text={t.common.dash} />
        ) : (
          <ul className="timeline">
            {feed.map((row, i) => {
              // A payment's line names the way the money came in; everything
              // else is an action the journal already has words for.
              const channels: Record<string, string> = t.payments.channels;
              const word = row.kind === 'payment' ? (channels[row.text] ?? t.saleCard.words[row.text] ?? row.text) : (t.saleCard.words[row.text] ?? t.feedWords[row.text] ?? row.text);
              return (
                <li key={`${row.at}-${i}`}>
                  <span className="mono muted">{fmtDate(row.at)}</span>
                  <span>
                    <span>{word}</span>
                    {row.amountTetri != null && <span className="mono"> · {formatGel(row.amountTetri)}</span>}
                    {row.note && <span className="muted"> · {row.note}</span>}
                    {row.by && <span className="muted"> · {row.by}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {sheet === 'cancel' && (
        <CancelSheet
          id={s.id}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            reload();
          }}
        />
      )}
      <RecordHistory kind="sale" id={s.id} search={s.number} />

      {sheet === 'schedule' && (
        <ScheduleSheet
          id={s.id}
          priceTetri={s.priceTetri}
          rows={s.instalments.map((i) => ({ dueOn: i.dueOn, amount: String(i.amountTetri / 100) }))}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            reload();
          }}
        />
      )}
      {sheet === 'date' && (
        <DateSheet
          sale={s}
          signedSoldOn={data.signedSoldOn}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            reload();
          }}
        />
      )}
      {signing && (
        <SignScreen
          rentalId={s.id}
          base="sales"
          kind="contract"
          title={t.sell.document}
          onClose={closeSign}
          onSigned={() => {
            closeSign();
            reload();
          }}
        />
      )}
    </>
  );
}

/** A sale that never happened: only while no money has touched it (`sales.md`). */
function CancelSheet({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState('');
  return (
    <FormSheet
      title={t.saleCard.cancelTitle}
      onClose={onClose}
      value={reason}
      initial=""
      onRestore={setReason}
      label={t.saleCard.cancelTitle}
      submit={async (key) => {
        await api.post(`/api/sales/${id}/cancel`, { reason: reason.trim() }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onDone}
    >
      <Field label={t.saleCard.cancelReason} name="reason">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <p className="hint muted">{t.saleCard.cancelNote}</p>
    </FormSheet>
  );
}

/** The dates moved, or the amounts did: an owner's change, with a reason (§3.2). */
function ScheduleSheet({
  id,
  priceTetri,
  rows,
  onClose,
  onDone,
}: { id: string; priceTetri: number; rows: { dueOn: ISODate; amount: string }[]; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const initial = { rows, reason: '' };
  const [f, setF] = useState(initial);
  const edit = (i: number, patch: Partial<{ dueOn: ISODate; amount: string }>) => setF({ ...f, rows: f.rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  // The same line the wizard shows before a sale is made (crit. 4 of wave 5):
  // a schedule may come to something other than the price, but not by
  // accident (QA-W6-13).
  const gap = scheduleGap(priceTetri, f.rows.map((r) => ({ amountTetri: parseGel(r.amount) ?? 0 })));
  return (
    <FormSheet
      title={t.saleCard.scheduleTitle}
      onClose={onClose}
      value={f}
      initial={initial}
      onRestore={setF}
      label={t.saleCard.scheduleSave}
      submit={async (key) => {
        await api.post(`/api/sales/${id}/schedule`, { reason: f.reason.trim(), schedule: f.rows.map((r) => ({ dueOn: r.dueOn, amountTetri: parseGel(r.amount) ?? 0 })) }, { key });
        return { toast: { text: t.form.changesSaved } };
      }}
      onDone={onDone}
    >
      {f.rows.map((r, i) => (
        <div className="two-col two-col-tight" key={i}>
          <input className="input mono" type="date" aria-label={t.sell.dueOn} value={r.dueOn} onChange={(e) => edit(i, { dueOn: e.target.value })} />
          <input className="input input-amount mono" inputMode="decimal" aria-label={t.sell.amount} value={r.amount} onChange={(e) => edit(i, { amount: e.target.value })} />
        </div>
      ))}
      {gap !== 0 && <p className="warn-text">{gap > 0 ? t.sell.gapOver(formatGel(gap)) : t.sell.gapUnder(formatGel(-gap))}</p>}
      <button type="button" className="pill pill-sm" onClick={() => setF({ ...f, rows: [...f.rows, { dueOn: f.rows[f.rows.length - 1]?.dueOn ?? '', amount: '' }] })}>
        {t.saleCard.addRow}
      </button>
      <Field label={t.saleCard.scheduleReason} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/**
 * The sale was entered on the wrong day (call of 21.10.2026): an owner puts it
 * right, with a reason (ux №14). Before anything is sent the sheet shows what
 * moves with the date — the warranty, the schedule's lines, the moped's
 * history and the debt — by the same rule the server writes (`redateSale`),
 * so nothing moves by surprise.
 */
function DateSheet({ sale, signedSoldOn, onClose, onDone }: { sale: SaleCard['sale']; signedSoldOn: ISODate | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const today = todayISO();
  const initial = { soldOn: sale.soldOn, reason: '' };
  const [f, setF] = useState(initial);
  const valid = isISODate(f.soldOn);
  const plan = valid && f.soldOn !== sale.soldOn ? redateSale({ soldOn: sale.soldOn, warrantyUntil: sale.warrantyUntil, transferred: sale.transferred, instalments: sale.instalments }, f.soldOn) : null;
  const moved = new Map((plan?.instalments ?? []).map((m) => [m.seq, m.to]));
  // An unpaid line that moves can fall due, or stop being due, the moment this is saved.
  const debt = (rows: SaleCard['sale']['instalments']) => saleState({ today, status: 'active', instalments: rows }).owesTetri;
  const debtBefore = debt(sale.instalments);
  const debtAfter = debt(sale.instalments.map((i) => ({ ...i, dueOn: moved.get(i.seq) ?? i.dueOn })));
  return (
    <FormSheet
      title={t.saleDate.title}
      onClose={onClose}
      value={f}
      initial={initial}
      onRestore={setF}
      label={t.saleDate.save}
      submit={async (key) => {
        try {
          const res = await api.post<{ changed: boolean }>(`/api/sales/${sale.id}/date`, { soldOn: f.soldOn, reason: f.reason.trim() }, { key });
          return { toast: { text: res.changed ? t.form.changesSaved : t.saleDate.unchanged } };
        } catch (e) {
          // The server names the day the moped's history stops at; the words under the field say it.
          if (e instanceof ApiError && e.code === 'sale_before_history' && typeof e.extra.date === 'string') {
            throw new ApiError(e.status, e.code, e.message, { ...e.extra, field: 'soldOn', fieldText: t.saleDate.beforeHistory(fmtDate(e.extra.date)) });
          }
          throw e;
        }
      }}
      onDone={onDone}
    >
      <Field label={t.sell.soldOn} hint={t.saleDate.now(fmtDate(sale.soldOn))} name="soldOn" error={valid && f.soldOn > today ? t.errors.codes.sale_date_future : null}>
        <input className="input mono" type="date" max={today} value={f.soldOn} onChange={(e) => setF({ ...f, soldOn: e.target.value })} />
      </Field>
      {plan && (
        <div>
          <span className="lbl">{t.saleDate.changes}</span>
          <Row k={t.sell.soldOn} v={<FromTo from={sale.soldOn} to={f.soldOn} />} />
          {sale.vehicle && <Row k={t.saleDate.history} v={<FromTo from={sale.soldOn} to={f.soldOn} />} />}
          {plan.warrantyUntil !== sale.warrantyUntil && <Row k={t.saleCard.warranty} v={<FromTo from={sale.warrantyUntil} to={plan.warrantyUntil} />} />}
          {plan.instalments.map((m) => (
            <Row key={m.seq} k={t.saleDate.line(m.seq)} v={<FromTo from={m.from} to={m.to} />} />
          ))}
          {debtAfter !== debtBefore && (
            <Row
              k={t.saleCard.debt}
              v={
                <span className="mono">
                  {formatGel(debtBefore)} → {formatGel(debtAfter)}
                </span>
              }
            />
          )}
          {sale.transferred && <p className="hint muted">{t.saleDate.stays}</p>}
        </div>
      )}
      {/* What the buyer signed does not change (B4-06). */}
      {signedSoldOn && <p className="hint muted">{t.saleDate.paperKeeps(fmtDate(signedSoldOn))}</p>}
      <Field label={t.saleDate.reason} hint={t.saleDate.reasonHint} name="reason">
        <input className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </Field>
    </FormSheet>
  );
}

/** Two days, "was → becomes", the way the journal writes them. */
function FromTo({ from, to }: { from: ISODate | null; to: ISODate | null }) {
  return (
    <span className="mono">
      {fmtDate(from)} → {fmtDate(to)}
    </span>
  );
}
