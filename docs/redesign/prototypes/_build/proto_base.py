# Shared pieces for the EV8 Ops redesign prototypes. Static HTML + CSS, no JavaScript.
import re, pathlib
ROOT = pathlib.Path(__file__).resolve().parents[4]  # docs/redesign/prototypes/_build -> repo root
OUT = ROOT / 'docs/redesign/prototypes'
TOKENS = (ROOT / 'apps/web/src/styles/tokens.css').read_text()
TOKENS = re.sub(r'/\*.*?\*/', '', TOKENS, flags=re.S)
TOKENS = '\n'.join(l.rstrip() for l in TOKENS.splitlines() if l.strip())

PROPOSAL = """
/* ===== ПРЕДЛОЖЕНИЕ дизайнера — blueprint §3.4. Нет в packages/shared/tokens.json, пока А3 не утверждён ===== */
:root {
  --line-control: #7a7a7a;
  --focus-ring: 0 0 0 3px #e0ffa2, 0 0 0 5px #557553;
  --toast: #0b0b0b; --toast-ink: #ffffff; --toast-action: #e0ffa2;
  --control-large: 52px; --touch-gap: 8px;
  --header-h: 56px; --tabbar-h: 64px; --action-bar-h: 76px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-5: 24px; --space-6: 32px;
  --text-money-lg: 500 22px/1.2 var(--mono);
  --text-tab: 500 12px/1.15 var(--display);
  --icon-size: 24px; --icon-stroke: 1.75px;
}
"""

CSS = """
* { box-sizing: border-box; }
html, body { margin: 0; }
body { font: var(--text-body); color: var(--ink); background: #e9e9e9; }
a { color: inherit; text-decoration: none; }
.t-num { font-variant-numeric: tabular-nums; }
.mono { font-family: var(--mono); }
.muted { color: var(--muted); }
.crit { color: var(--crit-ink); }
.ok { color: var(--accent); }
svg.i { width: 24px; height: 24px; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; flex: none; }
svg.i.s { width: 18px; height: 18px; }

/* ---- document chrome around the frames ---- */
.doc { max-width: 1320px; margin: 0 auto; padding: 32px 32px 8px; }
.doc .back { font: var(--text-label); color: var(--accent); }
.doc h1 { font: 500 30px/1.15 var(--display); letter-spacing: var(--tracking-tight); margin: 10px 0 8px; }
.doc .lead { max-width: 900px; margin: 0 0 14px; }
.doc .demo { display: inline-block; background: var(--lime); padding: 2px 10px; border-radius: 999px; font: var(--text-overline); margin-right: 8px; }
.meta { display: grid; grid-template-columns: 170px 1fr; gap: 4px 16px; max-width: 1000px; font: var(--text-body-sm); margin: 0 0 8px; }
.meta dt { color: var(--muted); }
.meta dd { margin: 0; }
.band { max-width: 1320px; margin: 0 auto; padding: 16px 32px; }
.band > h2 { font: 500 20px/1.2 var(--display); letter-spacing: var(--tracking-tight); margin: 18px 0 12px; }
.frames { display: flex; flex-wrap: wrap; gap: 28px; align-items: flex-start; }
figure.f { margin: 0; }
figure.f > figcaption { font: var(--text-body-sm); max-width: 375px; margin: 10px 4px 0; }
figure.f > figcaption b { font-weight: 600; }
figure.wide > figcaption { max-width: 900px; }
.notes { max-width: 1320px; margin: 0 auto; padding: 8px 32px 48px; }
.notes h2 { font: 500 20px/1.2 var(--display); margin: 18px 0 8px; }
.notes table { border-collapse: collapse; background: #fff; font: var(--text-body-sm); max-width: 1100px; }
.notes th, .notes td { text-align: left; vertical-align: top; padding: 8px 12px; border-bottom: 1px solid var(--line-soft); }
.notes th { font: var(--text-overline); color: var(--muted); }
.notes ul { max-width: 1000px; }

/* ---- phone ---- */
.phone { width: 395px; height: 800px; border: 10px solid #0b0b0b; border-radius: 44px; overflow: hidden; position: relative; background: var(--bg); }
.ph-head { position: absolute; top: 0; left: 0; right: 0; height: var(--header-h); display: flex; align-items: center; gap: 2px; padding: 0 8px 0 16px; background: var(--bg); border-bottom: 1px solid var(--line-soft); z-index: 3; }
.ph-head .title { font: var(--text-h1-phone); letter-spacing: var(--tracking-tight); flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ph-head .sub { font: var(--text-label); color: var(--muted); margin-left: 8px; }
.icon-btn { width: 44px; height: 44px; display: inline-grid; place-items: center; border-radius: 50%; color: var(--ink); flex: none; }
.avatar { width: 32px; height: 32px; border-radius: 50%; background: var(--ink); color: var(--lime); display: grid; place-items: center; font: 600 14px/1 var(--display); }
.ph-body { position: absolute; top: var(--header-h); bottom: var(--tabbar-h); left: 0; right: 0; overflow-y: auto; padding: 12px 16px 24px; }
.ph-body.no-tabs { bottom: 0; }
.ph-body.with-bar { bottom: calc(var(--tabbar-h) + var(--action-bar-h)); }
.ph-body.bar-only { bottom: var(--action-bar-h); }
.tabbar { position: absolute; bottom: 0; left: 0; right: 0; height: var(--tabbar-h); display: grid; grid-template-columns: repeat(5, 1fr); background: var(--surface); border-top: 1px solid var(--line-soft); z-index: 3; }
.tab { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; font: var(--text-tab); color: var(--muted); text-align: center; padding: 4px 2px; }
.tab .ic { display: grid; place-items: center; width: 52px; height: 28px; border-radius: 999px; }
.tab.on { color: var(--ink); }
.tab.on .ic { background: var(--lime); }
.tab .badge { position: absolute; top: 4px; left: calc(50% + 6px); }
.tab-plus { display: grid; place-items: center; }
.plus { width: var(--control-large); height: var(--control-large); border-radius: 50%; background: var(--accent); color: var(--on-accent); display: grid; place-items: center; margin-top: -20px; box-shadow: 0 6px 18px rgba(11,11,11,.22); border: 3px solid var(--surface); }
.badge { min-width: 18px; height: 18px; border-radius: 9px; background: var(--crit); color: #fff; font: 600 11px/18px var(--body); padding: 0 5px; text-align: center; }
.action-bar { position: absolute; left: 0; right: 0; bottom: var(--tabbar-h); height: var(--action-bar-h); padding: 12px 16px; background: var(--surface); border-top: 1px solid var(--line-soft); display: flex; gap: 8px; z-index: 2; }
.action-bar.bottom { bottom: 0; }
.syncbar { position: absolute; top: var(--header-h); left: 0; right: 0; min-height: 36px; background: var(--surface-2); display: flex; align-items: center; gap: 8px; padding: 6px 16px; font: var(--text-label); z-index: 2; }
.syncbar + .ph-body { top: calc(var(--header-h) + 36px); }

/* ---- buttons ---- */
.btn { min-height: var(--control); border-radius: var(--radius-pill); padding: 0 18px; font: var(--text-button); letter-spacing: var(--tracking-button); display: inline-flex; align-items: center; justify-content: center; gap: 8px; border: var(--hairline) solid var(--ink); background: var(--surface); color: var(--ink); white-space: nowrap; }
.btn-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.btn-lg { min-height: var(--control-large); font: var(--text-cta); letter-spacing: var(--tracking-tight); flex: 1; }
.btn-sm { min-height: var(--control-dense); padding: 0 12px; font: var(--text-button-sm); }
.btn-quiet { border-color: transparent; background: transparent; }
.btn-round { width: var(--control); padding: 0; }
.btn[aria-disabled] { opacity: .55; }
.btn.sending { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn.failed { background: var(--surface); color: var(--crit-ink); border-color: var(--crit); }

/* ---- pills ---- */
.st { display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: 999px; font: 500 12px/1 var(--display); white-space: nowrap; }
.mk { width: 8px; height: 8px; display: inline-block; background: currentColor; border-radius: 50%; flex: none; }
.st-available, .st-active { background: var(--accent-soft); color: var(--accent-ink); }
.st-rented, .st-booked { background: var(--info-soft); color: var(--rented-ink); }
.st-rented .mk { border-radius: 2px; }
.st-service, .st-paused { background: var(--warn-soft); color: var(--service-deep); }
.st-service .mk { border-radius: 0; transform: rotate(45deg); width: 7px; height: 7px; }
.st-out, .st-overdue, .st-disputed { background: var(--crit-soft); color: var(--crit-ink); }
.st-out .mk, .st-overdue .mk { border-radius: 0; }
.st-sold, .st-returned { background: var(--surface-2); color: var(--grey-ink); }
.st-sold .mk { background: transparent; border: 2px solid currentColor; }
.st-waiting { background: var(--surface); color: var(--ink); border: 1px solid var(--line-control); }
.st-waiting .mk { background: transparent; border: 2px solid currentColor; }
.chip { display: inline-flex; align-items: center; gap: 6px; min-height: var(--control-dense); padding: 0 12px; border: 1px solid var(--line-control); border-radius: 999px; background: var(--surface); font: var(--text-button-sm); white-space: nowrap; }
.chip.on { background: var(--ink); color: var(--surface); border-color: var(--ink); }
.chip .n { font: 500 12px/1 var(--mono); color: var(--muted); }
.chip.on .n { color: var(--lime); }
.chips { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; margin: 0 -16px 8px; padding-left: 16px; padding-right: 16px; }

/* ---- blocks ---- */
.card { background: var(--surface); border-radius: var(--radius-card); padding: var(--card-pad); margin-bottom: 8px; }
.grp { display: flex; justify-content: space-between; align-items: baseline; margin: 18px 2px 8px; }
.grp:first-child { margin-top: 4px; }
.grp h3 { margin: 0; font: var(--text-overline); letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.grp .cnt { font: var(--text-label); color: var(--muted); }
.qrow { background: var(--surface); border-radius: var(--radius-card); padding: 12px 14px; margin-bottom: 8px; display: grid; grid-template-columns: 1fr auto; gap: 2px 12px; }
.qrow.t-crit { box-shadow: inset 3px 0 0 var(--crit); }
.qrow.t-warn { box-shadow: inset 3px 0 0 var(--service); }
.qrow.t-decide { box-shadow: inset 3px 0 0 var(--accent); }
.q-who { font: 500 15px/1.3 var(--body); grid-column: 1; }
.q-why { grid-column: 1; }
.qrow.nosum { grid-template-columns: 1fr; }
.q-why { font: var(--text-label); color: var(--muted); }
.q-sum { font: var(--text-money-lg); font-variant-numeric: tabular-nums; text-align: right; grid-row: 1 / span 2; grid-column: 2; align-self: center; }
.q-acts { grid-column: 1 / -1; display: flex; gap: 8px; margin-top: 10px; align-items: center; }
.q-acts .btn-primary { flex: 1; }
.q-more { display: block; text-align: center; font: var(--text-button-sm); color: var(--accent); padding: 10px; }
.vin { font: var(--text-mono); letter-spacing: .02em; }
.vin b { font-weight: 600; background: var(--lime); padding: 0 2px; border-radius: 3px; color: var(--ink); }
.nums { display: flex; gap: 8px; overflow-x: auto; margin: 0 -16px; padding: 0 16px 4px; }
.num { flex: none; min-width: 104px; background: var(--surface); border-radius: var(--radius-card); padding: 10px 12px; }
.num .v { font: 500 20px/1.2 var(--mono); font-variant-numeric: tabular-nums; }
.num .l { font: var(--text-label); color: var(--muted); white-space: nowrap; }
.date { font: var(--text-label); color: var(--muted); margin: 0 2px 6px; }
.kv { display: grid; grid-template-columns: auto 1fr; gap: 8px 16px; font: var(--text-body-sm); }
.kv dt { color: var(--muted); }
.kv dd { margin: 0; text-align: right; }
.hero { font: var(--text-display); letter-spacing: var(--tracking-tight); font-family: var(--mono); font-variant-numeric: tabular-nums; }
.hr { height: 1px; background: var(--line-soft); margin: 12px 0; }
.sheet-scrim { position: absolute; inset: 0; background: var(--scrim-soft); z-index: 5; }
.sheet { position: absolute; left: 0; right: 0; bottom: 0; background: var(--surface); border-radius: 20px 20px 0 0; padding: 8px 16px 20px; z-index: 6; box-shadow: var(--shadow); }
.sheet .grab { width: 40px; height: 4px; border-radius: 2px; background: var(--line-soft); margin: 0 auto 10px; }
.sheet h4 { font: var(--text-h2); margin: 4px 0 12px; }
.act-list a { display: flex; align-items: center; gap: 14px; min-height: 52px; border-bottom: 1px solid var(--line-soft); font: 500 16px/1.2 var(--display); }
.act-list a:last-child { border-bottom: 0; }
.act-list .ico { width: 40px; height: 40px; border-radius: 50%; background: var(--accent-soft); color: var(--accent-ink); display: grid; place-items: center; }
.toast { position: absolute; left: 12px; right: 12px; bottom: calc(var(--tabbar-h) + 12px); background: var(--toast); color: var(--toast-ink); border-radius: 14px; padding: 12px 14px; display: flex; align-items: center; gap: 12px; font: var(--text-body-sm); z-index: 7; overflow: hidden; }
.toast a { color: var(--toast-action); font-weight: 600; margin-left: auto; }
.toast .drain { position: absolute; left: 0; bottom: 0; height: 3px; width: 64%; background: var(--toast-action); }
.field { display: block; margin-bottom: 14px; }
.field > .lbl { display: block; font: var(--text-label); color: var(--muted); margin: 0 2px 6px; }
.input { min-height: var(--control); padding: 0 14px; border-radius: 12px; border: 1px solid var(--line-control); background: var(--surface); display: flex; align-items: center; gap: 8px; font: var(--text-body); }
.input.focus { box-shadow: var(--focus-ring); border-color: var(--accent); }
.input .ph { color: var(--muted); }
.input.err { border-color: var(--crit); }
.ferr { font: var(--text-label); color: var(--crit-ink); margin: 6px 2px 0; }
.hint { font: var(--text-label); color: var(--muted); margin: 6px 2px 0; }
.seg3 { display: grid; grid-template-columns: repeat(3, 1fr); border: 1px solid var(--line-control); border-radius: 12px; overflow: hidden; }
.seg3 span { min-height: 44px; display: grid; place-items: center; font: var(--text-button-sm); border-right: 1px solid var(--line-soft); text-align: center; padding: 0 4px; }
.seg3 span:last-child { border-right: 0; }
.seg3 span.on { background: var(--accent-soft); color: var(--accent-ink); font-weight: 600; }
.seg3 span.on.bad { background: var(--crit-soft); color: var(--crit-ink); }
.seg3 span.on.warn { background: var(--warn-soft); color: var(--service-deep); }
.steps { display: flex; gap: 6px; align-items: center; margin: 2px 2px 12px; font: var(--text-label); color: var(--muted); }
.steps i { width: 22px; height: 4px; border-radius: 2px; background: var(--line-soft); }
.steps i.done { background: var(--accent); }
.steps i.cur { background: var(--ink); }
.steps span { margin-left: auto; }
.lcard { background: var(--surface); border-radius: var(--radius-card); padding: 12px 14px; margin-bottom: 8px; display: grid; grid-template-columns: 1fr auto; gap: 4px 10px; }
.lcard .a { font: 500 15px/1.3 var(--body); }
.lcard .b { font: var(--text-label); color: var(--muted); }
.lcard .r { text-align: right; }
.money { font: var(--text-money); font-variant-numeric: tabular-nums; }
.in { color: var(--accent-ink); }
.out { color: var(--ink); }
.banner { border-radius: 12px; padding: 10px 12px; font: var(--text-body-sm); display: flex; gap: 10px; align-items: flex-start; margin-bottom: 12px; }
.banner.crit { background: var(--crit-soft); color: var(--crit-ink); }
.banner.warn { background: var(--warn-soft); color: var(--service-deep); }
.banner.info { background: var(--surface-2); color: var(--ink); }
.banner.ok { background: var(--accent-soft); color: var(--accent-ink); }
.skel { background: var(--surface-2); border-radius: 8px; height: 14px; margin: 6px 0; }
.empty { text-align: center; padding: 48px 12px; }
.empty .big { width: 56px; height: 56px; border-radius: 50%; background: var(--accent-soft); color: var(--accent-ink); display: grid; place-items: center; margin: 0 auto 12px; }
.empty h4 { font: var(--text-h2); margin: 0 0 6px; }
.empty p { font: var(--text-label); color: var(--muted); margin: 0 0 16px; }
.photo { width: 72px; height: 72px; border-radius: 12px; background: repeating-linear-gradient(45deg, var(--surface-2), var(--surface-2) 6px, #e7e7e7 6px, #e7e7e7 12px); display: grid; place-items: center; color: var(--muted); font: var(--text-label); }
.photo.add { background: var(--surface); border: 1px dashed var(--line-control); }
.photos { display: flex; gap: 8px; flex-wrap: wrap; }
.strip { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 3px; }
.strip i { height: 26px; border-radius: 6px; display: grid; place-items: center; font: 500 11px/1 var(--mono); font-style: normal; }
.s-paid { background: var(--accent); color: var(--on-accent); }
.s-late { background: var(--crit); color: var(--on-accent); }
.s-cur { background: var(--lime); border: 1px solid var(--accent); }
.s-ahead { background: var(--surface-2); color: var(--muted); }
.tl { list-style: none; margin: 0; padding: 0; }
.tl li { display: grid; grid-template-columns: 12px 1fr; gap: 10px; padding: 0 0 14px; position: relative; font: var(--text-body-sm); }
.tl li::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--accent); margin-top: 6px; }
.tl li::after { content: ""; position: absolute; left: 3.5px; top: 18px; bottom: 0; width: 1px; background: var(--line-soft); }
.tl li:last-child::after { display: none; }
.tl .when { font: var(--text-label); color: var(--muted); }
.lang-row { display: flex; gap: 6px; }
.lang-row span { min-width: 44px; min-height: 34px; border-radius: 999px; border: 1px solid var(--line-control); display: grid; place-items: center; font: var(--text-button-sm); }
.lang-row span.on { background: var(--lime); border-color: var(--lime); }

/* ---- laptop ---- */
.desk { width: 1280px; height: 800px; border: 1px solid #cfcfcf; border-radius: 12px; overflow: hidden; background: var(--bg); display: grid; grid-template-columns: var(--rail-w) 1fr; box-shadow: 0 8px 30px rgba(0,0,0,.08); }
.desk-wrap { max-width: 100%; overflow-x: auto; }
.rail { background: var(--rail); color: var(--rail-ink); padding: 18px 12px; display: flex; flex-direction: column; gap: 4px; }
.rail .logo { font: 700 22px/1 var(--display); color: #fff; letter-spacing: -.02em; padding: 0 8px 14px; }
.rail .logo small { font: 500 11px/1 var(--display); background: var(--lime); color: var(--ink); padding: 2px 6px; border-radius: 999px; vertical-align: middle; margin-left: 4px; }
.rail .cta { min-height: 40px; border-radius: 999px; background: var(--accent); color: #fff; display: flex; align-items: center; justify-content: center; gap: 6px; font: var(--text-button); margin: 0 0 8px; }
.rail .search { min-height: 36px; border-radius: 999px; border: 1px solid var(--rail-line); display: flex; align-items: center; gap: 8px; padding: 0 12px; font: var(--text-label); color: #9aa39a; margin-bottom: 8px; }
.rail .search kbd { margin-left: auto; font: 500 11px/1 var(--mono); border: 1px solid var(--rail-line); border-radius: 4px; padding: 2px 5px; }
.rail .g { font: 500 11px/1 var(--display); letter-spacing: .08em; text-transform: uppercase; color: #7f887f; padding: 12px 10px 4px; }
.rail a.it { display: flex; align-items: center; gap: 10px; min-height: 34px; padding: 0 10px; border-radius: 999px; font: var(--text-button); }
.rail a.it svg { width: 18px; height: 18px; }
.rail a.it.on { background: var(--rail-accent); color: var(--ink); }
.rail a.it .badge { margin-left: auto; }
.rail .foot { margin-top: auto; display: flex; align-items: center; gap: 10px; padding: 10px 6px 0; border-top: 1px solid var(--rail-line); font: var(--text-label); }
.main { overflow: hidden; display: flex; flex-direction: column; }
.d-head { display: flex; align-items: baseline; gap: 12px; padding: 22px 32px 8px; }
.d-head h2 { font: var(--text-h1); letter-spacing: var(--tracking-tight); margin: 0; }
.d-head .sub { font: var(--text-label); color: var(--muted); }
.d-head .acts { margin-left: auto; display: flex; gap: 8px; align-self: center; }
.d-tabs { display: flex; gap: 4px; padding: 0 32px; border-bottom: 1px solid var(--line-soft); }
.d-tabs a { padding: 10px 12px; font: var(--text-button); color: var(--muted); border-bottom: 2px solid transparent; display: flex; gap: 6px; align-items: center; }
.d-tabs a.on { color: var(--ink); border-color: var(--ink); }
.d-tabs .n { font: 500 12px/1 var(--mono); background: var(--surface-2); padding: 3px 6px; border-radius: 999px; }
.d-body { padding: 16px 32px 32px; overflow: auto; flex: 1; }
.cols { display: grid; gap: 24px; }
.table { width: 100%; border-collapse: collapse; background: var(--surface); border-radius: var(--radius-card); overflow: hidden; font: var(--text-body-sm); }
.table th { text-align: left; font: var(--text-overline); letter-spacing: .04em; color: var(--muted); padding: 10px 12px; border-bottom: 1px solid var(--line); white-space: nowrap; }
.table td { padding: 10px 12px; border-bottom: 1px solid var(--line-soft); vertical-align: middle; }
.table tr:last-child td { border-bottom: 0; }
.table td.r, .table th.r { text-align: right; }
.table tr.sel td { background: var(--surface-2); }
.toolbar { display: flex; gap: 8px; align-items: center; margin: 0 0 12px; flex-wrap: wrap; }
.toolbar .input { min-height: var(--control-dense); min-width: 280px; }
.panel { position: absolute; top: 0; right: 0; bottom: 0; width: 420px; background: var(--surface); box-shadow: var(--shadow); padding: 20px 24px; overflow: auto; }
.rel { position: relative; }
.h3 { font: var(--text-h2); margin: 0 0 10px; }
.small { font: var(--text-label); }
"""

FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Noto+Sans+Georgian:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap">'

ICONS = {
 'today': '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/><path d="m9 15 2 2 4-4"/>',
 'rentals': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/>',
 'money': '<path d="M20 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-3"/><path d="M21 9h-5a3 3 0 0 0 0 6h5z"/>',
 'fleet': '<circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M8.5 17h7l-2.5-8h3.5M13 9l-3 4H5.5"/>',
 'cash': '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
 'plus': '<path d="M12 5v14M5 12h14"/>',
 'search': '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
 'phone': '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
 'chat': '<path d="M21 11.5a8.5 8.5 0 0 1-12.6 7.4L3 20.5l1.6-5A8.5 8.5 0 1 1 21 11.5z"/>',
 'cloud': '<path d="m2 2 20 20"/><path d="M5.8 8.7A5 5 0 0 0 6.5 19H17"/><path d="M9.5 5.2A6 6 0 0 1 18 9.5a4.5 4.5 0 0 1 3 7.2"/>',
 'check': '<path d="m5 12.5 4.5 4.5L19 7"/>',
 'right': '<path d="m9 6 6 6-6 6"/>',
 'left': '<path d="m15 6-6 6 6 6"/>',
 'dots': '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
 'wrench': '<path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3 17 4l3 3-2.3 2.3"/>',
 'box': '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="m3 7.5 9 4.5 9-4.5M12 12v9"/>',
 'chart': '<path d="M3 21h18M6 17v-6M11 17V5M16 17v-9M21 17v-3"/>',
 'gear': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
 'bag': '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
 'truck': '<path d="M2 6h12v10H2zM14 10h4l4 4v2h-8"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>',
 'user': '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 'camera': '<path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
 'file': '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
 'clock': '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 'x': '<path d="M6 6l12 12M18 6 6 18"/>',
 'in': '<path d="M17 7 7 17M7 9v8h8"/>',
 'out': '<path d="M7 17 17 7M9 7h8v8"/>',
 'sort': '<path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/>',
 'return': '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
 'key': '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m10.7 12.3 9.8-9.8M17 6l3 3M14 9l2 2"/>',
 'battery': '<rect x="2" y="7" width="17" height="10" rx="2"/><path d="M22 11v2M6 10v4M10 10v4"/>',
 'pin': '<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
 'alert': '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
 'lock': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
 'undo': '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
 'send': '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
 'swap': '<path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>',
}

def ic(name, cls='i'):
    return f'<svg class="{cls}" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>'

def vin(tail, head='DEMO0000000'):
    # 17 chars total: DEMO + zeros + last 4 highlighted
    pad = 17 - len(head) - len(tail)
    return f'<span class="vin">{head}{"0"*pad}<b>{tail}</b></span>'

def st(kind, word):
    return f'<span class="st st-{kind}"><i class="mk"></i>{word}</span>'

TABS = {
 'owner':   [('today','Сегодня','today'), ('rentals','Аренды','rentals'), None, ('money','Деньги','money'), ('fleet','Парк','fleet')],
 'manager': [('today','Сегодня','today'), ('rentals','Аренды','rentals'), None, ('fleet','Парк','fleet'), ('cash','Касса','cash')],
 'owner_ka':   [('today','დღეს','today'), ('rentals','ქირაობა','rentals'), None, ('money','ფული','money'), ('fleet','პარკი','fleet')],
}

def tabbar(role='owner', on='today', badge=None, plus_href='#'):
    cells = []
    for t in TABS[role]:
        if t is None:
            cells.append(f'<a class="tab-plus" href="{plus_href}" aria-label="Действия"><span class="plus">{ic("plus")}</span></a>')
            continue
        key, label, icon = t
        b = f'<span class="badge">{badge}</span>' if (badge and key == 'today') else ''
        cells.append(f'<a class="tab{" on" if key == on else ""}" href="#"><span class="ic">{ic(icon)}</span>{label}{b}</a>')
    return '<nav class="tabbar">' + ''.join(cells) + '</nav>'

def head(title, sub='', left=None, right='search avatar', initial='K'):
    l = ''
    if left == 'back':
        l = f'<a class="icon-btn" href="#" style="margin-left:-12px">{ic("left")}</a>'
    elif left == 'close':
        l = f'<a class="icon-btn" href="#" style="margin-left:-12px">{ic("x")}</a>'
    r = ''
    if 'search' in right:
        r += f'<a class="icon-btn" href="#">{ic("search")}</a>'
    if 'dots' in right:
        r += f'<a class="icon-btn" href="#">{ic("dots")}</a>'
    if 'avatar' in right:
        r += f'<a class="icon-btn" href="#"><span class="avatar">{initial}</span></a>'
    s = f'<span class="sub">{sub}</span>' if sub else ''
    return f'<header class="ph-head">{l}<span class="title">{title}{s}</span>{r}</header>'

def phone(caption, header, body, tabs='', bar='', overlay='', body_cls='', sync='', fid=''):
    idattr = f' id="{fid}"' if fid else ''
    return (f'<figure class="f"{idattr}><div class="phone">{header}{sync}<main class="ph-body {body_cls}">{body}</main>'
            f'{bar}{tabs}{overlay}</div><figcaption>{caption}</figcaption></figure>')

RAIL_ITEMS = [
 ('Работа', [('today','Сегодня','today'),('rentals','Аренды','rentals'),('fleet','Парк','fleet'),('service','Сервис','wrench')]),
 ('Деньги', [('money','Деньги','money'),('sales','Продажи','bag'),('purchases','Закупки','truck')]),
 ('Управление', [('reports','Отчёты','chart'),('settings','Настройки','gear')]),
]
RAIL_MANAGER = [
 ('Работа', [('today','Сегодня','today'),('rentals','Аренды','rentals'),('fleet','Парк','fleet'),('service','Сервис','wrench')]),
 ('Деньги', [('cash','Касса','cash'),('sales','Продажи','bag')]),
]

WAVE1 = False

def rail(on='today', role='owner', badge=None):
    items = RAIL_ITEMS if role == 'owner' else RAIL_MANAGER
    cta = 'Выдать мопед' if (role != 'owner' or WAVE1) else 'Принять деньги'
    name, r = ('Mika', 'владелец') if role == 'owner' else ('Менеджер Пример', 'менеджер')
    out = [f'<nav class="rail"><div class="logo">EV8 <small>ops</small></div>',
           f'<a class="cta" href="#">{ic("plus","i s")}{cta}</a>',
           f'<div class="search">{ic("search","i s")}Поиск<kbd>/</kbd></div>']
    for g, its in items:
        out.append(f'<div class="g">{g}</div>')
        for key, label, icon in its:
            b = f'<span class="badge">{badge}</span>' if (badge and key == 'today') else ''
            out.append(f'<a class="it{" on" if key == on else ""}" href="#">{ic(icon)}{label}{b}</a>')
    out.append(f'<div class="foot"><span class="avatar">{name[0]}</span><span>{name}<br><span style="color:#7f887f">{r} · RU</span></span></div></nav>')
    return ''.join(out)

def desk(caption, rail_html, main_html, extra=''):
    return (f'<figure class="f wide"><div class="desk-wrap"><div class="desk">{rail_html}<div class="main rel">{main_html}{extra}</div></div></div>'
            f'<figcaption>{caption}</figcaption></figure>')

def page(fname, title, lead, meta, bands, notes=''):
    metas = ''.join(f'<dt>{k}</dt><dd>{v}</dd>' for k, v in meta)
    bands_html = ''.join(f'<section class="band"><h2>{h}</h2><div class="frames">{c}</div></section>' for h, c in bands)
    html = (f'<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
            f'<title>{title} — EV8 Ops, прототип</title>{FONTS}<style>{TOKENS}\n{PROPOSAL}\n{CSS}</style></head><body>'
            f'<header class="doc"><a class="back" href="index.html">← Все прототипы</a><h1>{title}</h1>'
            f'<p class="lead"><span class="demo">ПРИМЕР</span>{lead}</p><dl class="meta">{metas}</dl></header>'
            f'{bands_html}<section class="notes">{notes}</section></body></html>')
    (OUT / fname).write_text(html)
    assert '<script' not in html
    return fname
