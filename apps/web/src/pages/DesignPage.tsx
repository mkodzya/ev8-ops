import { Link, useSearchParams } from 'react-router-dom';
import { LOCALES, useT, type Locale } from '../i18n/index.js';

/**
 * The catalogue framed twice (wave 1 §3.9): a 375 px phone beside a laptop
 * column, in one language at a time. Media queries answer to the width of the
 * frame, so each side is the component as that screen really draws it.
 */
export function DesignPage() {
  const t = useT();
  const [params] = useSearchParams();
  const lang: Locale = LOCALES.includes(params.get('lang') as Locale) ? (params.get('lang') as Locale) : 'ru';
  return (
    <div className="d-frame">
      <header className="d-frame-head">
        <h1>{t.design.title}</h1>
        <nav className="list-chips" aria-label={t.lang.label}>
          {(['ru', 'ka'] as const).map((l) => (
            <Link key={l} to={`/design?lang=${l}`} className={`list-chip ${lang === l ? 'on' : ''}`}>
              {t.lang[l]}
            </Link>
          ))}
        </nav>
      </header>
      <div className="d-frames">
        <figure className="d-fig d-fig-phone">
          <figcaption className="t-label">{t.design.phone}</figcaption>
          <iframe title={t.design.phone} src={`/design/catalog?lang=${lang}`} />
        </figure>
        <figure className="d-fig d-fig-laptop">
          <figcaption className="t-label">{t.design.laptop}</figcaption>
          <iframe title={t.design.laptop} src={`/design/catalog?lang=${lang}`} />
        </figure>
      </div>
    </div>
  );
}
