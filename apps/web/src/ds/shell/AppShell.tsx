import {
  GROUPS,
  SECTIONS,
  actionsFor,
  menuSectionsFor,
  phoneTabsFor,
  sectionOfPath,
  sectionsFor,
  tabsFor,
  type SectionId,
} from '@ev8/shared';
import { ChevronLeft, KeyRound, LogOut, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../../api.js';
import { Drawer } from '../../components/Drawer.js';
import { LanguageToggle, LOCALES, useLocale, useT, type Locale } from '../../i18n/index.js';

import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import { SearchOverlay } from '../search/SearchOverlay.js';
import { SyncBar } from '../state/SyncBar.js';
import { HeaderProvider, PageHeadSlot, useHeader } from './header.js';
import { MoneyProvider } from '../money/MoneyForm.js';
import { SessionEnded } from '../../LoginPage.js';
import { ACTION_ICON, ICON, SECTION_ICON } from './icons.js';
import { SectionTabs, tabStep } from './SectionTabs.js';
import './shell.css';

const STORAGE_KEY = 'ev8-lang';

/**
 * The frame around every screen (wave 1 §3.2–3.3, blueprint §2.2).
 *
 * Phone (< 900 px): a 56 px header — the page's title, search, the avatar —
 * and a bottom bar with the role's four sections around a "+" that opens the
 * role's actions. Laptop: the dark rail with the main action, search, three
 * groups of sections and the person at the foot. Which sections, tabs and
 * actions a person gets is one rule in @ev8/shared (navigation.ts).
 */
export function AppShell() {
  return (
    <HeaderProvider>
      <MoneyProvider>
        <Frame />
      </MoneyProvider>
    </HeaderProvider>
  );
}

function Frame() {
  const t = useT();
  const { me, logout, can } = useSession();
  const { setLocale } = useLocale();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const header = useHeader();
  const [sheet, setSheet] = useState<'actions' | 'menu' | null>(null);
  const [searching, setSearching] = useState(false);

  const permissions = me?.permissions ?? [];
  const sections = sectionsFor(permissions);
  const current = sectionOfPath(pathname, permissions);
  // Derived from the address during render: the previous one is remembered,
  // and a tab-to-tab move counts once (a second render sees nothing new).
  const lastPath = useRef(pathname);
  const lastMove = useRef({ n: 0, dir: 0 });
  if (lastPath.current !== pathname) {
    const dir = tabStep(lastPath.current, pathname, permissions);
    if (dir !== 0) lastMove.current = { n: lastMove.current.n + 1, dir };
    lastPath.current = pathname;
  }
  const move = lastMove.current;
  const label = (id: SectionId) => t.nav[id];

  // The badge counts the rows "Today" lists, from the same request it reads
  // (wave 4 §3.1): one queue, one number, and it moves as soon as a write
  // marks that request stale.
  const queue = useLoad<{ count: number }>(me ? '/api/today' : null);
  const badge = queue.data?.count ?? 0;

  useEffect(() => {
    setSheet(null);
    setSearching(false);
  }, [pathname, search]);

  // "/" opens the search from anywhere a person is not typing (wave 1 §3.5).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest('input, textarea, select, [contenteditable="true"]') != null);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setSearching(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

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

  const signOut = async () => {
    await logout();
    // Replace, so Back from the login page does not reopen the last screen.
    navigate('/login', { replace: true });
  };

  // A section root or one of its tabs has no way back — it is where you go
  // back to. Anything deeper gets the arrow.
  const roots = new Set<string>(['/', '/me', '/customers', ...SECTIONS.map((s) => s.path), ...(['fleet', 'service', 'money', 'reports', 'purchases'] as const).flatMap((s) => tabsFor(s, permissions).map((tab) => tab.path))]);
  const isRoot = roots.has(pathname);
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(sections.find((s) => s.id === current)?.path ?? '/');
  };

  const tabs = phoneTabsFor(permissions);
  const actions = actionsFor(permissions);
  const initial = (me?.name ?? '?').trim().charAt(0).toUpperCase();
  // The owner's first thing is money coming in (wave 2 §3.0); a manager's is handing a moped over.
  const mainAction = actions.find((a) => a.id === 'takeMoney') ?? actions.find((a) => a.id === 'pickup');

  return (
    <div className="app">
      {/* ---- laptop ---- */}
      <nav className="app-rail" aria-label="EV8 Ops">
        <div className="rail-logo">
          <img src="/logo-light.svg" alt="EV8" height={22} width={88} />
        </div>
        {mainAction && (
          <Link to={mainAction.path} className="rail-cta">
            <Plus {...ICON} size={18} aria-hidden="true" />
            {t.shell.actions[mainAction.id]}
          </Link>
        )}
        <button type="button" className="rail-search" onClick={() => setSearching(true)}>
          <Search size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>{t.shell.search}</span>
          <kbd>/</kbd>
        </button>
        {GROUPS.map((g) => {
          const items = sections.filter((s) => s.group === g);
          if (items.length === 0) return null;
          return (
            <div key={g} className="rail-group">
              <div className="rail-group-title">{t.nav.groups[g]}</div>
              {items.map((s) => {
                const Icon = SECTION_ICON[s.id];
                return (
                  <NavLink key={s.id} to={s.path} end={s.id === 'today'} className={() => `rail-item ${current === s.id ? 'on' : ''}`}>
                    <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
                    <span>{label(s.id)}</span>
                    {s.id === 'today' && badge > 0 && <span className="badge">{badge}</span>}
                  </NavLink>
                );
              })}
            </div>
          );
        })}
        {me && (
          <button type="button" className="rail-user" onClick={() => setSheet('menu')}>
            <span className="avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="rail-user-text">
              <span className="rail-user-name">{me.name}</span>
              <span className="rail-user-role">{t.users.roles[me.role]}</span>
            </span>
          </button>
        )}
      </nav>

      {/* ---- phone ---- */}
      <header className="app-header">
        {!isRoot && (
          <button type="button" className="icon-btn head-back" onClick={goBack} aria-label={t.shell.back}>
            <ChevronLeft {...ICON} aria-hidden="true" />
          </button>
        )}
        <div className="head-title">
          <span className="head-title-text">{header?.title ?? label(current)}</span>
          {header?.sub != null && <span className="head-sub">{header.sub}</span>}
        </div>
        <button type="button" className="icon-btn" onClick={() => setSearching(true)} aria-label={t.shell.search}>
          <Search {...ICON} aria-hidden="true" />
        </button>
        {me && (
          <button type="button" className="icon-btn" onClick={() => setSheet('menu')} aria-label={t.shell.menu}>
            <span className="avatar" aria-hidden="true">
              {initial}
            </span>
          </button>
        )}
      </header>

      <main className="app-page">
        <SyncBar />
        <PageHeadSlot>
          <SectionTabs />
          {/* A move between two tabs of one section gives the page a new key, so
              it comes in from the side of the tab; anything else — another
              section, a record — keeps the key, and what the page draws simply
              fades in as it arrives (.tab-stage > *). */}
          <div className="tab-stage" key={move.n} data-dir={move.dir || undefined}>
            <Outlet />
          </div>
        </PageHeadSlot>
      </main>
      <SessionEnded />

      <nav className="app-tabbar" aria-label={t.shell.menu}>
        {tabs.slice(0, 2).map((id) => (
          <PhoneTab key={id} id={id} on={current === id} label={label(id)} badge={id === 'today' ? badge : 0} />
        ))}
        <button type="button" className="tab-plus" onClick={() => setSheet('actions')} aria-label={t.shell.openActions}>
          <span className="plus">
            <Plus {...ICON} aria-hidden="true" />
          </span>
        </button>
        {tabs.slice(2).map((id) => (
          <PhoneTab key={id} id={id} on={current === id} label={label(id)} badge={0} />
        ))}
      </nav>

      {sheet === 'actions' && (
        <Drawer title={t.shell.actionsTitle} onClose={() => setSheet(null)}>
          <div className="act-list">
            {actions.map((a) => {
              const Icon = ACTION_ICON[a.id];
              return (
                <Link key={a.id} to={a.path} className="act-item">
                  <span className="act-ico">
                    <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  {t.shell.actions[a.id]}
                </Link>
              );
            })}
          </div>
        </Drawer>
      )}

      {sheet === 'menu' && me && (
        <Drawer title={me.name} onClose={() => setSheet(null)}>
          <p className="menu-role">{t.users.roles[me.role]}</p>
          <div className="field">
            <span className="lbl">{t.lang.label}</span>
            <LanguageToggle onChange={remember} />
          </div>
          <div className="act-list">
            {menuSectionsFor(permissions).map((id) => {
              const s = sections.find((x) => x.id === id)!;
              const Icon = SECTION_ICON[id];
              return (
                <Link key={id} to={s.path} className="act-item">
                  <span className="act-ico">
                    <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  {/* The owner runs the stock too; the menu says so (wave 1 §3.2). */}
                  {id === 'service' && can('stock.count') ? t.nav.serviceStock : label(id)}
                </Link>
              );
            })}
            <Link to="/me" className="act-item">
              <span className="act-ico">
                <KeyRound size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              {t.shell.myLogin}
            </Link>
            {/* Last and red: a shared phone at the showroom has to be able to leave (B1-01). */}
            <button type="button" className="act-item act-danger" onClick={() => void signOut()}>
              <span className="act-ico">
                <LogOut size={20} strokeWidth={1.75} aria-hidden="true" />
              </span>
              {t.common.signOut}
            </button>
          </div>
        </Drawer>
      )}

      {searching && <SearchOverlay onClose={() => setSearching(false)} />}
    </div>
  );
}

function PhoneTab({ id, on, label, badge }: { id: SectionId; on: boolean; label: string; badge: number }) {
  const { me } = useSession();
  const path = sectionsFor(me?.permissions ?? []).find((s) => s.id === id)?.path ?? '/';
  const Icon = SECTION_ICON[id];
  return (
    <NavLink to={path} end={id === 'today'} className={() => `tab ${on ? 'on' : ''}`}>
      <span className="tab-ic">
        <Icon {...ICON} aria-hidden="true" />
      </span>
      <span className="tab-label">{label}</span>
      {badge > 0 && <span className="badge tab-badge">{badge}</span>}
    </NavLink>
  );
}
