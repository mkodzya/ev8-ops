from proto_base import *
import proto_base
import re

# Календарь оплат, сетка месяца (Mika, 11.10.2026, по экрану на тестовом стенде): «давай чуть
# облегчим, воздуха добавим. предложи варианты».
# The page decides how the month grid of Деньги → «Календарь» gets lighter. It is a visual pass over
# the grid, the bar with the month and the legend: what a cell shows and what a tap does stay as built.
# First the screen as it is on the test stand, then three ways, the strongest first; А is the
# recommended one. Every one is drawn twice: the laptop's 448 px column and the phone's 343 px block
# with the month open.
#
# The sums and the counts are those of the test stand on 11.10.2026, read from the owner's screenshot:
# October 2026, today is Sunday 11.10, the chosen day is Saturday 17.10. There are no names anywhere.
#
# «As built» below is a copy of the product: the rules of apps/web/src/styles/app.css and
# apps/web/src/ds/money/money.css, the markup of apps/web/src/pages/money/CalendarParts.tsx. Each way
# keeps its own block after it: its rules, every one scoped under its own class (.air-open, .air-rows,
# .air-soft) so that «Сейчас» stays untouched, and its laptop legend, the only markup a way changes.
# Static markup, no script.

# ---------------------------------------------------------------------------
# The screen as built.
# ---------------------------------------------------------------------------
# The product's own rules, class names and values unchanged.
# Two things could not be copied literally, both are media queries: the product decides
# "laptop or phone" by the window's width, here both stand on one page. So
#   @media (min-width: 900px) { X }   is written   :where(.air-l) X
#   @media (max-width: 899px) { X }   is written   :where(.air-p) X
# :where() adds no weight, so every rule keeps the weight and the place it has in the product.
CSS_CURRENT = '''
/* ===== from apps/web/src/styles/app.css ===== */
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: var(--text-body);
  -webkit-font-smoothing: antialiased;
}
h3, button, .app-rail { font-family: var(--display); }

/* ---- controls ---- */
/* app.css: @media (min-width: 900px). It stands BEFORE the plain .pill there as well, and so
   loses to it; the calendar's laptop bar is all .pill-sm, which sets its own 34 px. */
:where(.air-l) .pill, :where(.air-l) .input { min-height: var(--control-dense); }
:where(.air-l) .pill { padding: 0 14px; }
.pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: var(--control);
  padding: 0 18px;
  border-radius: var(--radius-pill);
  border: var(--hairline) solid var(--ink);
  background: var(--surface);
  color: var(--ink);
  font: var(--text-button);
  letter-spacing: var(--tracking-button);
  transition: var(--ease);
  cursor: pointer;
}
.pill:hover, .pill.is-hover { color: var(--service); border-color: var(--service); }
.pill:active, .pill.is-pressed { background: var(--surface-2); }
.pill:focus-visible, .pill.is-focus { outline: none; box-shadow: var(--focus-ring); }
.pill:disabled, .pill.is-disabled { opacity: 0.5; cursor: default; }
.pill-sm { min-height: 34px; padding: 0 12px; font: var(--text-button-sm); }
/* app.css: @media (max-width: 899px) { :root { --control-dense: var(--control); } .pill-sm { min-height: var(--control); } } */
:where(.air-p) { --control-dense: var(--control); }
:where(.air-p) .pill-sm { min-height: var(--control); }

/* ===== from apps/web/src/ds/money/money.css — "The payments calendar" ===== */
.cal { min-width: 0; }
/* Links here are names and lines, not green words. */
.cal a { color: inherit; }
/* Said to a screen reader, not drawn. */
.cal-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }

/* State marks: a tick in a disc is paid, a tick in a ring is paid ahead, a
   dot is due today, a ring is expected, a square is overdue. */
.cal-mark { width: 18px; height: 18px; flex: none; display: inline-grid; place-items: center; border-radius: 50%; }
.cal-mark svg { width: 11px; height: 11px; display: block; stroke-width: 3.4; }
.cal-mark::before { box-sizing: border-box; }
.cal-mark-paid { background: var(--accent); color: var(--on-accent); }
.cal-mark-paid_ahead { border: 1.5px solid var(--accent); color: var(--accent); }
.cal-mark-paid_ahead svg { width: 10px; height: 10px; }
.cal-mark-due_today::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--ink); }
.cal-mark-expected::before { content: ""; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--grey); }
.cal-mark-overdue::before { content: ""; width: 12px; height: 12px; background: var(--crit); }
.cal-mark.sm { width: 12px; height: 12px; }
.cal-mark.sm svg { width: 8px; height: 8px; stroke-width: 4; }
.cal-mark-paid_ahead.sm svg { width: 7px; height: 7px; }
.cal-mark-due_today.sm::before { width: 8px; height: 8px; }
.cal-mark-expected.sm::before { width: 10px; height: 10px; }
.cal-mark-overdue.sm::before { width: 9px; height: 9px; }
/* The state's word. Grey is a shape colour, so "expected" is written in the grey ink. */
.cal-st-overdue { color: var(--crit-ink); }
.cal-st-due_today { color: var(--ink); }
.cal-st-expected { color: var(--grey-ink); }
.cal-st-paid, .cal-st-paid_ahead { color: var(--accent-ink); }

/* A round outline button: 44 px under a thumb, 34 px under a pointer —
   --control-dense is the thumb's measure below 900 px. */
.pill.cal-round { width: var(--control-dense); padding: 0; justify-content: center; flex: none; }

/* The calendar's own controls: back, forward, today, and the month by a button. */
.cal-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 4px; }
.cal-bar .pill { flex: none; }
.pill.cal-now { padding: 0 14px; }
.pill.cal-all { margin-left: auto; gap: 2px; padding: 0 10px 0 14px; }
.cal-title { font: var(--text-month); letter-spacing: var(--tracking-tight); white-space: nowrap; }
.cal-title-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 2px 2px; }
.cal-title-row .cal-legend { margin: 0; }
.cal-bar.dense { gap: 6px; margin: 0 0 8px; }
.cal-bar.dense .cal-title { margin: 0 8px; }
.cal-bar.dense .pill.cal-now { padding: 0 12px; }

/* Weekday names and the grid. A 2 px gap, not the 8 px between touch targets:
   with 8 px a cell on a 375 px phone would be 42 px wide (§8.12). */
.cal-wd, .cal-grid { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.cal-wd { margin: 0 0 3px; }
.cal-wd span { text-align: center; font: var(--text-overline); line-height: 16px; color: var(--muted); }
.cal-cell { position: relative; min-width: 0; min-height: 44px; margin: 0; padding: 3px 1px; border: 0; border-radius: 10px; background: var(--surface); color: var(--ink); font: inherit; box-shadow: inset 0 0 0 1px var(--line-soft); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; }
button.cal-cell { cursor: pointer; }
.cal-cell.week { min-height: 54px; gap: 0; }
.cal-cell.off, .cal-cell.none { background: transparent; box-shadow: none; }
.cal-n { font: var(--text-h3); line-height: 18px; }
.cal-cell.past .cal-n, .cal-cell.ahead .cal-n, .cal-cell.none .cal-n { color: var(--muted); }
.cal-cell.late { background: var(--crit-soft); box-shadow: none; }
/* The one lime in the page's content: today. The chosen day is a frame, over any ground. */
.cal-cell.today { background: var(--lime); box-shadow: none; }
.cal-cell.today .cal-n { font-weight: 600; }
.cal-cell.on { box-shadow: inset 0 0 0 2px var(--ink); }
.cal-cell-sum { font: var(--text-cell); font-variant-numeric: tabular-nums; white-space: nowrap; }
.cal-cell-count { font: var(--text-cell); font-weight: 400; color: var(--muted); white-space: nowrap; }
.cal-cell-count.all { color: var(--accent-ink); font-weight: 600; }
/* Outranks `.all` in colour only: today's «3 из 3» is ink and bold — there is no green text on lime (§8.14). */
.cal-cell.today .cal-cell-count { color: var(--ink); }
.cal-flag { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; background: var(--crit); }
/* The product's focus ring is a shadow and so is the cell's frame: appended, not replaced. */
.cal-cell:focus-visible { outline: none; z-index: 1; box-shadow: inset 0 0 0 1px var(--line-soft), var(--focus-ring); }
.cal-cell.late:focus-visible, .cal-cell.today:focus-visible { box-shadow: var(--focus-ring); }
.cal-cell.on:focus-visible { box-shadow: inset 0 0 0 2px var(--ink), var(--focus-ring); }

/* Laptop: the same cells, larger, with the day's sum and its marks. The side
   padding is 2 px where the frame draws 5 px: «1 790 ₾» in the 13 px mono
   needs about 55 px of a 60.6 px cell (§8.16). */
.cal-grid.big { gap: 4px; }
.cal-grid.big .cal-cell { min-height: 40px; padding: 6px 2px; align-items: stretch; gap: 0; text-align: start; }
.cal-grid.big .cal-cell.week { min-height: 100px; justify-content: flex-start; }
.cal-cell-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; min-width: 0; height: 18px; }
.cal-cell-total { font: var(--text-label); font-family: var(--mono); font-weight: 500; line-height: 18px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cal-cell.none .cal-cell-total { color: var(--muted); }
.cal-cell-marks { display: flex; flex-wrap: wrap; gap: 3px 4px; margin-top: 4px; }
.cal-cell-mark { display: inline-flex; align-items: center; gap: 2px; font: var(--text-mono-sm); font-weight: 500; line-height: 14px; white-space: nowrap; }
.cal-cell-tag { margin-top: auto; font: var(--text-cell); font-family: var(--display); font-weight: 600; white-space: nowrap; }

/* Legend. */
.cal-legend { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; margin: 4px 2px 6px; font: var(--text-overline); font-weight: 400; line-height: 16px; color: var(--muted); }
.cal-legend span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.cal-legend p { margin: 0; }
.cal-legend b { font-weight: 500; color: var(--ink); }
.cal-swatch { display: inline-block; flex: none; width: 12px; height: 12px; border-radius: 4px; background: var(--lime); box-shadow: inset 0 0 0 1px var(--line-control); }
.cal-legend.desk { display: block; margin: 10px 2px 0; }
.cal-legend-marks { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 14px; margin: 4px 0; }

/* Laptop: a narrow month and the lists. */
.cal-left { min-width: 0; max-width: 448px; }
'''

# ---------------------------------------------------------------------------
# The data: October 2026 exactly as the owner's screenshot shows it (the test stand).
# No names anywhere. Nothing here is made up; what the screenshot does not show is not written.
# ---------------------------------------------------------------------------
MONTH_TITLE = 'Октябрь 2026'
PREV_TITLE, NEXT_TITLE = 'Сентябрь 2026', 'Ноябрь 2026'     # what the arrows are called for a screen reader
WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
MM = '10'
TODAY = 11                      # Sunday
CHOSEN = 17                     # Saturday — the 2 px ink frame
WEEK = range(5, 12)             # the current week, Monday–Sunday
# 1 October is a Thursday; a None is a neighbouring month's day — an empty cell.
CELLS = [None, None, None] + list(range(1, 32)) + [None]
# Past weeks: how the day ended. 'paid' — everything paid, 'overdue' — somebody still owes.
PAST = {1: 'paid', 2: 'paid', 3: 'paid'}
# Days nobody pays on: not buttons, no box.
NOBODY = {4, 11, 18, 25}
# The current week: day -> (the sum due that day in lari, how many payments in each state).
THIS_WEEK = {
    5: (150, {'paid': 1}),
    6: (300, {'paid': 2}),
    7: (300, {'paid': 2}),
    8: (300, {'overdue': 1, 'paid': 1}),
    9: (300, {'overdue': 2}),
    10: (150, {'overdue': 1}),
}
# The order the marks stand in inside a laptop cell, and the order the laptop's legend names them in.
MARKS = ['overdue', 'due_today', 'expected', 'paid', 'paid_ahead']
LEGEND = ['paid', 'paid_ahead', 'due_today', 'expected', 'overdue']
STATE = {'paid': 'Оплачено', 'paid_ahead': 'Оплачено заранее', 'due_today': 'Ждём сегодня', 'expected': 'Ожидается', 'overdue': 'Просрочено'}
SAID = {'paid': 'оплачено', 'paid_ahead': 'оплачено заранее', 'due_today': 'ждём сегодня', 'expected': 'ожидается', 'overdue': 'просрочено'}
LEGEND_HOW = 'Цифра у отметки — число оплат, сумма — сколько должно прийти за день.'
LEGEND_WEEKS = 'В прошлых неделях — только итог дня: всё оплачено или есть просрочка. Недели впереди — расчёт, пока аренда идёт: те же дни и суммы.'

NBSP = ' '


def gel(lari):
    """formatGel(…, {decimals: false}): «150 ₾», «1 790 ₾» — no-break spaces throughout."""
    return f'{lari:,}'.replace(',', NBSP) + NBSP + '₾'


def ddmm(day):
    return f'{day:02d}.{MM}'


def kind(day):
    """calendarCellKind: 'past' | 'current' | 'ahead' — by the week of today."""
    return 'past' if day < WEEK[0] else 'ahead' if day > WEEK[-1] else 'current'


# lucide-react 0.577: the same paths, the same attributes the component writes.
LUCIDE = {
    'chevron-left': 'm15 18-6-6 6-6',
    'chevron-right': 'm9 18 6-6-6-6',
    'chevron-up': 'm18 15-6-6-6 6',
    'chevron-down': 'm6 9 6 6 6-6',
    'check': 'M20 6 9 17l-5-5',
}


def lucide(name, size=24, stroke=2):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" '
            f'stroke="currentColor" stroke-width="{stroke}" stroke-linecap="round" stroke-linejoin="round" '
            f'class="lucide lucide-{name}" aria-hidden="true"><path d="{LUCIDE[name]}"/></svg>')


def icon(name, size=18):
    """CalendarParts.tsx ICON = { size: 18, strokeWidth: 1.75 }; the fold's chevron is 14."""
    return lucide(name, size, 1.75)


def state_mark(state, small=False):
    """<StateMark>: the tick is lucide's Check, sized and thickened by .cal-mark svg."""
    tick = lucide('check') if state in ('paid', 'paid_ahead') else ''
    return f'<i class="cal-mark cal-mark-{state}{" sm" if small else ""}" aria-hidden="true">{tick}</i>'


def today_key(word):
    return f'<span><i class="cal-swatch"></i>{word}</span>'


def cell_classes(day):
    k = kind(day)
    late = (k == 'past' and PAST.get(day) == 'overdue') or (k == 'current' and THIS_WEEK.get(day, (0, {}))[1].get('overdue', 0) != 0)
    classes = ['cal-cell', 'week' if k == 'current' else k]
    if day == TODAY:
        classes.append('today')
    if day in NOBODY:
        classes.append('none')
    # Today stays lime whoever is late.
    if late and day != TODAY:
        classes.append('late')
    if day == CHOSEN:
        classes.append('on')
    return ' '.join(classes)


def day_cell(day, big):
    """<DayCell>: `big` is the laptop's cell, otherwise the phone's."""
    if day is None:
        return '<span class="cal-cell off" aria-hidden="true"></span>'
    k = kind(day)
    cls = cell_classes(day)
    current = ' aria-current="date"' if day == TODAY else ''
    n = f'<span class="cal-n">{day}</span>'

    # A day nobody pays on is not a button.
    if day in NOBODY:
        top = f'<span class="cal-cell-top" aria-hidden="true">{n}</span>' if big else f'<span aria-hidden="true">{n}</span>'
        dash = f'<span class="{"cal-cell-total" if big else "cal-cell-count"}" aria-hidden="true">—</span>' if k == 'current' else ''
        tag = '<span class="cal-cell-tag">сегодня</span>' if big and day == TODAY else ''
        return f'<span class="{cls}"{current}>{top}{dash}{tag}<span class="cal-sr">{ddmm(day)}: оплат нет</span></span>'

    label = ''
    if k == 'past':
        # An earlier week: only how the day ended.
        late = PAST[day] == 'overdue'
        mark = state_mark('overdue' if late else 'paid', small=True)
        label = f'{ddmm(day)}: есть просрочка' if late else f'{ddmm(day)}: всё оплачено'
        inner = f'<span class="cal-cell-top">{n}{mark}</span>' if big else n + mark
    elif k == 'ahead':
        # A week ahead is a calculation: the number alone. The product's label says «по расчёту N оплат»;
        # the screenshot does not show N, so no label is written here.
        inner = f'<span class="cal-cell-top">{n}</span>' if big else n
    else:
        lari, states = THIS_WEEK[day]
        total = sum(states.values())
        paid = states.get('paid', 0) + states.get('paid_ahead', 0)
        late = states.get('overdue', 0)
        if big:
            # This week on a laptop: the day's sum and every mark with its count.
            shown = [s for s in MARKS if states.get(s, 0) != 0]
            label = f'{ddmm(day)}: {gel(lari)}: ' + ', '.join(f'{SAID[s]} {states[s]}' for s in shown)
            marks = ''.join(f'<span class="cal-cell-mark cal-st-{s}">{state_mark(s, small=True)}{states[s]}</span>' for s in shown)
            tag = '<span class="cal-cell-tag">сегодня</span>' if day == TODAY else ''
            inner = f'<span class="cal-cell-top">{n}</span><span class="cal-cell-total">{gel(lari)}</span><span class="cal-cell-marks">{marks}</span>{tag}'
        else:
            # This week on a phone: the sum, how many of its payments are in, a red square if somebody is late.
            label = f'{ddmm(day)}: {gel(lari)}, оплачено {paid} из {total}' + (f', просрочено {late}' if late else '')
            inner = (f'{n}<span class="cal-cell-sum">{gel(lari)}</span>'
                     f'<span class="cal-cell-count{" all" if paid == total else ""}">{paid} из {total}</span>'
                     + ('<i class="cal-flag"></i>' if late else ''))
    aria = f' aria-label="{label}"' if label else ''
    pressed = 'true' if day == CHOSEN else 'false'
    return f'<button type="button" class="{cls}" aria-pressed="{pressed}"{current}{aria}>{inner}</button>'


def weekdays():
    return '<div class="cal-wd" aria-hidden="true">' + ''.join(f'<span>{w}</span>' for w in WEEKDAYS) + '</div>'


def grid(big):
    return (f'<div class="cal-grid{" big" if big else ""}" role="group" aria-label="{MONTH_TITLE}">'
            + ''.join(day_cell(d, big) for d in CELLS) + '</div>')


def period_bar(dense):
    """<PeriodBar>: `dense` is the laptop's bar (the month's name inside it); the phone's has the fold, shown open."""
    sm = ' pill-sm' if dense else ''
    bar = (f'<div class="cal-bar{" dense" if dense else ""}">'
           f'<button type="button" class="pill{sm} cal-round" aria-label="{PREV_TITLE}">{icon("chevron-left")}</button>'
           f'<button type="button" class="pill{sm} cal-round" aria-label="{NEXT_TITLE}">{icon("chevron-right")}</button>'
           + (f'<div class="cal-title">{MONTH_TITLE}</div>' if dense else '')
           + f'<button type="button" class="pill{sm} cal-now">Сегодня</button>'
           + ('' if dense else f'<button type="button" class="pill cal-all" aria-expanded="true">Свернуть{icon("chevron-up", 14)}</button>')
           + '</div>')
    if dense:
        return bar
    # The month is open: its name stands under the bar, today's key beside it.
    return bar + f'<div class="cal-title-row"><div class="cal-title">{MONTH_TITLE}</div><div class="cal-legend">{today_key("сегодня")}</div></div>'


def legend_desk():
    marks = ''.join(f'<span>{state_mark(s, small=True)}{STATE[s]}</span>' for s in LEGEND) + today_key('Сегодня')
    return f'<div class="cal-legend desk"><p>{LEGEND_HOW}</p><div class="cal-legend-marks">{marks}</div><p>{LEGEND_WEEKS}</p></div>'


def legend_phone_month():
    """<CalendarLegend variant="month">: counts, all paid, overdue; today's key stands by the month's name."""
    return ('<div class="cal-legend">'
            '<span><b>1 из 3</b>— оплачено</span>'
            f'<span>{state_mark("paid", small=True)}всё оплачено</span>'
            f'<span>{state_mark("overdue", small=True)}просрочено</span>'
            '</div>')


def laptop_block(extra_class=''):
    """The laptop's left column, 448 px: PeriodBar, weekdays, the big month grid, the legend."""
    cls = ('air air-l ' + extra_class).strip()
    return (f'<div class="{cls}"><div class="cal"><div class="cal-left">'
            + period_bar(dense=True) + weekdays() + grid(big=True) + legend_desk()
            + '</div></div></div>')


def phone_block(extra_class=''):
    """The phone, 343 px, «Весь месяц» pressed: the bar, the month's name with today's key, weekdays, the grid, the legend."""
    cls = ('air air-p ' + extra_class).strip()
    return (f'<div class="{cls}"><div class="cal">'
            + period_bar(dense=False) + weekdays() + grid(big=False) + legend_phone_month()
            + '</div></div>')


# ---------------------------------------------------------------------------
# А. «Без рамок» — the box goes: no hairline and no white tile on any day.
# ---------------------------------------------------------------------------
open_CSS = '''
/* ===== Без рамок =====
   Every selector is the product's own, scoped under .air-open. A rule marked «restated» changes nothing in
   the product: it stands here only because the scope makes rule 1 outweigh the product's own line. */

/* 1. The box goes — the hairline and the white tile, in every week. A ground stays only where it says
      something: a debt (pink), today (lime). Order is the cascade, as in money.css: late < today. */
.air-open .cal-cell { background: transparent; box-shadow: none; }
.air-open .cal-cell.late { background: var(--crit-soft); }            /* restated */
.air-open .cal-cell.today { background: var(--lime); }                /* restated */
/* The chosen day keeps its 2 px ink frame — now the only outline on the grid. */
.air-open .cal-cell.on { box-shadow: inset 0 0 0 2px var(--ink); }    /* restated */
/* The focus ring no longer brings the hairline with it. */
.air-open .cal-cell:focus-visible { box-shadow: var(--focus-ring); }
.air-open .cal-cell.on:focus-visible { box-shadow: inset 0 0 0 2px var(--ink), var(--focus-ring); }   /* restated */

/* 2. What the box used to say — «somebody pays on this day» — the number says now: a day nobody pays on
      is lighter and thinner (both screens). Today is left as it is: grey on lime would be 3.9:1. */
.air-open .cal-cell.none:not(.today) .cal-n { color: var(--grey); font-weight: 400; }
/* A pointer finds the button a box used to show. */
@media (hover: hover) {
  .air-open button.cal-cell:not(.late):not(.today):hover { background: var(--surface-hover); }
}

/* 3. Air around the grid — both screens. The phone's grid keeps its columns, gaps and row heights. */
.air-open .cal-bar { margin-bottom: 8px; }
.air-open .cal-title-row { margin-bottom: 6px; }
.air-open .cal-wd { margin-bottom: 6px; }
.air-open .cal-grid + .cal-legend { margin-top: 8px; }

/* 4. Laptop. Weekday names stand on the numbers' left edge (they were centred over left-set
      numbers, and without a box that shows), on the grid's own 4 px gap. */
.air-open .cal-bar.dense { margin-bottom: 14px; }
.air-open .cal-left .cal-wd { gap: 4px; }
.air-open .cal-left .cal-wd span { text-align: start; padding-left: 6px; }
/* 6 px from the cell's edge instead of 2; an ordinary day's number sits in the middle of its row. */
.air-open .cal-grid.big .cal-cell { padding: 6px 2px 6px 6px; justify-content: center; }
/* The current week is as tall as what stands in it: 8 + 18 + 18 + 6 + 14 + 8 = 72 of 76 (it was 100).
   On a day when today has payments its word is a fourth line and the row grows to 90 by itself. */
.air-open .cal-grid.big .cal-cell.week { min-height: 76px; padding-top: 8px; padding-bottom: 8px; justify-content: flex-start; }
/* A past day's tick or square stands beside its number, not at the far edge of a box that is gone. */
.air-open .cal-grid.big .cal-cell-top { justify-content: flex-start; gap: 5px; }
/* The sum in the text face, as the phone's cell sets it: «1 800 ₾» is 47 px instead of 57,
   and that pays for the 6 px (the cell holds 52.6). */
.air-open .cal-grid.big .cal-cell-total { font-family: var(--body); }
/* The count by a mark in the phone cell's own style (11 px): two marks, one with a two-digit count, keep one line. */
.air-open .cal-grid.big .cal-cell-marks { gap: 4px; margin-top: 6px; }
.air-open .cal-grid.big .cal-cell-mark { font: var(--text-cell); }
.air-open .cal-grid.big .cal-cell-tag { padding-top: 4px; }

/* 5. The laptop's legend: the five marks in one line, then one sentence. */
.air-open .cal-grid + .cal-legend.desk { margin-top: 14px; }
.air-open .cal-legend.desk .cal-legend-marks { margin: 0; gap: 4px 8px; }
.air-open .cal-legend.desk p { margin-top: 4px; }
'''

# The laptop legend's words when the keys are one line: the product's own lower-case state words
# (t.calendar.said), with «оплачено заранее» cut to «заранее» — it stands right after «оплачено».
open_LEGEND_SHORT = {'paid': 'оплачено', 'paid_ahead': 'заранее', 'due_today': 'ждём сегодня', 'expected': 'ожидается', 'overdue': 'просрочено'}


def open_legend_desk():
    """<CalendarLegend variant="desk">: the five marks, always, in one line; then legendHow (the current week is on screen).
    No lime key — the laptop's cell says «сегодня»; no legendWeeks."""
    marks = ''.join('<span>' + state_mark(s, small=True) + open_LEGEND_SHORT[s] + '</span>' for s in LEGEND)
    return '<div class="cal-legend desk"><div class="cal-legend-marks">' + marks + '</div><p>' + LEGEND_HOW + '</p></div>'


def open_laptop():
    # laptop_block with the legend replaced; the bar, the weekdays and the grid are the product's markup untouched.
    return ('<div class="air air-l air-open"><div class="cal"><div class="cal-left">'
            + period_bar(dense=True) + weekdays() + grid(big=True) + open_legend_desk()
            + '</div></div></div>')


def open_phone(): return phone_block('air-open')


# ---------------------------------------------------------------------------
# Б. «Строки недель» — rows, not boxes: one line over every week.
# ONLY overrides. Every selector is scoped under .air-rows; class names are the product's; colours are tokens.
#   «.cal-grid.big …» and «.cal-left …» are the laptop's (the product keeps those rules outside a media query too),
#   the plain «.cal-cell …» rules are the phone's and the common ones.
# ---------------------------------------------------------------------------
rows_CSS = '''
/* ===== Строки недель ===== */

/* -- The bar: more air under it. The buttons themselves are not touched. -- */
.air-rows .cal-bar { margin-bottom: 8px; }
.air-rows .cal-bar.dense { margin-bottom: 14px; }
.air-rows .cal-title-row { margin: 0 2px 8px; }

/* -- Rows, not boxes. The columns join (no gap), so one line runs under the weekdays and over every week. -- */
.air-rows .cal-wd,
.air-rows .cal-grid,
.air-rows .cal-grid.big { gap: 0; }
.air-rows .cal-wd { margin-bottom: 6px; }

/* The cell itself draws nothing but its week's line — in every state. */
.air-rows .cal-cell,
.air-rows .cal-cell.off,
.air-rows .cal-cell.none,
.air-rows .cal-cell.late,
.air-rows .cal-cell.today,
.air-rows .cal-cell.on,
.air-rows .cal-cell:focus-visible,
.air-rows .cal-cell.late:focus-visible,
.air-rows .cal-cell.today:focus-visible,
.air-rows .cal-cell.on:focus-visible {
  background: transparent;
  border-radius: 0;
  box-shadow: inset 0 1px 0 var(--line);
  isolation: isolate;
}

/* -- Today, the chosen day and the keyboard's ring keep the look they have now — a lime ground, a 2 px ink
      frame, the product's ring, all the size of the cell with its 10 px corners — but stand 3 px clear of the
      week's lines, so the lines run unbroken. Drawn under the cell's content, inside the cell. -- */
.air-rows .cal-cell.today::before,
.air-rows .cal-cell.on::before,
.air-rows .cal-cell:focus-visible::before,
.air-rows button.cal-cell:hover::before {
  content: "";
  position: absolute;
  z-index: -1;
  top: 3px; right: 1px; bottom: 3px; left: 1px;
  border-radius: 10px;
}
/* A day that opens says so under the pointer (in the product: inside @media (hover: hover)). */
.air-rows button.cal-cell:hover::before { background: var(--surface-hover); }
/* The one lime thing. */
.air-rows .cal-cell.today::before,
.air-rows button.cal-cell.today:hover::before { background: var(--lime); }
.air-rows .cal-cell.on::before { box-shadow: inset 0 0 0 2px var(--ink); }
.air-rows .cal-cell:focus-visible::before { box-shadow: var(--focus-ring); }
.air-rows .cal-cell.on:focus-visible::before { box-shadow: inset 0 0 0 2px var(--ink), var(--focus-ring); }

/* -- The number stands in a box of its own, so a day somebody owes on can lay a pink pill under it:
      what is left of the pink cell. Today has no .late (as now) and stays lime. -- */
.air-rows .cal-n {
  display: grid;
  place-items: center;
  min-width: 28px;
  height: 22px;
  padding: 0 6px;
  border-radius: var(--radius-pill);
  line-height: 1;
}
.air-rows .cal-cell.late .cal-n { background: var(--crit-soft); }
/* A day nobody pays on: lighter and thinner — it is not a button. Today's own number is left as it is. */
.air-rows .cal-cell.none:not(.today) .cal-n { color: var(--grey); font-weight: 400; }

/* -- Phone: seven columns of 49 px. A row is as tall as what stands in it: numbers only — 44 px,
      a past week with its marks — 50 px, the current week — 64 px. Content stays centred, as now. -- */
.air-rows .cal-cell { min-height: 44px; padding: 7px 1px; gap: 0; }
/* In a row with something under the numbers the numbers share one line. */
.air-rows .cal-cell.week,
.air-rows .cal-cell.past { justify-content: flex-start; }
.air-rows .cal-cell.week { min-height: 64px; }
.air-rows .cal-cell.past .cal-mark { margin-top: 2px; }
/* The red square keeps its corner; moved in so the chosen day's frame does not cut it. */
.air-rows .cal-flag { top: 9px; right: 7px; }

/* -- Laptop: seven columns of 64 px, content at the left edge of its column, as now — and the weekday's
      name over it. 44 px for a row of numbers (past weeks too: the mark stands beside the number),
      76 px for the current week. -- */
.air-rows .cal-left .cal-wd span { padding-left: 11px; text-align: start; }
.air-rows .cal-grid.big .cal-cell { min-height: 44px; padding: 8px 2px 8px 11px; }
.air-rows .cal-grid.big .cal-cell.past { justify-content: center; }
.air-rows .cal-grid.big .cal-cell.week { min-height: 76px; }
/* The pill hangs 6 px to the left, so the number's digits stand on the same edge as the sum under them. */
.air-rows .cal-grid.big .cal-n { min-width: 22px; margin-left: -6px; }
.air-rows .cal-cell-top { justify-content: flex-start; gap: 3px; height: 22px; }
/* The sum in the text face, the counts in the cell's own text style — what the phone's cell already uses for both. */
.air-rows .cal-cell-total { margin-top: 2px; font-family: var(--body); }
.air-rows .cal-cell-marks { gap: 3px 6px; }
.air-rows .cal-cell-mark { font: var(--text-cell); }
/* «сегодня» stays at the bottom of the cell; when the day's content reaches it, 4 px stay between them. */
.air-rows .cal-cell-tag { padding-top: 4px; }

/* -- The legend: under the line that closes the month. On a laptop — the keys alone. -- */
.air-rows .cal-grid + .cal-legend { margin: 0 0 6px; padding: 8px 2px 0; border-top: 1px solid var(--line); }
.air-rows .cal-grid + .cal-legend.desk { margin: 0; padding: 10px 2px 0; }
.air-rows .cal-legend-marks { margin: 0; gap: 4px 14px; }

/* -- Loading: the grey blocks keep their gaps (joined, they would fuse into one slab) and take the new heights. -- */
.air-rows .cal-skel .cal-grid { gap: 2px; }
.air-rows .cal-skel .cal-grid.big { gap: 4px; }
.air-rows .skel.cal-skel-cell { height: 64px; }
.air-rows .skel.cal-skel-cell.low { height: 44px; }
.air-rows .cal-grid.big .skel.cal-skel-cell { height: 44px; }
'''


def rows_legend_desk():
    """<CalendarLegend variant="desk"> without its two sentences: the row of keys exactly as the product writes it."""
    marks = ''.join('<span>' + state_mark(s, small=True) + STATE[s] + '</span>' for s in LEGEND) + today_key('Сегодня')
    return '<div class="cal-legend desk"><div class="cal-legend-marks">' + marks + '</div></div>'


def rows_laptop():
    # laptop_block() with the keys-only legend in place of legend_desk(); the bar's and the grid's markup are untouched.
    return ('<div class="air air-l air-rows"><div class="cal"><div class="cal-left">'
            + period_bar(dense=True) + weekdays() + grid(big=True) + rows_legend_desk()
            + '</div></div></div>')


def rows_phone(): return phone_block('air-rows')


# ---------------------------------------------------------------------------
# В. «Мягкие клетки» — the same cells, the same sizes, without their hairlines.
# Only overrides. Every selector is scoped under .air-soft (the wrapper). The laptop's own rules go through
# `.cal-grid.big` or `.cal-left` — the phone's tree has neither.
# ---------------------------------------------------------------------------
soft_CSS = '''
/* ===== variant «soft»: the same cells, the same sizes, without their hairlines ===== */

/* ---- air around the grid. The bar's controls are the system's pills, untouched. ---- */
.air-soft .cal-bar { margin-bottom: 8px; }
.air-soft .cal-bar.dense { margin-bottom: 14px; }
.air-soft .cal-title-row { margin-bottom: 6px; }
.air-soft .cal-wd { margin-bottom: 6px; }
.air-soft .cal-grid + .cal-legend { margin-top: 8px; }
.air-soft .cal-grid + .cal-legend.desk { margin-top: 14px; }

/* ---- the grid: the columns as built, on the phone 2 px more between the weeks ---- */
/* Phone: 2 px between the columns stays — a cell is (343 - 12) / 7 = 47.29 px, the width the 11 px sum is
   sized for (§8.12). Between the rows 2 -> 4 px. */
.air-soft .cal-grid { gap: 4px 2px; }
/* Laptop: 4 px both ways, as now — a cell is (448 - 24) / 7 = 60.57 px. Restated only because the rule
   above outweighs the product's `.cal-grid.big`; in money.css that rule does not change. */
.air-soft .cal-grid.big { gap: 4px; }
/* Laptop: the weekday names stand on the grid's own columns (they had 2 px gaps over a 4 px grid) and over
   the numbers — both 6 px from the cell's edge. */
.air-soft .cal-left .cal-wd { gap: 4px; margin-bottom: 8px; }
.air-soft .cal-left .cal-wd span { text-align: start; padding-left: 6px; }

/* ---- the cell: the hairline goes, on every day ---- */
/* The white ground stays (the product's own rule); the pink of a debt, the lime of today, the transparent
   day nobody pays on and the empty neighbouring-month cell are the product's rules, untouched. */
.air-soft .cal-cell { box-shadow: none; }
/* The chosen day: the 2 px ink frame, over white, pink or lime — as now. */
.air-soft .cal-cell.on { box-shadow: inset 0 0 0 2px var(--ink); }
/* The focus ring no longer brings the hairline with it. */
.air-soft .cal-cell:focus-visible { box-shadow: var(--focus-ring); }
.air-soft .cal-cell.on:focus-visible { box-shadow: inset 0 0 0 2px var(--ink), var(--focus-ring); }
/* A day that opens something lights up under a pointer, the way a row does: the frame no longer says it
   can be pressed. Pink and lime keep their colour. Touch screens are not asked. */
@media (hover: hover) {
  .air-soft button.cal-cell { transition: background-color var(--ease); }
  .air-soft button.cal-cell:not(.late):not(.today):hover { background: var(--surface-2); }
}
/* A day nobody pays on steps back: a lighter and thinner number. Today is left out of the rule, so today
   without payments stays exactly as it is now, whatever the order of the rules. */
.air-soft .cal-cell.none:not(.today) .cal-n { color: var(--grey); font-weight: 400; }

/* ---- laptop: what stands in a cell ---- */
/* 6 px of air on the left instead of 2 px. The right side keeps the product's 2 px (§8.16): the inner
   width is 60.57 - 8 = 52.57 px, and the row of marks wraps at it — clear of the 2 px frame of a chosen day.
   Heights are not touched: 40 px, the current week 100 px. */
.air-soft .cal-grid.big .cal-cell { padding: 6px 2px 6px 6px; }
/* A past day has no frame to hold its mark by the far edge: the mark stands right after the number. */
.air-soft .cal-grid.big .cal-cell.past .cal-cell-top { justify-content: flex-start; gap: 6px; }
/* The day's sum: the label style as it is named — 13 px, regular, the text face (the phone's cell sets its
   sum in the text face too). «300 ₾» is 38.5 px, «2 400 ₾» 50.7 px, in 52.57 px. */
.air-soft .cal-cell-total { font: var(--text-label); line-height: 18px; font-variant-numeric: tabular-nums; }
/* The count beside a mark: the cell's own 11 px style. The marks themselves stay 12 px, as in the legend. */
.air-soft .cal-cell-mark { font: var(--text-cell); }

/* ---- the laptop's legend: the marks, then the one sentence about the figures ---- */
.air-soft .cal-legend-marks { gap: 4px 14px; margin: 0 0 4px; }
'''


def soft_legend_desk():
    """The laptop's legend: the five marks and today's key as they are, then the product's own sentence about
    the figures (the current week is on screen here, so it is shown). The paragraph about the weeks is gone."""
    marks = ''.join('<span>' + state_mark(s, small=True) + STATE[s] + '</span>' for s in LEGEND)
    marks += today_key('Сегодня')
    return '<div class="cal-legend desk"><div class="cal-legend-marks">' + marks + '</div><p>' + LEGEND_HOW + '</p></div>'


def soft_laptop():
    # laptop_block('air-soft') with the legend replaced — the variant's only markup change.
    return ('<div class="air air-l air-soft"><div class="cal"><div class="cal-left">'
            + period_bar(dense=True) + weekdays() + grid(big=True) + soft_legend_desk()
            + '</div></div></div>')


def soft_phone(): return phone_block('air-soft')


# ---------------------------------------------------------------------------
# The page: «Сейчас», then А, Б, В — each as the laptop's column and the phone's block, side by side.
# ---------------------------------------------------------------------------
# The figures of the screenshot, checked before a frame is drawn.
assert len(CELLS) == 35 and CELLS.index(1) == 3 and CELLS[-2] == 31            # 1 October is a Thursday
assert [THIS_WEEK[d][0] for d in range(5, 11)] == [150, 300, 300, 300, 300, 150]
assert [(s.get('paid', 0), s.get('overdue', 0)) for _, s in THIS_WEEK.values()] == [(1, 0), (2, 0), (2, 0), (1, 1), (0, 2), (0, 1)]
assert (TODAY, CHOSEN, sorted(NOBODY), sorted(PAST)) == (11, 17, [4, 11, 18, 25], [1, 2, 3])
# «Сейчас» stays as built: every rule of a way is scoped under that way's class.
for _scope, _css in (('.air-open', open_CSS), ('.air-rows', rows_CSS), ('.air-soft', soft_CSS)):
    _rules = re.sub(r'/\*.*?\*/', '', _css, flags=re.S).replace('@media (hover: hover) {', '')
    assert all(s.strip().startswith(_scope + ' ') for sel in re.findall(r'([^{}]+)\{', _rules) for s in sel.split(','))


def fig(block, caption):
    """A frame: the block and a caption under it. The block's wrapper (.air) is the sheet it stands on."""
    return '<figure class="f">' + block + '<figcaption>' + caption + '</figcaption></figure>'


LEAD = ('Три способа сделать сетку месяца в «Деньги → Календарь» легче; что показано в клетках и что происходит по нажатию, остаётся как есть. '
        'Рекомендую А, «Без рамок»: с экрана уходит больше всего линий, а долг, «сегодня» и выбранный день видны как раньше.')

BANDS = [
 ('Сейчас — как на тесте',
  fig(laptop_block(), 'Ноутбук, как сейчас.') +
  fig(phone_block(), 'Телефон, месяц раскрыт, как сейчас.')),

 ('А. Без рамок — рекомендую',
  fig(open_laptop(),
      '<b>А. Без рамок — рекомендую.</b> Рамок и белой заливки у дней нет, цвет — только у долга и у «сегодня»; '
      'подпись под сеткой — две строки. Цена: день с оплатами отличает от пустого только тёмное число.') +
  fig(open_phone(), '<b>А на телефоне.</b> Те же клетки без рамок и заливки, размер прежний.')),

 ('Б. Строки недель',
  fig(rows_laptop(),
      '<b>Б. Строки недель.</b> Вместо рамок — тонкая линия над каждой неделей; у долга розовая только плашка с числом, '
      'а не вся клетка. Цена: долг издалека заметен слабее, день меньше похож на кнопку.') +
  fig(rows_phone(), '<b>Б на телефоне.</b> То же; строка этой недели чуть выше.')),

 ('В. Мягкие клетки',
  fig(soft_laptop(),
      '<b>В. Мягкие клетки.</b> Клетки на своих местах и того же размера, но без тонкой рамки; суммы набраны светлее, '
      'вокруг сетки больше воздуха. Цена: белая клетка без рамки почти сливается с фоном страницы.') +
  fig(soft_phone(), '<b>В на телефоне.</b> Клетки без рамки, между неделями чуть больше места.')),
]

NOTES = (
 '<h2>Что выбрать</h2><p style="max-width:1000px">'
 '<b>Рекомендую А, «Без рамок»</b>: линий и заливок на экране становится меньше всего, а долг, «сегодня» и выбранный день видны как раньше. '
 '<b>Б</b> — если хочется, чтобы месяц читался строками недель: это самый заметный шаг, и долг в нём виден слабее. '
 '<b>В</b> — если клетки лучше оставить как есть и только снять рамки: перемена самая малая.</p>'
 '<h2>Что дальше</h2><p style="max-width:1000px">После выбора правка идёт на тестовый стенд, на боевой — по слову Mika вместе с календарём.</p>')

page('payments-calendar-air-options.html', 'Календарь · легче и с воздухом', LEAD,
 [('Запрос', 'Mika, 11.10.2026, по экрану на тестовом стенде: «давай чуть облегчим, воздуха добавим. предложи варианты»'),
  ('Что меняется', 'Только вид сетки месяца, строки с месяцем и подписи под сеткой — на ноутбуке и на телефоне. '
                   'Что показано в клетке и что происходит по нажатию, остаётся как есть.'),
  ('Данные', 'Суммы и число оплат — как на тестовом стенде 11.10.2026: октябрь, сегодня воскресенье 11.10, выбрана суббота 17.10. Имён нет.')],
 BANDS, NOTES)

# The page's own styles, after the shared ones: Inter (the product's index.html asks for it — it sets the
# Cyrillic), then the product's rules, the three ways, and the frames.
INTER = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">'
out = OUT / 'payments-calendar-air-options.html'
# proto_base calls its laptop frame .desk, and the product's laptop legend is «cal-legend desk». The frame's
# box is taken off the legend before the product's rules are read; :where() keeps the weight of one class.
UNFRAME = '''
.desk:where(.cal-legend) { width: auto; height: auto; border: 0; border-radius: 0; overflow: visible; background: transparent; box-shadow: none; grid-template-columns: none; }
'''
# The product's body rule (in CSS_CURRENT) paints the whole page --bg. Around the frames the page keeps the
# prototypes' own ground, read from proto_base, so that a frame is seen as a sheet.
GROUND = re.search(r'body \{[^}]*background: ([^;]+);', proto_base.CSS).group(1)
PAGE_CSS = '''
/* ===== the page around the blocks — not the product ===== */
body { background: ''' + GROUND + '''; }
/* A frame is as wide as its block and does not stretch. The block stands on the product's page ground
   (--bg: the cells are --surface on it, as on the stand), with the product's card radius. */
.air { padding: 24px; border-radius: var(--radius-card); background: var(--bg); }
.air-l { width: 496px; }                                            /* the laptop's 448 px column + 24 + 24 */
.air-p { width: 375px; padding-left: 16px; padding-right: 16px; }   /* the phone's 343 px + its 16 px gutters: a 375 px screen */
figure.f > .air-l + figcaption { max-width: 488px; }
figure.f > .air-p + figcaption { max-width: 367px; }
'''
out.write_text(out.read_text().replace('</head>', INTER + '<style>' + UNFRAME + CSS_CURRENT + open_CSS + rows_CSS + soft_CSS + PAGE_CSS + '</style></head>', 1))
assert '<script' not in out.read_text()
