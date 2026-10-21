// The workshops list in Settings → Repair (owner's decision of 21.10.2026):
// add, rename, take off the list, put back. One file, so the Georgian goes to
// proofreading as one list (docs/qa/workshops-list-ka-strings.md). The
// Georgian is the session's translation; the director proofreads it. It says
// სახელოსნო, as the journal and the errors already do; the older field label
// ხელოსნები (wave5-service.ts) is left for the director to align.

export const workshopsEn = {
  wshop: {
    title: 'Workshops',
    count: (n: number) => `${n} on the list`,
    hint: 'Who does the repairs. «Open a repair» offers this list.',
    add: 'Workshop',
    addTitle: 'New workshop',
    editTitle: 'Workshop',
    name: 'Name',
    phone: 'Phone',
    note: 'Note',
    renameHint: 'Every repair of this workshop will show the new name. A different workshop is added as a new one.',
    jobs: (n: number) => (n === 0 ? 'no repairs yet' : `${n} ${n === 1 ? 'repair' : 'repairs'}`),
    edit: 'Edit',
    archive: 'Take off the list',
    restore: 'Put back',
    archived: 'off the list',
    archivedToast: (name: string, open: number) =>
      open > 0 ? `«${name}» is off the list. ${open} open ${open === 1 ? 'repair stays' : 'repairs stay'} with it` : `«${name}» is off the list`,
    restoredToast: (name: string) => `«${name}» is back on the list`,
    added: (name: string) => `«${name}» is on the list`,
    empty: 'No workshops yet. Add the first one, and «Open a repair» will offer it.',
    editList: 'Edit the list',
  },
};

type Workshops = typeof workshopsEn;

/** 1 ремонт, 2 ремонта, 5 ремонтов. */
function ruPlural(n: number, one: string, few: string, many: string): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return one;
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return few;
  return many;
}

export const workshopsRu: Workshops = {
  wshop: {
    title: 'Мастерские',
    count: (n) => `${n} в списке`,
    hint: 'Кто делает ремонты. Этот список — в «Открыть ремонт».',
    add: 'Мастерская',
    addTitle: 'Новая мастерская',
    editTitle: 'Мастерская',
    name: 'Название',
    phone: 'Телефон',
    note: 'Заметка',
    renameHint: 'Новое имя увидят все ремонты этой мастерской. Другая мастерская — добавьте новую.',
    jobs: (n) => (n === 0 ? 'ремонтов ещё нет' : `${n} ${ruPlural(n, 'ремонт', 'ремонта', 'ремонтов')}`),
    edit: 'Изменить',
    archive: 'Убрать из списка',
    restore: 'Вернуть',
    archived: 'убрана',
    archivedToast: (name, open) =>
      open > 0
        ? `«${name}» убрана из списка. ${open} ${ruPlural(open, 'открытый ремонт остаётся', 'открытых ремонта остаются', 'открытых ремонтов остаются')} за ней`
        : `«${name}» убрана из списка`,
    restoredToast: (name) => `«${name}» снова в списке`,
    added: (name) => `«${name}» в списке`,
    empty: 'Мастерских пока нет. Добавьте первую — её можно будет выбрать в «Открыть ремонт».',
    editList: 'Изменить список',
  },
};

export const workshopsKa: Workshops = {
  wshop: {
    title: 'სახელოსნოები',
    count: (n) => `სიაში ${n}`,
    hint: 'ვინ აკეთებს შეკეთებებს. ეს სია ჩანს «შეკეთების გახსნაში».',
    add: 'სახელოსნო',
    addTitle: 'ახალი სახელოსნო',
    editTitle: 'სახელოსნო',
    name: 'დასახელება',
    phone: 'ტელეფონი',
    note: 'შენიშვნა',
    renameHint: 'ახალ სახელს დაინახავს ამ სახელოსნოს ყველა შეკეთება. სხვა სახელოსნოა — დაამატეთ ახალი.',
    jobs: (n) => (n === 0 ? 'შეკეთებები ჯერ არ არის' : `${n} შეკეთება`),
    edit: 'შეცვლა',
    archive: 'სიიდან მოხსნა',
    restore: 'დაბრუნება',
    archived: 'მოხსნილია',
    archivedToast: (name, open) => (open > 0 ? `«${name}» სიიდან მოიხსნა. ${open} ღია შეკეთება მასთან რჩება` : `«${name}» სიიდან მოიხსნა`),
    restoredToast: (name) => `«${name}» ისევ სიაშია`,
    added: (name) => `«${name}» სიაშია`,
    empty: 'სახელოსნოები ჯერ არ არის. დაამატეთ პირველი — ის «შეკეთების გახსნაში» გამოჩნდება.',
    editList: 'სიის შეცვლა',
  },
};
