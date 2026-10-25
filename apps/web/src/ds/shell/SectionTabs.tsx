import { sectionOfPath, tabsFor, type NavCounts, type Permission, type TabId } from '@ev8/shared';
import { useLayoutEffect, useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { useLoad } from '../../lib/use.js';
import { useSession } from '../../session.js';
import './shell.css';

/**
 * The tabs of a section, in the address (wave 1 §3.2): chips on a phone, a
 * line on a laptop. Shown only on the section's own lists — a record inside
 * it has its own head.
 *
 * Since 28.09.2026 (Mika: "smooth, with a light animation, everywhere there
 * is such a menu") the strip lives in the shell, not in each page: it stays
 * put while the page under it changes, so the mark of the open tab can slide
 * from the old tab to the new one instead of the strip vanishing behind a
 * skeleton and coming back. The mark is one element — a pill behind the
 * word on a phone, a line under it on a laptop — moved with the product's
 * one easing; the page below comes in from the side the tab is on
 * (`tabStep`, `.tab-stage`). Reduced motion turns both into a cut.
 */
export function SectionTabs() {
  const t = useT();
  const { me } = useSession();
  const { pathname } = useLocation();
  const section = sectionOfPath(pathname, me?.permissions);
  const tabs = tabsFor(section, me?.permissions ?? []);
  const nav = useRef<HTMLElement>(null);
  const mark = useRef<HTMLSpanElement>(null);
  // How much waits behind a tab (§3.0, issue #15): lines to sort coming in and
  // going out, hand-overs to take, who pays today and who is late — the
  // request the rail's counters read, so one number everywhere.
  const counted = section === 'sort' || section === 'cash' || section === 'schedule';
  const counts = useLoad<NavCounts>(counted && me?.permissions.includes('fleet.view') ? '/api/nav/counts' : null);
  const countOf = (id: TabId): number => {
    const c = counts.data;
    if (!c) return 0;
    if (id === 'sortIn') return c.sort?.in ?? 0;
    if (id === 'sortOut') return c.sort?.out ?? 0;
    if (id === 'till') return c.till ?? 0;
    if (id === 'due') return c.schedule?.dueToday ?? 0;
    if (id === 'late') return c.schedule?.late ?? 0;
    return 0;
  };
  const shown = tabs.length >= 2 && tabs.some((tab) => tab.path === pathname);

  // Put the mark under the open tab. It slides there by its CSS transition;
  // the first time in a section it appears in place, not sliding in from nowhere.
  useLayoutEffect(() => {
    const strip = nav.current;
    const m = mark.current;
    if (!strip || !m) return;
    const place = () => {
      const on = strip.querySelector<HTMLElement>('.section-tab.on');
      if (!on) return;
      const first = !m.dataset.placed;
      if (first) m.style.transition = 'none';
      m.style.width = `${on.offsetWidth}px`;
      m.style.transform = `translateX(${on.offsetLeft}px)`;
      if (first) {
        void m.offsetWidth; // commit the position before the transition comes back
        m.style.transition = '';
        m.dataset.placed = '1';
      }
      // On a phone the strip scrolls: keep the open tab in view.
      const left = on.offsetLeft - strip.scrollLeft;
      if (left < 0 || left + on.offsetWidth > strip.clientWidth) {
        strip.scrollTo({ left: on.offsetLeft - 16, behavior: 'smooth' });
      }
    };
    place();
    const seen = new ResizeObserver(place);
    seen.observe(strip);
    return () => seen.disconnect();
  }, [pathname, shown, counts.data]);

  if (!shown) return null;
  return (
    <nav ref={nav} className="section-tabs" aria-label={t.shell.menu}>
      <span ref={mark} className="section-tab-mark" aria-hidden="true" />
      {tabs.map((tab) => (
        <NavLink key={tab.id} to={tab.path} end className={({ isActive }) => `section-tab ${isActive ? 'on' : ''}`}>
          {t.shell.tabs[tab.id]}
          {countOf(tab.id) > 0 && <span className={`section-tab-n mono${tab.id === 'late' ? ' late' : ''}`}>{countOf(tab.id)}</span>}
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * Which way the page moved between two tabs of one section: 1 to the right,
 * -1 to the left, 0 when it was not a move between tabs at all — another
 * section, a record, the same address.
 */
export function tabStep(from: string, to: string, permissions: readonly Permission[]): number {
  if (from === to) return 0;
  const section = sectionOfPath(to, permissions);
  if (sectionOfPath(from, permissions) !== section) return 0;
  const tabs = tabsFor(section, permissions);
  const a = tabs.findIndex((tab) => tab.path === from);
  const b = tabs.findIndex((tab) => tab.path === to);
  return a < 0 || b < 0 ? 0 : Math.sign(b - a);
}
