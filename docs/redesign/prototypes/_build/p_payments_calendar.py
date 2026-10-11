from proto_base import *
import proto_base
proto_base.WAVE1 = False

# Календарь платежей (Mika, 11.10.2026): «в разделе деньги календарь платежей — ясный,
# понятный и лёгкий в использовании. Сначала покажи все варианты в html».
# The page decides how the new tab Деньги → «Календарь» shows the weekly rent of the
# running rentals: who pays on which day, what is paid, what is late. Five ways, each
# drawn on a phone and on a laptop, the strongest first; А is the recommended one.
#
# Example data only — clients, rental numbers and sums are invented (ПРИМЕР). Every
# concept draws the same twelve rentals and the same week, 12.10 – 18.10.2026, with
# «today» on Wednesday 14.10, and checks its own figures with asserts before it draws.
#
# Each concept keeps its own block below: its styles (classes pc-<key>-…, tokens only),
# its helpers under its own prefix, and <key>_bands(letter, rec), which returns its bands.
# Static markup, no script; a fold is <details> and opens by its own «Показать» button.

# ---- shared chrome, the same in every variant ----
MONEY_TABS = ['Календарь', 'Разобрать 5', 'Платежи', 'Касса 1', 'Выписки', 'Залоги']
def stabs(on='Календарь'):
    return '<div class="chips">' + ''.join('<span class="chip' + (' on' if t == on else '') + '">' + t + '</span>' for t in MONEY_TABS) + '</div>'
def dmain(body, sub=''):
    tabs = ''.join('<a class="' + ('on' if t == 'Календарь' else '') + '" href="#">' + t + '</a>' for t in MONEY_TABS)
    return '<div class="d-head"><h2>Деньги</h2><span class="sub">' + sub + '</span></div><div class="d-tabs">' + tabs + '</div><div class="d-body">' + body + '</div>'

# ---- words every caption says the same way ----
# The money form is the product's existing one (MoneyForm): it opens with the rental chosen and today's date;
# the amount is empty until the chip «долг» inside the form sets it. No variant promises more than that.
FORM_HINT = ('«Принять оплату» открывает обычную форму денег: арендатор и аренда уже выбраны, дата сегодняшняя, '
             'сумму ставит кнопка «долг» в самой форме.')
# The unsorted bank lines: one sentence on every screen, with the count the tab «Разобрать 5» shows.
UNSORTED = int(MONEY_TABS[1].split()[-1])
SORT_HINT = 'В «Разобрать» ' + str(UNSORTED) + ' поступлений — среди них могут быть оплаты аренды'


# ====================================================================================================
# А · weekstrip · «Полоса недели»
# ====================================================================================================
# Календарь платежей (Mika, 11.10.2026) - concept "week strip and day".
# A strip of seven day tiles, the debtors' line under it, one day selected, that day in full below.
# On a laptop the week is seven columns. Example data only, static markup.
# Round 2, after three judges: debtors are pinned under the strip, cards are shorter, every state is drawn.

weekstrip_NAME = 'Полоса недели'
weekstrip_PITCH = ('Лучше всего отвечает на «кто платит сегодня, кто завтра и кто должен»: неделя видна семью плитками '
         'с суммой дня, под ними — строка должников и выбранный день списком людей с крупными кнопками; '
         'на ноутбуке вся неделя раскрыта семью колонками.')
weekstrip_COST = ('На телефоне с кнопками виден один день: остальные дни недели стоят ниже короткими строками, '
        'и чтобы принять оплату или напомнить, день нужно открыть нажатием; месяц целиком не виден.')

weekstrip_CSS = '''
/* ===== weekstrip: marks shared by tiles, rows and columns ===== */
.pc-weekstrip-mk { width: 9px; height: 9px; flex: none; display: inline-block; }
.pc-weekstrip-mk-late { background: var(--crit); border-radius: 1px; }
.pc-weekstrip-mk-exp { border: 2px solid var(--grey); border-radius: 50%; }
.pc-weekstrip-mk-today { background: var(--ink); border-radius: 50%; }
.pc-weekstrip-tk { width: 14px; height: 14px; flex: none; border-radius: 50%; display: inline-grid; place-items: center; background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent); }
.pc-weekstrip-tk-early { background: var(--surface); color: var(--accent); }
.pc-weekstrip-tki { width: 9px; height: 9px; display: block; fill: none; stroke: currentColor; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.pc-weekstrip-go { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--muted); vertical-align: -3px; }
.pc-weekstrip-c-late { color: var(--crit-ink); }
.pc-weekstrip-c-paid, .pc-weekstrip-c-early { color: var(--accent-ink); }
.pc-weekstrip-c-exp { color: var(--grey-ink); }
.pc-weekstrip-c-today { color: var(--ink); }
.pc-weekstrip-nw { white-space: nowrap; }
/* the size of a day as a shape: length = expected that day, green part = already paid */
.pc-weekstrip-meter { display: block; align-self: stretch; height: 6px; }
.pc-weekstrip-meter i { display: block; height: 6px; border: 1px solid var(--grey); border-radius: 3px; background: var(--surface); overflow: hidden; }
.pc-weekstrip-meter i.pc-weekstrip-full { border-color: var(--accent); }
.pc-weekstrip-meter b { display: block; height: 100%; background: var(--accent); }
.pc-weekstrip-lnk { color: var(--accent-ink); font-weight: 500; text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }

/* ===== phone: the week card ===== */
.pc-weekstrip-week { background: var(--surface); border-radius: var(--radius-card); padding: 6px 8px 8px; margin-bottom: 8px; }
.pc-weekstrip-nav { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; gap: 8px; margin-bottom: 2px; }
.pc-weekstrip-arrow { width: 44px; height: 44px; flex: none; border-radius: 50%; border: 1px solid var(--line-control); background: var(--surface); color: var(--ink); display: grid; place-items: center; }
.pc-weekstrip-wk { min-width: 0; text-align: center; }
.pc-weekstrip-wk b { display: block; font: 500 17px/1.25 var(--display); letter-spacing: var(--tracking-tight); white-space: nowrap; }
.pc-weekstrip-wk span { display: block; font: var(--text-label); color: var(--muted); }
.pc-weekstrip-tiles { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; }
.pc-weekstrip-tile { position: relative; min-width: 0; min-height: 82px; padding: 4px 0; display: flex; flex-direction: column; align-items: center; border-radius: 12px; background: var(--surface-2); color: var(--ink); }
.pc-weekstrip-is-today.pc-weekstrip-tile { background: var(--lime); }
.pc-weekstrip-is-sel.pc-weekstrip-tile { box-shadow: inset 0 0 0 2px var(--ink); }
.pc-weekstrip-is-none.pc-weekstrip-tile { color: var(--muted); }
.pc-weekstrip-t-wd { font: 500 11px/13px var(--display); color: var(--muted); }
.pc-weekstrip-is-today .pc-weekstrip-t-wd { color: var(--ink); }
.pc-weekstrip-t-d { font: 600 17px/21px var(--display); }
.pc-weekstrip-t-sum { font: 500 11px/16px var(--body); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-weekstrip-tile .pc-weekstrip-meter { margin: 2px 3px 3px; }
.pc-weekstrip-t-st { height: 14px; display: flex; align-items: center; justify-content: center; font: 600 11px/14px var(--body); white-space: nowrap; }
.pc-weekstrip-t-flag { position: absolute; top: 6px; right: 4px; width: 7px; height: 7px; }
.pc-weekstrip-total { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0 8px; margin: 6px 4px 0; font: var(--text-label); color: var(--muted); }
.pc-weekstrip-total span { white-space: nowrap; }
.pc-weekstrip-total b { font: 600 13px/1.4 var(--body); font-variant-numeric: tabular-nums; color: var(--ink); }
.pc-weekstrip-total b.pc-weekstrip-c-paid { color: var(--accent-ink); }
/* a fold: opens by its own plain button, «Показать» / «Скрыть» */
.pc-weekstrip-det > summary { list-style: none; cursor: pointer; }
.pc-weekstrip-det > summary::-webkit-details-marker { display: none; }
.pc-weekstrip-wo { display: none; }
.pc-weekstrip-det[open] > summary .pc-weekstrip-wo { display: inline; }
.pc-weekstrip-det[open] > summary .pc-weekstrip-wc { display: none; }
.pc-weekstrip-pill { min-height: 44px; padding: 0 14px; flex: none; display: inline-flex; align-items: center; border-radius: 999px; border: 1px solid var(--ink); background: var(--surface); color: var(--ink); font: 500 13px/1 var(--display); white-space: nowrap; }
/* the debtors' line: the same under any selected day. It closes the week card; opened, its list stands in place of the day */
.pc-weekstrip-week.pc-weekstrip-week-top { border-radius: var(--radius-card) var(--radius-card) 0 0; padding-bottom: 0; margin-bottom: 0; }
.pc-weekstrip-latebox { display: block; margin: -1px 0 8px; padding: 7px 8px 8px; background: var(--surface); border-radius: 0 0 var(--radius-card) var(--radius-card); }
.pc-weekstrip-late { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: center; min-height: 52px; padding: 4px 4px 4px 12px; border-radius: 12px; background: var(--crit-soft); color: var(--crit-ink); }
.pc-weekstrip-debt[open] .pc-weekstrip-late { box-shadow: inset 0 0 0 2px var(--ink); }
.pc-weekstrip-debt[open] + .pc-weekstrip-dayv { display: none; }
.pc-weekstrip-late-x { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.pc-weekstrip-late-t { min-width: 0; font: 400 13px/1.4 var(--body); }
.pc-weekstrip-late-t b { font-weight: 600; font-variant-numeric: tabular-nums; }
.pc-weekstrip-late-t .pc-weekstrip-mk { margin-right: 6px; }
.pc-weekstrip-late-n { font: 400 12px/1.4 var(--body); color: var(--ink); }

/* ===== phone: the selected day ===== */
.pc-weekstrip-day { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 8px; align-items: baseline; align-content: center; min-height: 44px; margin: 0 2px 4px; }
.pc-weekstrip-day > b { min-width: 0; font: 500 17px/1.3 var(--display); letter-spacing: var(--tracking-tight); }
.pc-weekstrip-day > small { grid-column: 1 / -1; font: var(--text-label); color: var(--muted); }
.pc-weekstrip-day-n { font: var(--text-label); color: var(--muted); white-space: nowrap; text-align: right; }
.pc-weekstrip-day-n b { font: 600 13px/1.4 var(--body); font-variant-numeric: tabular-nums; color: var(--crit-ink); }
.pc-weekstrip-row { background: var(--surface); border-radius: var(--radius-card); margin-bottom: 6px; }
.pc-weekstrip-is-late.pc-weekstrip-row { box-shadow: inset 3px 0 0 var(--crit); }
.pc-weekstrip-top { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; align-items: end; min-height: 44px; padding: 10px 14px 0; }
.pc-weekstrip-name { grid-column: 1; grid-row: 1; min-width: 0; font: 500 15px/20px var(--body); overflow-wrap: anywhere; }
.pc-weekstrip-sum { grid-column: 2; grid-row: 1; text-align: right; font: 500 17px/20px var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-weekstrip-sum small { display: block; font: 400 11px/11px var(--body); }
.pc-weekstrip-sub { grid-column: 1 / -1; grid-row: 2; font: var(--text-label); color: var(--muted); }
.pc-weekstrip-stx { font-weight: 500; white-space: nowrap; }
.pc-weekstrip-stx .pc-weekstrip-mk { margin-right: 5px; }
.pc-weekstrip-stx .pc-weekstrip-tk { margin-right: 5px; vertical-align: -2px; }
.pc-weekstrip-acts { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 14px 10px; }
.pc-weekstrip-btn { min-height: 44px; padding: 0 10px; flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 999px; border: 1px solid var(--ink); background: var(--surface); color: var(--ink); font: 500 13px/1 var(--display); white-space: nowrap; }
.pc-weekstrip-grow.pc-weekstrip-btn { flex: 1 1 auto; min-width: 0; }
.pc-weekstrip-round.pc-weekstrip-btn { width: 44px; padding: 0; }
.pc-weekstrip-wide.pc-weekstrip-btn { display: flex; margin: 12px 0 0; }
/* a card that holds several short lines: paid people, the other days of the week */
.pc-weekstrip-list { background: var(--surface); border-radius: var(--radius-card); margin-bottom: 6px; overflow: hidden; }
.pc-weekstrip-list > * + * { border-top: 1px solid var(--line-soft); }
.pc-weekstrip-list .pc-weekstrip-top { padding-bottom: 10px; }
.pc-weekstrip-row + .pc-weekstrip-paid { margin-top: 10px; }
.pc-weekstrip-ix { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0 10px; align-items: baseline; min-height: 44px; padding: 10px 14px; }
.pc-weekstrip-ix b { font: 500 15px/20px var(--body); }
.pc-weekstrip-ix-n { font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-weekstrip-ix-who { grid-column: 1 / -1; font: var(--text-label); color: var(--ink); }
.pc-weekstrip-ix-who .pc-weekstrip-tk { margin-right: 4px; vertical-align: -2px; }
.pc-weekstrip-ix-who .pc-weekstrip-mk { margin-right: 5px; }
.pc-weekstrip-ix-p { display: inline-block; max-width: 100%; }
.pc-weekstrip-is-none.pc-weekstrip-ix b { color: var(--muted); }
.pc-weekstrip-fold { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 52px; padding: 4px 4px 4px 14px; background: var(--surface); border-radius: var(--radius-card); margin-bottom: 6px; font: var(--text-label); color: var(--muted); }
.pc-weekstrip-fold b { font: 500 15px/20px var(--body); color: var(--accent-ink); }
.pc-weekstrip-fold .pc-weekstrip-tk { margin-right: 6px; vertical-align: -2px; }
.pc-weekstrip-foot { margin: 14px 2px 0; }
.pc-weekstrip-foot a { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; padding: 4px 0; border-top: 1px solid var(--line-soft); font: var(--text-label); color: var(--muted); }
.pc-weekstrip-foot a b { font: 600 13px/1.4 var(--body); font-variant-numeric: tabular-nums; color: var(--ink); }

/* ===== laptop: the week as seven columns ===== */
.pc-weekstrip-dbar { display: flex; align-items: center; gap: 8px; margin: 0 0 6px; }
.pc-weekstrip-dbar .pc-weekstrip-arrow { width: 34px; height: 34px; }
.pc-weekstrip-dbar > b { margin-left: 6px; font: 500 18px/1.2 var(--display); letter-spacing: var(--tracking-tight); white-space: nowrap; }
.pc-weekstrip-dbar > span { font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-weekstrip-dbar > span.pc-weekstrip-heavy { margin-left: auto; padding-right: 4px; }
.pc-weekstrip-heavy b { font: 600 13px/1.4 var(--body); font-variant-numeric: tabular-nums; color: var(--ink); }
.pc-weekstrip-sums { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-bottom: 6px; }
.pc-weekstrip-sumbox { display: block; min-width: 0; background: var(--surface); border-radius: var(--radius-card); padding: 6px 14px 7px; }
.pc-weekstrip-l { display: flex; align-items: center; gap: 6px; font: var(--text-label); color: var(--muted); }
.pc-weekstrip-l .pc-weekstrip-go { margin-left: auto; }
.pc-weekstrip-v { display: block; font: 500 20px/1.3 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-weekstrip-n { display: block; font: 400 12px/1.35 var(--body); color: var(--muted); }
.pc-weekstrip-quiet { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 24px; margin: 0 4px 6px; font: var(--text-label); color: var(--muted); }
.pc-weekstrip-quiet b { font: 600 13px/1.4 var(--body); font-variant-numeric: tabular-nums; color: var(--ink); }
.pc-weekstrip-cols { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 4px; align-items: start; }
.pc-weekstrip-col { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.pc-weekstrip-ch { min-height: 104px; padding: 8px; background: var(--surface); border-radius: 12px; }
.pc-weekstrip-is-today.pc-weekstrip-ch { background: var(--lime); }
.pc-weekstrip-ch-d { height: 20px; display: flex; align-items: baseline; gap: 6px; font: 600 15px/20px var(--display); white-space: nowrap; }
.pc-weekstrip-ch-d small { font: 500 12px/20px var(--display); color: var(--muted); }
.pc-weekstrip-is-today .pc-weekstrip-ch-d small { color: var(--ink); }
.pc-weekstrip-ch-d .pc-weekstrip-tag { margin-left: auto; font: 600 12px/20px var(--display); color: var(--muted); }
.pc-weekstrip-is-today .pc-weekstrip-ch-d .pc-weekstrip-tag { color: var(--ink); }
.pc-weekstrip-ch-sum { height: 22px; font: 500 16px/22px var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-weekstrip-ch .pc-weekstrip-meter { margin: 2px 0 5px; }
.pc-weekstrip-ch-l { height: 16px; display: flex; align-items: center; gap: 4px; font: 400 12px/16px var(--body); color: var(--muted); white-space: nowrap; }
.pc-weekstrip-is-today .pc-weekstrip-ch-l { color: var(--ink); }
.pc-weekstrip-ch-l.pc-weekstrip-c-late { color: var(--crit-ink); font-weight: 600; }
.pc-weekstrip-ch-l.pc-weekstrip-c-paid { color: var(--accent-ink); }
.pc-weekstrip-dc { min-width: 0; padding: 5px 6px 6px; background: var(--surface); border-radius: 12px; }
.pc-weekstrip-is-late.pc-weekstrip-dc { padding-left: 8px; box-shadow: inset 3px 0 0 var(--crit); }
.pc-weekstrip-dc-who { display: block; }
.pc-weekstrip-dc-name { display: block; font: 500 13px/18px var(--body); letter-spacing: -0.01em; overflow-wrap: anywhere; }
.pc-weekstrip-dc-row { display: flex; justify-content: space-between; align-items: baseline; gap: 6px; font: 400 12px/20px var(--body); color: var(--muted); }
.pc-weekstrip-dc-row b { font: 500 14px/20px var(--mono); font-variant-numeric: tabular-nums; color: var(--ink); white-space: nowrap; }
.pc-weekstrip-dc-row b.pc-weekstrip-c-late { color: var(--crit-ink); }
.pc-weekstrip-dc-st { display: flex; align-items: flex-start; gap: 4px; margin-top: 2px; font: 600 12px/16px var(--display); letter-spacing: -0.01em; }
.pc-weekstrip-dc-st .pc-weekstrip-mk { margin-top: 4px; }
.pc-weekstrip-dc-st .pc-weekstrip-tk { width: 12px; height: 12px; margin-top: 2px; }
.pc-weekstrip-dc-st .pc-weekstrip-tki { width: 8px; height: 8px; }
.pc-weekstrip-dc-det { font: 400 12px/16px var(--body); color: var(--muted); }
.pc-weekstrip-is-late .pc-weekstrip-dc-det { color: var(--crit-ink); }
.pc-weekstrip-dbtn { min-height: var(--control-dense); margin-top: 5px; padding: 0 6px; display: flex; align-items: center; justify-content: center; gap: 5px; border-radius: 999px; border: 1px solid var(--ink); background: var(--surface); color: var(--ink); font: 500 12px/1 var(--display); white-space: nowrap; }
.pc-weekstrip-dbar .pc-weekstrip-dbtn { margin: 0 0 0 2px; padding: 0 14px; font-size: 13px; }
.pc-weekstrip-dbtn svg { width: 15px; height: 15px; }
.pc-weekstrip-dacts { display: flex; gap: 6px; }
.pc-weekstrip-dacts .pc-weekstrip-dbtn { width: var(--control-dense); padding: 0; flex: none; }
.pc-weekstrip-none { padding: 14px 8px; border: 1px dashed var(--line-control); border-radius: 12px; text-align: center; font: var(--text-label); color: var(--muted); }
'''


# ---- the one example dataset. Today is Wednesday 14.10.2026; the week is 12.10 - 18.10 ----
weekstrip_DAYS = [('Пн', '12.10', 'понедельник'), ('Вт', '13.10', 'вторник'), ('Ср', '14.10', 'среда'), ('Чт', '15.10', 'четверг'),
                  ('Пт', '16.10', 'пятница'), ('Сб', '17.10', 'суббота'), ('Вс', '18.10', 'воскресенье')]
weekstrip_TODAY = 2
weekstrip_NOW = weekstrip_DAYS[weekstrip_TODAY][1]
# s: paid | early (paid before the week began) | late | today (due today, not paid) | exp (a future week)
# on: the date of the payment itself - a different fact from the day the week is due
weekstrip_RENT = [
    {'k': 'А', 'no': 'R-00101', 'm': 'Wolf-8', 'rate': 150, 'd': 0, 's': 'paid', 'on': '12.10', 'ch': 'наличные'},
    {'k': 'Б', 'no': 'R-00102', 'm': 'B11', 'rate': 150, 'd': 1, 's': 'early', 'on': '10.10', 'ch': 'перевод'},
    {'k': 'В', 'no': 'R-00103', 'm': 'B11', 'rate': 140, 'd': 1, 's': 'paid', 'on': '13.10', 'ch': 'перевод'},
    {'k': 'Г', 'no': 'R-00104', 'm': 'XL1200', 'rate': 150, 'd': 1, 's': 'late', 'days': 1, 'debt': 150, 'why': 'срок был 13.10'},
    {'k': 'Д', 'no': 'R-00105', 'm': '17C', 'rate': 150, 'd': 2, 's': 'today'},
    {'k': 'Е', 'no': 'R-00106', 'm': 'Wolf-8', 'rate': 150, 'd': 2, 's': 'paid', 'on': '14.10', 'ch': 'карта'},
    {'k': 'М', 'no': 'R-00112', 'm': '17C', 'rate': 150, 'd': 2, 's': 'late', 'days': 7, 'debt': 300, 'why': '2 недели, с 07.10'},
    {'k': 'Ж', 'no': 'R-00107', 'm': 'XL1200', 'rate': 150, 'd': 3, 's': 'exp'},
    {'k': 'З', 'no': 'R-00108', 'm': 'B11', 'rate': 150, 'd': 3, 's': 'exp'},
    {'k': 'И', 'no': 'R-00109', 'm': 'F-150', 'rate': 150, 'd': 4, 's': 'exp'},
    {'k': 'К', 'no': 'R-00110', 'm': 'B11', 'rate': 150, 'd': 4, 's': 'early', 'on': '13.10', 'ch': 'наличные'},
    {'k': 'Л', 'no': 'R-00111', 'm': 'MB5', 'rate': 150, 'd': 5, 's': 'exp'},
]
weekstrip_ORDER = {'late': 0, 'today': 1, 'exp': 2, 'early': 3, 'paid': 3}
weekstrip_OPEN = ('late', 'today', 'exp')
weekstrip_DONE = ('paid', 'early')
weekstrip_UNSORTED = 5  # the counter of the tab «Разобрать 5»

def weekstrip_num(n):
    s = str(n)
    if len(s) > 3:
        s = s[:-3] + '&thinsp;' + s[-3:]
    return s

def weekstrip_gel(n):
    return weekstrip_num(n) + '&nbsp;₾'

def weekstrip_pl(n):
    if n % 10 == 1 and n % 100 != 11:
        return 'оплата'
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return 'оплаты'
    return 'оплат'

def weekstrip_few(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11:
        return str(n) + ' ' + one
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return str(n) + ' ' + few
    return str(n) + ' ' + many

def weekstrip_rentals(n):
    # the calendar counts rentals and payments, never people
    return weekstrip_few(n, 'аренда', 'аренды', 'аренд')

def weekstrip_owes(r):
    # the whole debt of a late rental, in words: «долг 300 ₾ за 2 недели»
    weeks = r['debt'] // r['rate']
    return 'долг ' + weekstrip_gel(r['debt']) + (' за ' + weekstrip_few(weeks, 'неделю', 'недели', 'недель') if weeks > 1 else '')

def weekstrip_of(i):
    return sorted([r for r in weekstrip_RENT if r['d'] == i], key=lambda r: weekstrip_ORDER[r['s']])

def weekstrip_sum(rows):
    return sum(r['rate'] for r in rows)

weekstrip_DAYSUM = [weekstrip_sum(weekstrip_of(i)) for i in range(7)]
weekstrip_PAID = [r for r in weekstrip_RENT if r['s'] in weekstrip_DONE]
weekstrip_LEFT = [r for r in weekstrip_RENT if r['s'] in weekstrip_OPEN]
weekstrip_LATE = sorted([r for r in weekstrip_RENT if r['s'] == 'late'], key=lambda r: -r['days'])  # the oldest debt first
weekstrip_WEEK = weekstrip_sum(weekstrip_RENT)
weekstrip_DEBT = sum(r['debt'] for r in weekstrip_LATE)
weekstrip_TOP = weekstrip_DAYSUM.index(max(weekstrip_DAYSUM))
# money that came in, by the date of the payment, from Monday to today
weekstrip_CAME = {d[1]: sum(r['rate'] for r in weekstrip_PAID if r['on'] == d[1]) for d in weekstrip_DAYS[:weekstrip_TODAY + 1]}
weekstrip_GOT = sum(weekstrip_CAME.values())

# The dataset, checked where it is written down.
assert weekstrip_DAYSUM == [150, 440, 450, 300, 300, 150, 0] and weekstrip_WEEK == 1790 and len(weekstrip_RENT) == 12
assert (len(weekstrip_PAID), weekstrip_sum(weekstrip_PAID)) == (5, 740)
assert (len(weekstrip_LEFT), weekstrip_sum(weekstrip_LEFT)) == (7, 1050)
assert (len(weekstrip_LATE), weekstrip_sum(weekstrip_LATE), weekstrip_DEBT) == (2, 300, 450)
assert [r['k'] for r in weekstrip_LATE] == ['М', 'Г']
assert weekstrip_sum([r for r in weekstrip_RENT if r['s'] == 'today']) == 150
assert weekstrip_sum([r for r in weekstrip_RENT if r['s'] == 'exp']) == 600
assert weekstrip_TOP == 2 and weekstrip_DAYSUM.count(450) == 1
# payment dates: 590 came in on 12-14.10, nothing is dated after today, "заранее" means paid before the due day
assert weekstrip_CAME == {'12.10': 150, '13.10': 290, '14.10': 150} and weekstrip_GOT == 590
assert all(r['on'] <= weekstrip_NOW for r in weekstrip_PAID)
assert all((r['on'] < weekstrip_DAYS[r['d']][1]) == (r['s'] == 'early') for r in weekstrip_PAID)

def weekstrip_week(rent):
    days = []
    for i in range(7):
        rows = [r for r in rent if r['d'] == i]
        done = [r for r in rows if r['s'] in weekstrip_DONE]
        days.append({'n': len(rows), 'sum': weekstrip_sum(rows), 'paid_n': len(done), 'paid_sum': weekstrip_sum(done),
                     'late': len([r for r in rows if r['s'] == 'late'])})
    return days

weekstrip_WK = {'days': weekstrip_week(weekstrip_RENT), 'late_n': len(weekstrip_LATE), 'debt': weekstrip_DEBT,
                'late_names': ', '.join('Клиент Пример ' + r['k'] for r in weekstrip_LATE)}

def weekstrip_mk(kind):
    if kind in weekstrip_DONE:
        return ('<span class="pc-weekstrip-tk' + (' pc-weekstrip-tk-early' if kind == 'early' else '') + '">'
                + ic('check', 'pc-weekstrip-tki') + '</span>')
    return '<i class="pc-weekstrip-mk pc-weekstrip-mk-' + kind + '"></i>'

weekstrip_GO = ic('right', 'pc-weekstrip-go')

def weekstrip_meter(total, paid, top):
    if not total:
        return '<span class="pc-weekstrip-meter"></span>'
    part = round(100 * paid / total)
    return ('<span class="pc-weekstrip-meter"><i' + (' class="pc-weekstrip-full"' if part == 100 else '')
            + ' style="width:' + str(round(100 * total / top)) + '%">'
            + ('<b style="width:' + str(part) + '%"></b>' if part else '') + '</i></span>')

# ---- phone: the strip ----
def weekstrip_tile(i, sel, wk):
    wd, date, full = weekstrip_DAYS[i]
    d = wk['days'][i]
    left = d['n'] - d['paid_n']
    top = max(x['sum'] for x in wk['days'])
    cls = 'pc-weekstrip-tile'
    if i == weekstrip_TODAY:
        cls += ' pc-weekstrip-is-today'
    if i == sel:
        cls += ' pc-weekstrip-is-sel'
    flag = ''
    if not d['n']:
        cls += ' pc-weekstrip-is-none'
        mark, said = '', 'оплат нет'
    elif left == 0:
        mark, said = weekstrip_mk('paid'), 'всё оплачено'
    else:
        mark, said = 'ещё ' + str(left), 'осталось оплат: ' + str(left)
        if d['late']:
            flag = '<i class="pc-weekstrip-mk pc-weekstrip-mk-late pc-weekstrip-t-flag"></i>'
            said += ', из них просрочено: ' + str(d['late'])
    label = full + ' ' + date + ', ' + (weekstrip_gel(d['sum']) + ', ' if d['n'] else '') + said
    return ('<a class="' + cls + '" href="#" aria-label="' + label + '">' + flag
            + '<span class="pc-weekstrip-t-wd">' + wd + '</span>'
            '<span class="pc-weekstrip-t-d">' + date[:2] + '</span>'
            '<span class="pc-weekstrip-t-sum">' + (weekstrip_gel(d['sum']) if d['n'] else '—') + '</span>'
            + weekstrip_meter(d['sum'], d['paid_sum'], top)
            + '<span class="pc-weekstrip-t-st">' + mark + '</span></a>')

weekstrip_TOGGLE = '<span class="pc-weekstrip-pill"><span class="pc-weekstrip-wc">Показать</span><span class="pc-weekstrip-wo">Скрыть</span></span>'

def weekstrip_weekcard(sel, wk):
    paid = sum(d['paid_sum'] for d in wk['days'])
    week = sum(d['sum'] for d in wk['days'])
    return ('<div class="pc-weekstrip-week pc-weekstrip-week-top">'
            '<div class="pc-weekstrip-nav">'
            '<a class="pc-weekstrip-arrow" href="#" aria-label="Предыдущая неделя">' + ic('left') + '</a>'
            '<div class="pc-weekstrip-wk"><b>12.10 – 18.10</b><span>эта неделя</span></div>'
            '<a class="pc-weekstrip-arrow" href="#" aria-label="Следующая неделя">' + ic('right') + '</a></div>'
            '<div class="pc-weekstrip-tiles">' + ''.join(weekstrip_tile(i, sel, wk) for i in range(7)) + '</div>'
            '<div class="pc-weekstrip-total"><span>Оплачено <b class="pc-weekstrip-c-paid">' + weekstrip_gel(paid) + '</b> из <b>' + weekstrip_gel(week) + '</b></span>'
            '<span>осталось <b>' + weekstrip_gel(week - paid) + '</b></span></div>'
            '</div>')

# the red line under the strip is a fold: «Показать» opens the debtors in place of the day, «Скрыть» brings the day back
def weekstrip_latefold(wk, inner, opened=False):
    return ('<details class="pc-weekstrip-det pc-weekstrip-debt"' + (' open' if opened else '') + '>'
            '<summary class="pc-weekstrip-latebox"><span class="pc-weekstrip-late"><span class="pc-weekstrip-late-x">'
            '<span class="pc-weekstrip-late-t">' + weekstrip_mk('late') + '<b>Просрочено ' + str(wk['late_n']) + '</b> · долг <b>' + weekstrip_gel(wk['debt']) + '</b></span>'
            '<span class="pc-weekstrip-late-n">' + wk['late_names'] + '</span></span>'
            + weekstrip_TOGGLE + '</span></summary>' + inner + '</details>')

# ---- phone: one person ----
def weekstrip_state(r, whole=False):
    # the fixed word, then « · » and what makes it exact; the dot stays with the detail when the line wraps
    s = r['s']
    tail = ''
    if s == 'paid':
        word, tail = 'Оплачено', ('сегодня' if r['on'] == weekstrip_NOW else r['on']) + ', ' + r['ch']
    elif s == 'early':
        word, tail = 'Оплачено заранее', r['on'] + ', ' + r['ch']
    elif s == 'today':
        word = 'Ждём сегодня'
    elif s == 'exp':
        word = 'Ожидается'
    else:
        word = 'Просрочено · ' + str(r['days']) + '&nbsp;дн.'
        tail = r['why'] if whole else weekstrip_owes(r)
    return ('<span class="pc-weekstrip-stx pc-weekstrip-c-' + s + '">' + weekstrip_mk(s) + word + '</span>'
            + (' <span class="pc-weekstrip-nw' + (' pc-weekstrip-c-late' if s == 'late' and not whole else '') + '">· ' + tail + '</span>' if tail else ''))

weekstrip_PAY = '<a class="pc-weekstrip-btn pc-weekstrip-grow" href="#">Принять оплату</a>'
weekstrip_CALL = '<a class="pc-weekstrip-btn pc-weekstrip-round" href="#" aria-label="Позвонить">' + ic('phone', 'i s') + '</a>'
weekstrip_WA = '<a class="pc-weekstrip-btn pc-weekstrip-round" href="#" aria-label="Написать в WhatsApp">' + ic('chat', 'i s') + '</a>'
weekstrip_REMIND = '<a class="pc-weekstrip-btn" href="#" aria-label="Напомнить в WhatsApp: завтра оплата">' + ic('chat', 'i s') + 'Напомнить</a>'

def weekstrip_top(r, whole=False):
    # in a day the figure is that week's rent, so the rows add up to the day's sum, and a late one names the whole debt in words;
    # whole: the row stands in the debtors' list, where the figure is the whole debt under the word «долг»
    s = r['s']
    money = ('<small>долг</small>' + weekstrip_gel(r['debt'])) if s == 'late' and whole else weekstrip_gel(r['rate'])
    return ('<a class="pc-weekstrip-top" href="#">'
            '<span class="pc-weekstrip-name">Клиент Пример ' + r['k'] + ' ' + weekstrip_GO + '</span>'
            '<span class="pc-weekstrip-sum pc-weekstrip-c-' + s + '">' + money + '</span>'
            '<span class="pc-weekstrip-sub">' + r['m'] + ' · ' + weekstrip_state(r, whole) + '</span></a>')

def weekstrip_prow(r, whole=False):
    s = r['s']
    tomorrow = s == 'exp' and r['d'] == weekstrip_TODAY + 1
    return ('<div class="pc-weekstrip-row' + (' pc-weekstrip-is-late' if s == 'late' else '') + '">' + weekstrip_top(r, whole)
            + '<div class="pc-weekstrip-acts">' + weekstrip_PAY
            + (weekstrip_REMIND + weekstrip_CALL if tomorrow else weekstrip_CALL + weekstrip_WA) + '</div></div>')

def weekstrip_grp(title, cnt=''):
    return '<div class="grp"><h3>' + title + '</h3>' + ('<span class="cnt">' + cnt + '</span>' if cnt else '') + '</div>'

def weekstrip_dayhead(title, note, right):
    return ('<div class="pc-weekstrip-day"><b>' + title + '</b><span class="pc-weekstrip-day-n">' + right + '</span>'
            + ('<small>' + note + '</small>' if note else '') + '</div>')

def weekstrip_title(sel):
    wd, date, full = weekstrip_DAYS[sel]
    if sel == weekstrip_TODAY:
        return 'Сегодня, ' + full + ' ' + date
    if sel == weekstrip_TODAY + 1:
        return 'Завтра, ' + full + ' ' + date
    return full.capitalize() + ', ' + date

# the other days of the week as short lines with names: a person is found without tapping six tiles.
weekstrip_SAID = {'early': 'оплачено заранее', 'paid': 'оплачено', 'late': 'просрочено'}
def weekstrip_ahead_who(r, last):
    # a person with what is said about him stays on one line while it fits; under a long name the words go to the next line
    s = r['s']
    return ('<span class="pc-weekstrip-ix-p"><span class="pc-weekstrip-nw">' + (weekstrip_mk(s) if s in weekstrip_SAID else '') + 'Клиент Пример ' + r['k'] + '</span>'
            + (' <span class="pc-weekstrip-nw">— ' + weekstrip_SAID[s] + '</span>' if s in weekstrip_SAID else '') + ('' if last else ',') + '</span>')

def weekstrip_ahead(first):
    # first: the first day of the list. Under a day already gone the list starts with today, so today is never skipped
    items = ''
    for i in range(first, 7):
        wd, date, full = weekstrip_DAYS[i]
        rows = weekstrip_of(i)
        label = ('Сегодня, ' if i == weekstrip_TODAY else ('Завтра, ' if i == weekstrip_TODAY + 1 else '')) + wd + ' ' + date
        if not rows:
            items += '<div class="pc-weekstrip-ix pc-weekstrip-is-none"><b>' + label + '</b><span class="pc-weekstrip-ix-n">оплат нет</span></div>'
            continue
        who = ' '.join(weekstrip_ahead_who(r, r is rows[-1]) for r in rows)
        items += ('<a class="pc-weekstrip-ix" href="#"><b>' + label + '</b><span class="pc-weekstrip-ix-n">' + str(len(rows)) + ' ' + weekstrip_pl(len(rows))
                  + ' · ' + weekstrip_gel(weekstrip_sum(rows)) + ' ' + weekstrip_GO + '</span><span class="pc-weekstrip-ix-who">' + who + '</span></a>')
    return weekstrip_grp('Дальше на неделе') + '<div class="pc-weekstrip-list">' + items + '</div>' if items else ''

weekstrip_NEXT = '<a class="pc-weekstrip-btn pc-weekstrip-wide" href="#">Следующая неделя · 19.10 – 25.10 ' + weekstrip_GO + '</a>'

assert weekstrip_UNSORTED == UNSORTED

def weekstrip_foot(came=True):
    out = '<div class="pc-weekstrip-foot">'
    if came:
        out += ('<a href="#"><span>Пришло денег ' + weekstrip_DAYS[0][1] + ' – ' + weekstrip_NOW + ': <b>' + weekstrip_gel(weekstrip_GOT) + '</b></span>'
                '<span class="pc-weekstrip-lnk">Платежи</span></a>')
    return (out + '<a href="#"><span>' + SORT_HINT + '</span>'
            '<span class="pc-weekstrip-lnk">Разобрать</span></a></div>')

def weekstrip_dayview(sel):
    rows = weekstrip_of(sel)
    todo = [r for r in rows if r['s'] in weekstrip_OPEN]
    done = [r for r in rows if r['s'] in weekstrip_DONE]
    out = weekstrip_dayhead(weekstrip_title(sel), 'Самый большой день недели' if sel == weekstrip_TOP else '',
                            str(len(rows)) + ' ' + weekstrip_pl(len(rows)) + ' · ' + weekstrip_gel(weekstrip_DAYSUM[sel]))
    out += ''.join(weekstrip_prow(r) for r in todo)
    if done:
        # paid people are short lines without buttons, each says "Оплачено" itself, so they need no heading;
        # more than three of them fold behind a button (frame "85 мопедов")
        out += '<div class="pc-weekstrip-list pc-weekstrip-paid">' + ''.join(weekstrip_top(r) for r in done) + '</div>'
    return out + weekstrip_ahead(sel + 1 if sel >= weekstrip_TODAY else weekstrip_TODAY) + weekstrip_NEXT + weekstrip_foot()

# the debtors' list: opened from the red line, stands in place of the day under the strip
def weekstrip_lateview(late, debt):
    this = weekstrip_sum(late)
    out = weekstrip_dayhead('Просрочено · ' + weekstrip_rentals(len(late)),
                            weekstrip_gel(this) + ' — за эту неделю, ' + weekstrip_gel(debt - this) + ' — за прошлую',
                            'долг <b>' + weekstrip_gel(debt) + '</b>')
    return out + ''.join(weekstrip_prow(r, True) for r in late) + weekstrip_foot(False)

def weekstrip_screen(sel, wk, late, day, late_open=False):
    # the red line is a live fold in every frame: opened, the debtors' list hides the day; the frame «Должники» draws it opened
    return (stabs() + weekstrip_weekcard(None if late_open else sel, wk)
            + weekstrip_latefold(wk, weekstrip_lateview(late, wk['debt']), late_open)
            + '<div class="pc-weekstrip-dayv">' + day + '</div>')

def weekstrip_phone(caption, sel, late_open=False):
    body = weekstrip_screen(sel, weekstrip_WK, weekstrip_LATE, weekstrip_dayview(sel), late_open)
    return phone(caption, head('Деньги'), body, tabbar('owner', 'money', 9))

# ---- phone at the planned scale: 85 mopeds, about 12 payments a day. Invented, marked as such in the caption.
# It is the same week Б draws at 85 mopeds (agenda_BIG): the figures are written out here and checked against it below. ----
weekstrip_BIG = {'days': [
    {'n': 12, 'sum': 1800, 'paid_n': 11, 'paid_sum': 1650, 'late': 1},
    {'n': 12, 'sum': 1800, 'paid_n': 11, 'paid_sum': 1650, 'late': 1},
    {'n': 13, 'sum': 1950, 'paid_n': 8, 'paid_sum': 1200, 'late': 1},
    {'n': 12, 'sum': 1800, 'paid_n': 2, 'paid_sum': 300, 'late': 0},
    {'n': 12, 'sum': 1800, 'paid_n': 1, 'paid_sum': 150, 'late': 0},
    {'n': 12, 'sum': 1800, 'paid_n': 1, 'paid_sum': 150, 'late': 0},
    {'n': 12, 'sum': 1800, 'paid_n': 0, 'paid_sum': 0, 'late': 0},
], 'late_n': 3, 'debt': 600, 'late_names': 'Клиент Пример 25, Клиент Пример 1 и ещё 1'}
# today, Wednesday: one late, four awaited, eight paid (two of them in advance)
weekstrip_BIG_TODAY = [
    {'k': '25', 'm': 'MB5', 'rate': 150, 'd': 2, 's': 'late', 'days': 7, 'debt': 300, 'why': '2 недели, с 07.10'},
    {'k': '26', 'm': 'Wolf-8', 'rate': 150, 'd': 2, 's': 'today'},
    {'k': '27', 'm': 'B11', 'rate': 150, 'd': 2, 's': 'today'},
    {'k': '28', 'm': 'XL1200', 'rate': 150, 'd': 2, 's': 'today'},
    {'k': '29', 'm': '17C', 'rate': 150, 'd': 2, 's': 'today'},
    {'k': '30', 'm': 'MB5', 'rate': 150, 'd': 2, 's': 'paid', 'on': '14.10', 'ch': 'наличные'},
    {'k': '31', 'm': 'Wolf-8', 'rate': 150, 'd': 2, 's': 'paid', 'on': '14.10', 'ch': 'перевод'},
    {'k': '32', 'm': 'B11', 'rate': 150, 'd': 2, 's': 'paid', 'on': '14.10', 'ch': 'карта'},
    {'k': '33', 'm': 'XL1200', 'rate': 150, 'd': 2, 's': 'paid', 'on': '14.10', 'ch': 'наличные'},
    {'k': '34', 'm': '17C', 'rate': 150, 'd': 2, 's': 'paid', 'on': '14.10', 'ch': 'перевод'},
    {'k': '35', 'm': 'F-150', 'rate': 150, 'd': 2, 's': 'paid', 'on': '14.10', 'ch': 'карта'},
    {'k': '36', 'm': 'Wolf-8', 'rate': 150, 'd': 2, 's': 'early', 'on': '12.10', 'ch': 'наличные'},
    {'k': '37', 'm': 'B11', 'rate': 150, 'd': 2, 's': 'early', 'on': '12.10', 'ch': 'перевод'},
]
# the three late ones of the week, the oldest debt first
weekstrip_BIG_LATE = [
    weekstrip_BIG_TODAY[0],
    {'k': '1', 'm': 'B11', 'rate': 150, 'd': 0, 's': 'late', 'days': 2, 'debt': 150, 'why': 'срок был 12.10'},
    {'k': '13', 'm': '17C', 'rate': 150, 'd': 1, 's': 'late', 'days': 1, 'debt': 150, 'why': 'срок был 13.10'},
]
weekstrip_BIG_OPEN = [r for r in weekstrip_BIG_TODAY if r['s'] in weekstrip_OPEN]
weekstrip_BIG_DONE = [r for r in weekstrip_BIG_TODAY if r['s'] in weekstrip_DONE]
assert sum(d['n'] for d in weekstrip_BIG['days']) == 85 and sum(d['sum'] for d in weekstrip_BIG['days']) == 85 * 150
assert all(d['sum'] == 150 * d['n'] and d['paid_sum'] == 150 * d['paid_n'] for d in weekstrip_BIG['days'])
assert sum(d['paid_n'] for d in weekstrip_BIG['days']) == 34 and sum(d['paid_sum'] for d in weekstrip_BIG['days']) == 5100
assert len(weekstrip_BIG_TODAY) == weekstrip_BIG['days'][weekstrip_TODAY]['n'] and len(weekstrip_BIG_DONE) == weekstrip_BIG['days'][weekstrip_TODAY]['paid_n']
assert (len(weekstrip_BIG_OPEN), len(weekstrip_BIG_DONE)) == (5, 8)
assert sum(d['late'] for d in weekstrip_BIG['days']) == weekstrip_BIG['late_n'] == len(weekstrip_BIG_LATE)
assert weekstrip_BIG['debt'] == sum(r['debt'] for r in weekstrip_BIG_LATE) == 600 and [r['days'] for r in weekstrip_BIG_LATE] == [7, 2, 1]

def weekstrip_fold(rows, opened=False):
    # more than three paid people in a day: one line with their count and sum, the names behind a plain button
    return ('<details class="pc-weekstrip-det"' + (' open' if opened else '') + '><summary class="pc-weekstrip-fold"><span>' + weekstrip_mk('paid')
            + '<b>Оплачено · ' + str(len(rows)) + '</b> · ' + weekstrip_gel(weekstrip_sum(rows)) + '</span>' + weekstrip_TOGGLE + '</summary>'
            '<div class="pc-weekstrip-list pc-weekstrip-paid">' + ''.join(weekstrip_top(r) for r in rows) + '</div></details>')

def weekstrip_big_ahead():
    wk = weekstrip_BIG
    items = ''
    for i in range(weekstrip_TODAY + 1, 7):
        d = wk['days'][i]
        wd, date, full = weekstrip_DAYS[i]
        who = 'ожидается ' + str(d['n'] - d['paid_n']) + (' · оплачено заранее ' + str(d['paid_n']) if d['paid_n'] else '')
        items += ('<a class="pc-weekstrip-ix" href="#"><b>' + ('Завтра, ' if i == weekstrip_TODAY + 1 else '') + wd + ' ' + date + '</b>'
                  '<span class="pc-weekstrip-ix-n">' + str(d['n']) + ' ' + weekstrip_pl(d['n']) + ' · ' + weekstrip_gel(d['sum']) + ' ' + weekstrip_GO + '</span>'
                  '<span class="pc-weekstrip-ix-who pc-weekstrip-c-exp">' + who + '</span></a>')
    return weekstrip_grp('Дальше на неделе') + '<div class="pc-weekstrip-list">' + items + '</div>'

def weekstrip_phone_big(caption):
    wk = weekstrip_BIG
    day = wk['days'][weekstrip_TODAY]
    out = weekstrip_dayhead(weekstrip_title(weekstrip_TODAY), '', str(day['n']) + ' ' + weekstrip_pl(day['n']) + ' · ' + weekstrip_gel(day['sum']))
    out += ''.join(weekstrip_prow(r) for r in weekstrip_BIG_OPEN) + weekstrip_fold(weekstrip_BIG_DONE) + weekstrip_big_ahead()
    return phone(caption, head('Деньги'), weekstrip_screen(weekstrip_TODAY, wk, weekstrip_BIG_LATE, out), tabbar('owner', 'money', 9))

def weekstrip_phone_big_low(caption):
    # the same screen scrolled to the end of today: the last awaited one, then «Оплачено» opened by its button
    out = ''.join(weekstrip_prow(r) for r in weekstrip_BIG_OPEN[-1:]) + weekstrip_fold(weekstrip_BIG_DONE, True) + weekstrip_big_ahead()
    return phone(caption, head('Деньги'), out, tabbar('owner', 'money', 9))

# ---- laptop: seven columns ----
def weekstrip_dcard(r):
    s = r['s']
    late = s == 'late'
    det, acts = '', ''
    # the figure is always that week's rent, so a column adds up to its sum; a late one names the whole debt under the state
    money = '<b' + (' class="pc-weekstrip-c-late"' if late else '') + '>' + weekstrip_gel(r['rate']) + '</b>'
    if late:
        word = 'Просрочено <span class="pc-weekstrip-nw">· ' + str(r['days']) + '&nbsp;дн.</span>'
        det = weekstrip_owes(r)
    elif s == 'paid':
        word, det = 'Оплачено', ('сегодня' if r['on'] == weekstrip_NOW else r['on']) + ', ' + r['ch']
    elif s == 'early':
        word, det = 'Оплачено заранее', r['on'] + ', ' + r['ch']
    elif s == 'today':
        word = 'Ждём сегодня'
    else:
        word = 'Ожидается'
    if s in weekstrip_OPEN:
        acts = '<a class="pc-weekstrip-dbtn" href="#">Принять оплату</a>'
        if late:
            acts += ('<div class="pc-weekstrip-dacts"><a class="pc-weekstrip-dbtn" href="#" aria-label="Позвонить">' + ic('phone') + '</a>'
                     '<a class="pc-weekstrip-dbtn" href="#" aria-label="Написать в WhatsApp">' + ic('chat') + '</a></div>')
        elif r['d'] == weekstrip_TODAY + 1:
            acts += '<a class="pc-weekstrip-dbtn" href="#" aria-label="Напомнить в WhatsApp: завтра оплата">' + ic('chat') + 'Напомнить</a>'
    return ('<div class="pc-weekstrip-dc' + (' pc-weekstrip-is-late' if late else '') + '">'
            '<a class="pc-weekstrip-dc-who" href="#"><span class="pc-weekstrip-dc-name">Клиент Пример ' + r['k'] + '</span>'
            '<span class="pc-weekstrip-dc-row"><span>' + r['m'] + '</span>' + money + '</span></a>'
            '<div class="pc-weekstrip-dc-st pc-weekstrip-c-' + s + '">' + weekstrip_mk(s) + '<span>' + word + '</span></div>'
            + ('<div class="pc-weekstrip-dc-det">' + det + '</div>' if det else '') + acts + '</div>')

def weekstrip_chl(text, cls=''):
    return '<div class="pc-weekstrip-ch-l' + (' ' + cls if cls else '') + '">' + text + '</div>'

def weekstrip_col(i):
    wd, date, full = weekstrip_DAYS[i]
    rows = weekstrip_of(i)
    d = weekstrip_WK['days'][i]
    today = i == weekstrip_TODAY
    left = d['n'] - d['paid_n']
    if not rows:
        lines = weekstrip_chl('оплат нет')
        total = '<span class="pc-weekstrip-c-exp">—</span>'
        cards = '<div class="pc-weekstrip-none">Оплат нет</div>'
    else:
        if i > weekstrip_TODAY:
            # a day that is not due yet is not a failure: say what is expected, not "оплачено 0 из 2"
            lines = weekstrip_chl(weekstrip_mk('exp') + 'ожидается ' + str(left)) if left else ''
            if d['paid_n']:
                lines += weekstrip_chl('оплачено заранее ' + str(d['paid_n']), 'pc-weekstrip-c-paid')
        else:
            lines = weekstrip_chl((weekstrip_mk('paid') if not left else '') + 'оплачено ' + str(d['paid_n']) + ' из ' + str(d['n']),
                                  'pc-weekstrip-c-paid' if not left else '')
            if d['late']:
                lines += weekstrip_chl(weekstrip_mk('late') + 'просрочено ' + str(d['late']), 'pc-weekstrip-c-late')
        total = '<a href="#">' + weekstrip_gel(d['sum']) + '</a>'
        cards = ''.join(weekstrip_dcard(r) for r in rows)
    tag = 'сегодня' if today else ('завтра' if i == weekstrip_TODAY + 1 else '')
    return ('<div class="pc-weekstrip-col"><div class="pc-weekstrip-ch' + (' pc-weekstrip-is-today' if today else '') + '">'
            '<div class="pc-weekstrip-ch-d"><small>' + wd + '</small>' + date + ('<span class="pc-weekstrip-tag">' + tag + '</span>' if tag else '') + '</div>'
            '<div class="pc-weekstrip-ch-sum">' + total + '</div>'
            + weekstrip_meter(d['sum'], d['paid_sum'], weekstrip_DAYSUM[weekstrip_TOP])
            + lines + '</div>' + cards + '</div>')

def weekstrip_sumbox(label, value, note, cls=''):
    return ('<a class="pc-weekstrip-sumbox" href="#"><span class="pc-weekstrip-l">' + label + weekstrip_GO + '</span>'
            '<span class="pc-weekstrip-v' + (' ' + cls if cls else '') + '">' + value + '</span>'
            '<span class="pc-weekstrip-n">' + note + '</span></a>')

def weekstrip_desk_body():
    n_paid, n_left, n_late = len(weekstrip_PAID), len(weekstrip_LEFT), len(weekstrip_LATE)
    bar = ('<div class="pc-weekstrip-dbar">'
           '<a class="pc-weekstrip-arrow" href="#" aria-label="Предыдущая неделя">' + ic('left', 'i s') + '</a>'
           '<a class="pc-weekstrip-arrow" href="#" aria-label="Следующая неделя">' + ic('right', 'i s') + '</a>'
           '<a class="pc-weekstrip-dbtn" href="#">Сегодня</a>'
           '<b>12.10 – 18.10</b><span>эта неделя</span>'
           # a column is too narrow for these words, so the week's biggest day is named once, here
           '<span class="pc-weekstrip-heavy">Самый большой день — ' + weekstrip_DAYS[weekstrip_TOP][2] + ', <b>' + weekstrip_gel(weekstrip_DAYSUM[weekstrip_TOP]) + '</b></span></div>')
    sums = ('<div class="pc-weekstrip-sums">'
            + weekstrip_sumbox('Должно прийти за неделю', weekstrip_gel(weekstrip_WEEK), str(len(weekstrip_RENT)) + ' ' + weekstrip_pl(len(weekstrip_RENT)))
            + weekstrip_sumbox(weekstrip_mk('paid') + 'Оплачено', weekstrip_gel(weekstrip_sum(weekstrip_PAID)),
                               str(n_paid) + ' ' + weekstrip_pl(n_paid) + ' из ' + str(len(weekstrip_RENT)), 'pc-weekstrip-c-paid')
            + weekstrip_sumbox('Осталось получить', weekstrip_gel(weekstrip_sum(weekstrip_LEFT)), str(n_left) + ' ' + weekstrip_pl(n_left))
            + weekstrip_sumbox(weekstrip_mk('late') + 'Просрочено, весь долг', weekstrip_gel(weekstrip_DEBT),
                               weekstrip_rentals(n_late) + ' · за эту неделю ' + weekstrip_gel(weekstrip_sum(weekstrip_LATE)), 'pc-weekstrip-c-late')
            + '</div>')
    quiet = ('<div class="pc-weekstrip-quiet">'
             '<a href="#">Пришло денег ' + weekstrip_DAYS[0][1] + ' – ' + weekstrip_NOW + ': <b>' + weekstrip_gel(weekstrip_GOT) + '</b> · '
             '<span class="pc-weekstrip-lnk">Платежи</span></a>'
             '<a href="#">' + SORT_HINT + ' · '
             '<span class="pc-weekstrip-lnk">Разобрать</span></a></div>')
    cols = '<div class="pc-weekstrip-cols">' + ''.join(weekstrip_col(i) for i in range(7)) + '</div>'
    return bar + sums + quiet + cols

def weekstrip_bands(letter, rec=False):
    lead = '<b>' + letter + '. ' + weekstrip_NAME + (' — рекомендую' if rec else '') + '.</b> '
    def sub(word):
        return '<b>' + letter + '. ' + word + '.</b> '
    big = weekstrip_BIG['days'][weekstrip_TODAY]
    p1 = weekstrip_phone(lead + 'Неделя — семь плиток: день, сумма, полоска (длина — размер дня, зелёное — уже оплачено) и «ещё 2» — '
        'сколько оплат осталось; красный квадрат — в этом дне есть просрочка. Красная строка с должниками видна при любом выбранном дне. '
        'Ниже — выбранный день, по умолчанию сегодня; под ним, если пролистать, — остальные дни недели короткими строками с именами. '
        + FORM_HINT + ' Цена: с кнопками на экране только один день.', weekstrip_TODAY)
    p2 = weekstrip_phone(sub('Должники') + 'Нажали «Показать» в красной строке: вместо дня — все, кто просрочил, самый старый долг первым, '
        'у каждого весь долг, «Принять оплату», звонок и WhatsApp. Под списком напоминание: в «Разобрать» 5 поступлений — '
        'среди них могут быть оплаты аренды. Цена: чтобы вернуться ко дню, нужно нажать «Скрыть» или плитку.', weekstrip_TODAY, True)
    p3 = weekstrip_phone(sub('Завтра') + 'Нажали на четверг: полоса и красная строка на месте, ниже — кто платит завтра, у каждого «Напомнить» — '
        'WhatsApp с готовым текстом «Завтра оплата». Стрелки ‹ › листают недели. '
        'Цена: каждый следующий день с кнопками — ещё одно нажатие.', weekstrip_TODAY + 1)
    p4 = weekstrip_phone(sub('Прошедший день') + 'Нажали на вторник: кто не заплатил — сверху, с кнопками; оплаченные — короткими строками без кнопок, '
        'у «Оплачено заранее» стоит дата платежа. «Дальше на неделе» начинается с сегодняшнего дня. '
        'Цена: оплаченные строки занимают место, пока их три и меньше; когда больше — складываются за кнопку (следующий кадр).', weekstrip_TODAY - 1)
    p5 = weekstrip_phone_big(sub('При 85 мопедах') + 'Числа условные, неделя та же, что у варианта Б при 85 мопедах. Плиток по-прежнему семь, '
        'четырёхзначная сумма «' + weekstrip_gel(1800) + '» в плитку помещается. Сегодня ' + str(big['n']) + ' ' + weekstrip_pl(big['n'])
        + ': открыты только должник и четверо «Ждём сегодня», ' + str(big['paid_n']) + ' оплаченных сложены за кнопку «Показать». '
        'Цена: в строках «Дальше на неделе» имён уже нет — человека ищут поиском сверху.')
    p6 = weekstrip_phone_big_low(sub('При 85 мопедах, «Оплачено» раскрыто') + 'Тот же экран ниже, нажата «Показать»: оплаченные — '
        'короткими строками без кнопок, у «Оплачено заранее» стоит дата платежа; «Скрыть» складывает их обратно в одну строку. '
        'Цена: раскрытый список отодвигает «Дальше на неделе» на следующий экран.')
    d = desk(lead + 'На ноутбуке неделя раскрыта целиком, нажимать не нужно: семь колонок, в каждой — её плательщики, сегодня — лаймом; '
        'полоска под суммой дня показывает его размер и сколько уже оплачено. Четыре итога сверху открывают свои списки в «Платежах»; '
        '«Пришло денег ' + weekstrip_gel(weekstrip_GOT) + '» — отдельная цифра по дате платежа: «Оплачено ' + weekstrip_gel(weekstrip_sum(weekstrip_PAID))
        + '» больше, потому что одну неделю оплатили ещё 10.10. '
        'Звонок и WhatsApp стоят у просроченных, «Напомнить» — у завтрашних; у остальных они в карточке аренды. '
        'При 85 мопедах колонок по-прежнему семь, в каждой около 12 человек: оплаченные складываются за кнопку «Показать», как на телефоне, '
        'и неделя листается вниз. Цена: колонки узкие — длинное имя переносится на вторую строку; месяц целиком не виден.',
        rail('money', 'owner', 9), dmain(weekstrip_desk_body(), 'календарь платежей · сегодня ' + weekstrip_DAYS[weekstrip_TODAY][2] + ', ' + weekstrip_NOW))
    return [(letter + '. ' + weekstrip_NAME + ' — телефон', p1 + p2 + p3 + p4 + p5 + p6), (letter + '. ' + weekstrip_NAME + ' — ноутбук', d)]


# ====================================================================================================
# Б · agenda · «Неделя списком»
# ====================================================================================================
# Календарь платежей (Mika, 11.10.2026) - concept "Неделя списком по дням".
# One Monday-Sunday week as a vertical to-do list: the week's totals, the late payers
# (never folded, the only place their debt and buttons live), today, tomorrow, the days
# after, and the days already gone folded into one line. Example data only.

agenda_NAME = 'Неделя списком'
agenda_PITCH = ('Лучше всего отвечает на «кто просрочил, кто платит сегодня и кто завтра»: неделя идёт списком дел — '
         'должники, сегодня, завтра и дальше, — и у каждого, от кого ждём денег, сразу кнопка «Принять оплату».')
agenda_COST = ('Хуже показывает картину целиком: на телефоне дни идут друг под другом, сравнить их и увидеть самый большой день '
        'можно только прокруткой, месяц не виден совсем; и чем больше должников, тем ниже на экране «Сегодня».')

agenda_CSS = '''
/* ===== agenda: неделя списком по дням ===== */
.pc-agenda-crit { color: var(--crit-ink); }
.pc-agenda-ok { color: var(--accent-ink); }
.pc-agenda-wait { color: var(--ink); font-weight: 600; }
.pc-agenda-nw { white-space: nowrap; }

/* state marks: always a shape next to the word */
.pc-agenda-m { width: 18px; height: 18px; flex: none; display: inline-grid; place-items: center; border-radius: 50%; box-sizing: border-box; }
.pc-agenda-m svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; display: block; }
.pc-agenda-m-paid { background: var(--accent); color: var(--on-accent); }
.pc-agenda-m-early { border: 1.5px solid var(--accent); color: var(--accent); }
.pc-agenda-m-early svg { width: 10px; height: 10px; }
.pc-agenda-m-exp { border: 2px solid var(--grey); }
.pc-agenda-m-today::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--ink); }
.pc-agenda-m-late::before { content: ""; width: 12px; height: 12px; border-radius: 2px; background: var(--crit); }
.pc-agenda-m-sm { width: 14px; height: 14px; }
.pc-agenda-m-sm svg { width: 9px; height: 9px; }
.pc-agenda-m-sm.pc-agenda-m-today::before { width: 8px; height: 8px; }
.pc-agenda-m-sm.pc-agenda-m-late::before { width: 10px; height: 10px; }
.pc-agenda-m-sm.pc-agenda-m-exp { border-width: 1.5px; }

/* the week: its switch and its three totals in one card */
.pc-agenda-wk { background: var(--surface); border-radius: var(--radius-card); padding: 6px 8px 10px; margin: 0 0 8px; }
.pc-agenda-wk-nav { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; gap: 8px; align-items: center; }
.pc-agenda-wk-t { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center; gap: 0 8px; min-width: 0; }
.pc-agenda-wk-t b { font: 500 17px/1.25 var(--display); letter-spacing: var(--tracking-tight); white-space: nowrap; }
.pc-agenda-wk-t span { font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-agenda-tot { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 10px; padding: 6px 0 0 6px; }
.pc-agenda-tot-c { display: flex; flex-direction: column; min-width: 0; }
.pc-agenda-tot-l { display: inline-flex; align-items: center; gap: 4px; font: var(--text-label); color: var(--muted); }
.pc-agenda-tot-c b { font: 500 17px/1.3 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-agenda-tot > svg { color: var(--muted); }

/* block header: a day, or the late block */
.pc-agenda-bh { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 10px 2px 6px; min-height: 24px; }
.pc-agenda-bh-t { display: inline-flex; align-items: center; gap: 8px; font: 600 15px/1.3 var(--display); white-space: nowrap; }
.pc-agenda-bh-t small { font: var(--text-label); color: var(--muted); }
.pc-agenda-bh-s { font: var(--text-label); color: var(--muted); white-space: nowrap; padding: 13px 0; margin: -13px 0; }
.pc-agenda-bh-s b { font: 500 14px/1.3 var(--mono); font-variant-numeric: tabular-nums; color: var(--ink); }
.pc-agenda-bh-s.pc-agenda-crit, .pc-agenda-bh-s.pc-agenda-crit b { color: var(--crit-ink); }
.pc-agenda-bh-sub { font: var(--text-label); color: var(--muted); margin: -4px 2px 6px 28px; }
.pc-agenda-now { background: var(--lime); border-radius: 999px; padding: 4px 12px; font: 600 14px/1.2 var(--display); white-space: nowrap; }

/* a card of rows */
.pc-agenda-card { background: var(--surface); border-radius: var(--radius-card); margin: 0 0 8px; overflow: hidden; }
.pc-agenda-card-late { box-shadow: inset 3px 0 0 var(--crit); }
.pc-agenda-card-now { box-shadow: 0 0 0 2px var(--ink); }
.pc-agenda-card-cont { margin-top: -12px; border-radius: 0 0 var(--radius-card) var(--radius-card); }
.pc-agenda-row { border-top: 1px solid var(--line-soft); }
.pc-agenda-card > :first-child { border-top: 0; }
.pc-agenda-who { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; column-gap: 10px; align-items: center; padding: 8px 12px; }
.pc-agenda-name { font: 500 15px/1.35 var(--body); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-agenda-amt { font: 500 16px/1.25 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
.pc-agenda-amt-due { font-size: 18px; }
.pc-agenda-st { grid-column: 2 / 4; font: var(--text-label); color: var(--muted); min-width: 0; }
.pc-agenda-acts { display: flex; flex-wrap: wrap; gap: 8px; padding: 0 12px 8px; margin-top: -2px; }
.pc-agenda-b { padding: 0 14px; flex: 1 1 auto; }
.pc-agenda-ib { width: 34px; padding: 0; }

/* a late payer inside his own day: one quiet line, no sum - the sum and the buttons live in the late block only */
.pc-agenda-stub { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; column-gap: 10px; align-items: center; min-height: 44px; padding: 4px 12px; border-top: 1px solid var(--line-soft); font: var(--text-label); color: var(--muted); }
.pc-agenda-stub-n { font: 400 14px/1.35 var(--body); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pc-agenda-stub-to { white-space: nowrap; }

/* a folded group: one line of result, opened by its own plain button */
.pc-agenda-fold { background: var(--surface); border-radius: var(--radius-card); margin: 0 0 8px; overflow: hidden; }
.pc-agenda-fold > summary { display: block; list-style: none; cursor: pointer; }
.pc-agenda-fold > summary::-webkit-details-marker { display: none; }
.pc-agenda-fold-in { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; column-gap: 10px; align-items: center; padding: 8px 12px; min-height: 52px; }
.pc-agenda-fold-t { display: flex; flex-direction: column; min-width: 0; font: var(--text-label); color: var(--muted); }
.pc-agenda-fold-t span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-agenda-fold-t b { font: 600 14px/1.35 var(--display); color: var(--ink); }
.pc-agenda-tog { gap: 4px; padding: 0 8px 0 12px; }
.ph-body .pc-agenda-tog { min-height: 44px; }
.ph-body .pc-agenda-fold-in { padding-top: 4px; padding-bottom: 4px; }
.pc-agenda-wo { display: none; }
.pc-agenda-fold[open] > summary .pc-agenda-wo { display: inline; }
.pc-agenda-fold[open] > summary .pc-agenda-wc { display: none; }
.pc-agenda-chev { display: inline-flex; transform: rotate(90deg); }
.pc-agenda-chev svg { width: 16px; height: 16px; }
.pc-agenda-fold[open] > summary .pc-agenda-chev { transform: rotate(-90deg); }
.pc-agenda-card > .pc-agenda-fold { border-radius: 0; margin: 0; border-top: 1px solid var(--line-soft); }
.pc-agenda-sub { display: flex; justify-content: space-between; gap: 10px; padding: 7px 12px; background: var(--surface-2); font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-agenda-sub b { font: 600 13px/1.4 var(--display); color: var(--ink); }
.pc-agenda-sub + * { border-top: 0; }
.pc-agenda-next { display: flex; width: 100%; margin: 14px 0 0; }

/* laptop: the same list, wider - a day gutter on the left, the week and the late ones on the right */
.pc-agenda-desk { display: grid; grid-template-columns: minmax(0, 1fr) 304px; column-gap: 24px; align-items: start; }
.pc-agenda-dweek { display: flex; align-items: center; gap: 12px; margin: 0 0 10px; min-height: 34px; }
.pc-agenda-dweek-t { display: flex; align-items: baseline; gap: 10px; margin: 0 4px; white-space: nowrap; }
.pc-agenda-dweek-t b { font: var(--text-h2); }
.pc-agenda-dweek-t span { font: var(--text-label); color: var(--muted); }
.pc-agenda-legend { margin-left: auto; max-width: 216px; font: 400 12px/1.3 var(--body); color: var(--muted); text-align: right; }
.pc-agenda-band { display: grid; grid-template-columns: 150px minmax(0, 1fr); column-gap: 12px; align-items: stretch; margin: 0 0 6px; }
.pc-agenda-band .pc-agenda-card { margin: 0; align-self: start; }
.pc-agenda-gut { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 6px; row-gap: 4px; align-items: center; align-content: start; padding: 6px 10px 8px; border-radius: 12px; }
.pc-agenda-gut-now { background: var(--lime); }
.pc-agenda-gut-tag { grid-column: 1 / 3; font: 400 12px/1.3 var(--body); color: var(--muted); }
.pc-agenda-gut-now .pc-agenda-gut-tag { font: 600 13px/1.3 var(--display); color: var(--ink); }
.pc-agenda-gut-d { font: 600 14px/1.3 var(--display); white-space: nowrap; }
.pc-agenda-gut-s { font: 500 13px/1.3 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-agenda-gut-s.pc-agenda-none-s { font: 400 12px/1.3 var(--body); color: var(--muted); }
.pc-agenda-bar { display: block; height: 8px; }
.pc-agenda-gut .pc-agenda-bar { grid-column: 1 / 3; }
.pc-agenda-bar i { display: block; height: 8px; border-radius: 4px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--grey); overflow: hidden; }
.pc-agenda-bar b { display: block; height: 8px; background: var(--accent); }
.pc-agenda-drow { display: flex; align-items: center; gap: 10px; padding: 4px 12px; min-height: 45px; border-top: 1px solid var(--line-soft); }
.pc-agenda-drow:first-child { border-top: 0; }
.pc-agenda-dwho { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pc-agenda-dwho .pc-agenda-name { font: 500 14px/1.3 var(--body); }
.pc-agenda-dwho .pc-agenda-st { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-agenda-dacts { display: flex; gap: 6px; flex: none; }
.pc-agenda-bd { padding: 0 10px; gap: 6px; }
.pc-agenda-drow .pc-agenda-amt { width: 52px; flex: none; font-size: 14px; }
.pc-agenda-dstub { min-height: 36px; font: var(--text-label); color: var(--muted); }
.pc-agenda-dstub .pc-agenda-stub-n { flex: none; }
.pc-agenda-dstub .pc-agenda-m { margin: 0 2px; }
.pc-agenda-none { padding: 9px 12px; font: var(--text-label); color: var(--muted); }
.pc-agenda-sumcard { margin: 0 0 4px; }
.pc-agenda-kv { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 7px 12px; align-items: center; font: var(--text-body-sm); }
.pc-agenda-kv-l { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.pc-agenda-kv-l small { font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-agenda-kv-v { font: 500 16px/1.3 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
.pc-agenda-kv-sub { padding-left: 14px; font: var(--text-label); gap: 5px 12px; }
.pc-agenda-kv-sub .pc-agenda-kv-v { font-size: 13px; }
.pc-agenda-side .pc-agenda-bar { margin: 10px 0; }
.pc-agenda-heavy { font: var(--text-label); color: var(--muted); margin: 10px 0 0; padding: 10px 0; border-top: 1px solid var(--line-soft); white-space: nowrap; }
.pc-agenda-heavy b { font-weight: 500; color: var(--ink); }
.pc-agenda-came { display: grid; grid-template-columns: minmax(0, 1fr) auto 18px; column-gap: 8px; align-items: center; padding: 10px 0 0; border-top: 1px solid var(--line-soft); font: var(--text-label); }
.pc-agenda-came small { display: block; font: 400 12px/1.35 var(--body); color: var(--muted); }
.pc-agenda-came b { font: 500 16px/1.3 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; text-decoration: underline; text-underline-offset: 3px; }
.pc-agenda-came svg { color: var(--muted); }
.pc-agenda-note { font: var(--text-label); color: var(--muted); margin: 10px 4px 0; }
.pc-agenda-note a { color: var(--ink); font-weight: 500; white-space: nowrap; text-decoration: underline; text-underline-offset: 3px; }
'''


# ---- the one example dataset: week Mon 12.10 - Sun 18.10.2026, today is Wed 14.10 ----
agenda_DAYS = [('Пн', '12.10'), ('Вт', '13.10'), ('Ср', '14.10'), ('Чт', '15.10'), ('Пт', '16.10'), ('Сб', '17.10'), ('Вс', '18.10')]
agenda_WDFULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
agenda_TODAY = 2
agenda_UNSORTED = 5   # the count on the tab "Разобрать"
def agenda_date(off):
    # a day counted from Monday 12.10; the example never leaves October
    return str(12 + off) + '.10'
def agenda_r(k, moped, amount, day, state, pay=None, how='', days=0, debt=0):
    # pay - the day the money came, counted from Monday (None: not paid); it is never later than today
    return {'k': k, 'moped': moped, 'sum': amount, 'day': day, 'state': state, 'pay': pay, 'how': how, 'days': days, 'debt': debt}
agenda_RENTALS = [
    agenda_r('А', 'Wolf-8', 150, 0, 'paid', 0, 'наличные'),
    agenda_r('Б', 'B11', 150, 1, 'early', -2, 'перевод'),
    agenda_r('В', 'B11', 140, 1, 'paid', 1, 'перевод'),
    agenda_r('Г', 'XL1200', 150, 1, 'late', days=1, debt=150),
    agenda_r('Д', '17C', 150, 2, 'today'),
    agenda_r('Е', 'Wolf-8', 150, 2, 'paid', 2, 'карта'),
    agenda_r('М', '17C', 150, 2, 'late', days=7, debt=300),
    agenda_r('Ж', 'XL1200', 150, 3, 'exp'),
    agenda_r('З', 'B11', 150, 3, 'exp'),
    agenda_r('И', 'F-150', 150, 4, 'exp'),
    agenda_r('К', 'B11', 150, 4, 'early', 1, 'наличные'),
    agenda_r('Л', 'MB5', 150, 5, 'exp'),
]
agenda_PAID = ('paid', 'early')

def agenda_scale():
    # the same Wednesday at 85 mopeds, 150 ₾ each - invented like everything here, to show how the list folds
    plan = [(1, 0, 0, 11, 0), (1, 0, 0, 10, 1), (1, 4, 0, 6, 2), (0, 0, 10, 0, 2), (0, 0, 11, 0, 1), (0, 0, 11, 0, 1), (0, 0, 12, 0, 0)]
    mopeds = ['Wolf-8', 'B11', 'XL1200', '17C', 'F-150', 'MB5']
    how = ['наличные', 'перевод', 'карта']
    late = {0: (2, 150), 1: (1, 150), 2: (7, 300)}
    out, n = [], 0
    for d, (n_late, n_today, n_exp, n_paid, n_early) in enumerate(plan):
        for state, cnt in (('late', n_late), ('today', n_today), ('exp', n_exp), ('paid', n_paid), ('early', n_early)):
            for _ in range(cnt):
                n += 1
                r = agenda_r(str(n), mopeds[(n + n // 6) % 6], 150, d, state)
                if state == 'late': r['days'], r['debt'] = late[d]
                if state == 'paid': r['pay'], r['how'] = d, how[n % 3]
                if state == 'early': r['pay'], r['how'] = min(d - 2, agenda_TODAY), how[n % 3]
                out.append(r)
    return out
agenda_BIG = agenda_scale()

def agenda_of(rs, day):
    # who is still to pay goes first, then the late one, then the paid
    rank = {'today': 0, 'exp': 0, 'late': 1, 'paid': 2, 'early': 2}
    return sorted([r for r in rs if r['day'] == day], key=lambda r: rank[r['state']])
def agenda_sum(rows): return sum(r['sum'] for r in rows)
def agenda_paid(rows): return [r for r in rows if r['state'] in agenda_PAID]
def agenda_in(rows, state): return [r for r in rows if r['state'] == state]
def agenda_debt(rows): return sum(r['debt'] for r in agenda_in(rows, 'late'))
def agenda_daysums(rs): return [agenda_sum(agenda_of(rs, d)) for d in range(7)]
def agenda_came(rs): return [r for r in rs if r['pay'] is not None and 0 <= r['pay'] <= agenda_TODAY]

# the figures of the brief, checked before a single frame is drawn
agenda_ALL = agenda_sum(agenda_RENTALS)
agenda_GOT = agenda_sum(agenda_paid(agenda_RENTALS))
assert len(agenda_RENTALS) == 12 and agenda_ALL == 1790
assert len(agenda_paid(agenda_RENTALS)) == 5 and agenda_GOT == 740
assert agenda_ALL - agenda_GOT == 1050 and len(agenda_RENTALS) - len(agenda_paid(agenda_RENTALS)) == 7
assert agenda_sum(agenda_in(agenda_RENTALS, 'late')) == 300 and agenda_debt(agenda_RENTALS) == 450 and len(agenda_in(agenda_RENTALS, 'late')) == 2
assert agenda_daysums(agenda_RENTALS) == [150, 440, 450, 300, 300, 150, 0]
assert agenda_sum(agenda_in(agenda_RENTALS, 'today')) == 150 and agenda_sum(agenda_in(agenda_RENTALS, 'exp')) == 600
# payment dates: nothing is dated after today, "заранее" means the money came before the week began,
# and by payment date 590 ₾ in 4 payments came on 12-14.10 (the fifth, 150 ₾, came on 10.10)
def agenda_check(rs):
    for r in rs:
        assert (r['pay'] is not None) == (r['state'] in agenda_PAID)
        if r['state'] == 'paid': assert r['pay'] == r['day'] <= agenda_TODAY
        if r['state'] == 'early': assert r['pay'] < r['day'] and r['pay'] <= agenda_TODAY
        if r['state'] == 'late': assert r['day'] <= agenda_TODAY and r['debt'] >= r['sum']
        if r['state'] == 'today': assert r['day'] == agenda_TODAY
        if r['state'] == 'exp': assert r['day'] > agenda_TODAY
agenda_check(agenda_RENTALS)
agenda_check(agenda_BIG)
assert agenda_sum(agenda_came(agenda_RENTALS)) == 590 and len(agenda_came(agenda_RENTALS)) == 4
assert agenda_sum(agenda_paid([r for r in agenda_RENTALS if r['day'] < agenda_TODAY])) == 440
# the 85-moped example adds up too
assert len(agenda_BIG) == 85 and agenda_sum(agenda_BIG) == 12750 and [len(agenda_of(agenda_BIG, d)) for d in range(7)] == [12, 12, 13, 12, 12, 12, 12]
assert len(agenda_paid(agenda_BIG)) == 34 and agenda_sum(agenda_paid(agenda_BIG)) == 5100
assert len(agenda_in(agenda_BIG, 'late')) == 3 and agenda_sum(agenda_in(agenda_BIG, 'late')) == 450 and agenda_debt(agenda_BIG) == 600
assert agenda_sum(agenda_in(agenda_BIG, 'today')) == 600 and agenda_sum(agenda_in(agenda_BIG, 'exp')) == 6600
assert 5100 + 450 + 600 + 6600 == 12750
# the 85-moped example is ONE week on the page: what А writes out (weekstrip_BIG) is this same set, day by day and person by person
for _d in range(7):
    _rows, _w = agenda_of(agenda_BIG, _d), weekstrip_BIG['days'][_d]
    assert (_w['n'], _w['sum'], _w['paid_n'], _w['paid_sum'], _w['late']) == (
        len(_rows), agenda_sum(_rows), len(agenda_paid(_rows)), agenda_sum(agenda_paid(_rows)), len(agenda_in(_rows, 'late')))
assert weekstrip_BIG['debt'] == agenda_debt(agenda_BIG)
assert ([(r['k'], r['m'], r['d'], r['days'], r['debt']) for r in weekstrip_BIG_LATE]
        == [(r['k'], r['moped'], r['day'], r['days'], r['debt']) for r in sorted(agenda_in(agenda_BIG, 'late'), key=lambda r: -r['days'])])
assert (sorted((int(r['k']), r['m'], r['s'], r.get('ch', '')) for r in weekstrip_BIG_TODAY)
        == sorted((int(r['k']), r['moped'], r['state'], r['how']) for r in agenda_of(agenda_BIG, agenda_TODAY)))
assert all(r['on'] == agenda_date(a['pay']) for r in weekstrip_BIG_DONE for a in agenda_BIG if a['k'] == r['k'])

def agenda_num(n):
    s = str(n)
    return (s[:-3] + '&thinsp;' + s[-3:]) if len(s) > 3 else s
def agenda_gel(n): return agenda_num(n) + '&nbsp;₾'
def agenda_form(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11: return one
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14): return few
    return many
def agenda_pl(n): return str(n) + ' ' + agenda_form(n, 'оплата', 'оплаты', 'оплат')
def agenda_day(d): return agenda_DAYS[d][0] + ' ' + agenda_DAYS[d][1]
def agenda_name(r): return 'Клиент Пример ' + r['k']

agenda_TICK = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS['check'] + '</svg>'
def agenda_mark(state, sm=False):
    inner = agenda_TICK if state in agenda_PAID else ''
    return '<i class="pc-agenda-m pc-agenda-m-' + state + (' pc-agenda-m-sm' if sm else '') + '">' + inner + '</i>'

def agenda_stline(r):
    # moped, then the state word; "Ожидается" is only ever the state of one payment that is not due yet
    s, m = r['state'], r['moped'] + ' · '
    if s == 'paid':
        when = 'сегодня' if r['pay'] == agenda_TODAY else agenda_date(r['pay'])
        return m + '<span class="pc-agenda-ok">Оплачено</span> · ' + when + ', ' + r['how']
    if s == 'early': return m + '<span class="pc-agenda-ok">Оплачено заранее</span> · ' + agenda_date(r['pay']) + ', ' + r['how']
    if s == 'today': return m + '<span class="pc-agenda-wait">Ждём сегодня</span>'
    if s == 'exp': return m + 'Ожидается'
    weeks = r['debt'] // r['sum']
    return m + '<span class="pc-agenda-crit">Просрочено · ' + str(r['days']) + '&nbsp;дн.</span>' + (' · ' + str(weeks) + ' недели' if weeks > 1 else '')

def agenda_acts(r, dense=False, tight=False):
    # who has paid needs no button; today and late - take, call, write; tomorrow - take or remind; later - take
    s = r['state']
    if s in agenda_PAID: return ''
    sm = (' btn-sm' if dense else '') + (' pc-agenda-bd' if tight else ' pc-agenda-b')
    take = '<a class="btn' + sm + '" href="#">Принять оплату</a>'
    if s == 'exp':
        if r['day'] == agenda_TODAY + 1:
            return take + '<a class="btn' + sm + '" href="#">' + ic('chat', 'i s') + 'Напомнить</a>'
        return take
    if dense:
        return (take + '<a class="btn btn-sm pc-agenda-ib" href="#" aria-label="Позвонить">' + ic('phone', 'i s') + '</a>'
                + '<a class="btn btn-sm pc-agenda-ib" href="#" aria-label="Написать в WhatsApp">' + ic('chat', 'i s') + '</a>')
    return (take + '<a class="btn btn-round" href="#" aria-label="Позвонить">' + ic('phone') + '</a>'
            + '<a class="btn btn-round" href="#" aria-label="Написать в WhatsApp">' + ic('chat') + '</a>')

def agenda_row(r, dense=False):
    # one person: in the late block the figure is the whole debt, in a day it is that week's rent
    late, paid = r['state'] == 'late', r['state'] in agenda_PAID
    tone = ' pc-agenda-crit' if late else (' pc-agenda-ok' if paid else ' pc-agenda-amt-due')
    if late: tone += ' pc-agenda-amt-due'
    acts = agenda_acts(r, dense)
    h = ('<div class="pc-agenda-row"><a class="pc-agenda-who" href="#">' + agenda_mark(r['state'])
         + '<span class="pc-agenda-name">' + agenda_name(r) + '</span>'
         + '<span class="pc-agenda-amt' + tone + '">' + agenda_gel(r['debt'] if late else r['sum']) + '</span>'
         + '<span class="pc-agenda-st">' + agenda_stline(r) + '</span></a>')
    if acts: h += '<div class="pc-agenda-acts">' + acts + '</div>'
    return h + '</div>'

def agenda_stub(r):
    return ('<a class="pc-agenda-stub" href="#">' + agenda_mark('late', True) + '<span class="pc-agenda-stub-n">' + agenda_name(r) + '</span>'
            + '<span class="pc-agenda-stub-to">в «Просрочено» выше</span></a>')
def agenda_rows(rows):
    # inside a day a late payer is only pointed at: he is written once, in the late block
    return ''.join(agenda_stub(r) if r['state'] == 'late' else agenda_row(r) for r in rows)

def agenda_late_block(rs, dense=False):
    # never folded and never cut: this is the list somebody works through
    late = sorted(agenda_in(rs, 'late'), key=lambda r: -r['days'])
    debt, week = agenda_debt(rs), agenda_sum(late)
    split = agenda_gel(week) + ' — эта неделя' + (', ' + agenda_gel(debt - week) + ' — прошлая' if debt > week else '')
    return ('<div class="pc-agenda-bh"><span class="pc-agenda-bh-t">' + agenda_mark('late') + 'Просрочено · ' + str(len(late)) + '</span>'
            + '<a class="pc-agenda-bh-s pc-agenda-crit" href="#">долг <b>' + agenda_gel(debt) + '</b></a></div>'
            + '<div class="pc-agenda-bh-sub">' + split + '</div>'
            + '<div class="pc-agenda-card pc-agenda-card-late">' + ''.join(agenda_row(r, dense) for r in late) + '</div>')

# ---- phone ----
def agenda_tot_cell(label, amount, n, tone='', mark=''):
    return ('<span class="pc-agenda-tot-c"><span class="pc-agenda-tot-l">' + mark + label + '</span>'
            + '<b class="' + tone + '">' + agenda_gel(amount) + '</b><span class="pc-agenda-tot-l">' + agenda_pl(n) + '</span></span>')
def agenda_weekcard(rs):
    n_all, n_got, got = len(rs), len(agenda_paid(rs)), agenda_sum(agenda_paid(rs))
    return ('<div class="pc-agenda-wk"><div class="pc-agenda-wk-nav">'
            '<a class="btn btn-round" href="#" aria-label="Прошлая неделя">' + ic('left') + '</a>'
            '<div class="pc-agenda-wk-t"><b>12.10 – 18.10</b><span>эта неделя</span></div>'
            '<a class="btn btn-round" href="#" aria-label="Следующая неделя">' + ic('right') + '</a></div>'
            '<a class="pc-agenda-tot" href="#" aria-label="Платежи по этим арендам">'
            + agenda_tot_cell('Должно прийти', agenda_sum(rs), n_all)
            + agenda_tot_cell('Оплачено', got, n_got, 'pc-agenda-ok', agenda_mark('paid', True))
            + agenda_tot_cell('Осталось', agenda_sum(rs) - got, n_all - n_got)
            + ic('right', 'i s') + '</a></div>')

def agenda_fold(mark, title, lines, inner, opened=False):
    # lines: the result of what is folded, one short line each
    return ('<details class="pc-agenda-fold"' + (' open' if opened else '') + '><summary><span class="pc-agenda-fold-in">' + mark
            + '<span class="pc-agenda-fold-t"><b>' + title + '</b>' + ''.join('<span>' + l + '</span>' for l in lines) + '</span>'
            + '<span class="btn btn-sm pc-agenda-tog"><span class="pc-agenda-wc">Показать</span><span class="pc-agenda-wo">Скрыть</span><span class="pc-agenda-chev">' + ic('right', 'i s') + '</span></span>'
            + '</span></summary>' + inner + '</details>')

def agenda_past_fold(rs, opened=False):
    # the days already gone are one line of result; the late ones from them are in the late block above
    rows = [r for r in rs if r['day'] < agenda_TODAY]
    miss = agenda_in(rows, 'late')
    title = 'Прошедшие дни · ' + agenda_DAYS[0][0] + '–' + agenda_DAYS[agenda_TODAY - 1][0]
    res = ['оплачено ' + agenda_num(agenda_sum(agenda_paid(rows))) + ' из ' + agenda_gel(agenda_sum(rows))]
    if miss:
        res.append('<span class="pc-agenda-crit">' + ('не оплатил ' if len(miss) == 1 else 'не оплатили ') + str(len(miss)) + '</span>')
    inner = ''
    for d in range(agenda_TODAY):
        day = agenda_of(rs, d)
        inner += ('<div class="pc-agenda-sub"><b>' + agenda_day(d) + '</b><span>' + agenda_pl(len(day)) + ' · ' + agenda_gel(agenda_sum(day)) + '</span></div>'
                  + agenda_rows(day))
    return agenda_fold(agenda_mark('late' if miss else 'paid'), title, res, inner, opened)

def agenda_day_head(rs, d):
    rows = agenda_of(rs, d)
    if d == agenda_TODAY: title = '<span class="pc-agenda-now">Сегодня</span>' + agenda_day(d)
    elif d == agenda_TODAY + 1: title = agenda_day(d) + '<small>завтра</small>'
    else: title = agenda_day(d)
    if not rows:
        return '<div class="pc-agenda-bh"><span class="pc-agenda-bh-t">' + title + '</span><span class="pc-agenda-bh-s">оплат нет</span></div>'
    return ('<div class="pc-agenda-bh"><span class="pc-agenda-bh-t">' + title + '</span>'
            + '<a class="pc-agenda-bh-s" href="#">' + agenda_pl(len(rows)) + ' · <b>' + agenda_gel(agenda_sum(rows)) + '</b></a></div>')

def agenda_paid_fold(rows, d, opened=False):
    # who has paid in a busy day: one line with the count and the sum
    paid = agenda_paid(rows)
    word = 'Оплачено' if d <= agenda_TODAY else 'Оплачено заранее'
    return agenda_fold(agenda_mark('paid' if d <= agenda_TODAY else 'early'), word + ' · ' + str(len(paid)), [agenda_gel(agenda_sum(paid))], agenda_rows(paid), opened)

def agenda_open_day(rs, d, many=False):
    # many: at 85 mopeds the paid rows of a day fold into one line; who is awaited is never folded
    rows = agenda_of(rs, d)
    if not rows: return agenda_day_head(rs, d)
    if many and agenda_paid(rows):
        body = agenda_rows([r for r in rows if r['state'] not in agenda_PAID]) + agenda_paid_fold(rows, d)
    else:
        body = agenda_rows(rows)
    return agenda_day_head(rs, d) + '<div class="pc-agenda-card' + (' pc-agenda-card-now' if d == agenda_TODAY else '') + '">' + body + '</div>'

def agenda_day_line(rs, d):
    # at 85 mopeds a day after tomorrow is one line with its sum and a plain button
    rows = agenda_of(rs, d)
    early = agenda_paid(rows)
    lines = [agenda_pl(len(rows)) + ' · ' + agenda_gel(agenda_sum(rows))]
    if early: lines.append('<span class="pc-agenda-ok">оплачено заранее ' + str(len(early)) + '</span>')
    return agenda_fold(agenda_mark('exp'), agenda_day(d), lines, agenda_rows(rows))

agenda_NEXT = '<a class="btn pc-agenda-next" href="#">Следующая неделя · 19.10 – 25.10' + ic('right', 'i s') + '</a>'

def agenda_phone_top():
    # the screen as it opens: the week, the late ones, today, then the rest of the list
    rs = agenda_RENTALS
    return (stabs() + agenda_weekcard(rs) + agenda_late_block(rs)
            + ''.join(agenda_open_day(rs, d) for d in range(agenda_TODAY, 7)) + agenda_past_fold(rs) + agenda_NEXT)
def agenda_phone_mid():
    # the same screen scrolled to tomorrow
    rs = agenda_RENTALS
    return ''.join(agenda_open_day(rs, d) for d in range(agenda_TODAY + 1, 7)) + agenda_past_fold(rs) + agenda_NEXT
def agenda_phone_end():
    # the end of the list, the past days opened by their button. The frame starts where a screen scrolled to its end starts:
    # the tail of Friday's card under the header, then Saturday, Sunday, the past days and the next week
    rs = agenda_RENTALS
    d = agenda_TODAY + 2
    return ('<div class="pc-agenda-card pc-agenda-card-cont">' + agenda_rows(agenda_of(rs, d)[-1:]) + '</div>'
            + ''.join(agenda_open_day(rs, x) for x in range(d + 1, 7)) + agenda_past_fold(rs, True) + agenda_NEXT)
def agenda_phone_big():
    # 85 mopeds: late and awaited-today stay open, the paid and the days after tomorrow fold
    rs = agenda_BIG
    return (stabs() + agenda_weekcard(rs) + agenda_late_block(rs)
            + ''.join(agenda_open_day(rs, d, True) for d in (agenda_TODAY, agenda_TODAY + 1))
            + ''.join(agenda_day_line(rs, d) for d in range(agenda_TODAY + 2, 7)) + agenda_past_fold(rs) + agenda_NEXT)
def agenda_phone_big_end():
    # 85 mopeds, scrolled to the end of tomorrow: the early-paid opened by their button, the later days as lines
    rs = agenda_BIG
    d = agenda_TODAY + 1
    rows = agenda_of(rs, d)
    wait = [r for r in rows if r['state'] not in agenda_PAID]
    return ('<div class="pc-agenda-card pc-agenda-card-cont">' + agenda_rows(wait[-1:]) + agenda_paid_fold(rows, d, True) + '</div>'
            + ''.join(agenda_day_line(rs, x) for x in range(agenda_TODAY + 2, 7)) + agenda_past_fold(rs) + agenda_NEXT)

# ---- laptop ----
def agenda_bar(total, paid, of=None):
    w = 100 if of is None else round(100 * total / of)
    p = round(100 * paid / total) if total else 0
    return '<span class="pc-agenda-bar"><i style="width:' + str(w) + '%"><b style="width:' + str(p) + '%"></b></i></span>'

def agenda_drow(r):
    if r['state'] == 'late':
        return ('<a class="pc-agenda-drow pc-agenda-dstub" href="#">' + agenda_mark('late', True) + '<span class="pc-agenda-stub-n">' + agenda_name(r) + '</span>'
                + '<span>— в «Просрочено» справа</span></a>')
    acts = agenda_acts(r, True, True)
    tone = 'pc-agenda-ok' if r['state'] in agenda_PAID else ''
    return ('<div class="pc-agenda-drow">' + agenda_mark(r['state'])
            + '<a class="pc-agenda-dwho" href="#"><span class="pc-agenda-name">' + agenda_name(r) + '</span>'
            + '<span class="pc-agenda-st">' + agenda_stline(r) + '</span></a>'
            + ('<span class="pc-agenda-dacts">' + acts + '</span>' if acts else '')
            + '<span class="pc-agenda-amt ' + tone + '">' + agenda_gel(r['sum']) + '</span></div>')

def agenda_band(rs, d):
    rows = agenda_of(rs, d)
    top = max(agenda_daysums(rs))
    tag = ''
    if d == agenda_TODAY: tag = '<span class="pc-agenda-gut-tag">Сегодня</span>'
    elif d == agenda_TODAY + 1: tag = '<span class="pc-agenda-gut-tag">завтра</span>'
    if not rows:
        gut = tag + '<span class="pc-agenda-gut-d">' + agenda_day(d) + '</span><span class="pc-agenda-gut-s pc-agenda-none-s">—</span>'
        card = '<div class="pc-agenda-none">Оплат нет</div>'
    else:
        total = agenda_sum(rows)
        gut = (tag + '<span class="pc-agenda-gut-d">' + agenda_day(d) + '</span><a class="pc-agenda-gut-s" href="#">' + agenda_gel(total) + '</a>'
               + agenda_bar(total, agenda_sum(agenda_paid(rows)), top))
        card = ''.join(agenda_drow(r) for r in rows)
    now = d == agenda_TODAY
    return ('<div class="pc-agenda-band"><div class="pc-agenda-gut' + (' pc-agenda-gut-now' if now else '') + '">' + gut + '</div>'
            + '<div class="pc-agenda-card' + (' pc-agenda-card-now' if now else '') + '">' + card + '</div></div>')

def agenda_kv(label, n, amount, tone='', mark=''):
    return ('<span class="pc-agenda-kv-l">' + mark + '<span>' + label + '</span><small>' + n + '</small></span>'
            + '<b class="pc-agenda-kv-v ' + tone + '">' + agenda_gel(amount) + '</b>')

def agenda_desk_body():
    rs = agenda_RENTALS
    week = ('<div class="pc-agenda-dweek"><a class="btn btn-sm" href="#">' + ic('left', 'i s') + 'Прошлая</a>'
            '<div class="pc-agenda-dweek-t"><b>12.10 – 18.10</b><span>эта неделя</span></div>'
            '<a class="btn btn-sm" href="#">Следующая' + ic('right', 'i s') + '</a>'
            '<span class="pc-agenda-legend">полоска: сколько должно прийти за день, зелёным — оплачено</span></div>')
    n_all, n_got = len(rs), len(agenda_paid(rs))
    late, wait, ahead = agenda_in(rs, 'late'), agenda_in(rs, 'today'), agenda_in(rs, 'exp')
    sums = agenda_daysums(rs)
    heavy = sums.index(max(sums))
    came = agenda_came(rs)
    before = [r for r in rs if r['pay'] is not None and r['pay'] < 0]
    came_sub = str(len(came)) + ' ' + agenda_form(len(came), 'платёж', 'платежа', 'платежей')
    if before:
        came_sub += '; ещё ' + agenda_gel(agenda_sum(before)) + ' — заранее, ' + ', '.join(agenda_date(r['pay']) for r in before)
    summary = ('<div class="card pc-agenda-sumcard"><div class="h3">Неделя 12.10 – 18.10</div>'
               '<a class="pc-agenda-kv" href="#" aria-label="Платежи по этим арендам">'
               + agenda_kv('Должно прийти', agenda_pl(n_all), agenda_ALL)
               + agenda_kv('Оплачено', str(n_got), agenda_GOT, 'pc-agenda-ok', agenda_mark('paid', True))
               + agenda_kv('Осталось', str(n_all - n_got), agenda_ALL - agenda_GOT) + '</a>'
               + agenda_bar(agenda_ALL, agenda_GOT)
               + '<a class="pc-agenda-kv pc-agenda-kv-sub" href="#" aria-label="Кто ещё не оплатил">'
               + agenda_kv('Просрочено за эту неделю', str(len(late)), agenda_sum(late), 'pc-agenda-crit', agenda_mark('late', True))
               + agenda_kv('Ждём сегодня', str(len(wait)), agenda_sum(wait), '', agenda_mark('today', True))
               + agenda_kv('Ожидается', str(len(ahead)), agenda_sum(ahead), '', agenda_mark('exp', True)) + '</a>'
               + '<div class="pc-agenda-heavy">Самый большой день — ' + agenda_WDFULL[heavy] + ', <b>' + agenda_gel(sums[heavy]) + '</b></div>'
               + '<a class="pc-agenda-came" href="#"><span>Пришло денег ' + agenda_date(0) + ' – ' + agenda_date(agenda_TODAY)
               + '<small>' + came_sub + '</small></span><b>' + agenda_gel(agenda_sum(came)) + '</b>' + ic('right', 'i s') + '</a></div>')
    assert agenda_UNSORTED == weekstrip_UNSORTED
    note = '<div class="pc-agenda-note">' + SORT_HINT + '. <a href="#">Разобрать</a></div>'
    return ('<div class="pc-agenda-desk"><div>' + week + ''.join(agenda_band(rs, d) for d in range(7)) + '</div>'
            + '<aside class="pc-agenda-side">' + summary + agenda_late_block(rs, True) + note + '</aside></div>')

def agenda_bands(letter, rec=False):
    lead = '<b>' + letter + '. ' + agenda_NAME + (' — рекомендую' if rec else '') + '.</b> '
    cap_top = (lead + 'Экран читается сверху вниз, как список дел: сколько должно прийти за неделю и сколько из этого уже оплачено, '
               'кто просрочил, кто платит сегодня. Без прокрутки видны итоги, оба должника и сегодняшний плательщик с кнопками; '
               'оплативший сегодня и следующие дни — ниже. ' + FORM_HINT + ' Нажатие на имя — карточка аренды, на итоги — «Платежи».')
    cap_mid = ('<b>' + letter + ', тот же экран ниже.</b> Завтра — с кнопкой «Напомнить» (WhatsApp «Завтра оплата»), дальше пятница и суббота: '
               'в заголовке дня число оплат и сумма, у оплативших кнопок нет. Прошедшие дни и кнопка следующей недели — ещё ниже, в соседнем кадре.')
    cap_end = ('<b>' + letter + ', конец списка.</b> Прошедшие дни сложены в одну строку с итогом и открываются кнопкой «Показать» — здесь она нажата. '
               'Должник в своём дне записан одной строкой без суммы: его долг и кнопки есть только в «Просрочено», наверху. '
               'Цена: неделя не помещается на один экран телефона — это два с лишним экрана прокрутки.')
    cap_big = ('<b>' + letter + ' при 85 мопедах</b> (пример: 85 оплат на 12&thinsp;750&nbsp;₾ в неделю, 12–13 в день). «Просрочено» не сворачивается и не обрезается, '
               'сколько бы должников ни было, — это рабочий список; так же «Ждём сегодня». Цена: уже при трёх должниках «Сегодня» начинается '
               'у нижнего края первого экрана, а сегодня и завтра вместе — два-три экрана прокрутки.')
    cap_big_end = ('<b>' + letter + ' при 85 мопедах, конец списка.</b> Экран прокручен к концу завтрашнего дня. Оплатившие в каждом дне сложены в одну строку '
                   'с кнопкой «Показать»: сегодня это «Оплачено · 8», завтра — «Оплачено заранее · 2», здесь она нажата. '
                   'Пятница, суббота, воскресенье и прошедшие дни — строкой с суммой и той же кнопкой.')
    cap_desk = ('<b>' + letter + ' на ноутбуке.</b> Вся неделя раскрыта одним списком и помещается на экран; сегодняшний день — на лаймовом поле и в рамке. '
                'Слева у каждого дня сумма и полоска, итог недели и просроченные всегда справа. «Оплачено 740&nbsp;₾» считает недели аренды, а не даты платежей: '
                '150&nbsp;₾ пришли заранее, 10.10, поэтому по датам за 12.10 – 14.10 пришло 590&nbsp;₾ — эта строка открывает «Платежи» за эти дни. '
                'При 85 мопедах оплатившие в каждом дне сворачиваются в строку «Оплачено · N» с кнопкой «Показать», дни после завтра — в строку с суммой; '
                'на один экран неделя тогда уже не помещается. '
                'Цена: видна одна неделя — месяц не виден, прошлые и будущие недели листаются кнопками.')
    bar = tabbar('owner', 'money', 9)
    return [
        (letter + '. ' + agenda_NAME + ' — телефон',
         phone(cap_top, head('Деньги'), agenda_phone_top(), bar)
         + phone(cap_mid, head('Деньги'), agenda_phone_mid(), bar)
         + phone(cap_end, head('Деньги'), agenda_phone_end(), bar)
         + phone(cap_big, head('Деньги'), agenda_phone_big(), bar)
         + phone(cap_big_end, head('Деньги'), agenda_phone_big_end(), bar)),
        (letter + '. ' + agenda_NAME + ' — ноутбук',
         desk(cap_desk, rail('money', 'owner', 9), dmain(agenda_desk_body(), 'календарь платежей · сегодня среда, 14.10'))),
    ]


# ====================================================================================================
# В · wild · «Очередь оплат»
# ====================================================================================================
wild_NAME = 'Очередь оплат'
wild_PITCH = ('Лучше всех отвечает на вопрос «что делать прямо сейчас»: сверху неделя полосой из семи дней, под ней — кого догонять, '
         'кого ждём сегодня, кто платит завтра и дальше по дням; оплатившие — отдельным списком, на телефоне под кнопкой «Показать».')
wild_COST = ('Это очередь, а не календарная сетка: люди сложены по срочности, а не по дням, поэтому прошедший день целиком '
        '(кто платил во вторник) одним взглядом не виден, и месяца целиком нет. При 85 мопедах очередь на сегодня — около двух прокруток телефона.')

wild_CSS = '''
/* ---- Очередь оплат (pc-wild) ---- */
/* marks: one shape per state, the same in tiles, pile heads and rows */
.pc-wild-mk { width: 9px; height: 9px; flex: none; display: inline-block; }
.pc-wild-mk-late { background: var(--crit); }
.pc-wild-mk-today { background: var(--ink); border-radius: 50%; }
.pc-wild-mk-exp { border: 2px solid var(--grey); border-radius: 50%; }
.pc-wild-tk { width: 15px; height: 15px; flex: none; border-radius: 50%; display: inline-grid; place-items: center; background: var(--accent); color: var(--on-accent); border: 1px solid var(--accent); }
.pc-wild-tk-adv { background: var(--surface); color: var(--accent); }
.pc-wild-tki { width: 9px; height: 9px; display: block; fill: none; stroke: currentColor; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.pc-wild-go { width: 14px; height: 14px; flex: none; align-self: center; fill: none; stroke: var(--muted); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.pc-wild-red { color: var(--crit-ink); }
.pc-wild-in { color: var(--accent-ink); }
.pc-wild-nw { white-space: nowrap; }
.pc-wild-lnk { border-bottom: 1px dotted var(--line-control); }

/* phone: the week card - arrows, seven day tiles, two lines of total */
.pc-wild-wk { background: var(--surface); border-radius: var(--radius-card); padding: 6px 8px 4px; margin-bottom: 4px; }
.pc-wild-per { display: flex; align-items: center; gap: 8px; }
.pc-wild-per-l { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 1px; }
.pc-wild-per-l b { font: 500 16px/1.2 var(--display); letter-spacing: var(--tracking-tight); white-space: nowrap; }
.pc-wild-per-l span { font: 400 12px/1.3 var(--body); color: var(--muted); white-space: nowrap; }
.pc-wild-tiles { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; margin-top: 4px; }
.pc-wild-t { min-width: 0; padding: 3px 0 4px; display: flex; flex-direction: column; align-items: center; border-radius: 10px; background: var(--surface-2); color: var(--ink); }
.pc-wild-t-now { background: var(--lime); }
.pc-wild-t-wd { display: inline-flex; align-items: center; gap: 3px; font: 500 11px/13px var(--display); color: var(--muted); }
.pc-wild-t-wd .pc-wild-mk { width: 7px; height: 7px; }
.pc-wild-t-now .pc-wild-t-wd { color: var(--ink); }
.pc-wild-t-d { font: 600 13px/17px var(--display); white-space: nowrap; }
.pc-wild-t-s { font: 500 11px/14px var(--body); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-wild-t-none .pc-wild-t-s { color: var(--muted); font-weight: 400; }
.pc-wild-t-bx { width: 36px; height: 5px; margin-top: 3px; display: flex; justify-content: center; }
.pc-wild-t-bar { display: block; height: 5px; border-radius: 3px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-control); overflow: hidden; }
.pc-wild-t-bar i { display: block; height: 100%; background: var(--accent); }
.pc-wild-sm { display: block; padding: 5px 4px 0; min-height: 44px; }
.pc-wild-sm-r { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: 0 10px; }
.pc-wild-sm-l { display: inline-flex; align-items: baseline; gap: 5px; white-space: nowrap; }
.pc-wild-sw { width: 12px; height: 6px; border-radius: 3px; flex: none; align-self: center; display: inline-block; }
.pc-wild-sw-paid { background: var(--accent); }
.pc-wild-sw-left { background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-control); }
.pc-wild-sm-k { font: 400 13px/1.3 var(--body); color: var(--muted); }
.pc-wild-sm-v { font: 500 14px/1.3 var(--mono); font-variant-numeric: tabular-nums; }
.pc-wild-sm-o { font: 400 13px/1.3 var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.pc-wild-sm-n { font: 400 13px/1.3 var(--body); color: var(--muted); white-space: nowrap; margin-left: auto; }

/* pile heads */
.pc-wild-ph { display: flex; align-items: center; gap: 8px; margin: 6px 2px 4px; min-height: 26px; }
.pc-wild-ph h3 { margin: 0; font: 500 15px/1.2 var(--display); display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
.pc-wild-ph-n { font: 500 12px/1 var(--mono); background: var(--surface-2); color: var(--muted); padding: 4px 7px; border-radius: 999px; }
.pc-wild-ph-s { margin: -13px 0 -13px auto; padding: 13px 0 13px 12px; font: 500 15px/1.2 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-wild-ph-s small { font: var(--text-label); margin-right: 6px; }
.pc-wild-ph-sub { font: var(--text-label); color: var(--muted); margin: -2px 2px 4px; }
/* a day inside "Впереди" */
.pc-wild-dh { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; margin: 10px 2px 4px; font: var(--text-label); color: var(--muted); }
.pc-wild-ph + .pc-wild-dh { margin-top: 0; }
.pc-wild-dh > b { font: 500 14px/1.4 var(--display); color: var(--ink); white-space: nowrap; }
.pc-wild-dh > span { white-space: nowrap; }
.pc-wild-dh-r { margin-left: auto; }
.pc-wild-dh-r b { font: 500 13px/1.4 var(--mono); color: var(--ink); font-variant-numeric: tabular-nums; }

/* a person we wait money from: name and sum, the state under the name, then the buttons */
.pc-wild-c { background: var(--surface); border-radius: var(--radius-card); padding: 0 14px 8px; margin-bottom: 4px; }
.pc-wild-c-late { box-shadow: inset 3px 0 0 var(--crit); }
.pc-wild-open { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; align-items: baseline; align-content: center; padding: 5px 0; min-height: 50px; }
.pc-wild-who { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 8px; min-width: 0; }
.pc-wild-who b { font: 500 15px/1.35 var(--body); min-width: 0; overflow-wrap: anywhere; }
.pc-wild-who span { font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-wild-sum { font: 500 18px/1.2 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
.pc-wild-sum small { font: 400 12px/1.2 var(--body); margin-right: 6px; }
.pc-wild-l2 { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: center; gap: 0 4px; min-width: 0; font: var(--text-label); color: var(--muted); }
.pc-wild-s { display: inline-flex; align-items: center; gap: 6px; font: 500 13px/1.4 var(--body); white-space: nowrap; }
.pc-wild-s-late { color: var(--crit-ink); }
.pc-wild-s-today { color: var(--ink); }
.pc-wild-s-exp { color: var(--grey-ink); }
.pc-wild-s-paid, .pc-wild-s-adv { color: var(--accent-ink); }
.pc-wild-acts { display: flex; align-items: center; gap: 8px; }
.pc-wild-btn { min-height: 44px; padding: 0 14px; font: var(--text-button-sm); flex: none; }
.pc-wild-take { flex: 1 1 0; min-width: 0; }
.pc-wild-rnd { width: 44px; min-height: 44px; padding: 0; flex: none; }

/* paid people: one card, a row each; folded behind a plain button on the phone */
.pc-wild-fold > summary { list-style: none; cursor: pointer; min-height: 44px; margin-bottom: 4px; }
.pc-wild-fold > summary::-webkit-details-marker { display: none; }
.pc-wild-wo { display: none; }
.pc-wild-fold[open] .pc-wild-wo { display: inline; }
.pc-wild-fold[open] .pc-wild-wc { display: none; }
.pc-wild-list { background: var(--surface); border-radius: var(--radius-card); padding: 0 14px; margin-bottom: 4px; }
.pc-wild-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 12px; align-items: baseline; align-content: center; padding: 6px 0; min-height: 54px; border-top: 1px solid var(--line-soft); }
.pc-wild-row:first-child { border-top: 0; }
.pc-wild-note { display: flex; align-items: center; gap: 8px; min-height: 44px; margin: 0 2px; font: var(--text-label); color: var(--muted); }
.pc-wild-note > span { flex: 1; min-width: 0; }
.pc-wild-note b { font: 500 13px/1.4 var(--mono); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* laptop */
.pc-wild-band { display: grid; grid-template-columns: 136px minmax(0, 1fr) 352px; gap: 20px; align-items: center; background: var(--surface); border-radius: var(--radius-card); padding: 8px 18px; margin-bottom: 8px; }
.pc-wild-pd { display: flex; flex-direction: column; align-items: flex-start; }
.pc-wild-pd span { font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-wild-pd b { font: 500 22px/1.2 var(--display); letter-spacing: var(--tracking-tight); white-space: nowrap; }
.pc-wild-pd-nav { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.pc-wild-mid { min-width: 0; }
.pc-wild-stats { display: flex; justify-content: space-between; gap: 12px; }
.pc-wild-stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.pc-wild-stat span { font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-wild-stat b { font: 500 22px/1.2 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; align-self: flex-start; }
.pc-wild-top { font: var(--text-label); color: var(--muted); margin-top: 12px; }
.pc-wild-top b { font: 500 13px/1.4 var(--mono); color: var(--ink); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-wild-dc { min-width: 0; }
.pc-wild-dc-h { font: 500 14px/1.3 var(--display); margin-bottom: 4px; }
.pc-wild-days { display: flex; }
.pc-wild-d { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; }
.pc-wild-d-box { width: 100%; height: 56px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 3px; border-bottom: 1px solid var(--line); margin-bottom: 4px; }
.pc-wild-d-s { font: 500 11px/1.2 var(--body); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-wild-d-0 { font: 400 11px/1.2 var(--body); color: var(--muted); padding-bottom: 3px; }
.pc-wild-d-col { width: 26px; display: flex; flex-direction: column-reverse; gap: 2px; flex: none; }
.pc-wild-d-col i { display: block; min-height: 0; border-radius: 3px; }
.pc-wild-b-paid { background: var(--accent); }
.pc-wild-b-late { background: repeating-linear-gradient(135deg, var(--crit) 0, var(--crit) 6px, var(--crit-soft) 6px, var(--crit-soft) 8px); }
.pc-wild-b-today { background: radial-gradient(circle, var(--ink) 0, var(--ink) 2.5px, var(--surface) 3.5px); border: 1.5px solid var(--ink); }
.pc-wild-b-exp { background: var(--surface); border: 1.5px solid var(--grey); }
.pc-wild-d-l { display: flex; flex-direction: column; align-items: center; font: 400 11px/1.25 var(--body); color: var(--muted); min-height: 44px; padding: 2px 2px; border-radius: 9px; white-space: nowrap; }
.pc-wild-d-l b { font: 500 12px/1.25 var(--display); color: var(--ink); }
.pc-wild-d-l em { font: 500 11px/1.3 var(--display); font-style: normal; color: var(--ink); }
.pc-wild-d-now { background: var(--lime); color: var(--ink); }
.pc-wild-d-now b { font-weight: 700; }
.pc-wild-lg { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 2px 6px; margin-top: 6px; font: 400 11px/1.4 var(--body); color: var(--muted); }
.pc-wild-lg span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.pc-wild-lg i { width: 12px; height: 10px; border-radius: 3px; display: inline-block; flex: none; }
.pc-wild-board { display: grid; grid-template-columns: minmax(0, 334fr) minmax(0, 338fr) minmax(0, 302fr); gap: 10px; align-items: start; }
.pc-wild-col { min-width: 0; }
.pc-wild-col > .pc-wild-ph:first-child { margin-top: 0; }
.pc-wild-dk .pc-wild-c { padding: 0 12px 7px; }
.pc-wild-dk .pc-wild-open { min-height: 0; padding: 4px 0; }
.pc-wild-dk .pc-wild-row { min-height: 0; }
.pc-wild-dk .pc-wild-list { padding: 0 12px; }
.pc-wild-dk .pc-wild-sum { font-size: 16px; }
.pc-wild-dk .pc-wild-btn { min-height: 34px; padding: 0 12px; }
.pc-wild-dk .pc-wild-rnd { width: 34px; min-height: 34px; padding: 0; }
.pc-wild-dk .pc-wild-note { min-height: 34px; }
'''


# ---- the one example dataset (ПРИМЕР). Today is Wednesday 14.10.2026 ----
WILD_THIN = '\u2009'      # thin space inside thousands: 1 790
WILD_NB = '\u00a0'        # no-break space before the lari sign: 150 ₾
WILD_TODAY = '14.10'
WILD_TOMORROW = '15.10'
WILD_DAYS = [('Пн', '12.10'), ('Вт', '13.10'), ('Ср', '14.10'), ('Чт', '15.10'), ('Пт', '16.10'), ('Сб', '17.10'), ('Вс', '18.10')]
WILD_FULL = {'Пн': 'понедельник', 'Вт': 'вторник', 'Ср': 'среда', 'Чт': 'четверг', 'Пт': 'пятница', 'Сб': 'суббота', 'Вс': 'воскресенье'}
# paid = the date of the payment; weeks = the due dates of the weeks still unpaid
WILD_R = [
    dict(no='R-00101', who='Клиент Пример А', moped='Wolf-8', sum=150, dow='Пн', due='12.10', st='paid', paid='12.10', ch='наличные'),
    dict(no='R-00102', who='Клиент Пример Б', moped='B11', sum=150, dow='Вт', due='13.10', st='adv', paid='10.10', ch='перевод'),
    dict(no='R-00103', who='Клиент Пример В', moped='B11', sum=140, dow='Вт', due='13.10', st='paid', paid='13.10', ch='перевод'),
    dict(no='R-00104', who='Клиент Пример Г', moped='XL1200', sum=150, dow='Вт', due='13.10', st='late', days=1, debt=150, weeks=['13.10']),
    dict(no='R-00105', who='Клиент Пример Д', moped='17C', sum=150, dow='Ср', due='14.10', st='today'),
    dict(no='R-00106', who='Клиент Пример Е', moped='Wolf-8', sum=150, dow='Ср', due='14.10', st='paid', paid='14.10', ch='карта'),
    dict(no='R-00112', who='Клиент Пример М', moped='17C', sum=150, dow='Ср', due='14.10', st='late', days=7, debt=300, weeks=['07.10', '14.10']),
    dict(no='R-00107', who='Клиент Пример Ж', moped='XL1200', sum=150, dow='Чт', due='15.10', st='exp'),
    dict(no='R-00108', who='Клиент Пример З', moped='B11', sum=150, dow='Чт', due='15.10', st='exp'),
    dict(no='R-00109', who='Клиент Пример И', moped='F-150', sum=150, dow='Пт', due='16.10', st='exp'),
    dict(no='R-00110', who='Клиент Пример К', moped='B11', sum=150, dow='Пт', due='16.10', st='adv', paid='13.10', ch='наличные'),
    dict(no='R-00111', who='Клиент Пример Л', moped='MB5', sum=150, dow='Сб', due='17.10', st='exp'),
]
WILD_FILL = {'paid': 'paid', 'adv': 'paid', 'late': 'late', 'today': 'today', 'exp': 'exp'}
WILD_ORDER = ('paid', 'late', 'today', 'exp')

def wild_gel(n):
    s = str(n)
    if len(s) > 3:
        s = s[:-3] + WILD_THIN + s[-3:]
    return s + WILD_NB + '₾'

def wild_pl(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11:
        w = one
    elif n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        w = few
    else:
        w = many
    return str(n) + WILD_NB + w

def wild_pays(n):
    return wild_pl(n, 'оплата', 'оплаты', 'оплат')

def wild_key(d):
    # 'dd.mm' -> (mm, dd): every date of the example lies in one year
    return (int(d[3:]), int(d[:2]))

def wild_rows(*states):
    return [r for r in WILD_R if r['st'] in states]

def wild_parts(due=None):
    out = {'paid': 0, 'late': 0, 'today': 0, 'exp': 0}
    for r in WILD_R:
        if due is None or r['due'] == due:
            out[WILD_FILL[r['st']]] += r['sum']
    return out

WILD_WEEK = wild_parts()
WILD_ALL = sum(WILD_WEEK.values())
WILD_LEFT = WILD_ALL - WILD_WEEK['paid']
WILD_DEBT = sum(r['debt'] for r in wild_rows('late'))
WILD_BYDAY = [sum(wild_parts(d).values()) for _, d in WILD_DAYS]
WILD_MAX = max(WILD_BYDAY)
WILD_TOP = WILD_DAYS[WILD_BYDAY.index(WILD_MAX)][0]
# money by the date it came in, inside this week so far
WILD_CAME = sum(r['sum'] for r in wild_rows('paid', 'adv') if wild_key(WILD_DAYS[0][1]) <= wild_key(r['paid']) <= wild_key(WILD_TODAY))
WILD_EARLY = [r for r in wild_rows('adv') if wild_key(r['paid']) < wild_key(WILD_DAYS[0][1])]
# the dataset, number by number: a wrong figure stops the build
assert len(WILD_R) == 12 and WILD_ALL == 1790
assert WILD_WEEK == {'paid': 740, 'late': 300, 'today': 150, 'exp': 600}
assert (len(wild_rows('paid', 'adv')), len(wild_rows('late')), len(wild_rows('today')), len(wild_rows('exp'))) == (5, 2, 1, 4)
assert WILD_LEFT == 1050 and WILD_DEBT == 450
assert WILD_BYDAY == [150, 440, 450, 300, 300, 150, 0] and WILD_TOP == 'Ср'
assert [wild_parts(d)['paid'] for _, d in WILD_DAYS] == [150, 290, 150, 0, 150, 0, 0]
# payments: none dated after today; in advance means paid before the due day; 590 came in on 12-14.10
assert all(wild_key(r['paid']) <= wild_key(WILD_TODAY) for r in wild_rows('paid', 'adv'))
assert all(wild_key(r['paid']) < wild_key(r['due']) for r in wild_rows('adv'))
assert all(r['paid'] == r['due'] for r in wild_rows('paid'))
assert WILD_CAME == 590 and [r['no'] for r in WILD_EARLY] == ['R-00102'] and WILD_CAME + sum(r['sum'] for r in WILD_EARLY) == WILD_WEEK['paid']
# debts: a whole number of unpaid weeks, counted in days from the oldest one
assert all(r['debt'] == r['sum'] * len(r['weeks']) and r['weeks'][-1] == r['due'] for r in wild_rows('late'))
assert all(r['days'] == wild_key(WILD_TODAY)[1] - wild_key(r['weeks'][0])[1] for r in wild_rows('late'))
assert all(wild_key(r['due']) > wild_key(WILD_TODAY) for r in wild_rows('exp')) and all(r['due'] == WILD_TODAY for r in wild_rows('today'))

# ---- pieces ----
def wild_status(kind, word):
    if kind in ('paid', 'adv'):
        mark = '<span class="pc-wild-tk' + (' pc-wild-tk-adv' if kind == 'adv' else '') + '">' + ic('check', 'pc-wild-tki') + '</span>'
    else:
        mark = '<i class="pc-wild-mk pc-wild-mk-' + kind + '"></i>'
    return '<span class="pc-wild-s pc-wild-s-' + kind + '">' + mark + word + '</span>'

WILD_GO = ic('right', 'pc-wild-go')
WILD_TAKE = '<a class="btn pc-wild-btn pc-wild-take" href="#">Принять оплату</a>'
WILD_CALL = '<a class="btn btn-round pc-wild-rnd" href="#" aria-label="Позвонить">' + ic('phone', 'i s') + '</a>'
WILD_WA = '<a class="btn btn-round pc-wild-rnd" href="#" aria-label="WhatsApp">' + ic('chat', 'i s') + '</a>'
WILD_REMIND = '<a class="btn pc-wild-btn" href="#" aria-label="WhatsApp: завтра оплата">' + ic('chat', 'i s') + 'Напомнить</a>'

def wild_top(r, cls):
    # name, model and sum on the first line; the state with its detail under the name
    k = r['st']
    amount, sum_cls, lab, more = r['sum'], '', '', ''
    if k == 'late':
        amount, sum_cls, lab = r['debt'], ' pc-wild-red', '<small>долг</small>'
        status = wild_status('late', 'Просрочено · ' + str(r['days']) + ' дн.')
        more = wild_pl(len(r['weeks']), 'неделя', 'недели', 'недель') + ': ' + ' и '.join('сегодня' if w == WILD_TODAY else w for w in r['weeks'])
    elif k == 'today':
        status = wild_status('today', 'Ждём сегодня')
    elif k == 'exp':
        status = wild_status('exp', 'Ожидается')
    elif k == 'adv':
        sum_cls = ' pc-wild-in'
        status = wild_status('adv', 'Оплачено заранее')
        more = r['paid'] + ', ' + r['ch'] + ' · срок ' + r['due']
    else:
        sum_cls = ' pc-wild-in'
        status = wild_status('paid', 'Оплачено')
        more = ('сегодня' if r['paid'] == WILD_TODAY else r['paid']) + ', ' + r['ch']
    # the detail follows the fixed word after « · »; the dot goes to the next line together with the detail
    return ('<a class="' + cls + '" href="#" title="' + r['no'] + '"><span class="pc-wild-who"><b>' + r['who'] + '</b><span>' + r['moped'] + '</span>' + WILD_GO + '</span>'
            '<span class="pc-wild-sum' + sum_cls + '">' + lab + wild_gel(amount) + '</span>'
            '<span class="pc-wild-l2">' + status + ('<span class="pc-wild-nw">· ' + more + '</span>' if more else '') + '</span></a>')

def wild_card(r):
    k = r['st']
    if k in ('late', 'today'):
        acts = WILD_TAKE + WILD_CALL + WILD_WA
    else:
        acts = WILD_TAKE + (WILD_REMIND if r['due'] == WILD_TOMORROW else '')
    return ('<div class="pc-wild-c' + (' pc-wild-c-late' if k == 'late' else '') + '">' + wild_top(r, 'pc-wild-open')
            + '<div class="pc-wild-acts">' + acts + '</div></div>')

def wild_ph(kind, title, n, total, lab='', sub='', tail='', tag='div', cls=''):
    mark = '<span class="pc-wild-tk">' + ic('check', 'pc-wild-tki') + '</span>' if kind == 'paid' else '<i class="pc-wild-mk pc-wild-mk-' + kind + '"></i>'
    # inside a fold's summary the sum is plain text: a link there would take the tap meant for «Показать»
    link = tag != 'summary'
    out = ('<' + tag + ' class="pc-wild-ph' + cls + '"><h3>' + mark + title + '</h3><span class="pc-wild-ph-n">' + str(n) + '</span>'
           + ('<a class="pc-wild-ph-s' + (' pc-wild-red' if kind == 'late' else '') + '" href="#"><span class="pc-wild-lnk">' if link else '<span class="pc-wild-ph-s"><span>')
           + ('<small>' + lab + '</small>' if lab else '') + wild_gel(total) + '</span>' + ('</a>' if link else '</span>') + tail + '</' + tag + '>')
    return out + ('<div class="pc-wild-ph-sub">' + sub + '</div>' if sub else '')

def wild_pile_late():
    rows = sorted(wild_rows('late'), key=lambda r: -r['days'])
    sub = wild_gel(WILD_WEEK['late']) + ' — эта неделя, ' + wild_gel(WILD_DEBT - WILD_WEEK['late']) + ' — прошлая'
    return wild_ph('late', 'Просрочено', len(rows), WILD_DEBT, 'долг', sub) + ''.join(wild_card(r) for r in rows)

def wild_pile_today():
    # today's due day is split over three piles; the line under the head says where the rest of the day's sum is
    rows = wild_rows('today')
    p = wild_parts(WILD_TODAY)
    rest = [wild_gel(p[k]) + ' ' + w for k, w in (('paid', 'оплачено'), ('late', 'просрочено')) if p[k]]
    assert WILD_WEEK['today'] + p['paid'] + p['late'] == WILD_BYDAY[[d for _, d in WILD_DAYS].index(WILD_TODAY)] == 450
    sub = 'Ещё на сегодня: ' + ', '.join(rest) if rest else ''
    return wild_ph('today', 'Ждём сегодня', len(rows), WILD_WEEK['today'], sub=sub) + ''.join(wild_card(r) for r in rows)

def wild_soon_days():
    # "Впереди" day by day: (heading, cards) for every day that still expects money
    out = []
    for dow, d in WILD_DAYS:
        day = [r for r in wild_rows('exp') if r['due'] == d]
        if not day:
            continue
        early = [r for r in wild_rows('adv') if r['due'] == d]
        name = ('Завтра · ' if d == WILD_TOMORROW else '') + dow + ' ' + d
        note = '<span>ещё ' + wild_pl(len(early), 'оплачена', 'оплачены', 'оплачено') + ' заранее</span>' if early else ''
        headline = ('<div class="pc-wild-dh"><b>' + name + '</b>' + note + '<span class="pc-wild-dh-r">' + wild_pays(len(day))
                    + ' · <b>' + wild_gel(sum(r['sum'] for r in day)) + '</b></span></div>')
        out.append((headline, ''.join(wild_card(r) for r in day)))
    return out

def wild_pile_soon():
    rows = wild_rows('exp')
    return wild_ph('exp', 'Впереди', len(rows), WILD_WEEK['exp']) + ''.join(h + c for h, c in wild_soon_days())

def wild_sort_hint():
    return '<a class="pc-wild-note" href="#"><span>' + SORT_HINT + '</span>' + WILD_GO + '</a>'

def wild_pile_paid(fold=None):
    # newest payment first; a payment made in advance names both its own date and the due day
    rows = sorted(wild_rows('paid', 'adv'), key=lambda r: wild_key(r['paid']), reverse=True)
    assert [r['no'] for r in rows] == ['R-00106', 'R-00103', 'R-00110', 'R-00101', 'R-00102']
    first, last = WILD_DAYS[0][1], WILD_TODAY
    came = ('<a class="pc-wild-note" href="#"><span>Деньгами за <span class="pc-wild-nw">' + first + ' – ' + last + '</span> пришло <b class="pc-wild-lnk">' + wild_gel(WILD_CAME) + '</b>; ещё <b>'
            + wild_gel(sum(r['sum'] for r in WILD_EARLY)) + '</b> оплачены заранее, ' + WILD_EARLY[0]['paid'] + '</span>' + WILD_GO + '</a>')
    body = '<div class="pc-wild-list">' + ''.join(wild_top(r, 'pc-wild-row') for r in rows) + '</div>' + came + wild_sort_hint()
    if fold is None:
        return wild_ph('paid', 'Оплачено', len(rows), WILD_WEEK['paid']) + body
    btn = '<span class="btn pc-wild-btn"><span class="pc-wild-wc">Показать</span><span class="pc-wild-wo">Скрыть</span></span>'
    return ('<details class="pc-wild-fold"' + (' open' if fold == 'open' else '') + '>'
            + wild_ph('paid', 'Оплачено', len(rows), WILD_WEEK['paid'], tail=btn, tag='summary') + body + '</details>')

def wild_tiles():
    out = []
    for dow, d in WILD_DAYS:
        p = wild_parts(d)
        total = sum(p.values())
        cls = 'pc-wild-t' + (' pc-wild-t-now' if d == WILD_TODAY else '') + ('' if total else ' pc-wild-t-none')
        late = '<i class="pc-wild-mk pc-wild-mk-late"></i>' if p['late'] else ''
        if total:
            w = int(round(100.0 * total / WILD_MAX))
            f = int(round(100.0 * p['paid'] / total))
            tip = dow + ' ' + d + ': ' + wild_gel(total) + ', оплачено ' + wild_gel(p['paid']) + (', просрочено ' + wild_gel(p['late']) if p['late'] else '')
            body = ('<span class="pc-wild-t-s">' + wild_gel(total) + '</span><span class="pc-wild-t-bx"><span class="pc-wild-t-bar" style="width:'
                    + str(w) + '%"><i style="width:' + str(f) + '%"></i></span></span>')
        else:
            tip = dow + ' ' + d + ': оплат нет'
            body = '<span class="pc-wild-t-s">нет</span><span class="pc-wild-t-bx"></span>'
        tag = 'a' if total and wild_key(d) >= wild_key(WILD_TODAY) else 'span'
        out.append('<' + tag + ' class="' + cls + '"' + (' href="#"' if tag == 'a' else '') + ' title="' + tip + '"><span class="pc-wild-t-wd">' + late + dow + '</span>'
                   '<b class="pc-wild-t-d">' + d + '</b>' + body + '</' + tag + '>')
    return '<div class="pc-wild-tiles">' + ''.join(out) + '</div>'

def wild_week_phone():
    n_paid = len(wild_rows('paid', 'adv'))
    return ('<div class="pc-wild-wk"><div class="pc-wild-per">'
            '<a class="btn btn-round pc-wild-rnd" href="#" aria-label="Прошлая неделя">' + ic('left', 'i s') + '</a>'
            '<div class="pc-wild-per-l"><b>Неделя ' + WILD_DAYS[0][1] + ' – ' + WILD_DAYS[6][1] + '</b><span>эта неделя · сегодня Ср ' + WILD_TODAY + '</span></div>'
            '<a class="btn btn-round pc-wild-rnd" href="#" aria-label="Следующая неделя">' + ic('right', 'i s') + '</a></div>'
            + wild_tiles() +
            '<a class="pc-wild-sm" href="#">'
            '<span class="pc-wild-sm-r"><span class="pc-wild-sm-l"><i class="pc-wild-sw pc-wild-sw-paid"></i><span class="pc-wild-sm-k">Оплачено</span>'
            '<b class="pc-wild-sm-v pc-wild-lnk">' + wild_gel(WILD_WEEK['paid']) + '</b><span class="pc-wild-sm-o">из ' + wild_gel(WILD_ALL) + '</span></span>'
            '<span class="pc-wild-sm-n">' + str(n_paid) + ' из ' + wild_pays(len(WILD_R)) + '</span></span>'
            '<span class="pc-wild-sm-r"><span class="pc-wild-sm-l"><i class="pc-wild-sw pc-wild-sw-left"></i><span class="pc-wild-sm-k">Осталось</span>'
            '<b class="pc-wild-sm-v pc-wild-lnk">' + wild_gel(WILD_LEFT) + '</b></span>'
            '<span class="pc-wild-sm-n">' + wild_pays(len(WILD_R) - n_paid) + '</span></span>'
            '</a></div>')

WILD_BARH = 38
def wild_days():
    # laptop: the week as seven columns, a sum over each
    words = {'paid': 'оплачено', 'late': 'просрочено', 'today': 'ждём сегодня', 'exp': 'ожидается'}
    cols = []
    for dow, d in WILD_DAYS:
        parts = wild_parts(d)
        total = sum(parts.values())
        if total:
            h = int(round(float(WILD_BARH) * total / WILD_MAX))
            segs = ''.join('<i class="pc-wild-b-' + k + '" style="flex:' + str(parts[k]) + ' 1 0%"></i>' for k in WILD_ORDER if parts[k])
            box = ('<span class="pc-wild-d-s">' + wild_gel(total) + '</span>'
                   '<span class="pc-wild-d-col" style="height:' + str(h) + 'px">' + segs + '</span>')
        else:
            box = '<span class="pc-wild-d-0">нет</span>'
        tag = 'сегодня' if d == WILD_TODAY else ('завтра' if d == WILD_TOMORROW else '')
        lab = ('<span class="pc-wild-d-l' + (' pc-wild-d-now' if d == WILD_TODAY else '') + '"><b>' + dow + '</b>' + d
               + ('<em>' + tag + '</em>' if tag else '') + '</span>')
        el = 'a' if total and wild_key(d) >= wild_key(WILD_TODAY) else 'span'
        cols.append('<' + el + ' class="pc-wild-d"' + (' href="#"' if el == 'a' else '') + '><span class="pc-wild-d-box">' + box + '</span>' + lab + '</' + el + '>')
    legend = '<div class="pc-wild-lg">' + ''.join('<span><i class="pc-wild-b-' + k + '"></i>' + words[k] + '</span>' for k in WILD_ORDER) + '</div>'
    return ('<div class="pc-wild-dc"><div class="pc-wild-dc-h">Неделя по дням</div>'
            '<div class="pc-wild-days">' + ''.join(cols) + '</div>' + legend + '</div>')

def wild_phone_top():
    return (stabs() + wild_week_phone() + wild_pile_late() + wild_pile_today()
            + wild_pile_soon() + wild_pile_paid('closed'))

def wild_phone_low():
    return wild_pile_soon() + wild_pile_paid('closed')

def wild_phone_end():
    h, c = wild_soon_days()[-1]
    return h + c + wild_pile_paid('open')

def wild_stat(label, n, cls=''):
    return '<a class="pc-wild-stat" href="#"><span>' + label + '</span><b class="pc-wild-lnk' + cls + '">' + wild_gel(n) + '</b></a>'

def wild_desk_body():
    n_paid = len(wild_rows('paid', 'adv'))
    band = ('<div class="pc-wild-band">'
            '<div class="pc-wild-pd"><span>Неделя</span><b>' + WILD_DAYS[0][1] + ' – ' + WILD_DAYS[6][1] + '</b><span>эта неделя</span><div class="pc-wild-pd-nav">'
            '<a class="btn btn-round pc-wild-rnd" href="#" aria-label="Прошлая неделя">' + ic('left', 'i s') + '</a>'
            '<a class="btn btn-round pc-wild-rnd" href="#" aria-label="Следующая неделя">' + ic('right', 'i s') + '</a></div></div>'
            '<div class="pc-wild-mid"><div class="pc-wild-stats">'
            + wild_stat('Должно прийти · ' + wild_pays(len(WILD_R)), WILD_ALL)
            + wild_stat('Оплачено · ' + wild_pays(n_paid), WILD_WEEK['paid'], ' pc-wild-in')
            + wild_stat('Осталось · ' + wild_pays(len(WILD_R) - n_paid), WILD_LEFT)
            + '</div><div class="pc-wild-top">Самый большой день — ' + WILD_FULL[WILD_TOP] + ', <b>' + wild_gel(WILD_MAX) + '</b></div></div>'
            + wild_days() + '</div>')
    board = ('<div class="pc-wild-board">'
             '<div class="pc-wild-col">' + wild_pile_late() + wild_pile_today() + '</div>'
             '<div class="pc-wild-col">' + wild_pile_soon() + '</div>'
             '<div class="pc-wild-col">' + wild_pile_paid() + '</div></div>')
    return '<div class="pc-wild-dk">' + band + board + '</div>'

def wild_bands(letter, rec=False):
    lead = '<b>' + letter + '. ' + wild_NAME + (' — рекомендую' if rec else '') + '.</b> '
    def sub(words):
        return '<b>' + letter + words + '.</b> '
    p1 = phone(lead + 'Утро на одном экране. Сверху неделя по дням: сегодня — лаймом, полоска под суммой тем длиннее, чем больше день, '
               'зелёная её часть уже оплачена, красный квадрат — в этом дне есть просрочка. Ниже — кого догонять и кого ждём сегодня. '
               + FORM_HINT + ' Оплата записывается в три нажатия; '
               'рядом звонок и WhatsApp, имя ведёт в карточку аренды. Цена: люди сложены по срочности, а не по дням.',
               head('Деньги'), wild_phone_top(), tabbar('owner', 'money', 9))
    p2 = phone(sub(', тот же экран ниже') + '«Впереди» разложено по дням с итогом дня, «Напомнить» — только у завтрашних; плитка сегодняшнего '
               'или будущего дня прокручивает к его людям. «Оплачено» свёрнуто в строку с кнопкой «Показать». '
               'При 85 мопедах «Просрочено» и «Ждём сегодня» остаются списком людей (около 12 строк, две прокрутки) и не сворачиваются никогда, '
               'а дни после завтра сворачиваются в строку с итогом дня так же, как «Оплачено».',
               head('Деньги'), wild_phone_low(), tabbar('owner', 'money', 9))
    p3 = phone(sub(', конец экрана') + 'Нажата «Показать»: оплатившие строками, свежие платежи сверху; у оплаты заранее видны и дата платежа, и срок. '
               'Под списком — сколько денег пришло по датам платежей (это число совпадает со списком «Платежи») и напоминание про «Разобрать». '
               'Стрелки листают недели: на другой неделе остаются полоса дней и итог (прошлая — оплачено 1' + WILD_THIN + '640 из ' + wild_gel(WILD_ALL) + '), '
               'а под датами появляется кнопка «Сегодня».',
               head('Деньги'), wild_phone_end(), tabbar('owner', 'money', 9))
    d = desk(sub(' на ноутбуке') + 'Одним взглядом видно, идут ли деньги: сверху три числа недели и нагрузка по дням, ниже три колонки — '
             'действовать, впереди по дням, оплачено. Подчёркнутые суммы ведут в «Платежи»; стрелки листают недели, '
             'на другой неделе рядом с ними появляется кнопка «Сегодня». Цена: видна одна неделя за раз, месяца целиком нет.',
             rail('money', 'owner', 9), dmain(wild_desk_body(), 'календарь платежей · сегодня среда, ' + WILD_TODAY))
    return [(letter + '. ' + wild_NAME + ' — телефон', p1 + p2 + p3), (letter + '. ' + wild_NAME + ' — ноутбук', d)]


# ====================================================================================================
# Г · matrix · «Сетка аренд»
# ====================================================================================================
# Payments calendar, concept "matrix": rows are rentals, columns are the days of the week.
# Revision 2: the rows are grouped under day headings (late, today, tomorrow, later days, paid),
# the week is a strip of seven day tiles with the day sum, the phone rows carry no columns,
# the laptop keeps one mark per rental under its day. Static HTML + CSS, no JavaScript. Example data only (ПРИМЕР).

matrix_NAME = 'Сетка аренд'
matrix_PITCH = ('Лучше всего отвечает на «с кого брать деньги прямо сейчас и кто следующий»: должники и сегодняшние с кнопками стоят '
         'на первом экране, над ними — полоса недели с суммой каждого дня; на ноутбуке у каждой аренды значок стоит под её днём.')
matrix_COST = ('Имена тех, кто платит после завтра, и тех, кто уже оплатил, открываются кнопкой «Показать»; сетка со значками осталась '
        'только на ноутбуке и показывает одну неделю — прошлая и следующая видны итогом, а не по людям.')

matrix_CSS = '''
/* ---- marks: colour + shape; the word always stands beside ---- */
.pc-matrix-m { width: 16px; height: 16px; display: inline-grid; place-items: center; border-radius: 50%; flex: none; box-sizing: border-box; }
.pc-matrix-m svg { width: 10px; height: 10px; display: block; fill: none; stroke: currentColor; stroke-width: 3.6; stroke-linecap: round; stroke-linejoin: round; }
.pc-matrix-m-paid { background: var(--accent); color: var(--on-accent); }
.pc-matrix-m-adv { background: var(--surface); border: 1.75px solid var(--accent); color: var(--accent); }
.pc-matrix-m-due::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--ink); }
.pc-matrix-m-exp { border: 1.75px solid var(--grey); }
.pc-matrix-m-late { background: var(--crit); border-radius: 3px; }
.pc-matrix-m.pc-matrix-sm { width: 12px; height: 12px; }
.pc-matrix-m.pc-matrix-sm svg { width: 8px; height: 8px; }
.pc-matrix-m-due.pc-matrix-sm::before { width: 8px; height: 8px; }
.pc-matrix-m-late.pc-matrix-sm { border-radius: 2px; }
.pc-matrix-m-adv.pc-matrix-sm, .pc-matrix-m-exp.pc-matrix-sm { border-width: 1.5px; }
.pc-matrix-sw { width: 10px; height: 16px; border-radius: 3px; background: var(--lime); flex: none; }
.pc-matrix-sum { font-family: var(--mono); font-style: normal; font-weight: 500; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-matrix-go { width: 14px; height: 14px; flex: none; align-self: center; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; color: var(--muted); }
.pc-matrix-s-paid, .pc-matrix-s-adv { color: var(--accent-ink); }
.pc-matrix-s-exp { color: var(--grey-ink); }
.pc-matrix-s-due { color: var(--ink); }
.pc-matrix-s-late { color: var(--crit-ink); }

/* ---- a day tile: weekday, date, the day sum, a bar (length = the day sum, filled part = already paid) ---- */
.pc-matrix-tile { min-width: 0; display: flex; flex-direction: column; align-items: center; color: var(--ink); }
.pc-matrix-tile em { font: 500 12px/14px var(--display); font-style: normal; color: var(--muted); }
.pc-matrix-tile b { font: 600 13px/17px var(--display); white-space: nowrap; }
.pc-matrix-tile small { font: 500 11px/13px var(--display); color: var(--muted); white-space: nowrap; }
.pc-matrix-tsum { font: 500 13px/17px var(--body); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-matrix-tsum.pc-matrix-max { font-weight: 700; }
.pc-matrix-tbw { display: block; align-self: stretch; height: 6px; margin: 3px 4px 0; }
.pc-matrix-tbar { display: block; height: 6px; border-radius: 3px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-control); overflow: hidden; }
.pc-matrix-tbar i { display: block; height: 6px; background: var(--accent); }
.pc-matrix-tile.pc-matrix-td { background: var(--lime); }
.pc-matrix-tile.pc-matrix-td em, .pc-matrix-tile.pc-matrix-td small { color: var(--ink); }
.pc-matrix-tile.pc-matrix-none b, .pc-matrix-tile.pc-matrix-none .pc-matrix-tsum { color: var(--muted); font-weight: 500; }

/* ---- a rental: name, sum, the state in words under the name (the same block on a phone and on a laptop) ---- */
.pc-matrix-who { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 10px; row-gap: 1px; align-items: baseline; align-content: center; min-width: 0; }
.pc-matrix-n { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 6px; min-width: 0; }
.pc-matrix-n b { font: 500 15px/1.35 var(--body); overflow-wrap: anywhere; }
.pc-matrix-n small { font: 400 12px/1.35 var(--body); color: var(--muted); white-space: nowrap; }
.pc-matrix-amt { font: 500 17px/1.3 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
.pc-matrix-amt small { font: 400 12px/1.3 var(--body); margin-right: 6px; }
.pc-matrix-stl { grid-column: 1 / -1; display: flex; align-items: flex-start; gap: 6px; min-width: 0; font: 400 13px/17px var(--body); }
.pc-matrix-stl .pc-matrix-m { margin-top: 2px; }
.pc-matrix-stl > span { min-width: 0; }
.pc-matrix-nw { white-space: nowrap; }
.pc-matrix-stl b { font: 500 13px/17px var(--display); }
.pc-matrix-stl.pc-matrix-s-paid > span, .pc-matrix-stl.pc-matrix-s-adv > span, .pc-matrix-stl.pc-matrix-s-exp > span, .pc-matrix-stl.pc-matrix-s-due > span { color: var(--muted); }
.pc-matrix-s-paid b, .pc-matrix-s-adv b { color: var(--accent-ink); }
.pc-matrix-s-exp b { color: var(--grey-ink); }
.pc-matrix-s-due b { color: var(--ink); }

/* ---- a fold: opens only by its own plain button ---- */
.pc-matrix-fold > summary { display: block; list-style: none; cursor: pointer; }
.pc-matrix-fold > summary::-webkit-details-marker { display: none; }
.pc-matrix-tog { flex: none; gap: 4px; padding: 0 8px 0 12px; }
.ph-body .pc-matrix-tog { min-height: 44px; }
.pc-matrix-wo { display: none; }
.pc-matrix-fold[open] > summary .pc-matrix-wo { display: inline; }
.pc-matrix-fold[open] > summary .pc-matrix-wc { display: none; }
.pc-matrix-chev { display: inline-flex; transform: rotate(90deg); }
.pc-matrix-chev svg { width: 16px; height: 16px; }
.pc-matrix-fold[open] > summary .pc-matrix-chev { transform: rotate(-90deg); }

/* ================= phone ================= */
.pc-matrix-body { padding-top: 0; }
.pc-matrix-gap { height: 12px; }
.pc-matrix-strip { position: sticky; top: 0; z-index: 2; display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 3px; margin: 0 -16px; padding: 4px 16px 8px; background: var(--bg); }
.pc-matrix-strip .pc-matrix-tile { min-height: 62px; padding: 4px 0 6px; border-radius: 10px; background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-soft); }
.pc-matrix-strip .pc-matrix-tile.pc-matrix-td { background: var(--lime); box-shadow: none; }
.pc-matrix-psum { display: block; background: var(--surface); border-radius: var(--radius-card); padding: 10px 12px 10px 14px; margin-bottom: 4px; }
.pc-matrix-pl1 { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0 8px; font: 400 13px/1.4 var(--body); }
.pc-matrix-pl1 > span { white-space: nowrap; }
.pc-matrix-pl1 b { font: 600 16px/1.35 var(--mono); font-variant-numeric: tabular-nums; }
.pc-matrix-pl1 small { display: inline-flex; align-items: center; gap: 2px; font: 400 12px/1.4 var(--body); color: var(--muted); white-space: nowrap; }
.pc-matrix-prog { height: 6px; border-radius: 3px; background: var(--surface-2); margin: 6px 0; overflow: hidden; }
.pc-matrix-prog i { display: block; height: 6px; background: var(--accent); }
.pc-matrix-pl2 { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 0 8px; font: 400 13px/1.4 var(--body); }
.pc-matrix-pl2 > span { white-space: nowrap; }
.pc-matrix-pl2 b { font: 500 13px/1.4 var(--mono); font-variant-numeric: tabular-nums; }
.pc-matrix-plate { color: var(--crit-ink); }
.pc-matrix-grp { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 0 10px; min-height: 20px; margin: 10px 2px 8px; }
.pc-matrix-grp > b { display: inline-flex; align-items: center; gap: 6px; height: 20px; font: 600 15px/20px var(--display); white-space: nowrap; }
.pc-matrix-grp > b small { font: 400 13px/1.3 var(--body); color: var(--muted); }
.pc-matrix-grp > span { font: 400 13px/20px var(--body); color: var(--muted); }
.pc-matrix-grp > span .pc-matrix-sum { line-height: 1; }
.pc-matrix-grp > span.pc-matrix-plate { color: var(--crit-ink); }
.pc-matrix-nil > b { color: var(--muted); font-weight: 500; }
.pc-matrix-card { background: var(--surface); border-radius: var(--radius-card); margin-bottom: 6px; overflow: hidden; }
.pc-matrix-prow { border-top: 1px solid var(--line-soft); }
.pc-matrix-card > .pc-matrix-prow:first-child { border-top: 0; }
.pc-matrix-prow.pc-matrix-r-late { box-shadow: inset 3px 0 0 var(--crit); }
.pc-matrix-pwho { min-height: 44px; padding: 7px 12px 5px 14px; }
.pc-matrix-prow.pc-matrix-quiet .pc-matrix-pwho { min-height: 49px; padding-top: 6px; padding-bottom: 5px; }
.pc-matrix-pacts { display: flex; gap: 8px; padding: 2px 12px 10px 14px; }
.pc-matrix-pb { padding: 0 14px; }
.pc-matrix-grow { flex: 1 1 auto; min-width: 0; }
.pc-matrix-pfold { margin: 0; }
.pc-matrix-pfl { display: flex; align-items: center; gap: 10px; min-height: 44px; margin: 6px 0 6px 2px; }
.pc-matrix-pflt { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.pc-matrix-pflt b { display: flex; align-items: center; gap: 6px; font: 600 15px/1.3 var(--display); }
.pc-matrix-pflt span { font: 400 13px/1.35 var(--body); color: var(--muted); }
.pc-matrix-cut { height: 2px; border-radius: 1px; background: var(--line); margin: 8px 0 2px; }
.pc-matrix-came { display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 10px; row-gap: 2px; align-items: baseline; background: var(--surface); border-radius: var(--radius-card); padding: 6px 10px 6px 14px; margin: 8px 0 0; }
.pc-matrix-came > span { font: 500 14px/1.35 var(--body); }
.pc-matrix-came > b { display: inline-flex; align-items: center; gap: 4px; font: 500 17px/1.3 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.pc-matrix-came > small { grid-column: 1 / -1; font: 400 12px/1.4 var(--body); color: var(--muted); }
.pc-matrix-pnote { font: 400 13px/1.45 var(--body); margin: 6px 2px 0; }
.pc-matrix-pnote b { font: 600 13px/1.4 var(--mono); }
.pc-matrix-pleg { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 6px 2px 0; font: 400 12px/1.3 var(--body); color: var(--muted); }
.pc-matrix-pleg span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.pc-matrix-pweeks { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; margin: 8px 0 0; }
.pc-matrix-wkbtn { min-width: 0; min-height: 48px; padding: 4px 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; border: var(--hairline) solid var(--ink); border-radius: 24px; background: var(--surface); color: var(--ink); text-align: center; }
.pc-matrix-wkbtn b { display: inline-flex; align-items: center; gap: 2px; font: 500 13px/1.2 var(--display); white-space: nowrap; }
.pc-matrix-wkbtn b svg { width: 16px; height: 16px; }
.pc-matrix-wkbtn small { font: 400 12px/1.2 var(--body); color: var(--muted); white-space: nowrap; }

/* ================= laptop ================= */
.pc-matrix-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 0 0 8px; }
.pc-matrix-tl-box { display: block; min-width: 0; background: var(--surface); border-radius: var(--radius-card); padding: 8px 14px; }
.pc-matrix-tl { display: flex; align-items: center; justify-content: space-between; gap: 6px; font: 400 12px/1.35 var(--body); color: var(--muted); white-space: nowrap; }
.pc-matrix-tv { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
.pc-matrix-tv b { font: 500 20px/1.3 var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-matrix-tv span { font: 400 12px/1.3 var(--body); color: var(--muted); white-space: nowrap; }
.pc-matrix-tv b.pc-matrix-ok { color: var(--accent); }
.pc-matrix-tv b.pc-matrix-bad { color: var(--crit-ink); }
.pc-matrix-bar { display: flex; align-items: center; gap: 8px; margin: 0 0 8px; min-height: 34px; }
.pc-matrix-range { font: 500 15px/1 var(--display); white-space: nowrap; padding: 0 6px; }
.pc-matrix-wks { margin-left: auto; display: flex; align-items: baseline; gap: 10px; font: 400 12px/1.3 var(--body); font-variant-numeric: tabular-nums; color: var(--muted); white-space: nowrap; }
.pc-matrix-wks a { color: var(--ink); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; }
.pc-matrix-wks a.pc-matrix-cur { font-weight: 600; }
.pc-matrix-grid { background: var(--surface); border-radius: var(--radius-card); padding: 4px 0 4px; }
.pc-matrix-row { display: flex; align-items: stretch; box-shadow: inset 0 -1px 0 var(--line-soft); }
.pc-matrix-row.pc-matrix-r-late { box-shadow: inset 3px 0 0 var(--crit), inset 0 -1px 0 var(--line-soft); }
.pc-matrix-dwho { flex: 1 1 334px; min-width: 0; min-height: 42px; padding: 4px 12px 4px 14px; }
.pc-matrix-dwho .pc-matrix-n b { font-size: 14px; }
.pc-matrix-dwho .pc-matrix-amt { font-size: 15px; }
.pc-matrix-dwho .pc-matrix-stl, .pc-matrix-dwho .pc-matrix-stl b { font-size: 12px; line-height: 16px; }
.pc-matrix-dwho .pc-matrix-stl .pc-matrix-m { margin-top: 2px; }
.pc-matrix-act { flex: 0 0 224px; display: flex; align-items: center; gap: 6px; }
.pc-matrix-dbtn { min-height: 30px; padding: 0 10px; }
.pc-matrix-dbtn.pc-matrix-ib { width: 30px; padding: 0; }
.pc-matrix-dbtn svg { width: 16px; height: 16px; }
.pc-matrix-days { flex: 0 0 434px; display: grid; grid-template-columns: repeat(7, 62px); }
.pc-matrix-c { display: grid; place-items: center; min-width: 0; }
.pc-matrix-c.pc-matrix-td { background: var(--lime); }
.pc-matrix-hd { position: sticky; top: 0; z-index: 1; background: var(--surface); border-radius: var(--radius-card) var(--radius-card) 0 0; box-shadow: inset 0 -1px 0 var(--line); }
.pc-matrix-hdl { flex: 1 1 558px; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; padding: 0 12px 8px 14px; }
.pc-matrix-hdl b { font: var(--text-overline); letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.pc-matrix-hdl span { font: 400 12px/1.35 var(--body); color: var(--muted); }
.pc-matrix-hd .pc-matrix-tile { padding: 6px 0 7px; border-radius: 8px 8px 0 0; }
.pc-matrix-hd .pc-matrix-tile em { display: inline-flex; align-items: baseline; gap: 4px; line-height: 17px; }
.pc-matrix-hd .pc-matrix-tile small { min-height: 13px; }
.pc-matrix-hd .pc-matrix-tsum { font-size: 14px; line-height: 19px; margin-top: 1px; }
.pc-matrix-hd .pc-matrix-tbw { margin: 2px 6px 0; }
.pc-matrix-gh { min-height: 28px; background: var(--surface-2); }
.pc-matrix-ght { flex: 1 1 558px; min-width: 0; display: flex; align-items: center; gap: 10px; padding: 5px 12px 5px 14px; }
.pc-matrix-ght.pc-matrix-short { flex: 1 1 334px; }
.pc-matrix-ght b { display: inline-flex; align-items: center; gap: 6px; height: 18px; font: 600 13px/18px var(--display); white-space: nowrap; }
.pc-matrix-ght span { font: 400 12px/18px var(--body); color: var(--muted); white-space: nowrap; }
.pc-matrix-ght span.pc-matrix-plate { color: var(--crit-ink); }
.pc-matrix-gh .pc-matrix-tog { min-height: 26px; }
.pc-matrix-gh.pc-matrix-cutrow { box-shadow: inset 0 2px 0 var(--line), inset 0 -1px 0 var(--line-soft); }
.pc-matrix-ft { box-shadow: none; align-items: center; min-height: 26px; padding: 0 14px; gap: 14px; font: 400 12px/1.35 var(--body); color: var(--muted); }
.pc-matrix-ft.pc-matrix-top { box-shadow: inset 0 1px 0 var(--line); padding-top: 2px; }
.pc-matrix-legend { display: flex; align-items: center; gap: 12px; }
.pc-matrix-legend span { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.pc-matrix-fnote { margin-left: auto; white-space: nowrap; }
.pc-matrix-fnote b, .pc-matrix-ftxt b { font-weight: 600; color: var(--ink); }
.pc-matrix-ftxt { min-width: 0; }
.pc-matrix-ft a { color: var(--accent); font-weight: 500; white-space: nowrap; display: inline-flex; align-items: center; gap: 2px; }
.pc-matrix-ft a.pc-matrix-lnk { color: var(--ink); font-weight: 600; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 3px; display: inline; }
'''


# ---- the one example dataset. Today is Wednesday 14.10.2026; the week is 12.10 – 18.10 ----
matrix_THIN = '\u2009'      # thin space inside thousands: 1 790
matrix_NBSP = '\u00a0'      # no-break space before the lari sign: 150 ₾
matrix_TODAY = 14
matrix_MON = 12                                    # Monday of the week on the screen
matrix_WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
matrix_WDFULL = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье']
matrix_WORD = {'paid': 'Оплачено', 'adv': 'Оплачено заранее', 'due': 'Ждём сегодня', 'exp': 'Ожидается', 'late': 'Просрочено'}
matrix_UNSORTED = 5                                # the badge of the tab «Разобрать 5»

# Order: by the nearest unpaid week — late first (the oldest debt first), then today, then the days ahead, then those who have paid.
# wd: pay weekday, 0 = Monday. st: state of the week 12.10 – 18.10. since: first unpaid due day. pay: day of the payment.
matrix_ROWS = [
    {'no': 'R-00112', 'who': 'Клиент Пример М', 'moped': '17C',    'rate': 150, 'wd': 2, 'st': 'late', 'since': 7,  'debt': 300, 'prev': 'late'},
    {'no': 'R-00104', 'who': 'Клиент Пример Г', 'moped': 'XL1200', 'rate': 150, 'wd': 1, 'st': 'late', 'since': 13, 'debt': 150},
    {'no': 'R-00105', 'who': 'Клиент Пример Д', 'moped': '17C',    'rate': 150, 'wd': 2, 'st': 'due'},
    {'no': 'R-00107', 'who': 'Клиент Пример Ж', 'moped': 'XL1200', 'rate': 150, 'wd': 3, 'st': 'exp'},
    {'no': 'R-00108', 'who': 'Клиент Пример З', 'moped': 'B11',    'rate': 150, 'wd': 3, 'st': 'exp'},
    {'no': 'R-00109', 'who': 'Клиент Пример И', 'moped': 'F-150',  'rate': 150, 'wd': 4, 'st': 'exp'},
    {'no': 'R-00111', 'who': 'Клиент Пример Л', 'moped': 'MB5',    'rate': 150, 'wd': 5, 'st': 'exp'},
    {'no': 'R-00101', 'who': 'Клиент Пример А', 'moped': 'Wolf-8', 'rate': 150, 'wd': 0, 'st': 'paid', 'pay': 12, 'ch': 'наличные'},
    {'no': 'R-00102', 'who': 'Клиент Пример Б', 'moped': 'B11',    'rate': 150, 'wd': 1, 'st': 'adv',  'pay': 10, 'ch': 'перевод'},
    {'no': 'R-00103', 'who': 'Клиент Пример В', 'moped': 'B11',    'rate': 140, 'wd': 1, 'st': 'paid', 'pay': 13, 'ch': 'перевод'},
    {'no': 'R-00106', 'who': 'Клиент Пример Е', 'moped': 'Wolf-8', 'rate': 150, 'wd': 2, 'st': 'paid', 'pay': 14, 'ch': 'карта'},
    {'no': 'R-00110', 'who': 'Клиент Пример К', 'moped': 'B11',    'rate': 150, 'wd': 4, 'st': 'adv',  'pay': 13, 'ch': 'наличные'},
]

def matrix_num(n):
    s = str(n)
    return (s[:-3] + matrix_THIN + s[-3:]) if len(s) > 3 else s
def matrix_gel(n):
    return matrix_num(n) + matrix_NBSP + '₾'
def matrix_d(day):
    return '%02d.10' % day
def matrix_due(r):
    return matrix_MON + r['wd']
def matrix_of(st):
    return [r for r in matrix_ROWS if r['st'] in st]
def matrix_rent(rows):
    return sum(r['rate'] for r in rows)
def matrix_pl(n, one, few, many):
    if n % 10 == 1 and n % 100 != 11:
        return str(n) + ' ' + one
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return str(n) + ' ' + few
    return str(n) + ' ' + many
def matrix_pays(n):
    return matrix_pl(n, 'оплата', 'оплаты', 'оплат')

# Every figure on the screens is counted from the rows above and checked against the brief.
matrix_DAYSUM = [matrix_rent([r for r in matrix_ROWS if r['wd'] == i]) for i in range(7)]
matrix_TOTAL = sum(matrix_DAYSUM)
matrix_PAID = matrix_of(('paid', 'adv'))
matrix_LATE = matrix_of(('late',))
matrix_DUE = matrix_of(('due',))
matrix_AHEAD = matrix_of(('exp',))
matrix_TOMORROW = [r for r in matrix_AHEAD if matrix_due(r) == matrix_TODAY + 1]
matrix_LATER = [r for r in matrix_AHEAD if matrix_due(r) > matrix_TODAY + 1]
matrix_LEFT = matrix_LATE + matrix_DUE + matrix_AHEAD
matrix_DEBT = sum(r['debt'] for r in matrix_LATE)
matrix_DEBT_OLD = matrix_DEBT - matrix_rent(matrix_LATE)                       # weeks before this one
matrix_DAYPAID = [matrix_rent([r for r in matrix_PAID if r['wd'] == i]) for i in range(7)]   # paid, by the due day
matrix_CAME = sum(r['rate'] for r in matrix_PAID if r['pay'] >= matrix_MON)    # money by the payment date, 12.10 – 14.10
matrix_CAME_BEFORE = [r for r in matrix_PAID if r['pay'] < matrix_MON]         # this week's rent that came in earlier
matrix_PREV_PAID = matrix_TOTAL - matrix_rent([r for r in matrix_ROWS if r.get('prev') == 'late'])
matrix_MAXDAY = max(range(7), key=lambda i: matrix_DAYSUM[i])
assert matrix_DAYSUM == [150, 440, 450, 300, 300, 150, 0] and matrix_TOTAL == 1790 and len(matrix_ROWS) == 12
assert (len(matrix_PAID), matrix_rent(matrix_PAID)) == (5, 740)
assert (len(matrix_LEFT), matrix_rent(matrix_LEFT)) == (7, 1050)
assert (len(matrix_LATE), matrix_rent(matrix_LATE), matrix_DEBT, matrix_DEBT_OLD) == (2, 300, 450, 150)
assert (len(matrix_DUE), matrix_rent(matrix_DUE)) == (1, 150)
assert (len(matrix_AHEAD), matrix_rent(matrix_AHEAD)) == (4, 600)
assert (len(matrix_TOMORROW), matrix_rent(matrix_TOMORROW)) == (2, 300) and (len(matrix_LATER), matrix_rent(matrix_LATER)) == (2, 300)
assert [matrix_TODAY - r['since'] for r in matrix_LATE] == [7, 1]
assert matrix_DAYPAID == [150, 290, 150, 0, 150, 0, 0] and sum(matrix_DAYPAID) == 740
assert matrix_CAME == 590 and matrix_rent(matrix_CAME_BEFORE) == 150 and [r['pay'] for r in matrix_CAME_BEFORE] == [10]
assert [sum(r['rate'] for r in matrix_PAID if r['pay'] == d) for d in (12, 13, 14)] == [150, 290, 150]
assert all((r['st'] == 'adv') == (r['pay'] < matrix_due(r)) for r in matrix_PAID)
assert all(r['pay'] <= matrix_TODAY for r in matrix_PAID)                      # no payment is dated in the future
assert all(matrix_due(r) == matrix_TODAY for r in matrix_DUE) and all(matrix_due(r) > matrix_TODAY for r in matrix_AHEAD)
assert matrix_PREV_PAID == 1640 and (matrix_MAXDAY, matrix_DAYSUM[matrix_MAXDAY]) == (2, 450)
assert matrix_UNSORTED == weekstrip_UNSORTED                                   # the one sentence about «Разобрать» names this count

matrix_PAID_PCT = str(round(100 * matrix_rent(matrix_PAID) / matrix_TOTAL))   # 41

def matrix_mark(kind, small=False, title=''):
    tick = ('<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS['check'] + '</svg>') if kind in ('paid', 'adv') else ''
    t = (' title="' + title + '"') if title else ''
    return '<i class="pc-matrix-m pc-matrix-m-' + kind + (' pc-matrix-sm' if small else '') + '"' + t + '>' + tick + '</i>'

def matrix_go():
    return '<svg class="pc-matrix-go" viewBox="0 0 24 24" aria-hidden="true">' + ICONS['right'] + '</svg>'

def matrix_sum(text, cls=''):
    return '<em class="pc-matrix-sum' + (' ' + cls if cls else '') + '">' + text + '</em>'

def matrix_legend(small=False):
    return ('<span><i class="pc-matrix-sw"></i>сегодня</span>' +
            ''.join('<span>' + matrix_mark(k, small) + matrix_WORD[k] + '</span>' for k in ('paid', 'adv', 'due', 'exp', 'late')))

def matrix_state(r):
    # the fixed word first, then what makes it exact: days late, the payment date, the channel
    st = r['st']
    if st == 'late':
        weeks = r['debt'] // r['rate']
        return ('Просрочено · ' + str(matrix_TODAY - r['since']) + matrix_NBSP + 'дн.',
                ' <span class="pc-matrix-nw">· ' + (matrix_pl(weeks, 'неделя', 'недели', 'недель') + ', ' if weeks > 1 else '') + 'с ' + matrix_d(r['since']) + '</span>')
    if st == 'due':
        return ('Ждём сегодня', '')
    if st == 'exp':
        return ('Ожидается', '')            # the day stands in the group heading above the row
    # a separator dot never ends a line: it goes to the next one together with what follows it
    if st == 'paid':
        return ('Оплачено', ' <span class="pc-matrix-nw">· ' + ('сегодня' if r['pay'] == matrix_TODAY else matrix_d(r['pay'])) + ', ' + r['ch'] + '</span>')
    return ('Оплачено заранее', ' <span class="pc-matrix-nw">· ' + matrix_d(r['pay']) + ', ' + r['ch'] + '</span>'
            ' <span class="pc-matrix-nw">· срок ' + matrix_d(matrix_due(r)) + '</span>')

def matrix_who(r, cls):
    # tap opens the rental card; the arrow says so on a touch screen
    st = r['st']
    lead, tail = matrix_state(r)
    amt = ('<small>долг</small>' + matrix_gel(r['debt'])) if st == 'late' else matrix_gel(r['rate'])
    return ('<a class="pc-matrix-who ' + cls + '" href="#" aria-label="Открыть аренду ' + r['no'] + '">'
            '<span class="pc-matrix-n"><b>' + r['who'] + '</b><small>' + r['moped'] + '</small>' + matrix_go() + '</span>'
            '<span class="pc-matrix-amt' + (' pc-matrix-s-late' if st == 'late' else '') + '">' + amt + '</span>'
            '<span class="pc-matrix-stl pc-matrix-s-' + st + '">' + matrix_mark(st, True) + '<span><b>' + lead + '</b>' + tail + '</span></span></a>')

def matrix_acts(r, dense=False):
    # who has paid needs no button; late and today: take, call, write; tomorrow: take or remind; later: take
    st = r['st']
    if st in ('paid', 'adv'):
        return ''
    take = ('<a class="btn btn-sm pc-matrix-dbtn" href="#">Принять оплату</a>' if dense
            else '<a class="btn pc-matrix-pb pc-matrix-grow" href="#">Принять оплату</a>')
    if st == 'exp':
        if matrix_due(r) != matrix_TODAY + 1:
            return take
        return take + ('<a class="btn btn-sm pc-matrix-dbtn" href="#" aria-label="Напомнить в WhatsApp: завтра оплата">Напомнить</a>' if dense
                       else '<a class="btn pc-matrix-pb" href="#" aria-label="Напомнить в WhatsApp: завтра оплата">' + ic('chat', 'i s') + 'Напомнить</a>')
    if dense:
        return (take + '<a class="btn btn-sm pc-matrix-dbtn pc-matrix-ib" href="#" aria-label="Позвонить" title="Позвонить">' + ic('phone', 'i s') + '</a>'
                '<a class="btn btn-sm pc-matrix-dbtn pc-matrix-ib" href="#" aria-label="Написать в WhatsApp" title="Написать в WhatsApp">' + ic('chat', 'i s') + '</a>')
    return (take + '<a class="btn btn-round" href="#" aria-label="Позвонить">' + ic('phone') + '</a>'
            '<a class="btn btn-round" href="#" aria-label="Написать в WhatsApp">' + ic('chat') + '</a>')

def matrix_toggle():
    return ('<span class="btn btn-sm pc-matrix-tog"><span class="pc-matrix-wc">Показать</span><span class="pc-matrix-wo">Скрыть</span>'
            '<span class="pc-matrix-chev">' + ic('right', 'i s') + '</span></span>')

def matrix_tile(i, wide=False):
    # one day of the week: the sum that is due on it, and how much of that sum is already paid
    day = matrix_MON + i
    total, paid = matrix_DAYSUM[i], matrix_DAYPAID[i]
    cls = 'pc-matrix-tile' + (' pc-matrix-td' if day == matrix_TODAY else '') + ('' if total else ' pc-matrix-none')
    label = matrix_WDFULL[i] + ' ' + matrix_d(day) + ': ' + (matrix_gel(total) + ', оплачено ' + matrix_gel(paid) if total else 'оплат нет')
    if total:
        bar = ('<span class="pc-matrix-tbw"><i class="pc-matrix-tbar" style="width:' + str(round(100 * total / matrix_DAYSUM[matrix_MAXDAY])) + '%">'
               '<i style="width:' + str(round(100 * paid / total)) + '%"></i></i></span>')
        amount = '<span class="pc-matrix-tsum' + (' pc-matrix-max' if i == matrix_MAXDAY else '') + '">' + matrix_gel(total) + '</span>'
    else:
        bar, amount = '<span class="pc-matrix-tbw"></span>', '<span class="pc-matrix-tsum">—</span>'
    if wide:
        tag = 'сегодня' if day == matrix_TODAY else ('завтра' if day == matrix_TODAY + 1 else ('' if total else 'оплат нет'))
        return ('<a class="' + cls + '" href="#" aria-label="' + label + '"><em>' + matrix_WD[i] + '<b>' + matrix_d(day) + '</b></em>'
                '<small>' + tag + '</small>' + amount + bar + '</a>')
    return '<a class="' + cls + '" href="#" aria-label="' + label + '"><em>' + matrix_WD[i] + '</em><b>' + matrix_d(day) + '</b>' + amount + bar + '</a>'

def matrix_groups():
    # the days after tomorrow that still wait for somebody, and the days nobody pays on
    days = sorted(set(matrix_due(r) for r in matrix_LATER))
    empty = [matrix_MON + i for i in range(7) if not matrix_DAYSUM[i] and matrix_MON + i > matrix_TODAY]
    return days, empty
def matrix_dayname(day):
    return matrix_WD[day - matrix_MON] + ' ' + matrix_d(day)

# ================= phone =================
def matrix_strip():
    return '<div class="pc-matrix-strip">' + ''.join(matrix_tile(i) for i in range(7)) + '</div>'

def matrix_psummary():
    return ('<a class="pc-matrix-psum" href="#" aria-label="Открыть Деньги → Платежи">'
            '<div class="pc-matrix-pl1"><span>Оплачено <b>' + matrix_gel(matrix_rent(matrix_PAID)) + '</b> из <b>' + matrix_gel(matrix_TOTAL) + '</b></span>'
            '<small>' + str(len(matrix_PAID)) + ' из ' + matrix_pays(len(matrix_ROWS)) + matrix_go() + '</small></div>'
            '<div class="pc-matrix-prog"><i style="width:' + matrix_PAID_PCT + '%"></i></div>'
            '<div class="pc-matrix-pl2"><span>Осталось <b>' + matrix_gel(matrix_rent(matrix_LEFT)) + '</b></span>'
            '<span class="pc-matrix-plate">из них просрочено ' + str(len(matrix_LATE)) + ' · <b>' + matrix_gel(matrix_rent(matrix_LATE)) + '</b></span></div></a>')

def matrix_prow(r):
    acts = matrix_acts(r)
    return ('<div class="pc-matrix-prow' + (' pc-matrix-r-late' if r['st'] == 'late' else '') + ('' if acts else ' pc-matrix-quiet') + '">' +
            matrix_who(r, 'pc-matrix-pwho') + ('<div class="pc-matrix-pacts">' + acts + '</div>' if acts else '') + '</div>')

def matrix_pcard(rows):
    return '<div class="pc-matrix-card">' + ''.join(matrix_prow(r) for r in rows) + '</div>'

def matrix_pgrp(title, sub, meta, cls=''):
    return ('<div class="pc-matrix-grp"><b>' + title + ('<small>' + sub + '</small>' if sub else '') + '</b>'
            '<span' + (' class="' + cls + '"' if cls else '') + '>' + meta + '</span></div>')

def matrix_pfold(title, meta, rows, opened=False):
    return ('<details class="pc-matrix-fold pc-matrix-pfold"' + (' open' if opened else '') + '><summary><span class="pc-matrix-pfl">'
            '<span class="pc-matrix-pflt"><b>' + title + '</b><span>' + meta + '</span></span>' + matrix_toggle() + '</span></summary>' +
            matrix_pcard(rows) + '</details>')

def matrix_plate():
    return (matrix_pgrp(matrix_mark('late') + 'Просрочено', '', matrix_pl(len(matrix_LATE), 'аренда', 'аренды', 'аренд') + ' · весь долг ' + matrix_sum(matrix_gel(matrix_DEBT)), 'pc-matrix-plate') +
            matrix_pcard(matrix_LATE))
def matrix_ptoday():
    return (matrix_pgrp('Сегодня', matrix_dayname(matrix_TODAY), 'ждём ' + matrix_pl(len(matrix_DUE), 'оплату', 'оплаты', 'оплат') + ' · ' + matrix_sum(matrix_gel(matrix_rent(matrix_DUE)))) +
            matrix_pcard(matrix_DUE))
def matrix_ptomorrow():
    return (matrix_pgrp('Завтра', matrix_dayname(matrix_TODAY + 1), matrix_pays(len(matrix_TOMORROW)) + ' · ' + matrix_sum(matrix_gel(matrix_rent(matrix_TOMORROW)))) +
            matrix_pcard(matrix_TOMORROW))
def matrix_plater(opened=()):
    days, empty = matrix_groups()
    out = ''
    for day in days:
        rows = [r for r in matrix_LATER if matrix_due(r) == day]
        out += matrix_pfold(matrix_dayname(day), 'ожидается ' + matrix_pays(len(rows)) + ' · ' + matrix_sum(matrix_gel(matrix_rent(rows))), rows, day in opened)
    for day in empty:
        out += '<div class="pc-matrix-grp pc-matrix-nil"><b>' + matrix_dayname(day) + '</b><span>оплат нет</span></div>'
    return out
def matrix_ppaid(opened=False, cut=True):
    # the heavier rule parts those we still wait for from those who have paid
    return (('<div class="pc-matrix-cut"></div>' if cut else '') +
            matrix_pfold(matrix_mark('paid') + 'Оплачено', matrix_pays(len(matrix_PAID)) + ' · ' + matrix_sum(matrix_gel(matrix_rent(matrix_PAID))), matrix_PAID, opened))

def matrix_pend():
    before = matrix_CAME_BEFORE[0]
    return ('<a class="pc-matrix-came" href="#" aria-label="Открыть Деньги → Платежи"><span>Пришло денег ' + matrix_d(matrix_MON) + ' – ' + matrix_d(matrix_TODAY) + '</span>'
            '<b>' + matrix_gel(matrix_CAME) + matrix_go() + '</b>'
            '<small>По дате платежа; ' + matrix_gel(before['rate']) + ' за эту неделю пришли раньше — ' + matrix_d(before['pay']) + '. '
            + SORT_HINT + '.</small></a>'
            '<div class="pc-matrix-pnote">В плитке — сумма дня, зелёная часть полоски уже оплачена. '
            'Самый большой день — ' + matrix_WDFULL[matrix_MAXDAY] + ', <b>' + matrix_gel(matrix_DAYSUM[matrix_MAXDAY]) + '</b></div>'
            '<div class="pc-matrix-pleg">' + matrix_legend(True) + '</div>'
            '<div class="pc-matrix-pweeks">'
            '<a class="pc-matrix-wkbtn" href="#"><b>' + ic('left', 'i s') + 'Прошлая неделя</b><small>оплачено ' + matrix_num(matrix_PREV_PAID) + ' из ' + matrix_gel(matrix_TOTAL) + '</small></a>'
            '<a class="pc-matrix-wkbtn" href="#"><b>Следующая неделя' + ic('right', 'i s') + '</b><small>должно прийти ' + matrix_gel(matrix_TOTAL) + '</small></a></div>')

def matrix_phone_body(part):
    if part == 'top':        # the first screen; everything below it is in the frame too and scrolls
        return ('<div class="pc-matrix-gap"></div>' + stabs() + matrix_strip() + matrix_psummary() + matrix_plate() + matrix_ptoday() +
                matrix_ptomorrow() + matrix_plater() + matrix_ppaid() + matrix_pend())
    if part == 'low':        # scrolled to tomorrow; Friday is opened by its button
        return matrix_strip() + matrix_ptomorrow() + matrix_plater(opened=(16,)) + matrix_ppaid() + matrix_pend()
    return matrix_strip() + matrix_ppaid(opened=True, cut=False) + matrix_pend()   # the very bottom; «Оплачено» is opened

# ================= laptop =================
def matrix_dcells(r=None):
    cells = ''
    for i in range(7):
        day = matrix_MON + i
        m = ''
        if r is not None and i == r['wd']:
            m = matrix_mark(r['st'], title=matrix_WD[i] + ' ' + matrix_d(day) + ' · ' + matrix_WORD[r['st']] + ' · ' + matrix_gel(r['rate']))
        cells += '<span class="pc-matrix-c' + (' pc-matrix-td' if day == matrix_TODAY else '') + '">' + m + '</span>'
    return '<div class="pc-matrix-days">' + cells + '</div>'

def matrix_drow(r):
    return ('<div class="pc-matrix-row' + (' pc-matrix-r-late' if r['st'] == 'late' else '') + '">' + matrix_who(r, 'pc-matrix-dwho') +
            '<div class="pc-matrix-act">' + matrix_acts(r, dense=True) + '</div>' + matrix_dcells(r) + '</div>')

def matrix_dhead():
    return ('<div class="pc-matrix-row pc-matrix-hd"><div class="pc-matrix-hdl"><b>' + matrix_pl(len(matrix_ROWS), 'аренда', 'аренды', 'аренд') + '</b>'
            '<span>сначала должники, потом по дням; значок стоит под днём оплаты</span></div>'
            '<div class="pc-matrix-days">' + ''.join(matrix_tile(i, wide=True) for i in range(7)) + '</div></div>')

def matrix_dband(title, meta, cls=''):
    return ('<div class="pc-matrix-row pc-matrix-gh"><div class="pc-matrix-ght"><b>' + title + '</b>'
            '<span' + (' class="' + cls + '"' if cls else '') + '>' + meta + '</span></div>' + matrix_dcells() + '</div>')

def matrix_dfold(title, meta, rows, opened=False, cut=False):
    return ('<details class="pc-matrix-fold"' + (' open' if opened else '') + '><summary>'
            '<div class="pc-matrix-row pc-matrix-gh' + (' pc-matrix-cutrow' if cut else '') + '"><div class="pc-matrix-ght pc-matrix-short"><b>' + title + '</b><span>' + meta + '</span></div>'
            '<div class="pc-matrix-act">' + matrix_toggle() + '</div>' + matrix_dcells() + '</div></summary>' +
            ''.join(matrix_drow(r) for r in rows) + '</details>')

def matrix_dlate():
    return (matrix_dband(matrix_mark('late') + 'Просрочено', matrix_pl(len(matrix_LATE), 'аренда', 'аренды', 'аренд') + ' · весь долг ' + matrix_sum(matrix_gel(matrix_DEBT)) +
                         ' — ' + matrix_gel(matrix_rent(matrix_LATE)) + ' за эту неделю и ' + matrix_gel(matrix_DEBT_OLD) + ' за прошлую', 'pc-matrix-plate') +
            ''.join(matrix_drow(r) for r in matrix_LATE))
def matrix_dtoday():
    return (matrix_dband('Сегодня', matrix_dayname(matrix_TODAY) + ' · ждём ' + matrix_pl(len(matrix_DUE), 'оплату', 'оплаты', 'оплат') + ' · ' + matrix_sum(matrix_gel(matrix_rent(matrix_DUE)))) +
            ''.join(matrix_drow(r) for r in matrix_DUE))
def matrix_dtomorrow():
    return (matrix_dband('Завтра', matrix_dayname(matrix_TODAY + 1) + ' · ' + matrix_pays(len(matrix_TOMORROW)) + ' · ' + matrix_sum(matrix_gel(matrix_rent(matrix_TOMORROW)))) +
            ''.join(matrix_drow(r) for r in matrix_TOMORROW))
def matrix_dlater(opened=()):
    out = ''
    for day in matrix_groups()[0]:
        rows = [r for r in matrix_LATER if matrix_due(r) == day]
        out += matrix_dfold(matrix_dayname(day), 'ожидается ' + matrix_pays(len(rows)) + ' · ' + matrix_sum(matrix_gel(matrix_rent(rows))), rows, day in opened)
    return out
def matrix_dpaid(opened=False):
    return matrix_dfold(matrix_mark('paid') + 'Оплачено', matrix_pays(len(matrix_PAID)) + ' · ' + matrix_sum(matrix_gel(matrix_rent(matrix_PAID))), matrix_PAID, opened, cut=True)

def matrix_dfoot():
    before = matrix_CAME_BEFORE[0]
    return ('<div class="pc-matrix-row pc-matrix-ft pc-matrix-top"><div class="pc-matrix-legend">' + matrix_legend() + '</div>'
            '<div class="pc-matrix-fnote">Самый большой день — ' + matrix_WDFULL[matrix_MAXDAY] + ', <b class="pc-matrix-sum">' + matrix_gel(matrix_DAYSUM[matrix_MAXDAY]) + '</b></div></div>'
            '<div class="pc-matrix-row pc-matrix-ft"><div class="pc-matrix-ftxt">Пришло денег ' + matrix_d(matrix_MON) + ' – ' + matrix_d(matrix_TODAY) + ' (по дате платежа): '
            '<a class="pc-matrix-lnk pc-matrix-sum" href="#">' + matrix_gel(matrix_CAME) + '</a>; ещё ' + matrix_gel(before['rate']) + ' за эту неделю пришли раньше — ' + matrix_d(before['pay']) + '. '
            + SORT_HINT + '.</div>'
            '<div class="pc-matrix-fnote"><a href="#">Все платежи ' + ic('right', 'i s') + '</a></div></div>')

def matrix_box(label, value, note, cls=''):
    return ('<a class="pc-matrix-tl-box" href="#" aria-label="Открыть Деньги → Платежи"><div class="pc-matrix-tl">' + label + matrix_go() + '</div>'
            '<div class="pc-matrix-tv"><b' + (' class="' + cls + '"' if cls else '') + '>' + value + '</b><span>' + note + '</span></div></a>')

def matrix_desk_body(part):
    grid_top = '<div class="pc-matrix-grid">' + matrix_dhead()
    if part == 'low':        # scrolled down, the day header stays pinned; Friday, Saturday and «Оплачено» are opened by their buttons
        return grid_top + matrix_dtomorrow() + matrix_dlater(opened=(16, 17)) + matrix_dpaid(opened=True) + matrix_dfoot() + '</div>'
    boxes = ('<div class="pc-matrix-tiles">' +
             matrix_box('Должно прийти за неделю', matrix_gel(matrix_TOTAL), matrix_pays(len(matrix_ROWS))) +
             matrix_box('Оплачено', matrix_gel(matrix_rent(matrix_PAID)), matrix_pays(len(matrix_PAID)), 'pc-matrix-ok') +
             matrix_box('Осталось', matrix_gel(matrix_rent(matrix_LEFT)), matrix_pays(len(matrix_LEFT))) +
             matrix_box('Из них просрочено · ' + matrix_pl(len(matrix_LATE), 'аренда', 'аренды', 'аренд'), matrix_gel(matrix_rent(matrix_LATE)), 'весь долг ' + matrix_gel(matrix_DEBT), 'pc-matrix-bad') +
             '</div>')
    week_paid = [('прошлая', matrix_PREV_PAID, ''), ('эта', matrix_rent(matrix_PAID), ' pc-matrix-cur'), ('следующая', 0, '')]
    bar = ('<div class="pc-matrix-bar"><a class="btn btn-sm" href="#">' + ic('left', 'i s') + 'Раньше</a>'
           '<span class="pc-matrix-range">' + matrix_d(matrix_MON) + ' – ' + matrix_d(matrix_MON + 6) + '</span>'
           '<a class="btn btn-sm" href="#">Позже' + ic('right', 'i s') + '</a>'
           '<a class="btn btn-sm" href="#" aria-disabled="true">Сегодня</a>'
           '<div class="pc-matrix-wks"><span>Оплачено за неделю:</span>' +
           ''.join('<span>' + cap + ' <a class="' + cls.strip() + '" href="#">' + matrix_num(v) + ' из ' + matrix_gel(matrix_TOTAL) + '</a></span>' for cap, v, cls in week_paid) +
           '</div></div>')
    return boxes + bar + grid_top + matrix_dlate() + matrix_dtoday() + matrix_dtomorrow() + matrix_dlater() + matrix_dpaid() + matrix_dfoot() + '</div>'

def matrix_bands(letter, rec=False):
    lead = '<b>' + letter + '. ' + matrix_NAME + (' — рекомендую' if rec else '') + '.</b> '
    def sub(words):
        return '<b>' + letter + words + '.</b> '
    p1 = phone(lead + 'Первый экран. Сверху неделя семью плитками: день, сумма дня и полоска (её длина — сумма дня, зелёная часть уже оплачена); '
               'сегодня — лаймовая плитка. Ниже одна лента по срочности: должники (старший долг первым), сегодня, завтра. '
               'У каждого, с кого берём деньги, — кнопка «Принять оплату». ' + FORM_HINT
               + ' Имя со стрелкой открывает аренду. Цена: значков по дням в строках на телефоне нет, '
               'а из завтрашних на первый экран входит только заголовок с числом оплат и суммой.',
               head('Деньги'), matrix_phone_body('top'), tabbar('owner', 'money', 9), body_cls='pc-matrix-body')
    p2 = phone(sub(', тот же экран ниже') + 'Плитки дней закреплены и при прокрутке остаются сверху. У завтрашних — «Принять оплату» '
               '(платят заранее) и «Напомнить» в WhatsApp. Дни после завтра сложены в строку с числом оплат и суммой; '
               'пятница здесь раскрыта кнопкой «Показать», суббота и «Оплачено» — закрыты. У тех, кто платит позже завтра, '
               'только «Принять оплату»: напоминание «Завтра оплата» им ещё рано. '
               'Цена: имена на пятницу и субботу видны только после нажатия.',
               head('Деньги'), matrix_phone_body('low'), tabbar('owner', 'money', 9), body_cls='pc-matrix-body')
    p3 = phone(sub(', самый низ') + '«Оплачено» раскрыто кнопкой: кто оплатил, когда и как, с суммой; у оплаты заранее названы обе даты — '
               'платёж и срок. «Пришло денег» считает по дате платежа и ведёт в «Платежи». '
               'Самый большой день назван словами здесь же. Недели листаются двумя кнопками внизу, под большим пальцем. '
               'Цена: стрелок недели наверху на телефоне нет, а самый большой день на первом экране виден только жирной суммой и длинной полоской.',
               head('Деньги'), matrix_phone_body('end'), tabbar('owner', 'money', 9), body_cls='pc-matrix-body')
    d1 = desk(sub(' на ноутбуке') + 'Та же лента, а справа сетка: дни недели столбцами, у каждой аренды значок под её днём, сегодня — лаймовый столбец. '
              'Состояние словами стоит под именем, кнопки — рядом («Принять оплату» открывает обычную форму денег в правой панели); '
              'над столбцами сумма дня и полоска оплаченного. '
              'Итоги недели — четыре плитки сверху; «Раньше» и «Позже» листают недели, «Сегодня» возвращает к этой. '
              'Цена: сетка показывает одну неделю — прошлая и следующая видны только итогом справа от стрелок. '
              'При 85 мопедах (около 12 оплат в день) раскрыты всё так же только должники, сегодня и завтра — около 24 строк с кнопками: '
              'утром это четыре-пять экранов телефона и около двух экранов ноутбука, к вечеру меньше; остальные дни и «Оплачено» — по одной строке. '
              'Суммы дня станут четырёхзначными: в плитку телефона «1' + matrix_THIN + '800» войдёт только без знака ₾.',
              rail('money', 'owner', 9), dmain(matrix_desk_body('top'), 'неделя 12.10 – 18.10 · сегодня среда, 14.10'))
    d2 = desk(sub(' на ноутбуке, ниже') + 'Строка дней закреплена. Пятница, суббота и «Оплачено» раскрыты кнопкой «Показать» — видна сетка целиком. '
              'У оплативших значок стоит под днём срока: сплошная галочка — оплачено, контурная — оплачено заранее, дата платежа названа словами. '
              'Цена: чтобы увидеть всех сразу, как в таблице, нужно раскрыть каждую сложенную строку отдельно.',
              rail('money', 'owner', 9), dmain(matrix_desk_body('low'), 'неделя 12.10 – 18.10 · сегодня среда, 14.10'))
    return [(letter + '. ' + matrix_NAME + ' — телефон', p1 + p2 + p3),
            (letter + '. ' + matrix_NAME + ' — ноутбук', d1 + d2)]


# ====================================================================================================
# Д · month · «Месяц сеткой»
# ====================================================================================================
# Календарь платежей (Mika, 11.10.2026) — concept «Месяц сеткой».
# A classic month grid, Monday first. On a laptop the whole month stands next to
# three lists: who is late, the chosen day, tomorrow. On a phone the grid opens
# as ONE row — the current week — and the month unfolds by a plain button; the
# chosen day's payers are listed under it. Example data only; static, no script.

month_NAME = 'Месяц сеткой'
month_PITCH = ('Привычный календарь. На ноутбуке виден весь месяц — в какие дни была просрочка и как идёт эта неделя, '
         'а рядом списки «Просрочено», «Сегодня» и «Завтра». На телефоне — одна строка текущей недели с суммами, '
         'месяц открывается кнопкой.')
month_COST = ('Аренду платят раз в неделю, поэтому четыре строки месяца из пяти почти ничего не добавляют: в них видно только, '
        'где была просрочка. На телефоне поимённо виден один день, остальные — по нажатию на клетку, '
        'а открытый месяц сдвигает список людей вниз.')

month_CSS = '''
/* ---- Месяц сеткой: the page's own classes; colours are tokens only ---- */
.pc-month-nw { white-space: nowrap; }
.pc-month-lnk { text-decoration: underline; text-decoration-color: var(--line-control); text-underline-offset: 3px; }
svg.pc-month-go { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; color: var(--muted); }

/* state marks: tick in a disc = paid, tick in a ring = paid in advance, dot = due today, ring = ahead, square = late */
.pc-month-m { width: 18px; height: 18px; flex: none; display: inline-grid; place-items: center; box-sizing: border-box; border-radius: 50%; }
.pc-month-m svg { width: 11px; height: 11px; display: block; fill: none; stroke: currentColor; stroke-width: 3.4; stroke-linecap: round; stroke-linejoin: round; }
.pc-month-m::before { box-sizing: border-box; }
.pc-month-m-paid { background: var(--accent); color: var(--on-accent); }
.pc-month-m-adv { border: 1.5px solid var(--accent); color: var(--accent); }
.pc-month-m-adv svg { width: 10px; height: 10px; }
.pc-month-m-due::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: var(--ink); }
.pc-month-m-exp::before { content: ""; width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--grey); }
.pc-month-m-late::before { content: ""; width: 12px; height: 12px; background: var(--crit); }
.pc-month-m-sm { width: 12px; height: 12px; }
.pc-month-m-sm svg { width: 8px; height: 8px; stroke-width: 4; }
.pc-month-m-sm.pc-month-m-adv svg { width: 7px; height: 7px; }
.pc-month-m-sm.pc-month-m-due::before { width: 8px; height: 8px; }
.pc-month-m-sm.pc-month-m-exp::before { width: 10px; height: 10px; }
.pc-month-m-sm.pc-month-m-late::before { width: 9px; height: 9px; }
.pc-month-st-late { color: var(--crit-ink); }
.pc-month-st-due { color: var(--ink); }
.pc-month-st-exp { color: var(--grey-ink); }
.pc-month-st-paid, .pc-month-st-adv { color: var(--accent-ink); }

/* phone: the week in one line and the late ones behind a plain button, one card */
.pc-month-sumcard { background: var(--surface); border-radius: var(--radius-card); margin: 0 0 6px; overflow: hidden; }
.pc-month-wk { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 5px 10px 5px 14px; }
.pc-month-wk-t { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.pc-month-wk-o { font: var(--text-overline); line-height: 16px; color: var(--muted); }
.pc-month-wk-l { display: flex; flex-wrap: wrap; gap: 0 5px; font: 400 13px/18px var(--body); }
.pc-month-wk-l > span { white-space: nowrap; }
.pc-month-wk-l b { font-weight: 600; font-variant-numeric: tabular-nums; }
.pc-month-debt { border-top: 1px solid var(--line-soft); }
.pc-month-debt > summary { display: block; list-style: none; cursor: pointer; background: var(--crit-soft); }
.pc-month-debt > summary::-webkit-details-marker { display: none; }
.pc-month-debt-in { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; column-gap: 8px; align-items: center; min-height: 44px; padding: 5px 10px 5px 14px; }
.pc-month-debt-t { display: flex; flex-direction: column; min-width: 0; }
.pc-month-debt-t b { font: 600 13px/18px var(--body); color: var(--crit-ink); }
.pc-month-debt-t b span { font: inherit; }
.pc-month-debt-t span { font: 400 12px/16px var(--body); color: var(--crit-ink); white-space: nowrap; }
.pc-month-tog { gap: 2px; padding: 0 8px 0 12px; }
.ph-body .pc-month-tog { min-height: 44px; }
.ph-body .pc-month-debt-in { padding-top: 0; padding-bottom: 0; }
.ph-body .pc-month-debt-t { padding: 4px 0; }
.pc-month-wo { display: none; }
.pc-month-debt[open] .pc-month-wo { display: inline; }
.pc-month-debt[open] .pc-month-wc { display: none; }
.pc-month-ch { display: inline-flex; }
.pc-month-ch svg { width: 14px; height: 14px; }
.pc-month-ch-d, .pc-month-tog .pc-month-ch { transform: rotate(90deg); }
.pc-month-ch-u, .pc-month-debt[open] .pc-month-tog .pc-month-ch { transform: rotate(-90deg); }
.pc-month-note { margin: 0; padding: 8px 14px 10px; border-top: 1px solid var(--line-soft); font: 400 12px/16px var(--body); color: var(--muted); }

/* the calendar's own controls: back, forward, today, and the month by a button */
.pc-month-bar { display: flex; align-items: center; gap: 8px; margin: 0 0 4px; }
.pc-month-b { flex: none; }
.pc-month-now { padding: 0 14px; }
.pc-month-all { margin-left: auto; gap: 2px; padding: 0 10px 0 14px; }
.pc-month-title { font: 500 18px/22px var(--display); letter-spacing: var(--tracking-tight); white-space: nowrap; }
.pc-month-trow { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin: 0 2px 2px; }
.pc-month-trow .pc-month-lg { margin: 0; }

/* weekday names and the grid */
.pc-month-wd, .pc-month-g { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); gap: 2px; }
.pc-month-wd { margin: 0 0 3px; }
.pc-month-wd span { text-align: center; font: var(--text-overline); line-height: 16px; color: var(--muted); }
.pc-month-c { position: relative; min-width: 0; min-height: 44px; padding: 3px 1px; border-radius: 10px; background: var(--surface); color: var(--ink); box-shadow: inset 0 0 0 1px var(--line-soft); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; }
.pc-month-wkc { min-height: 54px; gap: 0; }
.pc-month-off, .pc-month-none { background: transparent; box-shadow: none; }
.pc-month-n { font: var(--text-h3); line-height: 18px; }
.pc-month-past .pc-month-n, .pc-month-next .pc-month-n, .pc-month-none .pc-month-n { color: var(--muted); }
.pc-month-late { background: var(--crit-soft); box-shadow: none; }
.pc-month-today { background: var(--lime); box-shadow: none; }
.pc-month-today .pc-month-n { font-weight: 600; }
.pc-month-sel { box-shadow: inset 0 0 0 2px var(--ink); }
.pc-month-cs { font: 500 11px/14px var(--body); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-month-cn { font: 400 11px/14px var(--body); color: var(--muted); white-space: nowrap; }
.pc-month-today .pc-month-cn { color: var(--ink); }
.pc-month-cn-all { color: var(--accent-ink); font-weight: 600; }
.pc-month-flag { position: absolute; top: 5px; right: 5px; width: 7px; height: 7px; background: var(--crit); }

/* legend */
.pc-month-lg { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 12px; margin: 4px 2px 6px; font: 400 12px/16px var(--body); color: var(--muted); }
.pc-month-lg span { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.pc-month-lg b { font-weight: 500; color: var(--ink); }
.pc-month-sw { display: inline-block; flex: none; width: 12px; height: 12px; border-radius: 4px; background: var(--lime); box-shadow: inset 0 0 0 1px var(--line-control); }

/* the chosen day: a heading that is one link, then its payers in one card */
.pc-month-dh { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; margin: 0 2px; }
.pc-month-dh-t { display: flex; flex-direction: column; min-width: 0; }
.pc-month-dh-t b { font: var(--text-h2); line-height: 20px; letter-spacing: var(--tracking-tight); white-space: nowrap; }
.pc-month-dh-t b span { font: var(--text-label); letter-spacing: 0; color: var(--muted); }
.pc-month-dh-t small { font: 400 12px/16px var(--body); color: var(--muted); }
.pc-month-dh-n { display: inline-flex; align-items: center; gap: 2px; font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-month-list { background: var(--surface); border-radius: var(--radius-card); overflow: hidden; margin: 0 0 2px; }
.pc-month-row { padding: 5px 14px 8px; border-top: 1px solid var(--line-soft); }
.pc-month-list > .pc-month-row:first-child { border-top: 0; }
.pc-month-r1 { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto; column-gap: 8px; align-content: center; align-items: center; min-height: 44px; }
.pc-month-who { min-width: 0; font: 500 15px/20px var(--body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-month-who span { font: 400 13px/20px var(--body); color: var(--muted); }
.pc-month-who svg { vertical-align: -3px; }
.pc-month-amt { font: 500 16px/20px var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; text-align: right; }
.pc-month-amt small { display: block; font: 400 11px/13px var(--body); }
.pc-month-amt-late { color: var(--crit-ink); }
.pc-month-st { grid-column: 2 / -1; min-width: 0; font: 500 13px/18px var(--body); }
.pc-month-r1-debt .pc-month-amt { grid-column: 3; grid-row: 1 / span 2; }
.pc-month-r1-debt .pc-month-st { grid-column: 2; }
.pc-month-acts { display: flex; align-items: center; gap: 8px; margin: 4px 0 0; }
.pc-month-take { flex: 1; min-width: 0; padding: 0 14px; }
.pc-month-rem { gap: 6px; padding: 0 14px; }
.pc-month-tmr { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 44px; margin: 0 2px 0 16px; font: var(--text-label); color: var(--muted); }
.pc-month-tmr > span { white-space: nowrap; }
.pc-month-tmr b { font-weight: 500; color: var(--ink); }

/* laptop: the week in figures */
.pc-month-card { background: var(--surface); border-radius: var(--radius-card); padding: 12px 16px 12px; margin: 0 0 12px; }
.pc-month-card-h { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin: 0 0 6px; font: var(--text-overline); color: var(--muted); }
.pc-month-card-h span + span { font: var(--text-label); }
.pc-month-card-h b { font-weight: 600; color: var(--ink); }
.pc-month-figs { display: flex; align-items: flex-start; gap: 44px; }
.pc-month-fig { display: flex; flex-direction: column; min-width: 0; }
.pc-month-fv { font: var(--text-money-lg); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-month-fl { display: inline-flex; align-items: center; gap: 6px; font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-month-fs { font: 400 12px/16px var(--body); color: var(--muted); white-space: nowrap; }
.pc-month-fig-debt { margin-left: auto; padding-left: 24px; border-left: 1px solid var(--line-soft); }
.pc-month-fig-debt .pc-month-fv, .pc-month-fig-debt .pc-month-fl { color: var(--crit-ink); }

/* laptop: a narrow month on the left, the lists on the right */
.pc-month-desk { display: grid; grid-template-columns: 448px minmax(0, 1fr); gap: 24px; align-items: start; }
.pc-month-bar-d { gap: 6px; margin: 0 0 8px; }
.pc-month-bar-d .pc-month-title { margin: 0 8px; }
.pc-month-bar-d .pc-month-now { padding: 0 12px; }
.pc-month-r34 { width: var(--control-dense); }
.pc-month-gd { gap: 4px; }
.pc-month-gd .pc-month-c { min-height: 40px; padding: 6px 5px; align-items: stretch; gap: 0; }
.pc-month-gd .pc-month-wkc { min-height: 100px; justify-content: flex-start; }
.pc-month-top { display: flex; align-items: center; justify-content: space-between; gap: 4px; min-width: 0; height: 18px; }
.pc-month-sum { font: 500 13px/18px var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-month-none .pc-month-sum { color: var(--muted); }
.pc-month-ps { display: flex; flex-wrap: wrap; gap: 3px 4px; margin-top: 4px; }
.pc-month-p { display: inline-flex; align-items: center; gap: 2px; font: 500 12px/14px var(--mono); white-space: nowrap; }
.pc-month-tag { margin-top: auto; font: 600 11px/14px var(--display); white-space: nowrap; }
.pc-month-lg-d { display: block; margin: 10px 2px 0; }
.pc-month-lg-d p { margin: 0; }
.pc-month-lg-m { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 14px; margin: 4px 0; }
.pc-month-side { min-width: 0; background: var(--surface); border-radius: var(--radius-card); padding: 4px 16px 8px; }
.pc-month-sec + .pc-month-sec { margin-top: 8px; border-top: 1px solid var(--line); }
.pc-month-sh { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 0 6px; }
.pc-month-sh h3 { margin: 0; display: inline-flex; align-items: center; gap: 8px; font: var(--text-h2); line-height: 20px; letter-spacing: var(--tracking-tight); white-space: nowrap; }
.pc-month-sh h3 span { font: var(--text-label); letter-spacing: 0; color: var(--muted); }
.pc-month-sh-n { font: var(--text-label); color: var(--muted); white-space: nowrap; }
.pc-month-sh-late h3, .pc-month-sh-late .pc-month-sh-n { color: var(--crit-ink); }
.pc-month-drow { display: grid; grid-template-columns: 18px minmax(0, 1fr) auto 60px; column-gap: 10px; align-items: center; min-height: 46px; padding: 4px 0; border-top: 1px solid var(--line-soft); }
.pc-month-dwho { display: flex; flex-direction: column; min-width: 0; }
.pc-month-dwide { grid-column: 2 / 4; }
.pc-month-dname { font: 500 14px/18px var(--body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-month-ds { font: 400 12px/16px var(--body); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-month-ds span { font-weight: 500; }
.pc-month-dacts { display: flex; gap: 6px; }
.pc-month-dacts .pc-month-take { flex: none; padding: 0 12px; }
.pc-month-dacts .pc-month-rem { padding: 0 12px; }
.pc-month-damt { text-align: right; font: 500 14px/18px var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pc-month-damt small { display: block; font: 400 11px/13px var(--body); }
.pc-month-side .pc-month-note { padding: 8px 0 4px 28px; }
'''


# ---- the one example dataset: October 2026, today is Wednesday 14.10, the week is 12–18.10 ----
month_TODAY = 14
month_WEEK = list(range(12, 19))
month_WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
month_WDFULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

def month_r(k, moped, rate, due, state, pay=0, ch='', since=0, debt=0, why=''):
    # due — the day of October this week falls due; state — paid | adv (paid before the week began) |
    # late | due (today, not paid) | exp (a week ahead); pay — the day of October the payment is dated;
    # since — the oldest due day still unpaid
    return {'k': k, 'moped': moped, 'rate': rate, 'due': due, 'state': state, 'pay': pay, 'ch': ch,
            'since': since, 'days': (month_TODAY - since) if since else 0, 'debt': debt, 'why': why}

month_RENT = [
    month_r('А', 'Wolf-8', 150, 12, 'paid', 12, 'наличные'),
    month_r('Б', 'B11', 150, 13, 'adv', 10, 'перевод'),
    month_r('В', 'B11', 140, 13, 'paid', 13, 'перевод'),
    month_r('Г', 'XL1200', 150, 13, 'late', since=13, debt=150, why='срок был 13.10'),
    month_r('Д', '17C', 150, 14, 'due'),
    month_r('Е', 'Wolf-8', 150, 14, 'paid', 14, 'карта'),
    month_r('М', '17C', 150, 14, 'late', since=7, debt=300, why='2 недели, с 07.10'),
    month_r('Ж', 'XL1200', 150, 15, 'exp'),
    month_r('З', 'B11', 150, 15, 'exp'),
    month_r('И', 'F-150', 150, 16, 'exp'),
    month_r('К', 'B11', 150, 16, 'adv', 13, 'наличные'),
    month_r('Л', 'MB5', 150, 17, 'exp'),
]
month_RANK = {'late': 0, 'due': 1, 'exp': 2, 'adv': 3, 'paid': 3}
month_KINDS = ['late', 'due', 'exp', 'paid', 'adv']
month_SAID = {'late': 'просрочено', 'due': 'ждём сегодня', 'exp': 'ожидается', 'paid': 'оплачено', 'adv': 'оплачено заранее'}

def month_of(d):
    # who is still to pay goes first; the paid ones follow in the order the money came
    return sorted([r for r in month_RENT if r['due'] == d], key=lambda r: (month_RANK[r['state']], r['pay']))
def month_sum(rows):
    return sum(r['rate'] for r in rows)

month_DAYSUM = [month_sum(month_of(d)) for d in month_WEEK]
month_DAYN = [len(month_of(d)) for d in month_WEEK]
month_DONE = [r for r in month_RENT if r['state'] in ('paid', 'adv')]
month_OPEN = [r for r in month_RENT if r['state'] in ('late', 'due', 'exp')]
month_LATE = sorted([r for r in month_RENT if r['state'] == 'late'], key=lambda r: -r['days'])   # the oldest debt first
month_ALL = month_sum(month_RENT)
month_DEBT = sum(r['debt'] for r in month_LATE)
month_TOP = month_DAYSUM.index(max(month_DAYSUM))
month_GOT = dict((d, month_sum([r for r in month_DONE if r['pay'] == d])) for d in month_WEEK)   # money by its own date

# The figures of the brief, checked before a single frame is drawn.
assert month_DAYSUM == [150, 440, 450, 300, 300, 150, 0] and month_ALL == 1790 and len(month_RENT) == 12
assert (len(month_DONE), month_sum(month_DONE)) == (5, 740)
assert (len(month_OPEN), month_sum(month_OPEN)) == (7, 1050)
assert (len(month_LATE), month_sum(month_LATE), month_DEBT) == (2, 300, 450)
assert month_sum([r for r in month_RENT if r['state'] == 'due']) == 150
assert month_sum([r for r in month_RENT if r['state'] == 'exp']) == 600
assert month_TOP == 2 and month_DAYSUM.count(450) == 1
# A payment has its own date: never after today; «заранее» is dated before the due day.
assert all(0 < r['pay'] <= month_TODAY for r in month_DONE) and all(r['pay'] == 0 for r in month_OPEN)
assert all(r['pay'] < r['due'] for r in month_RENT if r['state'] == 'adv')
assert all(r['pay'] == r['due'] for r in month_RENT if r['state'] == 'paid')
assert (month_GOT[12], month_GOT[13], month_GOT[14]) == (150, 290, 150) and sum(month_GOT.values()) == 590
# A debt is whole unpaid weeks, counted from the oldest unpaid due day.
assert all(r['debt'] == r['rate'] * ((r['due'] - r['since']) // 7 + 1) and r['since'] <= r['due'] < month_TODAY + 1 for r in month_LATE)
assert [(r['k'], r['days'], r['debt']) for r in month_LATE] == [('М', 7, 300), ('Г', 1, 150)]

def month_gel(n):
    # 150 ₾, 1 790 ₾: no decimals, a thin space for thousands (every place a sum stands is set not to wrap)
    s = str(n)
    if len(s) > 3:
        s = s[:-3] + '&thinsp;' + s[-3:]
    return s + '&nbsp;₾'

def month_dd(d):
    return ('%02d' % d) + '.10'

def month_pl(n):
    if n % 10 == 1 and n % 100 != 11:
        return str(n) + ' оплата'
    if n % 10 in (2, 3, 4) and n % 100 not in (12, 13, 14):
        return str(n) + ' оплаты'
    return str(n) + ' оплат'

def month_wd(d):
    # 01.10.2026 is a Thursday; 0 = Monday
    return (d + 2) % 7
assert month_wd(1) == 3 and [month_wd(d) for d in month_WEEK] == list(range(7)) and month_wd(7) == month_wd(14)

def month_split(d):
    # The payments due on day d of October, counted by state.
    s = dict((k, 0) for k in month_KINDS)
    n = month_DAYN[month_wd(d)]
    if d in month_WEEK:
        for r in month_of(d):
            s[r['state']] += 1
    elif d < month_WEEK[0]:
        # every earlier week was paid on its day, except the ones still owed today
        s['late'] = len([r for r in month_LATE if r['since'] == d])
        s['paid'] = n - s['late']
    else:
        s['exp'] = n                 # a week ahead is a calculation, not a fact
    return s
assert [d for d in range(1, 32) if month_split(d)['late']] == [7, 13, 14]

def month_mark(kind, sm=False):
    tick = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICONS['check'] + '</svg>' if kind in ('paid', 'adv') else ''
    return '<i class="pc-month-m pc-month-m-' + kind + (' pc-month-m-sm' if sm else '') + '">' + tick + '</i>'

month_GO = ic('right', 'pc-month-go')
def month_chev(up=False):
    return '<span class="pc-month-ch pc-month-ch-' + ('u' if up else 'd') + '">' + ic('right', 'i s') + '</span>'

# ---- phone: the grid ----
def month_cell(d, sel):
    wd = month_wd(d)
    n, total = month_DAYN[wd], month_DAYSUM[wd]
    inweek = d in month_WEEK
    cls = ['pc-month-c', 'pc-month-wkc' if inweek else ('pc-month-past' if d < month_WEEK[0] else 'pc-month-next')]
    if d == month_TODAY:
        cls.append('pc-month-today')
    num = '<span class="pc-month-n">' + str(d) + '</span>'
    if n == 0:
        cls.append('pc-month-none')
        dash = '<span class="pc-month-cn">—</span>' if inweek else ''
        return '<span class="' + ' '.join(cls) + '" aria-label="' + month_dd(d) + ': оплат нет">' + num + dash + '</span>'
    s = month_split(d)
    if s['late'] and d != month_TODAY:
        cls.append('pc-month-late')
    if d == sel:
        cls.append('pc-month-sel')
    done = s['paid'] + s['adv']
    if inweek:
        # this week: the day's sum, how many of its payments are in, a red square if somebody is late
        inner = (num + '<span class="pc-month-cs">' + month_gel(total) + '</span>'
                 '<span class="pc-month-cn' + (' pc-month-cn-all' if done == n else '') + '">' + str(done) + ' из ' + str(n) + '</span>'
                 + ('<i class="pc-month-flag"></i>' if s['late'] else ''))
        label = month_gel(total) + ', оплачено ' + str(done) + ' из ' + str(n) + (', просрочено ' + str(s['late']) if s['late'] else '')
    elif d < month_WEEK[0]:
        # an earlier week: only how the day ended
        inner = num + month_mark('late' if s['late'] else 'paid', True)
        label = 'есть просрочка' if s['late'] else 'всё оплачено'
    else:
        # a week ahead: the number alone
        inner = num
        label = 'по расчёту ' + month_pl(n)
    return '<a class="' + ' '.join(cls) + '" href="#" aria-label="' + month_dd(d) + ': ' + label + '">' + inner + '</a>'

def month_grid(sel, full):
    if not full:
        return '<div class="pc-month-g">' + ''.join(month_cell(d, sel) for d in month_WEEK) + '</div>'
    blank = '<span class="pc-month-c pc-month-off"></span>'
    cells = [blank] * 3                                  # Mon 28.09 – Wed 30.09
    cells += [month_cell(d, sel) for d in range(1, 32)]
    cells += [blank]                                     # Sun 01.11
    return '<div class="pc-month-g">' + ''.join(cells) + '</div>'

def month_weekdays():
    return '<div class="pc-month-wd">' + ''.join('<span>' + w + '</span>' for w in month_WD) + '</div>'

month_TODAYKEY = '<span><i class="pc-month-sw"></i>сегодня</span>'

def month_legend(full):
    out = '<span><b>1 из 3</b>— оплачено</span>'
    if full:
        out += '<span>' + month_mark('paid', True) + 'всё оплачено</span>'
    out += '<span>' + month_mark('late', True) + 'просрочено</span>'
    if not full:
        out += month_TODAYKEY
    return '<div class="pc-month-lg">' + out + '</div>'

def month_bar(full):
    # one row open: the arrows step by a week; the month open: by a month
    back, fwd = ('Сентябрь 2026', 'Ноябрь 2026') if full else ('Неделя 05.10 – 11.10', 'Неделя 19.10 – 25.10')
    return ('<div class="pc-month-bar">'
            '<a class="btn btn-round pc-month-b" href="#" aria-label="' + back + '">' + ic('left', 'i s') + '</a>'
            '<a class="btn btn-round pc-month-b" href="#" aria-label="' + fwd + '">' + ic('right', 'i s') + '</a>'
            '<a class="btn pc-month-b pc-month-now" href="#">Сегодня</a>'
            '<a class="btn pc-month-b pc-month-all" href="#">' + ('Свернуть' if full else 'Весь месяц') + month_chev(full) + '</a></div>'
            + ('<div class="pc-month-trow"><div class="pc-month-title">Октябрь 2026</div><div class="pc-month-lg">' + month_TODAYKEY + '</div></div>' if full else ''))

# ---- one person ----
def month_words(r):
    # the fixed word, « · », then the date of the payment and how it came — the same pattern in every variant
    s = r['state']
    if s == 'paid':
        return 'Оплачено · ' + ('сегодня' if r['pay'] == month_TODAY else month_dd(r['pay'])) + ', ' + r['ch']
    if s == 'adv':
        return 'Оплачено заранее · ' + month_dd(r['pay']) + ', ' + r['ch']
    if s == 'due':
        return 'Ждём сегодня'
    if s == 'exp':
        return 'Ожидается'
    weeks = r['debt'] // r['rate']
    return ('Просрочено · ' + str(r['days']) + '&nbsp;дн. · долг ' + month_gel(r['debt'])
            + (' за ' + str(weeks) + ' недели' if weeks > 1 else ''))

def month_acts(r, big=False):
    # «Принять оплату» opens the existing money form; the WhatsApp reminder exists only as «Завтра оплата»,
    # so it is offered only to those who pay tomorrow
    sm = ' btn-sm' if big else ''
    take = '<a class="btn' + sm + ' pc-month-take" href="#">Принять оплату</a>'
    call = ('<a class="btn' + sm + ' btn-round pc-month-b' + (' pc-month-r34' if big else '') + '" href="#" aria-label="Позвонить">'
            + ic('phone', 'i s') + '</a>')
    if r['state'] == 'exp' and r['due'] == month_TODAY + 1:
        remind = ('<a class="btn' + sm + ' pc-month-b pc-month-rem" href="#" aria-label="Напомнить в WhatsApp: завтра оплата">'
                  + ic('chat', 'i s') + 'Напомнить</a>')
        return take + remind + ('' if big else call)
    return take + call

def month_row(r, block=False):
    # block — the row inside «Просрочено»: the whole debt under the word «долг»; in a day — the week's rent
    s = r['state']
    who = '<span class="pc-month-who">Клиент Пример ' + r['k'] + ' <span>· ' + r['moped'] + '</span> ' + month_GO + '</span>'
    if block:
        amt = '<span class="pc-month-amt pc-month-amt-late"><small>долг</small>' + month_gel(r['debt']) + '</span>'
        st = '<span class="pc-month-st pc-month-st-late">' + str(r['days']) + '&nbsp;дн. · ' + r['why'] + '</span>'
    else:
        amt = '<span class="pc-month-amt">' + month_gel(r['rate']) + '</span>'
        st = '<span class="pc-month-st pc-month-st-' + s + '">' + month_words(r) + '</span>'
    return ('<div class="pc-month-row"><a class="pc-month-r1' + (' pc-month-r1-debt' if block else '') + '" href="#">'
            + month_mark(s) + who + amt + st + '</a>'
            + ('<div class="pc-month-acts">' + month_acts(r) + '</div>' if s in ('late', 'due', 'exp') else '') + '</div>')

# ---- phone: the week line and the late ones ----
def month_summary(opened):
    week = ('<a class="pc-month-wk" href="#" aria-label="Платежи этой недели"><span class="pc-month-wk-t">'
            '<span class="pc-month-wk-o">Эта неделя · ' + month_dd(month_WEEK[0]) + ' – ' + month_dd(month_WEEK[-1]) + '</span>'
            '<span class="pc-month-wk-l"><span>Оплачено <b class="pc-month-lnk">' + str(month_sum(month_DONE)) + '</b> из '
            '<b class="pc-month-lnk">' + month_gel(month_ALL) + '</b></span>'
            '<span>· осталось <b class="pc-month-lnk">' + month_gel(month_sum(month_OPEN)) + '</b></span></span></span>'
            + month_GO + '</a>')
    debt = ('<details class="pc-month-debt"' + (' open' if opened else '') + '><summary><span class="pc-month-debt-in">'
            + month_mark('late') + '<span class="pc-month-debt-t"><b>Просрочено · ' + str(len(month_LATE)) + ' <span>· долг ' + month_gel(month_DEBT) + '</span></b>'
            '<span>из них ' + month_gel(month_sum(month_LATE)) + ' — эта неделя</span></span>'
            '<span class="btn btn-sm pc-month-tog"><span class="pc-month-wc">Показать</span><span class="pc-month-wo">Скрыть</span>'
            '<span class="pc-month-ch">' + ic('right', 'i s') + '</span></span></span></summary>'
            + ''.join(month_row(r, True) for r in month_LATE)
            + '<p class="pc-month-note">' + SORT_HINT + '.</p></details>')
    return '<div class="pc-month-sumcard">' + week + debt + '</div>'

def month_day(sel):
    rows = month_of(sel)
    wd = month_wd(sel)
    tag = ' <span>· сегодня</span>' if sel == month_TODAY else (' <span>· завтра</span>' if sel == month_TODAY + 1 else '')
    note = '<small>самый большой день недели</small>' if wd == month_TOP else ''
    out = ('<a class="pc-month-dh" href="#"><span class="pc-month-dh-t"><b>' + month_WDFULL[wd] + ', ' + month_dd(sel) + tag + '</b>' + note + '</span>'
           '<span class="pc-month-dh-n"><span class="pc-month-lnk">' + month_pl(len(rows)) + ' · ' + month_gel(month_sum(rows)) + '</span>' + month_GO + '</span></a>'
           '<div class="pc-month-list">' + ''.join(month_row(r) for r in rows) + '</div>')
    if sel == month_TODAY:
        nxt = month_of(sel + 1)
        out += ('<a class="pc-month-tmr" href="#"><span>Завтра, ' + month_WD[month_wd(sel + 1)] + ' ' + month_dd(sel + 1) + ' · <b>'
                + month_pl(len(nxt)) + ' · ' + month_gel(month_sum(nxt)) + '</b></span>' + month_GO + '</a>')
    return out

def month_phone_body(sel, debt_open=False, full=False):
    return (stabs() + month_summary(debt_open) + month_bar(full) + month_weekdays() + month_grid(sel, full)
            + month_legend(full) + month_day(sel))

# ---- laptop ----
def month_dcell(d, sel):
    wd = month_wd(d)
    n, total = month_DAYN[wd], month_DAYSUM[wd]
    inweek = d in month_WEEK
    cls = ['pc-month-c', 'pc-month-wkc' if inweek else ('pc-month-past' if d < month_WEEK[0] else 'pc-month-next')]
    if d == month_TODAY:
        cls.append('pc-month-today')
    num = '<span class="pc-month-n">' + str(d) + '</span>'
    if n == 0:
        cls.append('pc-month-none')
        dash = '<span class="pc-month-sum">—</span>' if inweek else ''
        return ('<span class="' + ' '.join(cls) + '" aria-label="' + month_dd(d) + ': оплат нет"><span class="pc-month-top">' + num + '</span>'
                + dash + '</span>')
    s = month_split(d)
    if s['late'] and d != month_TODAY:
        cls.append('pc-month-late')
    if d == sel:
        cls.append('pc-month-sel')
    kinds = [k for k in month_KINDS if s[k]]
    if inweek:
        # this week: the day's sum and every mark with its count
        inner = ('<span class="pc-month-top">' + num + '</span><span class="pc-month-sum">' + month_gel(total) + '</span>'
                 '<span class="pc-month-ps">' + ''.join('<span class="pc-month-p pc-month-st-' + k + '">' + month_mark(k, True) + str(s[k]) + '</span>' for k in kinds) + '</span>'
                 + ('<span class="pc-month-tag">сегодня</span>' if d == month_TODAY else ''))
        label = month_gel(total) + ': ' + ', '.join(month_SAID[k] + ' ' + str(s[k]) for k in kinds)
    elif d < month_WEEK[0]:
        inner = '<span class="pc-month-top">' + num + month_mark('late' if s['late'] else 'paid', True) + '</span>'
        label = 'есть просрочка' if s['late'] else 'всё оплачено'
    else:
        inner = '<span class="pc-month-top">' + num + '</span>'
        label = 'по расчёту ' + month_pl(n)
    return '<a class="' + ' '.join(cls) + '" href="#" aria-label="' + month_dd(d) + ': ' + label + '">' + inner + '</a>'

def month_dgrid(sel):
    blank = '<span class="pc-month-c pc-month-off"></span>'
    cells = [blank] * 3 + [month_dcell(d, sel) for d in range(1, 32)] + [blank]
    return '<div class="pc-month-g pc-month-gd">' + ''.join(cells) + '</div>'

def month_dbar():
    return ('<div class="pc-month-bar pc-month-bar-d">'
            '<a class="btn btn-sm btn-round pc-month-b pc-month-r34" href="#" aria-label="Сентябрь 2026">' + ic('left', 'i s') + '</a>'
            '<a class="btn btn-sm btn-round pc-month-b pc-month-r34" href="#" aria-label="Ноябрь 2026">' + ic('right', 'i s') + '</a>'
            '<div class="pc-month-title">Октябрь 2026</div>'
            '<a class="btn btn-sm pc-month-b pc-month-now" href="#">Сегодня</a></div>')

def month_dlegend():
    items = [('paid', 'Оплачено'), ('adv', 'Оплачено заранее'), ('due', 'Ждём сегодня'), ('exp', 'Ожидается'), ('late', 'Просрочено')]
    return ('<div class="pc-month-lg pc-month-lg-d"><p>Цифра у отметки — число оплат, сумма — сколько должно прийти за день.</p>'
            '<div class="pc-month-lg-m">' + ''.join('<span>' + month_mark(k, True) + w + '</span>' for k, w in items)
            + '<span><i class="pc-month-sw"></i>Сегодня</span></div>'
            '<p>В прошлых неделях — только итог дня: всё оплачено или была просрочка. Недели впереди — расчёт, пока аренда идёт: те же дни и суммы.</p></div>')

def month_week_card():
    def fig(n, label):
        return ('<a class="pc-month-fig" href="#"><span class="pc-month-fv pc-month-lnk">' + month_gel(n) + '</span>'
                '<span class="pc-month-fl">' + label + '</span></a>')
    late_week = month_sum(month_LATE)
    return ('<div class="pc-month-card"><div class="pc-month-card-h"><span>Эта неделя · ' + month_dd(month_WEEK[0]) + ' – ' + month_dd(month_WEEK[-1]) + '</span>'
            '<span>Самый большой день — ' + month_WDFULL[month_TOP].lower() + ', <b>' + month_gel(month_DAYSUM[month_TOP]) + '</b></span></div>'
            '<div class="pc-month-figs">'
            + fig(month_ALL, 'должно прийти · ' + month_pl(len(month_RENT)))
            + fig(month_sum(month_DONE), month_mark('paid', True) + 'оплачено · ' + month_pl(len(month_DONE)))
            + fig(month_sum(month_OPEN), 'осталось · ' + month_pl(len(month_OPEN)))
            + '<a class="pc-month-fig pc-month-fig-debt" href="#"><span class="pc-month-fv">' + month_gel(month_DEBT) + '</span>'
            '<span class="pc-month-fl">' + month_mark('late', True) + 'Просрочено · весь долг по ' + str(len(month_LATE)) + (' аренде' if len(month_LATE) == 1 else ' арендам') + '</span>'
            '<span class="pc-month-fs">' + month_gel(late_week) + ' — эта неделя, ' + month_gel(month_DEBT - late_week) + ' — прошлая</span></a></div></div>')

def month_drow(r, block=False):
    s = r['state']
    name = '<span class="pc-month-dname">Клиент Пример ' + r['k'] + '</span>'
    if block:
        sub = r['moped'] + ' · ' + str(r['days']) + '&nbsp;дн. · ' + r['why']
        amt = '<span class="pc-month-damt pc-month-amt-late"><small>долг</small>' + month_gel(r['debt']) + '</span>'
        acts = month_acts(r, True)
    else:
        sub = r['moped'] + ' · <span class="pc-month-st-' + s + '">' + month_words(r) + '</span>'
        amt = '<span class="pc-month-damt">' + month_gel(r['rate']) + '</span>'
        # a late one has the buttons in «Просрочено», which is always on the screen above
        acts = month_acts(r, True) if s in ('due', 'exp') else ''
    return ('<div class="pc-month-drow">' + month_mark(s) + '<a class="pc-month-dwho' + ('' if acts else ' pc-month-dwide') + '" href="#">'
            + name + '<span class="pc-month-ds">' + sub + '</span></a>'
            + ('<span class="pc-month-dacts">' + acts + '</span>' if acts else '') + amt + '</div>')

def month_dsec(title, total, rows, late=False):
    if late:
        right = '<span class="pc-month-sh-n">' + total + '</span>'
    else:
        right = '<a class="pc-month-sh-n pc-month-lnk" href="#">' + total + '</a>'
    return ('<div class="pc-month-sec"><div class="pc-month-sh' + (' pc-month-sh-late' if late else '') + '"><h3>' + title + '</h3>' + right + '</div>'
            + rows + '</div>')

def month_side(sel):
    day, nxt = month_of(sel), month_of(sel + 1)
    late = month_dsec(month_mark('late') + 'Просрочено · ' + str(len(month_LATE)), 'долг ' + month_gel(month_DEBT),
                      ''.join(month_drow(r, True) for r in month_LATE)
                      + '<p class="pc-month-note">' + SORT_HINT + '.</p>', True)
    today = month_dsec(month_WDFULL[month_wd(sel)] + ', ' + month_dd(sel) + ' <span>· сегодня</span>',
                       month_pl(len(day)) + ' · ' + month_gel(month_sum(day)), ''.join(month_drow(r) for r in day))
    tomorrow = month_dsec('Завтра <span>· ' + month_WDFULL[month_wd(sel + 1)].lower() + ', ' + month_dd(sel + 1) + '</span>',
                          month_pl(len(nxt)) + ' · ' + month_gel(month_sum(nxt)), ''.join(month_drow(r) for r in nxt))
    return '<aside class="pc-month-side">' + late + today + tomorrow + '</aside>'

def month_desk_main(sel):
    left = month_dbar() + month_weekdays() + month_dgrid(sel) + month_dlegend()
    return dmain(month_week_card() + '<div class="pc-month-desk"><div>' + left + '</div>' + month_side(sel) + '</div>',
                 'календарь платежей · сегодня среда, 14.10')

def month_cap(title, gives, cost):
    # every frame has its own title, so the frames of one variant can be told apart by it
    return '<b>' + title + '.</b> ' + gives + ' Цена: ' + cost

def month_bands(letter, rec=False):
    p1 = phone(month_cap(letter + '. ' + month_NAME + (' — рекомендую' if rec else ''),
               'Телефон открывается на этой неделе: семь клеток, под числом — сумма за день и сколько оплат уже пришло, '
               'красный квадрат — есть просрочка, сегодня — лаймовая клетка. Ниже — кто платит в выбранный день. '
               + FORM_HINT + ' Строка «Завтра» показывает завтрашних. Стрелки листают недели, «Сегодня» возвращает к текущей.',
               'поимённо виден один день — остальные открываются нажатием на клетку.'),
               head('Деньги'), month_phone_body(14), tabbar('owner', 'money', 9))
    p2 = phone(month_cap(letter + ', должники',
               'Нажата «Показать» в красной строке: оба должника, старший долг первым, у каждого «Принять оплату» и звонок. '
               'Красная строка стоит на экране всегда, какой бы день ни был выбран.',
               'раскрытый блок сдвигает неделю и список дня вниз; должник, у которого срок сегодня, записан дважды — здесь и в списке дня.'),
               head('Деньги'), month_phone_body(14, debt_open=True), tabbar('owner', 'money', 9))
    p3 = phone(month_cap(letter + ', весь месяц',
               'Нажаты «Весь месяц» и пятница, 16.10: клетка обведена, сегодня остаётся лаймовым. В прошлых неделях — галочка '
               '«всё оплачено» или красный квадрат (07.10); в неделях впереди — только числа: там расчёт, и нажатие на такой день '
               'покажет тех же людей со словом «Ожидается». Под сеткой двое: «Ожидается» и «Оплачено заранее» с датой платежа; '
               'напоминание в WhatsApp есть только у тех, кто платит завтра.',
               'с открытым месяцем список дня начинается низко — второй человек виден после прокрутки; «Свернуть» возвращает одну неделю.'),
               head('Деньги'), month_phone_body(16, full=True), tabbar('owner', 'money', 9))
    d1 = desk(month_cap(letter + ' на ноутбуке',
              'Месяц виден целиком, а рядом три списка: «Просрочено» — всегда наверху, выбранный день (сейчас сегодня) '
              'и «Завтра» с кнопкой «Напомнить» (WhatsApp «Завтра оплата»). Суммы и отметки с числом оплат стоят только в строке этой недели; '
              'итог недели, долг и самый большой день — сверху; подчёркнутые суммы ведут в «Деньги → Платежи».',
              'аренду платят раз в неделю, поэтому четыре строки месяца из пяти почти пусты — в них видно только, где была просрочка. '
              'При 85 мопедах сетка та же и на ноутбуке, и на телефоне: в клетке около <span class="pc-month-nw">' + month_gel(1800) + '</span> '
              'и те же отметки с числами побольше (на телефоне «8 из 13»). Длиннее становится только список дня — около 12 человек: '
              '«Просрочено» и «Ждём сегодня» стоят всегда, оплаченные сворачиваются в строку «Оплачено · 8» с кнопкой «Показать».'),
              rail('money', 'owner', 9), month_desk_main(14))
    return [(letter + '. ' + month_NAME + ' — телефон', p1 + p2 + p3),
            (letter + '. ' + month_NAME + ' — ноутбук', d1)]


# ====================================================================================================
# The page: five concepts, the recommended one first
# ====================================================================================================
# Every concept draws more states than a first choice needs (a past day, the end of a long list, the
# same screen at 85 mopeds). The page therefore shows the main phone screen of all five side by side,
# then for each concept its laptop screen and at most two more phone states, each under a short caption
# of the page's own. The concepts' long captions stay in their code above, and the frames left out are
# still built by <key>_bands: they come back when one variant is chosen.
import re

def frames_of(bands):
    return re.findall(r'<figure class="f.*?</figure>', ''.join(c for _, c in bands), flags=re.S)

def cap(fig, text):
    return re.sub(r'<figcaption>.*?</figcaption>', lambda m: '<figcaption>' + text + '</figcaption>', fig, count=1, flags=re.S)

fA = frames_of(weekstrip_bands('А', True))   # phones 0-5, laptop 6
fB = frames_of(agenda_bands('Б'))            # phones 0-4, laptop 5
fV = frames_of(wild_bands('В'))              # phones 0-2, laptop 3
fG = frames_of(matrix_bands('Г'))            # phones 0-2, laptops 3-4
fD = frames_of(month_bands('Д'))             # phones 0-2, laptop 3
assert [len(f) for f in (fA, fB, fV, fG, fD)] == [7, 6, 4, 5, 4]
assert all('class="f wide"' in f for f in (fA[6], fB[5], fV[3], fG[3], fD[3]))
assert not any('class="f wide"' in f for f in (fA[0], fA[1], fA[2], fB[0], fB[1], fB[2], fV[0], fV[1], fV[2], fG[0], fD[0], fD[2]))

LEAD = ('Выбираем, как будет выглядеть новая вкладка «Календарь» в «Деньгах». Пять вариантов на одном и том же примере '
        'из двенадцати аренд: сначала все пять рядом на телефоне, потом каждый — на ноутбуке. '
        'Рекомендую А, «Полосу недели».')

OVERVIEW = (
 cap(fA[0], '<b>А. Полоса недели — рекомендую.</b> Сверху неделя семью плитками: день и сумма. Ниже — кто платит в выбранный день, '
            'у каждого «Принять оплату». Должники — красной строкой, она всегда на экране. '
            'Цена: с кнопками виден один день, остальные — по нажатию на плитку.') +
 cap(fB[0], '<b>Б. Неделя списком.</b> Читается сверху вниз, как список дел: итог недели, должники, сегодня, завтра и дальше. '
            'Цена: дни идут друг под другом — всю неделю и самый тяжёлый день видно только прокруткой.') +
 cap(fV[0], '<b>В. Очередь оплат.</b> Люди сложены не по дням, а по срочности: просрочено, ждём сегодня, впереди, оплачено. '
            'Цена: на календарь похож меньше всех; что было в прошедший день, целиком не увидеть.') +
 cap(fG[0], '<b>Г. Сетка аренд.</b> На телефоне — та же очередь по срочности под плитками недели; сама сетка есть только на ноутбуке. '
            'Цена: на телефоне почти не отличается от В.') +
 cap(fD[0], '<b>Д. Месяц сеткой.</b> Привычный календарь. На телефоне открывается строкой этой недели, месяц — по кнопке «Весь месяц». '
            'Цена: аренду платят раз в неделю, и месяц почти ничего не добавляет к неделе.'))

BANDS = [
 ('Сначала — все пять рядом: главный экран на телефоне', OVERVIEW),

 ('А. Полоса недели — ноутбук', cap(fA[6],
  '<b>А на ноутбуке — рекомендую.</b> Вся неделя раскрыта семью колонками, сегодня — лаймовая. Сверху четыре итога недели: '
  'должно прийти, оплачено, осталось, просрочено. Нажимать ничего не нужно; «Принять оплату» — прямо в карточке.')),
 ('А. Полоса недели — ещё два экрана телефона',
  cap(fA[1], '<b>А · должники.</b> Нажали «Показать» в красной строке: все, кто просрочил, — с долгом, звонком и «Принять оплату».') +
  cap(fA[2], '<b>А · другой день.</b> Нажали на плитку четверга: кто платит завтра; у каждого «Напомнить» — готовое сообщение в WhatsApp.')),

 ('Б. Неделя списком — ноутбук', cap(fB[5],
  '<b>Б на ноутбуке.</b> Слева неделя одним списком по дням, справа — итоги недели и должники с кнопками. '
  'Цена: неделя читается как длинный список, а не как календарь.')),
 ('Б. Неделя списком — ещё два экрана телефона',
  cap(fB[1], '<b>Б · тот же экран ниже.</b> Завтра и следующие дни: у каждого дня число оплат и сумма.') +
  cap(fB[2], '<b>Б · конец списка.</b> Прошедшие дни сложены в одну строку с итогом и открываются кнопкой «Показать».')),

 ('В. Очередь оплат — ноутбук', cap(fV[3],
  '<b>В на ноутбуке.</b> Три колонки: кого догонять и кого ждём сегодня, кто впереди, кто оплатил. Сверху итоги недели и столбики по дням. '
  'Цена: дни видны только столбиками сверху.')),
 ('В. Очередь оплат — ещё два экрана телефона',
  cap(fV[1], '<b>В · тот же экран ниже.</b> «Впереди» разложено по дням.') +
  cap(fV[2], '<b>В · конец экрана.</b> Оплатившие — отдельным списком, он открывается кнопкой «Показать».')),

 ('Г. Сетка аренд — ноутбук', cap(fG[3],
  '<b>Г на ноутбуке.</b> Таблица: аренды строками, дни недели столбцами, значок стоит под днём оплаты. '
  'Цена: читается дольше остальных; чтобы увидеть всех, сложенные строки нужно раскрывать.')),

 ('Д. Месяц сеткой — ноутбук', cap(fD[3],
  '<b>Д на ноутбуке.</b> Слева месяц целиком, справа списки: просрочено, выбранный день, завтра. '
  'Цена: четыре строки месяца из пяти почти пустые — в них видно только, где была просрочка.')),
 ('Д. Месяц сеткой — телефон, весь месяц',
  cap(fD[2], '<b>Д · весь месяц.</b> Нажали «Весь месяц» и пятницу: суммы есть только у этой недели, '
             'в прошлых видно лишь, всё ли было оплачено.')),
]

NOTES = (
 '<h2>Что выбрать</h2><p style="max-width:1000px">'
 '<b>Рекомендую А, «Полосу недели»</b>: неделя видна сразу, под ней — те, кто платит в выбранный день, с крупными кнопками; '
 'на ноутбуке вся неделя раскрыта без нажатий. Остальные — если важнее другое: '
 '<b>Б</b> — если удобнее читать неделю сверху вниз, как список дел. '
 '<b>В</b> — если главный вопрос «с кого брать деньги прямо сейчас»; на календарь похож меньше всех. '
 '<b>Г</b> — если на ноутбуке нужна таблица «аренды × дни». '
 '<b>Д</b> — если важен привычный вид месяца.</p>'
 '<h2>Что ещё решить</h2><ol style="max-width:1000px">'
 '<li><b>В день оплаты аренда — «Ждём сегодня» или уже «Просрочено»?</b> Рекомендую: «Ждём сегодня», просрочка — со следующего дня, '
 'одинаково на всех экранах. Сейчас система считает аренду просроченной с утра дня оплаты. '
 '(Кто уже должен за прошлую неделю, у того и новая неделя сразу идёт в долг — как у Клиента Пример М.)</li>'
 '<li><b>Календарь видят только владельцы или и менеджеры?</b> Рекомендую: пока только владельцы, как весь раздел «Деньги».</li>'
 '<li><b>Вкладка «Календарь» первая в «Деньгах» или после «Платежей»?</b> Рекомендую: первая.</li></ol>'
 '<h2>Важно</h2><p style="max-width:1000px">Календарь правдив настолько, насколько внесены оплаты. Пока оплаты не вносятся '
 'в систему каждый день, он будет показывать долги, которых на самом деле нет.</p>'
 '<h2>Чего в календаре нет</h2><p style="max-width:1000px">Расходов, залогов и закупок (у них в системе нет срока оплаты), '
 'приостановленных, спорных и возвращённых аренд; рассрочки по продажам можно добавить позже отдельной строкой.</p>'
 '<h2>Что осталось за кадром</h2><p style="max-width:1000px">У каждого варианта нарисованы и другие экраны: прошедший день, '
 'конец длинного списка, тот же экран при 85 мопедах. Покажу их для выбранного варианта.</p>')

page('payments-calendar-options.html', 'Календарь платежей · как показать', LEAD,
 [('Запрос', 'Mika, 11.10.2026: «в разделе деньги календарь платежей — ясный, понятный и лёгкий в использовании»'),
  ('Где', 'Деньги → новая вкладка «Календарь», первая в ряду. Видят владельцы.'),
  ('Что показывает', 'Недельную оплату идущих аренд: кто в какой день платит, что уже оплачено и что просрочено; расходов и залогов здесь нет.'),
  ('Данные', 'Пример: клиенты, номера аренд и платежи выдуманы. Как в жизни — правило (неделя — 7 дней от дня выдачи, у каждого свой день оплаты) '
             'и порядок ставок. «Сегодня» на всех экранах — среда, 14.10.2026.')],
 BANDS, NOTES)

# The page's own styles, after the shared ones: Inter (it carries the Cyrillic), then each concept's classes.
INTER = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap">'
out = OUT / 'payments-calendar-options.html'
# A laptop figure may shrink with the window, so its own strip scrolls sideways instead of the whole page.
PAGE_CSS = """
figure.f.wide { min-width: 0; max-width: 100%; }
"""
out.write_text(out.read_text().replace('</head>', INTER + '<style>' + PAGE_CSS + weekstrip_CSS + agenda_CSS + wild_CSS + matrix_CSS + month_CSS + '</style></head>', 1))
assert '<script' not in out.read_text()
