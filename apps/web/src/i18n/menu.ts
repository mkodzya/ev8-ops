// The new menu and the manager's part of the money (issue #15 of the
// director, 25.10.2026; ADR-0048). The sections' and tabs' own names live in
// `nav` and `shell.tabs` of the main dictionaries; here is what the frame and
// «Разобрать» say besides. The Georgian goes to proofreading with the rest
// (docs/qa/menu-and-manager-sort-ka-strings.md).

export const menuEn = {
  menu: {
    /** The rail's first button: it opens the actions, as the round "+" does on a phone. */
    action: 'Action',
    /** Under the answers a manager may give: the ones he may not, by their own words. */
    ownerSorts: (answers: string) => `${answers}: the owner sorts these.`,
  },
};

export type MenuDict = typeof menuEn;

export const menuRu: MenuDict = {
  menu: {
    action: 'Действие',
    ownerSorts: (answers) => `${answers} — разбирает владелец.`,
  },
};

export const menuKa: MenuDict = {
  menu: {
    action: 'ქმედება',
    ownerSorts: (answers) => `${answers} — ახარისხებს მფლობელი.`,
  },
};
