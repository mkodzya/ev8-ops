// Planned maintenance, repair downtime and the workshop's settings (stage 6
// of the mechanic plan; prototype
// docs/redesign/prototypes/mechanic-maintenance-options.html, variant A,
// chosen by Mika on 21.10.2026; ADR-0038). One file, so the Georgian goes to
// proofreading as one list. The Georgian is the session's translation; the
// director proofreads it. Words EV8 Ops already had — გეგმიური მომსახურება
// (the «planned» reason), გარბენი, კმ — are taken from there; მოცდენა
// (downtime) and the rest are new.

export const workshopMaintenanceEn = {
  wmaint: {
    block: 'Maintenance',
    every: (km: string) => `every ${km} km`,
    mopeds: (n: number) => `${n} ${n === 1 ? 'moped' : 'mopeds'}`,
    rowSub: (due: string, current: string) => `due at ${due} km · mileage ${current}`,
    left: (km: string) => `${km} km left`,
    over: (km: string) => `${km} km over`,
    unknown: (n: number) => `${n} more ${n === 1 ? 'moped has' : 'mopeds have'} no mileage written yet`,
    add: '+ Maintenance',
    underway: (number: string) => `${number} is open`,
    states: { ok: 'On schedule', soon: 'Time for maintenance', overdue: 'Maintenance overdue', unknown: 'No mileage written' } as Record<string, string>,
    next: (km: string) => `Next at ${km} km`,
    mileageFrom: (km: string, source: string, day: string) => `mileage ${km} (${source}, ${day})`,
    sources: { pickup: 'hand-over', return: 'return', repair_open: 'repair opened', repair_close: 'repair closed' } as Record<string, string>,
    lastPlannedAt: (km: string, day: string) => `— the last planned maintenance, ${km} km, ${day}`,
    firstMark: 'No planned maintenance in EV8 Ops yet: the mark is the nearest multiple of the interval from the first mileage written',
    noMileage: 'Maintenance is counted once a pickup, a return or a repair writes the mileage.',
    // Downtime of a repair.
    downtime: 'Downtime',
    hours: (h: string) => `${h} h`,
    minutes: (m: number) => `${m} min`,
    waited: (span: string) => `of it waiting for approval ${span}`,
    sofar: (span: string) => `downtime so far ${span}`,
    noData: 'no data',
    period30: (span: string) => `downtime ${span} over 30 days`,
    repairsLine: 'Downtime in repair',
    repairsValue: (span: string, wait: string) => `${span} · waiting for approval ${wait}`,
    repairsUnknown: (n: number) => `${n} without times`,
    // Settings → Repair.
    rate: 'Company rate for an hour of norm, ₾',
    rateHint: 'For a mechanic without his own rate. Works already written keep theirs.',
    interval: 'Planned maintenance every, km',
    warn: '«Time for maintenance» when less than, km, is left',
    saved: 'Saved',
  },
};

type WorkshopMaintenance = typeof workshopMaintenanceEn;

/** 1 мопед, 2 мопеда, 5 мопедов. */
function ruMopeds(n: number): string {
  const ten = n % 10;
  const hundred = n % 100;
  if (ten === 1 && hundred !== 11) return 'мопед';
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'мопеда';
  return 'мопедов';
}

export const workshopMaintenanceRu: WorkshopMaintenance = {
  wmaint: {
    block: 'ТО',
    every: (km) => `каждые ${km} км`,
    mopeds: (n) => `${n} ${ruMopeds(n)}`,
    rowSub: (due, current) => `ТО на ${due} км · пробег ${current}`,
    left: (km) => `осталось ${km} км`,
    over: (km) => `просрочено на ${km} км`,
    unknown: (n) => `ещё у ${n} ${ruMopeds(n) === 'мопед' ? 'мопеда' : 'мопедов'} пробег не записан`,
    add: '＋ ТО',
    underway: (number) => `${number} уже открыта`,
    states: { ok: 'По графику', soon: 'Пора на ТО', overdue: 'ТО просрочено', unknown: 'Пробег не записан' },
    next: (km) => `Следующее ТО на ${km} км`,
    mileageFrom: (km, source, day) => `пробег ${km} (${source}, ${day})`,
    sources: { pickup: 'выдача', return: 'возврат', repair_open: 'открытие ремонта', repair_close: 'закрытие ремонта' },
    lastPlannedAt: (km, day) => `— последнее ТО, ${km} км, ${day}`,
    firstMark: 'Плановых ТО в EV8 Ops ещё не было: отметка — ближайшая кратная интервалу от первого записанного пробега',
    noMileage: 'ТО посчитается после выдачи, возврата или заявки, где записан пробег.',
    downtime: 'Простой',
    hours: (h) => `${h} ч`,
    minutes: (m) => `${m} мин`,
    waited: (span) => `из них ожидание согласования ${span}`,
    sofar: (span) => `простой сейчас ${span}`,
    noData: 'нет данных',
    period30: (span) => `простой ${span} за 30 дней`,
    repairsLine: 'Простой в ремонте',
    repairsValue: (span, wait) => `${span} · ожидание согласования ${wait}`,
    repairsUnknown: (n) => `${n} без времени`,
    rate: 'Ставка компании за час нормы, ₾',
    rateHint: 'Для механика без своей ставки. Записанные работы не пересчитываются.',
    interval: 'Плановое ТО каждые, км',
    warn: '«Пора на ТО», когда осталось меньше, км',
    saved: 'Сохранено',
  },
};

export const workshopMaintenanceKa: WorkshopMaintenance = {
  wmaint: {
    block: 'გეგმიური მომსახურება',
    every: (km) => `ყოველ ${km} კმ-ში`,
    mopeds: (n) => `${n} მოპედი`,
    rowSub: (due, current) => `ნიშნული ${due} კმ · გარბენი ${current}`,
    left: (km) => `დარჩა ${km} კმ`,
    over: (km) => `გადაცილება ${km} კმ`,
    unknown: (n) => `კიდევ ${n} მოპედს გარბენი ჯერ არ აქვს ჩაწერილი`,
    add: '＋ მომსახურება',
    underway: (number) => `${number} უკვე გახსნილია`,
    states: { ok: 'გრაფიკით', soon: 'მომსახურების დროა', overdue: 'მომსახურება ვადაგადაცილებულია', unknown: 'გარბენი არ არის ჩაწერილი' },
    next: (km) => `შემდეგი — ${km} კმ-ზე`,
    mileageFrom: (km, source, day) => `გარბენი ${km} (${source}, ${day})`,
    sources: { pickup: 'გაცემა', return: 'დაბრუნება', repair_open: 'შეკეთების გახსნა', repair_close: 'შეკეთების დახურვა' },
    lastPlannedAt: (km, day) => `— ბოლო გეგმიური მომსახურება, ${km} კმ, ${day}`,
    firstMark: 'EV8 Ops-ში გეგმიური მომსახურება ჯერ არ ყოფილა: ნიშნული — პირველი ჩაწერილი გარბენიდან ინტერვალის უახლოესი ჯერადი',
    noMileage: 'მომსახურება დაითვლება გაცემის, დაბრუნების ან შეკეთების შემდეგ, სადაც გარბენი ჩაიწერება.',
    downtime: 'მოცდენა',
    hours: (h) => `${h} სთ`,
    minutes: (m) => `${m} წთ`,
    waited: (span) => `აქედან დამტკიცების მოლოდინი ${span}`,
    sofar: (span) => `მოცდენა ახლა ${span}`,
    noData: 'მონაცემი არ არის',
    period30: (span) => `მოცდენა ${span} 30 დღეში`,
    repairsLine: 'მოცდენა შეკეთებაში',
    repairsValue: (span, wait) => `${span} · დამტკიცების მოლოდინი ${wait}`,
    repairsUnknown: (n) => `${n} დროის გარეშე`,
    rate: 'კომპანიის განაკვეთი ნორმა-საათზე, ₾',
    rateHint: 'მექანიკოსისთვის, რომელსაც საკუთარი განაკვეთი არ აქვს. ჩაწერილი სამუშაოები არ გადაითვლება.',
    interval: 'გეგმიური მომსახურება ყოველ, კმ',
    warn: '„მომსახურების დროა“, როცა დარჩა ნაკლები, კმ',
    saved: 'შენახულია',
  },
};
