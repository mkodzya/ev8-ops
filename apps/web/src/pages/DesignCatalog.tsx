import { RENTAL_STATUSES, VEHICLE_STATES, formatGel, tokenGroups, tokens, type TokenEntry } from '@ev8/shared';
import { CloudOff } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CloseQuestion } from '../components/Drawer.js';
import { LoadError } from '../components/LoadError.js';
import { RentalBadge, StateBadge, Vin } from '../components/ui.js';
import { Field } from '../components/Wizard.js';
import { ToastCard } from '../ds/feedback/Toast.js';
import { DraftOffer, FailureProvider, SubmitButton } from '../ds/form/Form.js';
import type { Failure } from '../ds/form/operation.js';
import '../ds/form/form.css';
import { DataList } from '../ds/list/DataList.js';
import { NoAccess } from '../ds/state/NoAccess.js';
import { Skeleton } from '../ds/state/Skeleton.js';
import { SyncStrip } from '../ds/state/SyncBar.js';
import { SessionEndedCard, SignedOutOffline } from '../LoginPage.js';
import { FixedLocale, LOCALES, useT, type Locale } from '../i18n/index.js';

// Foundations, inside the application rather than beside it.
//
// The page renders `tokenGroups`, which is generated from
// packages/shared/tokens.json — so a token added to the source appears here
// without anybody writing it down a second time, and a token that drifts is
// visible as itself rather than as a screen that looks slightly wrong.
//
// The token names, their CSS custom properties and the notes are engineering
// text and stay in English: they are the source, quoted. Everything the page
// says in its own voice goes through the dictionary like any other screen.

/** A colour is worth a swatch; a font stack or a length is worth its value. */
function isColour(value: string): boolean {
  return value.startsWith('#') || value.startsWith('rgb');
}

function Swatch({ token }: { token: TokenEntry }) {
  if (isColour(token.value)) {
    return <span className="d-swatch" style={{ background: `var(${token.cssVar})` }} aria-hidden="true" />;
  }
  if (token.name === 'shadow') {
    return <span className="d-swatch d-swatch-shadow" aria-hidden="true" />;
  }
  // Always an element, never null: the row is a grid, and a missing first
  // cell slides the name into the 28 px swatch column and shreds it.
  return <span className="d-swatch-none" aria-hidden="true" />;
}

function TokenTable({ tokens }: { tokens: TokenEntry[] }) {
  return (
    <ul className="d-tokens">
      {tokens.map((token) => (
        <li key={token.name}>
          <Swatch token={token} />
          <code className="d-var">{token.cssVar}</code>
          <code className="d-value">{token.value}</code>
          <span className="d-note t-label">{token.note}</span>
        </li>
      ))}
    </ul>
  );
}

// Real names, from the real customer list: Be Vietnam Pro and Inter have no
// Georgian glyphs at all, and a face without them falls back to the system
// font silently. Every text style is shown on all three alphabets so the
// fallback is visible here instead of on a contract.
const SPECIMEN = {
  ka: 'ჟუჟუნა ჯაფარაძე · ნინო თუშიძე',
  ru: 'Жужуна Джапарадзе · 1 240,50 ₾',
  en: 'Zhuzhuna Japaradze · HH8LWFCA0N0000000',
};

const TEXT_STYLES = [
  'display',
  'h1',
  'h2',
  'h3',
  'body',
  'body-sm',
  'label',
  'overline',
  'button',
  'button-sm',
  'mono',
  'money',
  'mono-sm',
  'cta',
] as const;

const BUTTON_STATES = [
  { cls: '', key: 'default' },
  { cls: 'is-hover', key: 'hover' },
  { cls: 'is-pressed', key: 'pressed' },
  { cls: 'is-focus', key: 'focus' },
  { cls: 'is-disabled', key: 'disabled' },
] as const;

const SHAPES = [
  { cssVar: '--radius-pill', token: 'radiusPill', label: 'shapePill' },
  { cssVar: '--radius-card', token: 'radiusCard', label: 'shapeCard' },
  { cssVar: '--control', token: 'control', label: 'shapeTouch' },
] as const;

/**
 * The catalogue (wave 1 §3.9, build plan Р3): every ds/ component in every
 * state, on live tokens. /design frames it twice — a 375 px phone and a
 * laptop column — so what differs by width is seen side by side; `?lang=`
 * shows it in one language whatever the app is set to.
 */
export function DesignCatalog() {
  const [params] = useSearchParams();
  const lang = params.get('lang');
  const body = <Catalog />;
  return LOCALES.includes(lang as Locale) ? <FixedLocale locale={lang as Locale}>{body}</FixedLocale> : body;
}

function Catalog() {
  const t = useT();

  return (
    <div className="d-page d-catalog">
      <h1>{t.design.title}</h1>
      <p className="hint">{t.design.note}</p>

      <h2>{t.design.tokens}</h2>
      {tokenGroups.map((group) => (
        <section key={group.name} className="card d-group">
          <h2 className="sub">{group.name}</h2>
          <p className="d-note t-label">{group.note}</p>
          <TokenTable tokens={group.tokens} />
        </section>
      ))}

      <h2>{t.design.type}</h2>
      <section className="card">
        <p className="hint">{t.design.typeNote}</p>
        {TEXT_STYLES.map((style) => (
          <div key={style} className="d-type">
            <code className="d-var">--text-{style}</code>
            <div>
              <div className={`t-${style}`}>{SPECIMEN.ka}</div>
              <div className={`t-${style}`}>{SPECIMEN.ru}</div>
              <div className={`t-${style}`}>{SPECIMEN.en}</div>
            </div>
          </div>
        ))}
      </section>

      <h2>{t.design.buttons}</h2>
      <section className="card">
        <p className="hint">{t.design.buttonsNote}</p>
        <div className="d-row">
          {BUTTON_STATES.map((s) => (
            <button key={`a-${s.key}`} type="button" className={`pill pill-accent ${s.cls}`} disabled={s.key === 'disabled'}>
              {t.design.stateNames[s.key]}
            </button>
          ))}
        </div>
        <div className="d-row">
          {BUTTON_STATES.map((s) => (
            <button key={`o-${s.key}`} type="button" className={`pill ${s.cls}`} disabled={s.key === 'disabled'}>
              {t.design.stateNames[s.key]}
            </button>
          ))}
        </div>
        <div className="d-row">
          {BUTTON_STATES.slice(0, 3).map((s) => (
            <button key={`c-${s.key}`} type="button" className={`pill pill-accent pill-lg ${s.cls}`}>
              {t.design.stateNames[s.key]}
            </button>
          ))}
        </div>
        <p className="t-label">{t.design.ctaNote}</p>
        <div className="d-row">
          <button type="button" className="pill pill-sm">
            {t.design.stateNames.small}
          </button>
          <button type="button" className="pill pill-sm on">
            {t.design.stateNames.selected}
          </button>
        </div>
      </section>

      <h2>{t.design.states}</h2>
      <section className="card">
        <p className="hint">{t.design.statesNote}</p>
        <div className="d-row">
          {VEHICLE_STATES.map((s) => (
            <StateBadge key={s} state={s} />
          ))}
        </div>
        <div className="d-row">
          {RENTAL_STATUSES.map((s) => (
            <RentalBadge key={s} status={s} />
          ))}
        </div>
        <p className="t-label">{t.design.statesShape}</p>
      </section>

      <h2>{t.design.data}</h2>
      <section className="card">
        <div className="kv">
          <span className="t-label">{t.design.vin}</span>
          <Vin vin="HH8LWFCA3N0002016" />
        </div>
        <div className="kv">
          <span className="t-label">{t.design.money}</span>
          <span className="t-money">{formatGel(124050)}</span>
        </div>
        <div className="kv">
          <span className="t-label">{t.design.debt}</span>
          <span className="t-money crit-text">{formatGel(33000)}</span>
        </div>
        <div className="kv">
          <span className="t-label">{t.design.tile}</span>
          <span>
            <span className="tile-num">7</span> <span className="tile-lbl">{t.states.available}</span>
          </span>
        </div>
      </section>

      <h2>{t.design.shape}</h2>
      <section className="card">
        <p className="hint">{t.design.shapeNote}</p>
        <div className="d-row d-shapes">
          <span className="d-shape d-shape-pill" />
          <span className="d-shape d-shape-card" />
          <span className="d-shape d-shape-touch" />
        </div>
        <ul className="d-tokens">
          {SHAPES.map((shape) => (
            <li key={shape.cssVar}>
              <span className="d-swatch-none" aria-hidden="true" />
              <code className="d-var">{shape.cssVar}</code>
              <code className="d-value">{tokens[shape.token]}</code>
              <span className="d-note t-label">{t.design[shape.label]}</span>
            </li>
          ))}
        </ul>
      </section>

      <h2>{t.design.submit}</h2>
      <section className="card">
        <p className="hint">{t.design.submitNote}</p>
        <div className="d-row">
          {(['idle', 'busy', 'done', 'failed'] as const).map((state) => (
            <SubmitButton key={state} type="button" state={state} label={t.stock.addPart} />
          ))}
        </div>
      </section>

      <h2>{t.design.forms}</h2>
      <FormStates />

      <h2>{t.design.toasts}</h2>
      <section className="card d-stack">
        <ToastCard still text={t.stock.partAdded} onOpen={() => {}} />
        <ToastCard still text={t.pools.moved(t.pools.sale)} life={10000} onUndo={() => {}} />
      </section>

      <h2>{t.design.lists}</h2>
      <p className="hint">{t.design.listsNote}</p>
      <ListSample />

      <h2>{t.design.sixStates}</h2>
      <section className="card d-stack">
        <p className="t-label">{t.design.stateEmpty}</p>
        <div className="list-empty">
          <p>{t.rentals.empty}</p>
          <button type="button" className="pill pill-sm pill-accent">
            {t.actions.newRental}
          </button>
        </div>
        <p className="t-label">{t.design.stateLoading}</p>
        <Skeleton rows={3} />
        <p className="t-label">{t.design.stateError}</p>
        <LoadError failure={{ status: 500, code: 'error', text: t.errors.unknown }} onRetry={() => {}} />
        <p className="t-label">{t.design.stateNotFound}</p>
        <LoadError failure={{ status: 404, code: 'not_found', text: '' }} />
        <p className="t-label">{t.design.stateOffline}</p>
        <SyncStrip off text={t.sync.offlineSince('14:02')} />
        <SyncStrip text={t.sync.back('14:09')} />
        <p className="t-label">{t.design.stateNoAccess}</p>
        <NoAccess />
      </section>

      <h2>{t.design.session}</h2>
      <section className="d-stack">
        <SessionEndedCard title={t.design.sample.rentalTitle} email="kardu@example.ge" />
        <div className="login-card">
          <SignedOutOffline onDismiss={() => {}} />
        </div>
      </section>
    </div>
  );
}

/** A short form in each of its moments: fields, a field the server refused, the banner, the draft, the question on closing. */
function FormStates() {
  const t = useT();
  const [name, setName] = useState(t.design.sample.part);
  const refused: Failure = { text: t.errors.codes.part_exists, field: 'sku', fieldText: t.errors.codes.part_exists, code: 'part_exists', network: false };
  const network: Failure = { text: t.errors.network, field: null, fieldText: null, code: null, network: true };
  return (
    <div className="d-grid">
      <section className="card">
        <p className="t-label">{t.design.formRest}</p>
        <Field label={t.stock.name} name="name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label={t.stock.minQty} hint={t.pickup.noVehicleHint} name="minQty">
          <input className="input input-amount mono" defaultValue="4" />
        </Field>
      </section>
      <section className="card">
        <p className="t-label">{t.design.formField}</p>
        <FailureProvider value={refused}>
          <Field label={t.stock.sku} name="sku">
            <input className="input mono" defaultValue="DEMO-MIR-L" />
          </Field>
        </FailureProvider>
        <SubmitButton type="button" state="idle" label={t.stock.addPart} />
      </section>
      <section className="card">
        <p className="t-label">{t.design.formBanner}</p>
        <div className="form-banner form-banner-bad" role="alert">
          <CloudOff size={18} strokeWidth={1.75} aria-hidden="true" />
          <div>
            <b>{t.form.notSaved}</b> {network.text} {t.form.draftKept}
          </div>
        </div>
        <SubmitButton type="button" state="failed" label={t.stock.addPart} />
      </section>
      <section className="card">
        <p className="t-label">{t.design.formDraft}</p>
        <DraftOffer at={new Date(new Date().setHours(14, 20, 0, 0)).toISOString()} words={t.design.sample.part} onContinue={() => {}} onDiscard={() => {}} />
      </section>
      <section className="card">
        <p className="t-label">{t.design.formClose}</p>
        <CloseQuestion onBack={() => {}} onClose={() => {}} />
      </section>
    </div>
  );
}

interface SampleRow {
  id: string;
  who: string;
  number: string;
  model: string;
  vin: string;
  debt: number;
}

const owed = (tetri: number) => (tetri > 0 ? <span className="t-money crit-text">{formatGel(tetri, { decimals: false })}</span> : undefined);

/** The list with a handful of example rows — marked as such, no real customer in them. */
function ListSample() {
  const t = useT();
  const rows: SampleRow[] = [
    { id: 'a', who: t.design.sample.customerA, number: 'R-00001', model: 'Flybrother B11', vin: 'DEMO0000000000011', debt: 0 },
    { id: 'b', who: t.design.sample.customerB, number: 'R-00002', model: 'Flybrother XL1200', vin: 'DEMO0000000000022', debt: 31300 },
    { id: 'c', who: t.design.sample.customerC, number: 'R-00003', model: 'Luyuan MKK Plus', vin: 'DEMO0000000000033', debt: 0 },
  ];
  return (
    <section className="card">
      <p className="t-label">{t.design.example}</p>
      <DataList
        rows={rows}
        rowKey={(r) => r.id}
        fallback={(a, b) => a.number.localeCompare(b.number)}
        search={{ placeholder: t.lists.rentalsSearch, match: (r, q) => r.who.toLowerCase().includes(q.text) }}
        chips={[{ key: 'owing', label: t.lists.chips.owing, test: (r) => r.debt > 0 }]}
        empty={{ text: t.rentals.empty }}
        card={(r) => ({
          title: r.who,
          sub: (
            <>
              {r.number} · {r.model} <span className="mono">···{r.vin.slice(-4)}</span>
            </>
          ),
          right: owed(r.debt),
          rightSub: <RentalBadge status={r.debt > 0 ? 'overdue' : 'active'} />,
        })}
        columns={[
          { key: 'number', label: t.rentals.number, cell: (r) => <span className="mono">{r.number}</span>, sort: { value: (r) => r.number } },
          { key: 'who', label: t.rentals.customer, cell: (r) => <span>{r.who}</span>, sort: { value: (r) => r.who } },
          { key: 'vin', label: t.rentals.vehicle, cell: (r) => <Vin vin={r.vin} />, sort: { value: (r) => r.model } },
          { key: 'debt', label: t.lists.debt, num: true, cell: (r) => <span className="mono">{r.debt ? formatGel(r.debt, { decimals: false }) : t.common.dash}</span>, sort: { value: (r) => r.debt, first: 'desc' } },
        ]}
      />
    </section>
  );
}
