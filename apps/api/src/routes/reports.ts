import { todayISO, weekOf } from '@ev8/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../lib/env.js';
import { badRequest } from '../lib/errors.js';
import { money, renderWeekReport, type WeekRow } from '../lib/pdf/weekReport.js';
import { date } from '../lib/validate.js';
import { weekReport, type WeekAnswer } from '../lib/week.js';

// "Отчёты → Неделя" (wave 6 §3.1): the figures of the book on one screen and
// on one printable page. Both read the same `weekReport`, so what is printed
// for the meeting is what was on the screen when it was pressed.

type Query = { from?: string; to?: string };

/** The period asked for, or the week that contains today (Monday–Sunday). */
function periodOf(req: FastifyRequest<{ Querystring: Query }>): { from: string; to: string } {
  const week = weekOf(todayISO(new Date(), env.TZ));
  const from = date(req.query, 'from') ?? week.from;
  const to = date(req.query, 'to') ?? week.to;
  if (from > to) throw badRequest('bad_period', 'The period starts after it ends.', { field: 'from' });
  return { from, to };
}

/**
 * The paper of the week (crit. 4). Georgian leads and English follows, as on
 * every other document this system prints; a figure nobody keeps is written
 * out in words rather than printed as a zero (crit. 2).
 */
function pdfRows(w: WeekAnswer): { groups: { title: { ka: string; en: string }; rows: WeekRow[] }[]; notes: string[] } {
  const absent = { ka: 'აღრიცხვა არ არსებობს', en: 'no record is kept' };
  const fleet: WeekRow[] = [
    { label: { ka: 'მოპედი ქირაშია', en: 'Mopeds out with customers' }, value: String(w.fleet.rented) },
    { label: { ka: 'თავისუფალია საქირავო პარკში', en: 'Free in the rental park' }, value: String(w.fleet.freeInRentPool) },
    {
      label: { ka: 'რემონტშია', en: 'In repair' },
      value: w.fleet.serviceLongestDays == null ? String(w.fleet.inService) : `${w.fleet.inService} · ${w.fleet.serviceLongestDays} დღემდე`,
    },
    { label: { ka: 'ახალი ქირაობა · დაბრუნება', en: 'New rentals · returns' }, value: `${w.rentals.started} · ${w.rentals.returned}` },
    {
      label: { ka: 'პარკის დატვირთვა', en: 'Fleet utilisation' },
      value: w.utilisation.percent == null ? absent.ka : `${w.utilisation.percent} %`,
      absent: w.utilisation.percent == null,
    },
  ];
  const money_: WeekRow[] = [
    {
      label: { ka: 'ვადაგადაცილება', en: 'Overdue rent' },
      value: `${money(w.rentals.overdueTetri)} · ${w.rentals.overdueCount}`,
      negative: w.rentals.overdueTetri > 0,
    },
    { label: { ka: 'შემოსული — ქირა', en: 'Received — rent' }, value: money(w.money.rentTetri) },
    { label: { ka: 'შემოსული — გაყიდვები', en: 'Received — sales' }, value: money(w.money.saleTetri) },
    { label: { ka: 'მიღებული დეპოზიტები', en: 'Deposits received' }, value: money(w.money.depositsInTetri) },
    { label: { ka: 'ექვაირინგის საკომისიო', en: 'Acquiring fee' }, value: money(w.money.acquiringFeeTetri, { negative: true }), negative: true },
    { label: { ka: 'დაბრუნებული დეპოზიტები', en: 'Deposits handed back' }, value: money(w.money.depositsOutTetri, { negative: true }), negative: true },
    { label: { ka: 'დეპოზიტიდან დაკავებული', en: 'Kept out of deposits' }, value: money(w.money.withheldTetri) },
    { label: { ka: 'დეპოზიტები ხელზე', en: 'Deposits held' }, value: money(w.money.heldTetri) },
  ];
  const rest: WeekRow[] = [
    {
      label: { ka: 'ბატარეები: შოურუმი · კურიერები · რემონტი', en: 'Batteries: showroom · couriers · repair' },
      value: `${w.batteries.showroom} · ${w.batteries.couriers} · ${w.batteries.repair}`,
    },
    { label: { ka: 'ამონაწერის დაუხარისხებელი ხაზები', en: 'Statement lines not sorted' }, value: String(w.unmatchedLines) },
    { label: { ka: 'ბატარეის შეცვლა', en: 'Battery swaps' }, value: `${absent.ka} · ${absent.en}`, absent: true },
  ];

  const notes = [
    'ბატარეების რაოდენობა დღევანდელი მდგომარეობით · The battery count is today’s, not the week’s.',
    `გადმოტანამდე გადახდილი: ${money(w.money.paidBeforeTransferTetri)} — კვირის შემოსავალში არ შედის · Paid before the transfer, not part of any week’s takings.`,
  ];
  if (w.utilisation.unassigned > 0) {
    notes.push(`${w.utilisation.unassigned} მოპედი პარკის გარეშე დატვირთვაში არ ითვლება · mopeds with no park are outside the utilisation figure.`);
  }

  return {
    groups: [
      { title: { ka: 'პარკი', en: 'The fleet' }, rows: fleet },
      { title: { ka: 'ფული', en: 'Money' }, rows: money_ },
      { title: { ka: 'დანარჩენი', en: 'The rest' }, rows: rest },
    ],
    notes,
  };
}

export function reportRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Query }>('/api/reports/week', { config: { scope: 'reports.view' } }, async (req) => {
    const { from, to } = periodOf(req);
    return weekReport(from, to);
  });

  app.get<{ Querystring: Query }>('/api/reports/week.pdf', { config: { scope: 'reports.view' } }, async (req, reply) => {
    const { from, to } = periodOf(req);
    const w = await weekReport(from, to);
    const { groups, notes } = pdfRows(w);
    const bytes = await renderWeekReport({ from, to, asOf: w.asOf === to ? null : w.asOf, groups, notes });
    return sendPdf(reply, `ev8-week-${from}.pdf`, bytes);
  });
}

function sendPdf(reply: FastifyReply, name: string, bytes: Buffer) {
  return reply
    .header('content-type', 'application/pdf')
    .header('content-length', String(bytes.length))
    .header('x-content-type-options', 'nosniff')
    .header('content-disposition', `inline; filename="${name.replace(/[^\w.\-]+/g, '_')}"`)
    .header('cache-control', 'private, no-store')
    .send(bytes);
}
