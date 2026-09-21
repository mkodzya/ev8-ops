import { type TaskGroupRows, type TaskRow, type VehicleState } from '@ev8/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { Loading } from '../components/ui.js';
import { WhatsappSheet, type WaTarget } from '../components/Whatsapp.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { useSession } from '../session.js';

// "Today" is the queue (wave 4 §3.1): group by group, three rows and what is
// left over, one action per row. The rules are in @ev8/shared — this screen
// only says them in words and puts the buttons under a thumb.

export interface TodayData {
  today: string;
  owner: boolean;
  queue: TaskGroupRows[];
  count: number;
  numbers: {
    fleet: Record<VehicleState, number>;
    overdueTetri: number | null;
    depositsHeldTetri: number | null;
    week: { rentTetri: number; saleTetri: number; serviceTetri: number; depositTetri: number; feeTetri: number; from: string } | null;
    myTillTetri: number | null;
    batteries?: { showroom: number; total: number } | null;
  };
}

/**
 * «Пятница, 18 сентября» — the day in the language on screen (U1). Written
 * from the dictionary rather than from the device: a browser without Georgian
 * date data answers in whatever language it does have, which on a stand here
 * turned out to be Russian under a Georgian interface.
 */
function dayTitle(iso: string, t: ReturnType<typeof useT>): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const weekday = t.today.weekdays[d.getUTCDay()] ?? '';
  const month = t.today.months[d.getUTCMonth()] ?? '';
  return t.today.day(weekday, d.getUTCDate(), month);
}

/**
 * The list a group's "More N" opens: the one its rows were made from. Not every
 * group is a segment of the rentals list — deposits waiting for a decision and
 * a till handed over live in Money, and a list without the rows in it is worse
 * than no link at all (QA-W4-12).
 */
const SEGMENT: Record<string, string> = {
  decide: '/money/deposits',
  returns: '/rentals?s=returns',
  overdue: '/rentals?s=overdue',
  awaiting: '/rentals?s=awaiting',
  money: '/money/statements',
  service: '/service',
  instalments: '/sales',
  purchases: '/purchases',
  fill: '/rentals?s=unsigned',
  till: '/money/cash',
};

export function TodayPage() {
  const t = useT();
  const { can } = useSession();
  const openMoney = useMoneyForm();
  const navigate = useNavigate();
  const { data, failure, reload } = useLoad<TodayData>('/api/today');
  const [wa, setWa] = useState<WaTarget | null>(null);
  if (!data && failure) return <LoadError failure={failure} onRetry={reload} />;
  if (!data) return <Loading />;
  const n = data.numbers;

  const rowSub = (r: TaskRow): string => {
    const bits: string[] = [];
    if (r.number) bits.push(r.number);
    if (r.vin) bits.push(`···${r.vin.slice(-4)}`);
    if (r.group === 'returns') bits.push(r.days && r.days > 0 ? t.today.lateBy(r.days) : t.today.duesToday);
    else if (r.group === 'overdue' && r.days) bits.push(t.today.overdueDays(r.days));
    else if (r.group === 'awaiting') bits.push(t.today.handedToday);
    else if (r.action === 'take_instalment' && r.days) bits.push(t.today.overdueDays(r.days));
    else if (r.action === 'open_purchase') bits.push(t.today.ordered);
    // A reported breakdown says what broke; the shelf row names the parts.
    else if (r.action === 'open_report') bits.push(r.note ?? '');
    else if (r.action === 'order_parts') return (r.note ?? '').split('|')[1] ?? '';
    return bits.join(' · ');
  };

  const rowTitle = (r: TaskRow): string => {
    switch (r.action) {
      case 'decide_deposit':
        return `${t.today.deposit} · ${r.who ?? ''}`;
      case 'accept_till':
        return `${t.today.till} · ${r.who ?? ''}`;
      case 'hand_over_till':
        return t.today.actions.hand_over_till ?? '';
      case 'sort':
        return t.today.unsorted(Number(r.note ?? 0));
      case 'upload_statement':
        return t.today.staleBank(r.note ?? '', r.days ?? 0);
      case 'open_service':
        return t.today.inRepair(Number((r.note ?? '0/0').split('/')[0]));
      // A breakdown somebody reported, and the shelf running low (wave 5 §3.10).
      case 'open_report':
        return t.today.reported;
      case 'order_parts':
        return t.today.lowParts(Number((r.note ?? '0|').split('|')[0]));
      case 'set_pool':
        return t.today.noPool(Number(r.note ?? 0));
      case 'set_point':
        return t.today.noPoint(Number(r.note ?? 0));
      case 'sign':
        return t.today.unsignedContract(r.number ?? '');
      case 'set_vin':
        return `${r.who ?? ''} · ${t.today.noVin}`;
      default:
        return r.who ?? r.number ?? '';
    }
  };

  const act = (r: TaskRow) => {
    const id = r.id.split(':')[1];
    if ((r.action === 'take_money' || r.action === 'take_cash') && r.number && id) {
      openMoney({ target: { kind: 'rent', rentalId: id, number: r.number, customer: r.who ?? undefined } });
      return;
    }
    if (r.action === 'take_instalment') {
      openMoney({ target: { kind: 'sale', saleId: r.href.split('/').pop(), number: r.number ?? undefined, customer: r.who ?? undefined } });
      return;
    }
    navigate(r.href);
  };

  return (
    <>
      <header className="day-head">
        <h1>{t.today.title}</h1>
        <p className="muted">{dayTitle(data.today, t)}</p>
      </header>

      <div className="num-strip">
        <Num to="/fleet?f=rented" value={String(n.fleet.rented ?? 0)} label={t.today.numbers.rented ?? ''} />
        <Num to="/fleet?f=available" value={String(n.fleet.available ?? 0)} label={t.today.numbers.available ?? ''} />
        <Num to="/service" value={String(n.fleet.service ?? 0)} label={t.today.numbers.service ?? ''} />
        {n.overdueTetri != null && <Num to="/rentals?s=overdue" value={formatGel(n.overdueTetri, { decimals: false })} label={t.today.numbers.overdue ?? ''} tone="crit" />}
        {n.depositsHeldTetri != null && <Num to="/money/deposits" value={formatGel(n.depositsHeldTetri, { decimals: false })} label={t.today.numbers.deposits ?? ''} />}
        {n.week && <Num to="/money/payments" value={formatGel(n.week.rentTetri + n.week.saleTetri + n.week.serviceTetri, { decimals: false })} label={t.today.numbers.week ?? ''} />}
        {n.batteries && <Num to="/fleet/batteries" value={t.today.batteriesOf(n.batteries.showroom, n.batteries.total)} label={t.today.numbers.batteries ?? ''} />}
        {n.myTillTetri != null && <Num to="/money/cash" value={formatGel(n.myTillTetri, { decimals: false })} label={t.today.numbers.myTill ?? ''} />}
      </div>

      {data.queue.length === 0 ? (
        <section className="card empty-day">
          <p className="empty-title">{t.today.allDone}</p>
          <p className="muted">{t.today.allDoneSub}</p>
          {data.owner && can('payments.reconcile') ? (
            <Link to="/money/statements" className="pill pill-accent">
              {t.today.uploadStatement}
            </Link>
          ) : (
            can('rental.create') && (
              <Link to="/rentals/new" className="pill pill-accent">
                {t.today.handOver}
              </Link>
            )
          )}
        </section>
      ) : (
        data.queue.map((g) => (
          <section key={g.group} className="card queue-card">
            <div className="queue-head">
              <h2>{t.today.groups[g.group]}</h2>
              <span className="muted">
                {g.total}
                {g.group === 'overdue' && g.total > 1 ? ` · ${t.today.sortedLongest}` : ''}
              </span>
            </div>
            <ul className="queue">
              {g.rows.map((r) => (
                <li key={r.id} className="q-row">
                  <Link to={r.href} className="q-who">
                    <span className="q-name">{rowTitle(r)}</span>
                    <span className="q-sub muted">{r.action === 'open_service' ? t.today.inRepairSub(Number((r.note ?? '0/0').split('/')[1]), r.days ?? 0) : rowSub(r)}</span>
                  </Link>
                  {r.amountTetri != null && r.amountTetri > 0 && <span className={`t-money q-sum ${g.group === 'overdue' ? 'crit-text' : ''}`}>{formatGel(r.amountTetri, { decimals: false })}</span>}
                  <span className="q-acts">
                    {r.phone && (
                      <>
                        <a className="pill pill-sm" href={`tel:${r.phone}`} aria-label={t.today.call}>
                          ☎
                        </a>
                        <button
                          type="button"
                          className="pill pill-sm"
                          aria-label={t.today.whatsapp}
                          onClick={() =>
                            setWa({
                              rentalId: r.id.split(':')[1] ?? null,
                              number: r.number ?? '',
                              name: r.who ?? '',
                              phone: r.phone ?? '',
                              paidThrough: null,
                              debtTetri: r.amountTetri ?? 0,
                            })
                          }
                        >
                          WA
                        </button>
                      </>
                    )}
                    <button type="button" className="pill pill-sm pill-accent" onClick={() => act(r)}>
                      {t.today.actions[r.action]}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {g.total > g.rows.length && (
              <Link className="queue-more" to={SEGMENT[g.group] ?? '/rentals'}>
                {g.totalTetri > 0 ? t.today.more(g.total - g.rows.length, formatGel(g.totalTetri, { decimals: false })) : t.today.morePlain(g.total - g.rows.length)}
              </Link>
            )}
          </section>
        ))
      )}

      {n.week && (
        <section className="card week-card">
          <div className="queue-head">
            <h2>{t.today.weekTitle}</h2>
            <span className="muted">{t.today.weekFrom(`${n.week.from.slice(8)}.${n.week.from.slice(5, 7)}`)}</span>
          </div>
          <WeekRow k={t.today.weekRent} v={n.week.rentTetri} />
          <WeekRow k={t.today.weekSale} v={n.week.saleTetri} />
          <WeekRow k={t.today.weekService} v={n.week.serviceTetri} />
          <WeekRow k={t.today.weekDeposit} v={n.week.depositTetri} />
          <WeekRow k={t.today.weekFee} v={-n.week.feeTetri} />
        </section>
      )}

      {wa && <WhatsappSheet target={wa} onClose={() => setWa(null)} />}
    </>
  );
}

function Num({ to, value, label, tone }: { to: string; value: string; label: string; tone?: 'crit' }) {
  return (
    <Link to={to} className={`num ${tone ? `num-${tone}` : ''}`}>
      <span className="num-v">{value}</span>
      <span className="num-l">{label}</span>
    </Link>
  );
}

function WeekRow({ k, v }: { k: string; v: number }) {
  return (
    <div className="kv">
      <span className="kv-k">{k}</span>
      <span className="kv-v mono">{formatGel(v)}</span>
    </div>
  );
}
