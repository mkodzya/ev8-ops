import { normSecFromMinutes, workCategoryOf } from '@ev8/shared';
import { prisma } from './db.js';

// The book of works (stage 2 of docs/spec/mechanic-in-erp-plan.md).
//
// Until the director sends an export of the live sheet, the book is the
// mechanic bot's own: CATALOG_SEED in tools/mechanic-bot/Code.gs on the
// branch feature/mechanic-bot-prototype, as it stood on 11.10.2026 — copied
// here as is (Mika, 20.10.2026: «берём CATALOG_SEED сейчас с пометкой,
// выгрузку директора сверишь потом»). The bot has names in Georgian and
// Russian and categories in Georgian only; what it does not have stays empty
// and is not translated here (CLAUDE.md, rule 1).

/** Where these rows came from, written on each of them and shown on the screen. */
export const BOT_SOURCE = 'bot-2026-10-11';

/** Code, category (ka), name (ka), name (ru), minutes, the bot's own note. */
export const CATALOG_SEED: readonly (readonly [string, string, string, string, number, string])[] = [
  ['DG-01', 'დიაგნოსტიკა და სერვისი', 'დიაგნოსტიკა', 'Диагностика', 15, ''],
  ['DG-02', 'დიაგნოსტიკა და სერვისი', 'სრული უსაფრთხოების შემოწმება (PDI)', 'Полная проверка безопасности (PDI)', 30, ''],
  ['DG-03', 'დიაგნოსტიკა და სერვისი', 'დაგეგმილი ფლოტის მომსახურება (მუხრუჭები+საბურავები+ჭანჭიკები+აკუმულატორის შემოწმება)', 'Плановое ТО флота (тормоза, шины, болты, проверка АКБ)', 75, ''],
  ['BR-01', 'მუხრუჭები', 'სამუხრუჭე ხუნდების შეცვლა (თითო თვალზე, დისკზე)', 'Замена колодок, дисковый тормоз (одно колесо)', 30, ''],
  ['BR-02', 'მუხრუჭები', 'დოლური სამუხრუჭე ხუნდების შეცვლა (თითო თვალზე)', 'Замена колодок, барабанный тормоз (одно колесо)', 40, ''],
  ['BR-03', 'მუხრუჭები', 'სამუხრუჭე ბაგირის/სახელურის შეცვლა', 'Замена тормозного троса/ручки', 60, ''],
  ['BR-04', 'მუხრუჭები', 'სამუხრუჭე ბაგირის/სახელურის რეგულირება', 'Регулировка тормозного троса/ручки', 20, ''],
  ['BR-05', 'მუხრუჭები', 'სამუხრუჭე დისკის (როტორის) შეცვლა', 'Замена тормозного диска', 40, ''],
  ['BR-06', 'მუხრუჭები', 'სამუხრუჭე სუპორტის შეცვლა/რემონტი', 'Замена/ремонт суппорта', 40, ''],
  ['BR-07', 'მუხრუჭები', 'ჰიდრავლიკური მუხრუჭის სისტემის გაფრქვევა (bleed)', 'Прокачка гидравлических тормозов', 30, ''],
  ['WH-01', 'ბორბლები და საბურავები', 'ბორბლის მოხსნა/დაყენება (საბურავზე მუშაობის გარეშე)', 'Снятие/установка колеса (без работ с шиной)', 20, ''],
  ['WH-02', 'ბორბლები და საბურავები', 'საბურავის/კამერის შეცვლა', 'Замена шины/камеры', 40, ''],
  ['WH-03', 'ბორბლები და საბურავები', 'საბურავის პუნქციის შეკეთება (plug/patch)', 'Ремонт прокола', 10, ''],
  ['MT-01', 'ძრავი და კონტროლერი', 'ძრავის შემოწმება სახელოსნოში (დაშლით)', 'Проверка мотора в мастерской (с разборкой)', 40, ''],
  ['MT-02', 'ძრავი და კონტროლერი', 'ძრავის რემონტი/გადახვევა', 'Ремонт/перемотка мотора', 240, ''],
  ['MT-03', 'ძრავი და კონტროლერი', 'ჰოლის სენსორის შეცვლა', 'Замена датчика Холла', 60, 'В черновике: 60 в списке работ, 75 в тарифах — проверить'],
  ['MT-04', 'ძრავი და კონტროლერი', 'კონტროლერის დიაგნოსტიკა', 'Диагностика контроллера', 30, ''],
  ['MT-05', 'ძრავი და კონტროლერი', 'კონტროლერის შეცვლა', 'Замена контроллера', 45, ''],
  ['MT-06', 'ძრავი და კონტროლერი', 'გაზის სახელურის/სენსორის შეცვლა', 'Замена ручки/датчика газа', 30, ''],
  ['EL-01', 'ელექტროობა', 'დისპლეის შეცვლა', 'Замена дисплея', 30, ''],
  ['EL-02', 'ელექტროობა', 'გაყვანილობის ლოკალური შეკეთება', 'Локальный ремонт проводки', 45, ''],
  ['EL-03', 'ელექტროობა', 'ფარის/სტოპ სინათლის/მოსახვევის ნათურის ან ბლოკის შეცვლა', 'Замена фары/стоп-сигнала/поворотника (лампа или блок)', 60, ''],
  ['EL-04', 'ელექტროობა', 'საყვირის შეცვლა', 'Замена клаксона', 30, ''],
  ['EL-05', 'ელექტროობა', 'ბლანტის/რელეს შეცვლა', 'Замена реле поворотов', 30, ''],
  ['EL-06', 'ელექტროობა', 'დამტენის პორტის (charging port) შეკეთება', 'Ремонт порта зарядки', 30, ''],
  ['EL-07', 'ელექტროობა', 'დამტენის (charger) დიაგნოსტიკა/შეცვლა', 'Диагностика/замена зарядного устройства', 20, ''],
  ['BT-01', 'აკუმულატორი', 'აკუმულატორის დიაგნოსტიკა (BMS-ის შემოწმება)', 'Диагностика АКБ (проверка BMS)', 30, ''],
  ['BT-02', 'აკუმულატორი', 'აკუმულატორის შეცვლა (მხოლოდ ჩანაცვლება)', 'Замена АКБ (только замена)', 45, ''],
  ['SS-01', 'სავალი ნაწილი და საჭე', 'წინა ამორტიზატორის (ვილკის) სერვისი/სალინის შეცვლა', 'Обслуживание вилки / замена сальников', 60, ''],
  ['SS-02', 'სავალი ნაწილი და საჭე', 'უკანა ამორტიზატორის შეცვლა', 'Замена заднего амортизатора', 50, ''],
  ['SS-03', 'სავალი ნაწილი და საჭე', 'საჭის სვეტის საკისრების სერვისი/საჭის გასწორება', 'Подшипники рулевой колонки / выравнивание руля', 100, ''],
  ['LK-01', 'საკეტები და უსაფრთხოება', 'გასაღების/საკეტის ბლოკის შეცვლა', 'Замена замка/блока ключа', 30, ''],
  ['LK-02', 'საკეტები და უსაფრთხოება', 'სიგნალიზაციის/იმობილაიზერის დიაგნოსტიკა', 'Диагностика сигнализации/иммобилайзера', 20, ''],
  ['OT-01', 'სხვა', 'სარკის რეგულირება', 'Регулировка зеркала', 2.5, ''],
];

export interface ImportReport {
  /** Codes written now. */
  added: string[];
  /** Codes already in the book and equal to the source. */
  same: number;
  /** Codes already in the book that differ from the source — reported, never overwritten. */
  differs: { code: string; fields: string[] }[];
}

/**
 * Puts the bot's works into the book. Only what is missing is written: a
 * code already there is left as it is, whoever changed it and however — the
 * book is edited on its own screen, and an import never takes an edit back.
 * What differs from the source is named in the report, so a reconciliation
 * with the director's sheet can say what is different instead of quietly
 * making it so. Running it again writes nothing.
 */
export async function importWorkBook(rows: typeof CATALOG_SEED = CATALOG_SEED, source = BOT_SOURCE): Promise<ImportReport> {
  const report: ImportReport = { added: [], same: 0, differs: [] };
  // The bot's categories in the order the bot lists them.
  const categories: { code: string; nameKa: string; order: number }[] = [];
  for (const [code, categoryKa] of rows) {
    const cat = workCategoryOf(code);
    if (!categories.some((c) => c.code === cat)) categories.push({ code: cat, nameKa: categoryKa, order: categories.length + 1 });
  }
  await prisma.$transaction(async (tx) => {
    for (const c of categories) {
      await tx.workCategory.upsert({ where: { code: c.code }, update: {}, create: { code: c.code, nameKa: c.nameKa, sortOrder: c.order } });
    }
    const have = new Map((await tx.workType.findMany({ where: { code: { in: rows.map((r) => r[0]) } } })).map((w) => [w.code, w]));
    for (const [code, , nameKa, nameRu, minutes, notes] of rows) {
      const normSec = normSecFromMinutes(minutes)!;
      const was = have.get(code);
      if (!was) {
        await tx.workType.create({
          data: { code, category: workCategoryOf(code), nameKa, nameRu, normSec, notes: notes || null, source },
        });
        report.added.push(code);
        continue;
      }
      const fields = [
        was.nameKa !== nameKa && 'nameKa',
        was.nameRu !== nameRu && 'nameRu',
        was.normSec !== normSec && 'normSec',
        (was.notes ?? '') !== notes && 'notes',
        !was.active && 'active',
      ].filter((f): f is string => typeof f === 'string');
      if (fields.length === 0) report.same++;
      else report.differs.push({ code, fields });
    }
  });
  return report;
}
