import { parseGel, todayISO } from '@ev8/shared';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { Drawer } from '../components/Drawer.js';
import { BlockHead, Empty, Loading, PageHead, Vin } from '../components/ui.js';
import { Field, Row } from '../components/Wizard.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { errorText, useLoad } from '../lib/use.js';
import { useSession } from '../session.js';
import type { Sale } from './SalesPage.js';

interface SaleCard {
  sale: Sale;
  payments: { id: string; occurredOn: string; channel: 'transfer' | 'acquiring' | 'cash'; direction: 'in' | 'out'; grossTetri: number }[];
}

/** One sale: the schedule, what has come in, and how it ended. */
export function SalePage() {
  const { id } = useParams();
  const t = useT();
  const { can } = useSession();
  const { data, error, reload } = useLoad<SaleCard>(id ? `/api/sales/${id}` : null);
  const [err, setErr] = useState<string | null>(null);
  const [pay, setPay] = useState({ open: false, amount: '', channel: 'transfer' as 'transfer' | 'acquiring' | 'cash', on: todayISO() });
  const [back, setBack] = useState({ open: false, amount: '', on: todayISO(), toState: 'available' as 'available' | 'service' });
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);

  if (error) return <Empty text={error} />;
  if (!data) return <Loading />;
  const s = data.sale;
  const live = s.status === 'active';

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
      reload();
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  // A drawer that closes takes its error with it: the page behind would
  // otherwise keep showing a complaint about a form nobody can see.
  const closePay = () => {
    setPay({ ...pay, open: false });
    setErr(null);
  };
  const closeBack = () => {
    setBack({ ...back, open: false });
    setErr(null);
  };
  const closeCancel = () => {
    setCancelling(false);
    setErr(null);
  };

  return (
    <>
      <PageHead wrap title={s.number} sub={t.sales.statuses[s.status]}>
        {live && can('cash.record') && (
          <button type="button" className="pill pill-sm pill-accent" onClick={() => setPay({ ...pay, open: true })}>
            {t.sales.addPayment}
          </button>
        )}
        {live && can('sales.manage') && s.vehicle && (
          <button type="button" className="pill pill-sm" onClick={() => setBack({ ...back, open: true })}>
            {t.sales.buyBack}
          </button>
        )}
        {live && can('sales.manage') && (
          <button type="button" className="pill pill-sm" onClick={() => setCancelling(true)}>
            {t.sales.cancel}
          </button>
        )}
      </PageHead>
      {err && <div className="hint hint-bad">{err}</div>}

      {pay.open && (
        <Drawer title={t.sales.addPayment} onClose={closePay}>
          <Field label={t.payments.channel}>
            <div className="chips">
              {(['transfer', 'acquiring', 'cash'] as const).map((c) => (
                <button key={c} type="button" className={`pill pill-sm ${pay.channel === c ? 'on' : ''}`} onClick={() => setPay({ ...pay, channel: c })}>
                  {t.payments.channels[c]}
                </button>
              ))}
            </div>
          </Field>
          <Field label={t.payments.gross}>
            <input className="input input-amount mono" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} inputMode="decimal" autoFocus />
          </Field>
          <Field label={t.payments.date}>
            <input className="input mono" type="date" value={pay.on} onChange={(e) => setPay({ ...pay, on: e.target.value })} />
          </Field>
          {err && <div className="hint hint-bad">{err}</div>}
          <div className="row-actions">
            <button type="button" className="pill" onClick={closePay}>
              {t.actions.cancel}
            </button>
            <button
              type="button"
              className="pill pill-accent"
              disabled={busy || parseGel(pay.amount) == null}
              onClick={() => void act(async () => {
                await api.post(`/api/sales/${s.id}/payments`, { channel: pay.channel, grossTetri: parseGel(pay.amount), occurredOn: pay.on });
                setPay({ ...pay, open: false, amount: '' });
              })}
            >
              {t.actions.confirm}
            </button>
          </div>
        </Drawer>
      )}

      {back.open && (
        <Drawer title={t.sales.buyBack} onClose={closeBack}>
          <Field label={t.sales.buyBackAmount}>
            <input className="input input-amount mono" value={back.amount} onChange={(e) => setBack({ ...back, amount: e.target.value })} inputMode="decimal" autoFocus />
          </Field>
          <Field label={t.payments.date}>
            <input className="input mono" type="date" value={back.on} onChange={(e) => setBack({ ...back, on: e.target.value })} />
          </Field>
          <Field label={t.sales.buyBackState}>
            <div className="chips">
              {(['available', 'service'] as const).map((st) => (
                <button key={st} type="button" className={`pill pill-sm ${back.toState === st ? 'on' : ''}`} onClick={() => setBack({ ...back, toState: st })}>
                  {t.states[st]}
                </button>
              ))}
            </div>
          </Field>
          {err && <div className="hint hint-bad">{err}</div>}
          <div className="row-actions">
            <button type="button" className="pill" onClick={closeBack}>
              {t.actions.cancel}
            </button>
            <button
              type="button"
              className="pill pill-accent"
              disabled={busy || parseGel(back.amount) == null}
              onClick={() => void act(async () => {
                await api.post(`/api/sales/${s.id}/buy-back`, { amountTetri: parseGel(back.amount), occurredOn: back.on, toState: back.toState });
                setBack({ ...back, open: false, amount: '' });
              })}
            >
              {t.actions.confirm}
            </button>
          </div>
        </Drawer>
      )}

      {cancelling && (
        <Drawer title={t.sales.cancel} onClose={closeCancel}>
          <Field label={t.sales.cancelReason}>
            <input className="input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus />
          </Field>
          {err && <div className="hint hint-bad">{err}</div>}
          <div className="row-actions">
            <button type="button" className="pill" onClick={closeCancel}>
              {t.actions.cancel}
            </button>
            <button
              type="button"
              className="pill pill-accent"
              disabled={busy || !cancelReason.trim()}
              onClick={() => void act(async () => {
                await api.post(`/api/sales/${s.id}/cancel`, { reason: cancelReason });
                setCancelling(false);
              })}
            >
              {t.actions.confirm}
            </button>
          </div>
        </Drawer>
      )}

      <div className="two-col">
        <section className="card">
          <Row k={t.sales.buyer} v={<Link to={`/customers/${s.customer.id}`}>{s.customer.name}</Link>} />
          <Row
            k={t.sales.vehicle}
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
          <Row k={t.sales.soldOn} v={<span className="mono">{fmtDate(s.soldOn)}</span>} />
          <Row k={t.sales.warranty} v={<span className="mono">{fmtDate(s.warrantyUntil)}</span>} />
          {s.extras && <Row k={t.sales.extras} v={s.extras} />}
          {s.boughtBackOn && <Row k={t.sales.buyBack} v={<span className="mono">{fmtDate(s.boughtBackOn)}</span>} />}
          {s.notes && <Row k={t.rental.notes} v={<span className="pre">{s.notes}</span>} />}
        </section>
        <section className="card">
          <Row k={t.sales.price} v={<span className="mono">{formatGel(s.priceTetri)}</span>} />
          <Row k={t.sales.paid} v={<span className="mono">{formatGel(s.paidTetri)}</span>} />
          <Row k={t.sales.outstanding} v={<span className="mono">{formatGel(s.outstandingTetri)}</span>} />
          <Row
            k={t.sales.overdue}
            v={<span className={`mono ${s.overdueTetri > 0 ? 'crit-text' : ''}`}>{formatGel(s.overdueTetri)}</span>}
          />
        </section>
      </div>

      <section className="card">
        <BlockHead title={t.sales.schedule} sub={t.sales.instalmentsCount(s.instalments.length)} />
        <div className="table-wrap table-flat">
          <table className="table">
            <thead>
              <tr>
                <th>{t.sales.instalment}</th>
                <th>{t.sales.dueOn}</th>
                <th className="num">{t.sales.amount}</th>
                <th className="num">{t.sales.paid}</th>
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
                  <td className={i.payStatus === 'paid' ? 'state-available' : i.overdue ? 'crit-text' : 'muted'}>
                    {t.sales.payStatus[i.payStatus]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
                  <span className={`mono ${p.direction === 'out' ? 'crit-text' : ''}`}>
                    {p.direction === 'out' ? '-' : ''}
                    {formatGel(p.grossTetri)}
                  </span>{' '}
                  <span className="muted">{t.payments.channels[p.channel]}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
