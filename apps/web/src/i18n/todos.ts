// «Задачи» — GitHub issue #18 of the director, part A (Mika's «А» of
// 28.10.2026; ADR-0050): the section, its sheets, the block first on
// «Сегодня», a mechanic's own «Сегодня» and the tablet's sections. One file,
// so the Georgian goes to proofreading as one list
// (docs/qa/issue-18-a-tasks-ka-strings.md).
//
// The word «Задачи» / «დავალებები» / «Tasks» is this section's alone: the
// queue «Сегодня» builds from the data is «Сегодня» and its rows, never
// tasks (the director's issue, «Чтобы не задвоить»).

const ruPlural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const enOrdinal = (n: number): string => {
  const m100 = n % 100;
  if (m100 >= 11 && m100 <= 13) return `${n}th`;
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
};

export const todosEn = {
  todos: {
    /** The page's heading and the quiet count beside it. */
    title: 'Tasks',
    count: (open: number, late: number) => `${open} open${late > 0 ? ` · ${late} overdue` : ''}`,
    add: 'Task',
    /** «⋯ → Поручить» on a moped's, a rental's or a customer's card. */
    give: 'Set a task',
    /** The chips of an owner: his own first, «All» last (issue #17). */
    mine: 'Mine',
    groups: { overdue: 'Overdue', today: 'Today', tomorrow: 'Tomorrow', week: 'This week', later: 'Later' } as Record<string, string>,
    done: 'Done',
    doneSub: (n: number) => `in 7 days · ${n}`,
    moreDone: (n: number) => `${n} more done — show`,
    empty: 'No tasks',
    emptySub: 'Here go the tasks set by hand: a declaration every month, a round of the parking on Mondays. What «Today» finds by itself stays there.',
    emptyOther: 'Nothing open here.',
    /** The day on a row: «15.10 · −10 d.» */
    lateBy: (n: number) => `−${n} d.`,
    /** The repeat's tag: «↻ every week, Mon», «↻ every month, the 15th». */
    weekly: (weekday: string) => `every week, ${weekday}`,
    monthly: (day: number) => `every month, the ${enOrdinal(day)}`,
    fileTag: 'photo or file needed',
    setBy: (name: string) => `set by ${name}`,
    self: 'Myself',
    /** Under a task shown ahead: when it comes onto «Today». */
    shownFrom: (date: string, n: number) => `on «Today» from ${date} — ${n} ${n === 1 ? 'day' : 'days'} ahead`,
    closedBy: (name: string, date: string, time: string) => `closed by ${name} on ${date} at ${time}`,
    closedByRecord: {
      rental: 'closed by itself: the rental was returned',
      vehicle: 'closed by itself: the moped left the fleet',
    } as Record<string, string>,
    files: (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`,
    /** What a task is about, by kind. */
    linkKinds: { vehicle: 'Moped', rental: 'Rental', customer: 'Customer' } as Record<string, string>,
    repeats: { none: 'No', weekly: 'Every week', monthly: 'Every month' } as Record<string, string>,

    form: {
      newTitle: 'New task',
      editTitle: 'Change the task',
      text: 'What to do',
      assignee: 'To whom',
      due: 'Due',
      lead: 'Show ahead',
      leadNone: 'No',
      leadDays: (n: number) => `${n} ${n === 1 ? 'day' : 'days'} ahead`,
      repeat: 'Repeat',
      /** The repeat's day in the hint, Monday first: «Every Monday». */
      everyWeekday: ['Every Monday', 'Every Tuesday', 'Every Wednesday', 'Every Thursday', 'Every Friday', 'Every Saturday', 'Every Sunday'],
      weeklyHint: (every: string) => `${every}. The next one comes by itself, even if this one is not closed.`,
      monthlyHint: (day: number) => `Every month, the ${enOrdinal(day)} (the last day of a shorter month). The next one comes by itself, even if this one is not closed.`,
      leadHint: (date: string) => `On «Today» from ${date}.`,
      needsFile: 'A photo or a file is needed to close it',
      link: 'About (optional)',
      linkFind: 'Moped, rental or customer — number or name',
      linkMechanic: 'A task for a mechanic is about a moped only.',
      linkRemove: 'Remove',
      linkNothing: 'Nothing found',
      note: 'Comment',
      noteHint: 'For example: a screenshot of the confirmation',
      submit: 'Set the task',
      save: 'Save',
      rules: 'Whoever set a task changes or deletes it. Whoever it is for closes it and writes a comment.',
    },

    card: {
      title: 'Task',
      dueOn: (date: string) => `due ${date}`,
      lateBy: (n: number) => `overdue by ${n} ${n === 1 ? 'day' : 'days'}`,
      setNote: 'Comment of whoever set it',
      fileNeeded: 'A photo or a file is needed to close it.',
      addFile: 'Take a photo or choose a file',
      adding: 'Adding…',
      cannotRead: (name: string) => `Could not read ${name}`,
      yourNote: 'Your comment',
      optional: 'Optional',
      done: 'Done',
      closedNote: 'Comment',
      edit: 'Change',
      remove: 'Delete',
      removeAsk: 'Delete this task? It goes from the list; the journal keeps it.',
      removeRepeat: 'The repeat goes on: the next one comes by itself — unless you stop it.',
      removeOne: 'Delete this one',
      removeStop: 'Delete and stop repeating',
      reopen: 'Open again',
      openCard: 'Open the card',
    },

    toast: {
      set: 'Task set',
      saved: 'Task changed',
      done: (text: string) => `Done: ${text}`,
      removed: 'Task deleted',
      reopened: 'Task open again',
    },

    /** The block first on «Today»: what is late and what is today’s. */
    today: {
      all: 'all tasks →',
    },

    /** The words of the journal’s «was → is» for a task changed. */
    journal: {
      text: 'What to do',
      note: 'Comment',
      dueOn: 'Due',
      leadDays: 'Show ahead',
      needsFile: 'Photo or file',
      assignee: 'To whom',
      link: 'About',
      repeat: 'Repeat',
    } as Record<string, string>,
    /** The values of `link` and `repeat` in the journal. */
    journalLink: { vehicle: 'moped', rental: 'rental', customer: 'customer' } as Record<string, string>,
    journalRepeat: { none: 'no repeat', weekly: 'every week', monthly: 'every month' } as Record<string, string>,

    /** A mechanic's own «Today» (ADR-0050): his tasks, his repairs, the maintenance, his payout. */
    workshop: {
      repairs: 'My repairs',
      waiting: (n: number) => `Awaiting approval · ${n}`,
      working: (n: number) => `In work · ${n}`,
      noRepairs: 'No repair of yours is open.',
      toApprove: 'To approve',
      toApproveN: (n: number) => `${n} ${n === 1 ? 'repair waits' : 'repairs wait'} for approval`,
      maintenance: 'Planned maintenance',
      maintenanceDue: (n: number) => `${n} ${n === 1 ? 'moped is' : 'mopeds are'} due`,
      maintenanceLate: (n: number) => `of them past the mark · ${n}`,
      maintenanceNone: 'No moped is due.',
      payout: 'My payout',
      payoutNow: (sum: string) => `Owed now: ${sum}`,
      payoutNone: 'Nothing is owed now.',
      all: 'all →',
    },

    /** What the grey number beside «Today» counts, for a screen reader: the queue’s rows, not tasks. */
    queueSaid: 'rows in the queue',
    /** The two numbers beside «Tasks». */
    saidLate: 'tasks overdue',
    saidToday: 'tasks for today',
  },
};

export const todosRu: typeof todosEn = {
  todos: {
    title: 'Задачи',
    count: (open, late) => `${open} открыто${late > 0 ? ` · ${late} просрочено` : ''}`,
    add: 'Задача',
    give: 'Поручить',
    mine: 'Мои',
    groups: { overdue: 'Просрочено', today: 'Сегодня', tomorrow: 'Завтра', week: 'Эта неделя', later: 'Позже' },
    done: 'Сделано',
    doneSub: (n) => `за 7 дней · ${n}`,
    moreDone: (n) => `Ещё ${n} ${ruPlural(n, 'сделанная', 'сделанных', 'сделанных')} — показать`,
    empty: 'Задач нет',
    emptySub: 'Сюда попадают задачи, поставленные вручную: декларация каждый месяц, обход парковки по понедельникам. То, что «Сегодня» находит само, остаётся там.',
    emptyOther: 'Здесь открытых задач нет.',
    lateBy: (n) => `−${n} дн.`,
    // Mid-sentence the day is lower case, as in the director's mockup («↻ каждую неделю, пн»); the calendar's head keeps «Пн».
    weekly: (weekday) => `каждую неделю, ${weekday.toLowerCase()}`,
    monthly: (day) => `каждый месяц, ${day}-го`,
    fileTag: 'нужно фото или файл',
    setBy: (name) => `поставил(а) ${name}`,
    self: 'Себе',
    shownFrom: (date, n) => `на «Сегодня» с ${date} — за ${n} ${ruPlural(n, 'день', 'дня', 'дней')}`,
    closedBy: (name, date, time) => `закрыл(а) ${name} ${date} в ${time}`,
    closedByRecord: {
      rental: 'закрылась сама: аренда возвращена',
      vehicle: 'закрылась сама: мопед выбыл из парка',
    },
    files: (n) => `${n} ${ruPlural(n, 'файл', 'файла', 'файлов')}`,
    linkKinds: { vehicle: 'Мопед', rental: 'Аренда', customer: 'Клиент' },
    repeats: { none: 'Нет', weekly: 'Каждую неделю', monthly: 'Каждый месяц' },

    form: {
      newTitle: 'Новая задача',
      editTitle: 'Изменить задачу',
      text: 'Что сделать',
      assignee: 'Кому',
      due: 'Срок',
      lead: 'Показать заранее',
      leadNone: 'Нет',
      leadDays: (n) => `за ${n} ${ruPlural(n, 'день', 'дня', 'дней')}`,
      repeat: 'Повтор',
      everyWeekday: ['Каждый понедельник', 'Каждый вторник', 'Каждую среду', 'Каждый четверг', 'Каждую пятницу', 'Каждую субботу', 'Каждое воскресенье'],
      weeklyHint: (every) => `${every}. Следующая появится сама, даже если эту не закроют.`,
      monthlyHint: (day) => `Каждый месяц, ${day}-го (в коротком месяце — в последний день). Следующая появится сама, даже если эту не закроют.`,
      leadHint: (date) => `На «Сегодня» с ${date}.`,
      needsFile: 'Нужно фото или файл, чтобы закрыть',
      link: 'Привязать (необязательно)',
      linkFind: 'Мопед, аренда или клиент — номер или имя',
      linkMechanic: 'Задачу механику можно привязать только к мопеду.',
      linkRemove: 'Убрать',
      linkNothing: 'Ничего не нашлось',
      note: 'Комментарий',
      noteHint: 'Например: скрин подтверждения',
      submit: 'Поставить задачу',
      save: 'Сохранить',
      rules: 'Изменить или удалить задачу может тот, кто её поставил. Исполнитель закрывает и пишет комментарий.',
    },

    card: {
      title: 'Задача',
      dueOn: (date) => `срок ${date}`,
      lateBy: (n) => `просрочена на ${n} ${ruPlural(n, 'день', 'дня', 'дней')}`,
      setNote: 'Комментарий того, кто поставил',
      fileNeeded: 'Нужно фото или файл, чтобы закрыть.',
      addFile: 'Сфотографировать или выбрать файл',
      adding: 'Добавляем…',
      cannotRead: (name) => `Не удалось прочитать ${name}`,
      yourNote: 'Ваш комментарий',
      optional: 'Необязательно',
      done: 'Сделано',
      closedNote: 'Комментарий',
      edit: 'Изменить',
      remove: 'Удалить',
      removeAsk: 'Удалить задачу? Из списка она уйдёт, журнал её сохранит.',
      removeRepeat: 'Повтор останется: следующая появится сама — если не остановить его.',
      removeOne: 'Удалить эту',
      removeStop: 'Удалить и не повторять',
      reopen: 'Вернуть в работу',
      openCard: 'Открыть карточку',
    },

    toast: {
      set: 'Задача поставлена',
      saved: 'Задача изменена',
      done: (text) => `Сделано: ${text}`,
      removed: 'Задача удалена',
      reopened: 'Задача снова в работе',
    },

    today: {
      all: 'все задачи →',
    },

    journal: {
      text: 'Что сделать',
      note: 'Комментарий',
      dueOn: 'Срок',
      leadDays: 'Показать заранее',
      needsFile: 'Фото или файл',
      assignee: 'Кому',
      link: 'Привязка',
      repeat: 'Повтор',
    },
    journalLink: { vehicle: 'мопед', rental: 'аренда', customer: 'клиент' },
    journalRepeat: { none: 'без повтора', weekly: 'каждую неделю', monthly: 'каждый месяц' },

    workshop: {
      repairs: 'Мои ремонты',
      waiting: (n) => `Ждут согласования · ${n}`,
      working: (n) => `В работе · ${n}`,
      noRepairs: 'Открытых ремонтов у вас нет.',
      toApprove: 'Согласовать',
      toApproveN: (n) => `${n} ${ruPlural(n, 'ремонт ждёт', 'ремонта ждут', 'ремонтов ждут')} согласования`,
      maintenance: 'Плановое ТО',
      maintenanceDue: (n) => `Пора на ТО · ${n} ${ruPlural(n, 'мопед', 'мопеда', 'мопедов')}`,
      maintenanceLate: (n) => `из них просрочено · ${n}`,
      maintenanceNone: 'Пора на ТО — ни одного мопеда.',
      payout: 'Моя выплата',
      payoutNow: (sum) => `К оплате сейчас: ${sum}`,
      payoutNone: 'Сейчас к оплате ничего.',
      all: 'все →',
    },

    queueSaid: 'строк в очереди',
    saidLate: 'задач просрочено',
    saidToday: 'задач на сегодня',
  },
};

export const todosKa: typeof todosEn = {
  todos: {
    title: 'დავალებები',
    count: (open, late) => `${open} ღიაა${late > 0 ? ` · ${late} ვადაგადაცილებულია` : ''}`,
    add: 'დავალება',
    give: 'დავალების მიცემა',
    mine: 'ჩემი',
    groups: { overdue: 'ვადაგადაცილებული', today: 'დღეს', tomorrow: 'ხვალ', week: 'ამ კვირაში', later: 'მოგვიანებით' },
    done: 'შესრულებული',
    doneSub: (n) => `7 დღეში · ${n}`,
    moreDone: (n) => `კიდევ ${n} შესრულებული — ჩვენება`,
    empty: 'დავალებები არ არის',
    emptySub: 'აქ ხვდება ხელით მიცემული დავალებები: დეკლარაცია ყოველ თვეს, პარკინგის შემოვლა ორშაბათობით. რასაც «დღეს» თვითონ პოულობს, იქვე რჩება.',
    emptyOther: 'აქ ღია დავალებები არ არის.',
    lateBy: (n) => `−${n} დღე`,
    weekly: (weekday) => `ყოველ კვირას, ${weekday}`,
    monthly: (day) => `ყოველ თვეს, ${day} რიცხვში`,
    fileTag: 'საჭიროა ფოტო ან ფაილი',
    setBy: (name) => `დაავალა ${name}`,
    self: 'ჩემთვის',
    shownFrom: (date, n) => `«დღეს»-ში ${date}-დან — ${n} დღით ადრე`,
    closedBy: (name, date, time) => `დახურა ${name} ${date}, ${time}`,
    closedByRecord: {
      rental: 'თავისით დაიხურა: ქირაობა დაბრუნდა',
      vehicle: 'თავისით დაიხურა: მოპედი პარკიდან გავიდა',
    },
    files: (n) => `${n} ფაილი`,
    linkKinds: { vehicle: 'მოპედი', rental: 'ქირაობა', customer: 'კლიენტი' },
    repeats: { none: 'არა', weekly: 'ყოველ კვირას', monthly: 'ყოველ თვეს' },

    form: {
      newTitle: 'ახალი დავალება',
      editTitle: 'დავალების შეცვლა',
      text: 'რა უნდა გაკეთდეს',
      assignee: 'ვის',
      due: 'ვადა',
      lead: 'წინასწარ ჩვენება',
      leadNone: 'არა',
      leadDays: (n) => `${n} დღით ადრე`,
      repeat: 'გამეორება',
      // «კვირა» is both the week and Sunday: «ყოველ კვირას» said again the chip just pressed («every week»).
      everyWeekday: ['ყოველ ორშაბათს', 'ყოველ სამშაბათს', 'ყოველ ოთხშაბათს', 'ყოველ ხუთშაბათს', 'ყოველ პარასკევს', 'ყოველ შაბათს', 'ყოველ კვირა დღეს'],
      weeklyHint: (every) => `${every}. შემდეგი თავისით გამოჩნდება, ეს რომ არ დაიხუროს, მაინც.`,
      monthlyHint: (day) => `ყოველ თვეს, ${day} რიცხვში (მოკლე თვეში — ბოლო დღეს). შემდეგი თავისით გამოჩნდება, ეს რომ არ დაიხუროს, მაინც.`,
      leadHint: (date) => `«დღეს»-ში ${date}-დან.`,
      needsFile: 'დასახურად საჭიროა ფოტო ან ფაილი',
      link: 'მიბმა (არასავალდებულო)',
      linkFind: 'მოპედი, ქირაობა ან კლიენტი — ნომერი ან სახელი',
      linkMechanic: 'მექანიკოსის დავალება მხოლოდ მოპედს შეიძლება მიება.',
      linkRemove: 'მოხსნა',
      linkNothing: 'ვერაფერი მოიძებნა',
      note: 'კომენტარი',
      noteHint: 'მაგალითად: დადასტურების სქრინი',
      submit: 'დავალების მიცემა',
      save: 'შენახვა',
      rules: 'დავალებას ცვლის ან შლის ის, ვინც მისცა. შემსრულებელი ხურავს და წერს კომენტარს.',
    },

    card: {
      title: 'დავალება',
      dueOn: (date) => `ვადა ${date}`,
      lateBy: (n) => `ვადა გადაცილებულია ${n} დღით`,
      setNote: 'დამვალებლის კომენტარი',
      fileNeeded: 'დასახურად საჭიროა ფოტო ან ფაილი.',
      addFile: 'გადაიღეთ ფოტო ან აირჩიეთ ფაილი',
      adding: 'ემატება…',
      cannotRead: (name) => `ვერ წავიკითხეთ ${name}`,
      yourNote: 'თქვენი კომენტარი',
      optional: 'არასავალდებულო',
      done: 'შესრულდა',
      closedNote: 'კომენტარი',
      edit: 'შეცვლა',
      remove: 'წაშლა',
      removeAsk: 'წავშალოთ დავალება? სიიდან გაქრება, ჟურნალი შეინახავს.',
      removeRepeat: 'გამეორება რჩება: შემდეგი თავისით გამოჩნდება — თუ არ შეაჩერებთ.',
      removeOne: 'მხოლოდ ამის წაშლა',
      removeStop: 'წაშლა და გამეორების შეჩერება',
      reopen: 'ხელახლა გახსნა',
      openCard: 'ბარათის გახსნა',
    },

    toast: {
      set: 'დავალება მიცემულია',
      saved: 'დავალება შეიცვალა',
      done: (text) => `შესრულდა: ${text}`,
      removed: 'დავალება წაიშალა',
      reopened: 'დავალება ხელახლა ღიაა',
    },

    today: {
      all: 'ყველა დავალება →',
    },

    journal: {
      text: 'რა უნდა გაკეთდეს',
      note: 'კომენტარი',
      dueOn: 'ვადა',
      leadDays: 'წინასწარ ჩვენება',
      needsFile: 'ფოტო ან ფაილი',
      assignee: 'ვის',
      link: 'მიბმა',
      repeat: 'გამეორება',
    },
    journalLink: { vehicle: 'მოპედი', rental: 'ქირაობა', customer: 'კლიენტი' },
    journalRepeat: { none: 'გამეორების გარეშე', weekly: 'ყოველ კვირას', monthly: 'ყოველ თვეს' },

    workshop: {
      repairs: 'ჩემი რემონტები',
      waiting: (n) => `ელოდება დამტკიცებას · ${n}`,
      working: (n) => `მუშავდება · ${n}`,
      noRepairs: 'ღია რემონტი არ გაქვთ.',
      toApprove: 'დასამტკიცებელი',
      toApproveN: (n) => `${n} რემონტი ელოდება დამტკიცებას`,
      maintenance: 'გეგმიური ტექმომსახურება',
      maintenanceDue: (n) => `ტექმომსახურების დროა · ${n} მოპედი`,
      maintenanceLate: (n) => `მათგან ვადაგადაცილებული · ${n}`,
      maintenanceNone: 'ტექმომსახურების დრო არც ერთ მოპედს არ აქვს.',
      payout: 'ჩემი ანაზღაურება',
      payoutNow: (sum) => `ახლა გადასახდელი: ${sum}`,
      payoutNone: 'ახლა გადასახდელი არაფერია.',
      all: 'ყველა →',
    },

    queueSaid: 'სტრიქონი რიგში',
    saidLate: 'ვადაგადაცილებული დავალება',
    saidToday: 'დღევანდელი დავალება',
  },
};
