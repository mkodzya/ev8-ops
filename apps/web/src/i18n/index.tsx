import { DEFAULT_LOCALE, LOCALES, type Locale } from '@ev8/shared';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, type Dict } from './en.js';
import { ka } from './ka.js';
import { ru } from './ru.js';

/**
 * A language is one dictionary file plus a line here. English fixes the
 * shape (`Dict`), so a key a translation forgets is a build error.
 */
const DICTS: Record<Locale, Dict> = { ka, ru, en };
const STORAGE_KEY = 'ev8-lang';

export { LOCALES, type Locale };

/**
 * Resolved before first paint so nothing flashes in the wrong language: a
 * stored choice wins, then the browser's own languages, then Georgian — the
 * team's language, and the default this company runs on.
 */
function initialLocale(): Locale {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (LOCALES.includes(stored as Locale)) return stored as Locale;
  } catch {
    /* private mode */
  }
  const prefers = navigator.languages ?? [navigator.language];
  for (const tag of prefers) {
    const hit = LOCALES.find((l) => tag.toLowerCase().startsWith(l));
    if (hit) return hit;
  }
  return DEFAULT_LOCALE;
}

interface I18nCtx {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Dict;
}

const Ctx = createContext<I18nCtx | null>(null);

// The dictionary on screen right now, for code that runs outside a component:
// errorText is called from catch blocks and has no hook to ask.
let active: Dict = DICTS[DEFAULT_LOCALE];
export function currentDict(): Dict {
  return active;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.documentElement.lang = l;
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* the choice just won't survive a reload */
    }
  }, []);

  const value = useMemo<I18nCtx>(() => {
    active = DICTS[locale];
    return { locale, setLocale, t: DICTS[locale] };
  }, [locale, setLocale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function useI18n(): I18nCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useT must be used inside <I18nProvider>');
  return ctx;
}

/** The dictionary itself: `t.nav.today` is checked by the compiler. */
export function useT(): Dict {
  return useI18n().t;
}

export function useLocale(): { locale: Locale; setLocale: (l: Locale) => void } {
  const { locale, setLocale } = useI18n();
  return { locale, setLocale };
}

/** Three pills; the current one is lit. Each language names itself. */
export function LanguageToggle({ onChange }: { onChange?: (l: Locale) => void } = {}) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <div className="lang" role="group" aria-label={t.lang.label}>
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className={`pill pill-sm ${l === locale ? 'on' : ''}`}
          aria-pressed={l === locale}
          title={t.lang[l]}
          onClick={() => {
            setLocale(l);
            onChange?.(l);
          }}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}
