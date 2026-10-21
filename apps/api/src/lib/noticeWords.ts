// The words of the notices to the workshop's Telegram group (stage 6;
// ADR-0038 §6): every notice in two languages, the Georgian line first and the
// Russian one under it (Mika, 21.10.2026: «два языка в одном сообщении —
// грузинский сверху, русский ниже»). One file, so the Georgian goes to the
// director for proofreading as one list. The Georgian is the session's
// translation; where the app already has the word (`apps/web/src/i18n/
// workshop-*.ts`, `wave5-service.ts`) it is that word: ელოდება დამტკიცებას,
// დამტკიცდა, უარყოფილია, დაიხურა, გეგმიური მომსახურება, მინიმუმზე ნაკლები,
// ნაშთი, გვქონდეს არანაკლებ.
//
// What goes in is already escaped for Telegram's HTML; the words add only
// the bold. No money and no customer is ever named here (ADR-0038 §6): a
// repair is its number and its moped, a person is the mechanic or whoever
// decided.

export type NoticeLang = 'ka' | 'ru';

/** A repair as a notice names it: its number and its moped's. */
export interface JobRef {
  number: string;
  moped: string;
}

/** Who stands behind the repair: its mechanic, or — a breakdown reported from the office — who reported it. */
export interface JobPeople {
  mechanic: string | null;
  reporter?: string | null;
  /** Who approved or refused. */
  by?: string | null;
}

/** What waits: the repair itself, or what was added to one already approved. */
export type Waiting = 'repair' | 'work' | 'part';

export interface NoticeWords {
  waiting: (j: JobRef, what: Waiting, p: JobPeople, reason: string | null) => string;
  approved: (j: JobRef, again: boolean, p: JobPeople) => string;
  rejected: (j: JobRef, whole: boolean, p: JobPeople) => string;
  closed: (j: JobRef, p: JobPeople, downtime: string | null) => string;
  maintenanceSoon: (moped: string, dueKm: string, currentKm: string, leftKm: string) => string;
  maintenanceOverdue: (moped: string, dueKm: string, currentKm: string, overKm: string) => string;
  stockLow: (name: string, onHand: string, minQty: string) => string;
  /** The repair's reason, as the mechanic picked it (SERVICE_REASONS). */
  reasons: Record<string, string>;
  minutes: string;
  hours: string;
}

const tail = (parts: (string | null | undefined | false)[]): string => parts.filter(Boolean).map((p) => ` · ${p}`).join('');
const job = (j: JobRef): string => `<b>${j.number}</b> · ${j.moped}`;

const ka: NoticeWords = {
  waiting: (j, what, p, reason) =>
    `🔧 შეკეთება ${job(j)}${what === 'repair' ? ' ელოდება დამტკიცებას' : what === 'work' ? ': ახალი სამუშაო ელოდება დამტკიცებას' : ': ნაყიდი ნაწილი ელოდება დამტკიცებას'}` +
    tail([p.mechanic ? `მექანიკოსი: ${p.mechanic}` : p.reporter ? `შეატყობინა: ${p.reporter}` : null, reason]),
  approved: (j, again, p) =>
    `✅ შეკეთება ${job(j)}${again ? ': დამატებული დამტკიცდა — სამუშაო გრძელდება' : ' დამტკიცდა — მუშავდება'}` +
    tail([p.mechanic && `მექანიკოსი: ${p.mechanic}`, p.by && `დაამტკიცა: ${p.by}`]),
  rejected: (j, whole, p) =>
    `❌ შეკეთება ${job(j)}${whole ? ' უარყოფილია' : ': დამატებული უარყოფილია — დანარჩენი შეკეთება გრძელდება'}` +
    tail([p.mechanic && `მექანიკოსი: ${p.mechanic}`, p.by && `უარყო: ${p.by}`]),
  closed: (j, p, downtime) => `🏁 შეკეთება ${job(j)} დაიხურა` + tail([p.mechanic && `მექანიკოსი: ${p.mechanic}`, downtime && `მოცდენა ${downtime}`]),
  maintenanceSoon: (moped, due, current, left) => `🛠 მოპედი <b>${moped}</b>: გეგმიური მომსახურების დროა — ნიშნული ${due} კმ, ახლა ${current} კმ, დარჩა ${left} კმ`,
  maintenanceOverdue: (moped, due, current, over) =>
    `🛠 მოპედი <b>${moped}</b>: გეგმიური მომსახურება ვადაგადაცილებულია — ნიშნული ${due} კმ, ახლა ${current} კმ, გადაცილება ${over} კმ`,
  stockLow: (name, onHand, min) => `📦 <b>${name}</b> მინიმუმზე ნაკლებია: ნაშთი ${onHand}, გვქონდეს არანაკლებ ${min}`,
  reasons: { wear: 'ცვეთა', accident: 'ავარია', renter_fault: 'მოიჯარის ბრალი', warranty: 'გარანტია', planned: 'გეგმიური მომსახურება' },
  minutes: 'წთ',
  hours: 'სთ',
};

const ru: NoticeWords = {
  waiting: (j, what, p, reason) =>
    `Ремонт ${job(j)}${what === 'repair' ? ' ждёт согласования' : what === 'work' ? ': новая работа ждёт согласования' : ': купленная деталь ждёт согласования'}` +
    tail([p.mechanic ? `механик: ${p.mechanic}` : p.reporter ? `сообщил(а): ${p.reporter}` : null, reason]),
  approved: (j, again, p) =>
    `Ремонт ${job(j)}${again ? ': добавленное согласовано — работа продолжается' : ' согласован — в работе'}` +
    tail([p.mechanic && `механик: ${p.mechanic}`, p.by && `согласовал(а): ${p.by}`]),
  rejected: (j, whole, p) =>
    `Ремонт ${job(j)}${whole ? ' отклонён' : ': добавленное отклонено — остальной ремонт продолжается'}` +
    tail([p.mechanic && `механик: ${p.mechanic}`, p.by && `отклонил(а): ${p.by}`]),
  closed: (j, p, downtime) => `Ремонт ${job(j)} закрыт` + tail([p.mechanic && `механик: ${p.mechanic}`, downtime && `простой ${downtime}`]),
  maintenanceSoon: (moped, due, current, left) => `Мопед <b>${moped}</b>: пора на ТО — отметка ${due} км, сейчас ${current} км, осталось ${left} км`,
  maintenanceOverdue: (moped, due, current, over) => `Мопед <b>${moped}</b>: ТО просрочено — отметка ${due} км, сейчас ${current} км, перепробег ${over} км`,
  stockLow: (name, onHand, min) => `Деталь <b>${name}</b> ниже минимума: остаток ${onHand}, держать не меньше ${min}`,
  reasons: { wear: 'износ', accident: 'ДТП', renter_fault: 'вина арендатора', warranty: 'гарантия', planned: 'плановое ТО' },
  minutes: 'мин',
  hours: 'ч',
};

/** Georgian first, Russian under it. */
export const NOTICE_LANGS: readonly NoticeLang[] = ['ka', 'ru'];
export const NOTICE_WORDS: Record<NoticeLang, NoticeWords> = { ka, ru };
