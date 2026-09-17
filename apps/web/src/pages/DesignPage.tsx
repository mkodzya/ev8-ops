import { RENTAL_STATUSES, VEHICLE_STATES, formatGel, tokenGroups, tokens, type TokenEntry } from '@ev8/shared';
import { RentalBadge, StateBadge, Vin } from '../components/ui.js';
import { useT } from '../i18n/index.js';

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
  ka: 'ვაჟა ჯაფარიძე · გიორგი სუთიძე',
  ru: 'Вахтанг Джапаридзе · 1 240,50 ₾',
  en: 'Vazha Japaridze · HH8LWFCA3N0002016',
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

export function DesignPage() {
  const t = useT();

  return (
    <div className="d-page">
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
    </div>
  );
}
