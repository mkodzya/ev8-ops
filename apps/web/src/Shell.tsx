import { useEffect } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { LanguageToggle, LOCALES, useLocale, useT, type Locale } from './i18n/index.js';
import { useSession } from './session.js';

// The application frame: a dark rail on a laptop (brand black, light logo,
// one lime accent on the active item), a bottom bar on a phone — every item
// reachable with a thumb (spec §9.2).

const STORAGE_KEY = 'ev8-lang';

export function Shell() {
  const t = useT();
  const { me, logout, can } = useSession();
  const { setLocale } = useLocale();
  const navigate = useNavigate();

  // A person's stored language follows them to a new device; a choice made
  // on this device (localStorage) still wins.
  useEffect(() => {
    if (!me) return;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
    if (!stored && LOCALES.includes(me.locale as Locale)) setLocale(me.locale as Locale);
  }, [me, setLocale]);

  const remember = (l: Locale) => {
    void api.patch('/api/me/locale', { locale: l }).catch(() => {});
  };

  const items: { to: string; label: string; end?: boolean }[] = [
    { to: '/', label: t.nav.today, end: true },
    { to: '/fleet', label: t.nav.fleet },
    { to: '/rentals', label: t.nav.rentals },
    { to: '/customers', label: t.nav.customers },
    ...(can('users.manage') ? [{ to: '/settings', label: t.settings.title }] : []),
  ];

  return (
    <div className="shell">
      <nav className="rail" aria-label="EV8 Ops">
        <div className="rail-logo">
          <img src="/logo-light.svg" alt="EV8" height={24} width={96} />
        </div>
        {can('rental.create') && (
          <Link to="/rentals/new" className="rail-cta" aria-label={t.actions.newRental} title={t.actions.newRental}>
            <span className="cta-plus" aria-hidden="true">
              +
            </span>
            <span className="cta-text">{t.actions.newRental}</span>
          </Link>
        )}
        <ul className="rail-nav">
          {items.map((it) => (
            <li key={it.to}>
              <NavLink to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'on' : '')}>
                {it.label}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="rail-foot">
          <LanguageToggle onChange={remember} />
          {me && (
            <Link className="rail-user rail-user-link" to="/profile" title={t.profile.title}>
              <span className="rail-user-initial" aria-hidden="true">
                {me.name.trim().charAt(0).toUpperCase()}
              </span>
              <span className="rail-user-name">{me.name}</span>
              <span className="rail-user-role">{t.users.roles[me.role]}</span>
            </Link>
          )}
          {me && (
            <button
              type="button"
              className="rail-signout"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
            >
              {t.common.signOut}
            </button>
          )}
        </div>
      </nav>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
