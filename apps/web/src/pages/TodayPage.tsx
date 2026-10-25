import { localDateTime, queueMore, type FleetChip, type TaskGroupRows, type TaskRow, type VehicleState } from '@ev8/shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LoadError } from '../components/LoadError.js';
import { Loading } from '../components/ui.js';
import { WhatsappSheet, type WaTarget } from '../components/Whatsapp.js';
import { useMoneyForm } from '../ds/money/MoneyForm.js';
import { fmtDate, formatGel } from '../format.js';
import { useT } from '../i18n/index.js';
import { useLoad } from '../lib/use.js';
import { kmText, leftText } from '../lib/maintenance.js';
import { Typed } from '../lib/typed.js';
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
    /** The mopeds under each chip of «Парк → Мопеды» (`fleetChipOf`): a number that opens a chip is read here. */
    chips: Record<FleetChip, number>;
    overdueTetri: number | null;
    depositsHeldTetri: number | null;
    week: { rentTetri: number; saleTetri: number; serviceTetri: number; goodsTetri?: number; depositTetri: number; feeTetri: number; from: string } | null;
    myTillTetri: number | null;
    batteries?: { showroom: number; total: number } | null;
  };
  /** Mopeds with no mileage written in EV8 Ops: no maintenance is counted for them (ADR-0038). */
  maintenanceUnknown?: number;
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
  due_today: '/rentals?s=due_today',
  money: '/money/statements',
  service: '/service',
  instalments: '/sales',
  purchases: '/purchases',
  fill: '/rentals?s=unsigned',
  till: '/money/cash',
};

/** «осталось 140 км», or red «просрочено на 320 км» — first in the group, by the API's order. */
function MaintenanceLeft({ note }: { note: string | null }) {
  const t = useT();
  const left = Number((note ?? '0|0|0').split('|')[2]);
  return <span className={`t-money q-sum ${left < 0 ? 'crit-text' : ''}`}>{leftText({ leftKm: left }, t)}</span>;
}

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
    // Drive's return: the act's day and what it paid back, or only that the folder was moved (ADR-0034).
    if (r.action === 'close_from_drive') {
      const [on, back] = (r.note ?? '|').split('|');
      bits.push(on ? t.drive.todayAct(fmtDate(on)) : t.drive.todayFinished);
      if (back) bits.push(t.drive.todayPaidBack(formatGel(Number(back), { decimals: false })));
    } else if (r.action === 'hand_over_from_drive') bits.push(t.drive.todayContract(fmtDate(r.note)));
    else if (r.group === 'returns') bits.push(r.days && r.days > 0 ? t.today.lateBy(r.days) : t.today.duesToday);
    else if (r.group === 'overdue' && r.days) bits.push(t.today.overdueDays(r.days));
    else if (r.group === 'due_today' && r.note === 'handed_today') bits.push(t.today.handedToday);
    else if (r.action === 'take_instalment' && r.days) bits.push(t.today.overdueDays(r.days));
    else if (r.action === 'open_purchase') bits.push(t.today.ordered);
    // A deal Kommo has won and nobody has entered here yet (ADR-0015).
    else if (r.action === 'hand_over_from_kommo') bits.push(t.today.kommoRented);
    else if (r.action === 'sell_from_kommo') bits.push(t.today.kommoWon);
    // A reported breakdown says what broke: the words follow this line, in the
    // reader's language where a translation is ready (ADR-0042). The shelf row names the parts.
    else if (r.action === 'open_report') return bits.join(' · ');
    else if (r.action === 'order_parts') return (r.note ?? '').split('|')[1] ?? '';
    // Planned maintenance (ADR-0038): the mark and the mileage; what is left is the row's own figure.
    else if (r.action === 'open_maintenance') {
      const [due, current] = (r.note ?? '0|0|0').split('|').map(Number);
      return t.wmaint.rowSub(kmText(due ?? 0), kmText(current ?? 0));
    }
    // Kommo's row says how old its answer is; when Kommo has gone silent the
    // title already says so, and this is the time of its last word.
    else if (r.action === 'reconcile_kommo') {
      const [count, state, lastOkAt] = (r.note ?? '0|ok|').split('|');
      if (state === 'silent' && Number(count) > 0) bits.push(t.today.kommoSilent);
      const at = lastOkAt ? localDateTime(lastOkAt) : null;
      bits.push(at ? t.today.kommoAt(at.date, at.time) : t.today.kommoNeverAnswered);
    }
    return bits.join(' · ');
  };

  // The line under a group longer than the rows it shows: the number and the sum say one set
  // (QA of #15; shared `queueMore`): all the rows and their sum, the set the list it opens adds
  // up to (ux №10), or — a manager's group, which carries no sum (ADR-0048, addendum of
  // 25.10.2026), or one with no money — the rows left.
  const moreLine = (g: TaskGroupRows) => {
    const m = queueMore(g);
    if (!m) return null;
    return (
      <Link className="queue-more" to={SEGMENT[g.group] ?? '/rentals'}>
        {m.kind === 'all' ? t.today.all(m.count, formatGel(m.tetri, { decimals: false })) : t.today.morePlain(m.count)}
      </Link>
    );
  };

  const rowTitle = (r: TaskRow): string => {
    switch (r.action) {
      case 'decide_deposit':
        return `${t.today.deposit} · ${r.who ?? ''}`;
      // One row for everything the transfer left undecided (wave 6 §3.7):
      // the count is in `days`, the money in `amountTetri`.
      case 'sort_odoo_deposits':
        return t.today.odooDeposits(r.days ?? 0);
      // Kommo against the rentals here, one row (ADR-0012). With nothing
      // disagreeing the row is there for one reason only: Kommo is silent.
      case 'reconcile_kommo': {
        const n = Number((r.note ?? '0').split('|')[0]);
        return n > 0 ? t.today.kommoMismatch(n) : t.today.kommoSilent;
      }
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
      case 'open_maintenance':
        return [r.number, r.who].filter(Boolean).join(' · ');
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

  // Red is for a debt: every sum of the overdue group, and in "due today" a
  // figure that holds more than is awaited today (a deposit short since an
  // earlier day). The whole figure is red then, never a part of it (ADR-0017).
  const sumIsDebt = (r: TaskRow): boolean => r.group === 'overdue' || (r.group === 'due_today' && (r.amountTetri ?? 0) > (r.dueTodayTetri ?? 0));

  // The rental a row is about, when it is about one: then the row's address
  // is that rental's. An instalment or a deal from Kommo is not a rental, and
  // the WhatsApp sheet must not wait for one that will never load.
  const rentalOf = (r: TaskRow): string | null => {
    const id = r.id.split(':')[1];
    return id && r.href.startsWith(`/rentals/${id}`) ? id : null;
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
        {/* Each says the number of the chip it opens (Mika, answer «А», 22.10.2026): «Свободно» is ready to hand out — the rental park, on a point. */}
        <Num to="/fleet?f=rented" value={String(n.chips.rented ?? 0)} label={t.today.numbers.rented ?? ''} />
        <Num to="/fleet?f=available" value={String(n.chips.available ?? 0)} label={t.today.numbers.available ?? ''} />
        <Num to="/service" value={String(n.fleet.service ?? 0)} label={t.today.numbers.service ?? ''} />
        {n.overdueTetri != null && <Num to="/rentals?s=overdue" value={formatGel(n.overdueTetri, { decimals: false })} label={t.today.numbers.overdue ?? ''} tone="crit" />}
        {n.depositsHeldTetri != null && <Num to="/money/deposits" value={formatGel(n.depositsHeldTetri, { decimals: false })} label={t.today.numbers.deposits ?? ''} />}
        {n.week && <Num to="/money/payments" value={formatGel(n.week.rentTetri + n.week.saleTetri + n.week.serviceTetri + (n.week.goodsTetri ?? 0), { decimals: false })} label={t.today.numbers.week ?? ''} />}
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
          // "Due today" is a calm group (ADR-0017): an ink heading, nothing red
          // of its own. A sum in it turns red only when the figure holds
          // something older than today's week — the rule of every screen.
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
                    <span className="q-sub muted">
                      {r.action === 'open_service' ? t.today.inRepairSub(Number((r.note ?? '0/0').split('/')[1]), r.days ?? 0) : rowSub(r)}
                      {r.action === 'open_report' && r.note && (
                        <>
                          {' · '}
                          <Typed text={r.note} quiet />
                        </>
                      )}
                    </span>
                  </Link>
                  {r.amountTetri != null && r.amountTetri > 0 && <span className={`t-money q-sum ${sumIsDebt(r) ? 'crit-text' : ''}`}>{formatGel(r.amountTetri, { decimals: false })}</span>}
                  {r.action === 'open_maintenance' && <MaintenanceLeft note={r.note} />}
                  <span className="q-acts">
                    {r.phone && (
                      <>
                        <a className="pill pill-sm" href={`tel:${r.phone}`} aria-label={t.today.call}>
                          ☎
                        </a>
                        {/* No ready message for a rental handed over today (ADR-0017): the row says so itself, in
                            whichever group it stands — "returns" and "fill in" too. The call and the action stay. */}
                        {r.whatsapp !== false && (
                          <button
                            type="button"
                            className="pill pill-sm"
                            aria-label={t.today.whatsapp}
                            onClick={() =>
                              setWa({
                                rentalId: rentalOf(r),
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
                        )}
                      </>
                    )}
                    <button type="button" className="pill pill-sm pill-accent" onClick={() => act(r)}>
                      {t.today.actions[r.action]}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            {g.group === 'maintenance' && (data.maintenanceUnknown ?? 0) > 0 && <p className="hint muted">{t.wmaint.unknown(data.maintenanceUnknown ?? 0)}</p>}
            {moreLine(g)}
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
          {(n.week.goodsTetri ?? 0) > 0 && <WeekRow k={t.money.kinds.goods} v={n.week.goodsTetri ?? 0} />}
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
