import { sectionOfPath, tabsFor } from '@ev8/shared';
import { NavLink, useLocation } from 'react-router-dom';
import { useT } from '../../i18n/index.js';
import { useSession } from '../../session.js';
import './shell.css';

/**
 * The tabs of a section, in the address (wave 1 §3.2): chips under the header
 * on a phone, a line under the page title on a laptop. Shown only on the
 * section's own lists — a record inside it has its own head. The page head
 * places it twice, once for each, so the chips sit right under the header on
 * a phone however many buttons the page head carries.
 */
export function SectionTabs({ on }: { on: 'phone' | 'laptop' }) {
  const t = useT();
  const { me } = useSession();
  const { pathname } = useLocation();
  const section = sectionOfPath(pathname);
  const tabs = tabsFor(section, me?.permissions ?? []);
  if (tabs.length < 2 || !tabs.some((tab) => tab.path === pathname)) return null;
  return (
    <nav className={`section-tabs section-tabs-${on}`} aria-label={t.shell.menu}>
      {tabs.map((tab) => (
        <NavLink key={tab.id} to={tab.path} end className={({ isActive }) => `section-tab ${isActive ? 'on' : ''}`}>
          {t.shell.tabs[tab.id]}
        </NavLink>
      ))}
    </nav>
  );
}
