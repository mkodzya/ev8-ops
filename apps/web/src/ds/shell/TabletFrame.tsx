import { LOCALES } from '@ev8/shared';
import { ChevronLeft, LogOut } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { LanguageToggle, useLocale, useT, type Locale } from '../../i18n/index.js';
import { useSession } from '../../session.js';
import { SyncBar } from '../state/SyncBar.js';
import { PageHeadSlot, useHeader } from './header.js';
import { ICON } from './icons.js';
import './tablet.css';

/** How long before signing out the screen says so and offers to stay. */
const WARN_SECONDS = 30;

/**
 * The frame of a PIN session on the workshop tablet (ADR-0033 §7, §10). One
 * section — the repairs — so no rail, no bar, no search; instead the name of
 * whoever is signed in, always in sight, and a sign-out the width of a thumb.
 * This is the one exception to "sign out lives in the avatar menu"
 * (`docs/design/ux.md`): the tablet is shared, and leaving is the action that
 * keeps the next person's work off this one's name.
 */
export function TabletFrame() {
  const t = useT();
  const { me, logout } = useSession();
  const { setLocale } = useLocale();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  // Below 900 px a page hands its title to the header, as on a phone: here the bar carries it.
  const header = useHeader();
  const atRoot = pathname === '/service' || pathname === '/';

  // The tablet speaks the language of whoever signed in on it, whatever the
  // last person chose (ADR-0033 §9).
  useEffect(() => {
    if (me && LOCALES.includes(me.locale as Locale)) setLocale(me.locale as Locale);
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const signOut = useCallback(async () => {
    await logout();
    navigate('/login', { replace: true });
  }, [logout, navigate]);

  const left = useIdleSignOut(me?.idleMinutes ?? 10, signOut);
  if (!me) return null;
  const initial = me.name.trim().charAt(0).toUpperCase();

  return (
    <div className="tablet-app">
      <header className="tablet-bar">
        <div className="tablet-bar-left">
          <img className="tablet-logo" src="/logo.svg" alt="EV8" height={24} width={96} />
          {!atRoot && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/service'))}
              aria-label={t.shell.back}
            >
              <ChevronLeft {...ICON} aria-hidden="true" />
            </button>
          )}
          <span className="tablet-title">
            <span className="tablet-section">{header?.title ?? t.nav.service}</span>
            {header?.sub != null && <span className="tablet-sub">{header.sub}</span>}
          </span>
        </div>
        <div className="tablet-bar-right">
          <LanguageToggle onChange={(l) => void api.patch('/api/me/locale', { locale: l }).catch(() => {})} />
          <span className="tablet-me">
            <span className="avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="tablet-me-text">
              <span className="tablet-me-name">{me.name}</span>
              <span className="tablet-me-role">{t.users.roles[me.role]}</span>
            </span>
          </span>
          <button type="button" className="tablet-out" onClick={() => void signOut()}>
            <LogOut {...ICON} aria-hidden="true" />
            {t.workshop.signOut}
          </button>
        </div>
      </header>
      <main className="app-page tablet-page">
        <SyncBar />
        <PageHeadSlot>
          <div className="tab-stage">
            <Outlet />
          </div>
        </PageHeadSlot>
        <p className="hint muted tablet-idle">{t.workshop.idleNote(me.idleMinutes ?? 10)}</p>
      </main>
      {left != null && (
        <div className="tablet-warn" role="alertdialog" aria-live="assertive">
          <span>{t.workshop.idleSoon(left)}</span>
          {/* Any touch stays; the button says so in words. */}
          <button type="button" className="tablet-stay">
            {t.workshop.stay}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Signs out after `minutes` without a touch, a key or a scroll, and for the
 * last thirty seconds answers how many are left. The server ends the session
 * on its own after the same ten minutes; this is the screen keeping time so
 * the next mechanic does not find the last one's work open.
 */
function useIdleSignOut(minutes: number, signOut: () => Promise<void>): number | null {
  const [left, setLeft] = useState<number | null>(null);
  const last = useRef(Date.now());
  const done = useRef(false);

  useEffect(() => {
    const touch = () => {
      last.current = Date.now();
      setLeft(null);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    const tick = window.setInterval(() => {
      const remain = minutes * 60_000 - (Date.now() - last.current);
      if (remain <= 0) {
        if (done.current) return;
        done.current = true;
        void signOut();
      } else if (remain <= WARN_SECONDS * 1000) setLeft(Math.ceil(remain / 1000));
    }, 1000);
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
      window.clearInterval(tick);
    };
  }, [minutes, signOut]);

  return left;
}
