import { ROLE_PERMISSIONS, actionsFor, homePathFor, tabsFor, type Role, type SectionId } from '../src/index.js';
export { menuSectionsForRole, phoneTabsForRole, sectionOfPath, sectionsForRole } from '../src/index.js';
export const actionsForRole = (role: Role) => actionsFor(ROLE_PERMISSIONS[role]);
export const tabsForRole = (section: SectionId, role: Role) => tabsFor(section, ROLE_PERMISSIONS[role]);
export const homePathForRole = (role: Role) => homePathFor(ROLE_PERMISSIONS[role]);
