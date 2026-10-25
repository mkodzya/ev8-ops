import {
  GROUPS,
  SECTIONS,
  SECTION_TABS,
  actionsFor,
  menuSectionsFor,
  phoneTabsFor,
  sectionOfPath,
  sectionsFor,
  tabsFor,
  type NavCounts,
  type SectionId,
} from '@ev8/shared';
import { ChevronLeft, Ellipsis, KeyRound, LogOut, Plus, Search } from 'lucide-react';
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
import { TabletFrame } from './TabletFrame.js';
import './shell.css';

const STORAGE_KEY = 'ev8-lang';

/**
 * The frame around every screen (wave 1 §3.2–3.3, blueprint §2.2; the menu of
 * issue #15, ADR-0048).
 *
 * Phone (< 900 px): a 56 px header — the page's title, search, the avatar —
 * a bottom bar with Today · Оплаты · Разобрать · Мопеды · «Ещё», and the "+"
 * a round button of its own above the bar. Laptop: the dark rail with
 * «+ Действие», search, the groups of sections with their counters, and the
 * person at the foot. Which sections, tabs and actions a person gets is one
 * rule in @ev8/shared (navigation.ts).
 */
export function AppShell() {
  const { me } = useSession();
  return (
    <HeaderProvider>
      <MoneyProvider>{me?.via === 'pin' ? <TabletFrame /> : <Frame />}</MoneyProvider>
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
  const [sheet, setSheet] = useState<'actions' | 'menu' | 'more' | null>(null);
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

  // The badge of Today counts the rows "Today" lists, from the same request
  // it reads (wave 4 §3.1): one queue, one number, and it moves as soon as a
  // write marks that request stale. The other counters are one request of
  // their own, each counted the way its screen counts (issue #15).
  const front = me != null && can('fleet.view');
  const queue = useLoad<{ count: number }>(front ? '/api/today' : null);
  const counts = useLoad<NavCounts>(front ? '/api/nav/counts' : null);
  // Search finds mopeds, customers and records of the fleet; a mechanic has none of them.
  const mayFind = can('fleet.view');
  const todayCount = queue.data?.count ?? 0;

  useEffect(() => {
    setSheet(null);
    setSearching(false);
  }, [pathname, search]);

  // "/" opens the search from anywhere a person is not typing (wave 1 §3.5).
  const mayFindRef = useRef(mayFind);
  mayFindRef.current = mayFind;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && (e.target.closest('input, textarea, select, [contenteditable="true"]') != null);
      if (e.key === '/' && !typing && !e.metaKey && !e.ctrlKey && !e.altKey && mayFindRef.current) {
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
  const withTabs = Object.keys(SECTION_TABS) as SectionId[];
  const roots = new Set<string>(['/', '/me', ...SECTIONS.map((s) => s.path), ...withTabs.flatMap((s) => tabsFor(s, permissions).map((tab) => tab.path))]);
  const isRoot = roots.has(pathname);
  const goBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate(sections.find((s) => s.id === current)?.path ?? '/');
  };

  const tabs = phoneTabsFor(permissions);
  const more = menuSectionsFor(permissions);
  const actions = actionsFor(permissions);
  const initial = (me?.name ?? '?').trim().charAt(0).toUpperCase();

  return (
    <div className="app">
      {/* ---- laptop ---- */}
      <nav className="app-rail" aria-label="EV8 Ops">
        <div className="rail-logo">
          <img src="/logo-light.svg" alt="EV8" height={22} width={88} />
        </div>
        {/* «+ Действие» (issue #15): the actions of the role, as the round "+" opens them on a phone. */}
        {actions.length > 0 && (
          <button type="button" className="rail-cta" onClick={() => setSheet('actions')} aria-haspopup="dialog">
            <Plus {...ICON} size={18} aria-hidden="true" />
            {t.menu.action}
          </button>
        )}
        {mayFind && (
          <button type="button" className="rail-search" onClick={() => setSearching(true)}>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>{t.shell.search}</span>
            <kbd>/</kbd>
          </button>
        )}
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
                    <span className="rail-item-label">{label(s.id)}</span>
                    <SectionCount id={s.id} today={todayCount} counts={counts.data} />
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
        {mayFind && (
          <button type="button" className="icon-btn" onClick={() => setSearching(true)} aria-label={t.shell.search}>
            <Search {...ICON} aria-hidden="true" />
          </button>
        )}
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
        {tabs.map((id) => (
          <PhoneTab key={id} id={id} on={current === id} label={id === 'schedule' ? t.nav.scheduleShort : label(id)} today={todayCount} counts={counts.data} />
        ))}
        {/* «Ещё»: the role's other sections (issue #15). Lit while one of them is open. */}
        {more.length > 0 && (
          <button type="button" className={`tab ${more.includes(current) ? 'on' : ''}`} onClick={() => setSheet('more')} aria-haspopup="dialog">
            <span className="tab-ic">
              <Ellipsis {...ICON} aria-hidden="true" />
            </span>
            <span className="tab-label">{t.nav.more}</span>
          </button>
        )}
      </nav>
      {/* The "+" above the bar, at the thumb (issue #15). On a section's own
          list only: a card or a wizard has its main action in the strip at
          the foot, and the round button would sit on it. */}
      {actions.length > 0 && isRoot && (
        <button type="button" className="tab-fab" onClick={() => setSheet('actions')} aria-label={t.shell.openActions} aria-haspopup="dialog">
          <Plus {...ICON} aria-hidden="true" />
        </button>
      )}

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

      {sheet === 'more' && (
        <Drawer title={t.nav.more} onClose={() => setSheet(null)}>
          <div className="act-list">
            {more.map((id) => {
              const s = sections.find((x) => x.id === id)!;
              const Icon = SECTION_ICON[id];
              return (
                <Link key={id} to={s.path} className="act-item" aria-current={current === id ? 'page' : undefined}>
                  <span className="act-ico">
                    <Icon size={20} strokeWidth={1.75} aria-hidden="true" />
                  </span>
                  {label(id)}
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

/**
 * The numbers beside a section on the rail (issue #15; the director's
 * mockup): Today's tasks, «Оплаты по графику» red for the rentals late and
 * grey for the weeks awaited today, «Разобрать» the lines waiting. Each
 * number says what it counts to a screen reader; nought is not drawn.
 */
function SectionCount({ id, today, counts }: { id: SectionId; today: number; counts: NavCounts | null }) {
  const t = useT();
  const badges: { n: number; tone: 'crit' | 'quiet'; said: string }[] = [];
  if (id === 'today' && today > 0) badges.push({ n: today, tone: 'quiet', said: '' });
  if (id === 'schedule' && counts?.schedule) {
    if (counts.schedule.late > 0) badges.push({ n: counts.schedule.late, tone: 'crit', said: t.calendar.said.overdue });
    if (counts.schedule.dueToday > 0) badges.push({ n: counts.schedule.dueToday, tone: 'quiet', said: t.calendar.said.due_today });
  }
  if (id === 'sort' && counts?.sort) {
    const n = counts.sort.in + (counts.sort.out ?? 0);
    if (n > 0) badges.push({ n, tone: 'quiet', said: '' });
  }
  if (badges.length === 0) return null;
  return (
    <span className="rail-badges">
      {badges.map((b) => (
        <span key={b.tone} className={`badge ${b.tone === 'quiet' ? 'badge-quiet' : ''}`}>
          {b.said && <span className="sr-only">{b.said} </span>}
          {b.n}
        </span>
      ))}
    </span>
  );
}

/** A section of the phone bar, with one number: the red one while somebody is late, else the grey one. */
function PhoneTab({ id, on, label, today, counts }: { id: SectionId; on: boolean; label: string; today: number; counts: NavCounts | null }) {
  const t = useT();
  const { me } = useSession();
  const path = sectionsFor(me?.permissions ?? []).find((s) => s.id === id)?.path ?? '/';
  const Icon = SECTION_ICON[id];
  const late = id === 'schedule' ? (counts?.schedule?.late ?? 0) : 0;
  const quiet =
    id === 'today' ? today : id === 'schedule' ? (counts?.schedule?.dueToday ?? 0) : id === 'sort' && counts?.sort ? counts.sort.in + (counts.sort.out ?? 0) : 0;
  return (
    <NavLink to={path} end={id === 'today'} className={() => `tab ${on ? 'on' : ''}`}>
      <span className="tab-ic">
        <Icon {...ICON} aria-hidden="true" />
      </span>
      <span className="tab-label">{label}</span>
      {late > 0 ? (
        <span className="badge tab-badge">
          <span className="sr-only">{t.calendar.said.overdue} </span>
          {late}
        </span>
      ) : (
        quiet > 0 && (
          <span className="badge badge-quiet tab-badge">
            {id === 'schedule' && <span className="sr-only">{t.calendar.said.due_today} </span>}
            {quiet}
          </span>
        )
      )}
    </NavLink>
  );
}
