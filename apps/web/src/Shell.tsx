import { phoneTabsFor, sectionsFor, type SectionPath } from '@ev8/shared';
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from './api.js';
import { LanguageToggle, LOCALES, useLocale, useT, type Locale } from './i18n/index.js';
import { dayTaskCount, dayTasks, type DayTaskSource } from './lib/tasks.js';
import { useSession } from './session.js';

// The application frame: a dark rail on a laptop (brand black, light logo,
// one lime accent on the active item), a bottom bar on a phone — every item
// reachable with a thumb (spec §9.2).
//
// The phone bar carries five things and no more (U11): the four sections the
// role reaches for first, then More. Which sections a role sees at all, and
// which four come first, is one rule in @ev8/shared (navigation.ts) — a
// mechanic gets Service and Stock where a manager has Rentals and Payments.
// The badge on Today counts what the first row of that screen actually lists
// — one rule, in lib/tasks.ts, so the two can never disagree.

const STORAGE_KEY = 'ev8-lang';

export function Shell() {
  const t = useT();
  const { me, logout, can } = useSession();
  const { setLocale } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const [more, setMore] = useState(false);
  const [badge, setBadge] = useState(0);

  // Re-read on every navigation: the number is stale the moment somebody
  // records a payment, and this screen is where they come back to.
  useEffect(() => {
    setMore(false);
    void api
      .get<DayTaskSource>('/api/summary')
      .then((s) => setBadge(dayTaskCount(dayTasks(s, t, can))))
      .catch(() => setBadge(0));
  }, [location.pathname, t, can]);

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

  const signOut = async () => {
    await logout();
    // Replace, so Back from the login page does not reopen the last screen.
    navigate('/login', { replace: true });
  };

  const remember = (l: Locale) => {
    void api.patch('/api/me/locale', { locale: l }).catch(() => {});
  };

  const labels: Record<SectionPath, string> = {
    '/': t.nav.today,
    '/fleet': t.nav.fleet,
    '/models': t.nav.models,
    '/rentals': t.nav.rentals,
    '/sales': t.nav.sales,
    '/purchases': t.nav.purchases,
    '/service': t.nav.service,
    '/stock': t.stock.nav,
    '/payments': t.nav.payments,
    '/statements': t.nav.statements,
    '/economics': t.economics.nav,
    '/customers': t.nav.customers,
    '/settings': t.settings.title,
    '/design': t.design.title,
  };
  const permissions = me?.permissions ?? [];
  const items = sectionsFor(permissions).map((to) => ({ to, label: labels[to], end: to === '/' }));
  const tabs: readonly string[] = phoneTabsFor(permissions);
  const phone = tabs.map((to) => items.find((it) => it.to === to)!);
  const rest = items.filter((it) => !tabs.includes(it.to));

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
                {it.to === '/' && badge > 0 && <span className="badge">{badge}</span>}
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
              onClick={() => void signOut()}
            >
              {t.common.signOut}
            </button>
          )}
        </div>
      </nav>

      {/* The phone bar. Hidden on a laptop, where the rail does this job. */}
      {more && (
        <div className="sheet-scrim" onClick={() => setMore(false)} aria-hidden="true">
          <nav className="more-sheet" aria-label={t.nav.more}>
            <ul>
              {rest.map((it) => (
                <li key={it.to}>
                  <NavLink to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'on' : '')}>
                    {it.label}
                  </NavLink>
                </li>
              ))}
              {me && (
                <li>
                  <Link to="/profile">{t.profile.title}</Link>
                </li>
              )}
              {/* On a phone the rail's sign-out is hidden; a shared phone at
                  the showroom still has to be able to leave (B1-01). */}
              {me && (
                <li>
                  <button type="button" className="more-signout" onClick={() => void signOut()}>
                    {t.common.signOut}
                  </button>
                </li>
              )}
            </ul>
            <LanguageToggle onChange={remember} />
          </nav>
        </div>
      )}
      <nav className="tabbar" aria-label={t.nav.today}>
        {phone.map((it) => (
          <NavLink key={it.to} to={it.to} end={it.end} className={({ isActive }) => (isActive ? 'tab on' : 'tab')}>
            {it.label}
            {it.to === '/' && badge > 0 && <span className="badge">{badge}</span>}
          </NavLink>
        ))}
        <button type="button" className={more ? 'tab on' : 'tab'} onClick={() => setMore((v) => !v)}>
          {t.nav.more}
        </button>
      </nav>

      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
