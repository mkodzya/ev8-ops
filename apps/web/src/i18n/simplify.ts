// GitHub issue #18 of the director, part B — the simplifications of the audit
// (28.10.2026): a manager sells a moped (B8), the mopeds «В ремонте» with no
// repair become a block of «Ремонты» (B6), «Заменить мопед» stands under the
// "+" (B2), the hand-over takes the customer's advance off what is due (B3).
// One file, so the Georgian goes to proofreading as one list
// (docs/qa/issue-18-b-simplify-ka-strings.md).

const ruPlural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export const simpleEn = {
  simple: {
    /** The sale wizard, for whoever enters no bank money: a card or a transfer arrives as a line to sort (B8). */
    sale: {
      viaBank: 'A card or a transfer reaches the bank: sort that line to this sale in «Sort».',
    },
    /** «Ремонты»: mopeds whose status says in repair with no repair open (B6; was «Settings → Before EV8 Ops»). */
    idle: {
      title: 'In repair with no job',
      count: (n: number) => `${n} ${n === 1 ? 'moped' : 'mopeds'}`,
      note: 'The status says «In repair», but no repair is open: open one, or send the moped back to the yard with a reason.',
    },
    /** «Change the moped» from the "+": whose rental first (B2). */
    swapPick: {
      title: 'Whose moped to change?',
    },
    /** The hand-over's payment step: the customer's advance comes off what is due today (B3). */
    hand: {
      credit: 'Customer’s advance',
      creditNote: 'Money sent ahead lies on this rental at once, not at night: the deposit first, then the week.',
    },
  },
};

export const simpleRu: typeof simpleEn = {
  simple: {
    sale: {
      viaBank: 'Карта и перевод приходят в банк: эту строку привяжите к продаже в «Разобрать».',
    },
    idle: {
      title: 'В ремонте без заявки',
      count: (n: number) => `${n} ${ruPlural(n, 'мопед', 'мопеда', 'мопедов')}`,
      note: 'Статус — «В ремонте», а заявки нет: откройте ремонт или верните мопед в парк с причиной.',
    },
    swapPick: {
      title: 'Чей мопед заменить?',
    },
    hand: {
      credit: 'Аванс клиента',
      creditNote: 'Деньги, присланные заранее, лягут на эту аренду сразу, не ночью: сначала залог, потом неделя.',
    },
  },
};

export const simpleKa: typeof simpleEn = {
  simple: {
    sale: {
      viaBank: 'ბარათი და გადარიცხვა ბანკში შემოდის: ეს ხაზი ამ გაყიდვას «დასახარისხებელში» მიაბით.',
    },
    idle: {
      title: 'სერვისში, განაცხადის გარეშე',
      count: (n: number) => `${n} მოპედი`,
      note: 'სტატუსია «სერვისში», შეკეთება კი გახსნილი არ არის: გახსენით შეკეთება ან მიზეზით დააბრუნეთ მოპედი პარკში.',
    },
    swapPick: {
      title: 'ვისი მოპედი შევცვალოთ?',
    },
    hand: {
      credit: 'კლიენტის ავანსი',
      creditNote: 'წინასწარ გამოგზავნილი თანხა ამ ქირაობაზე მაშინვე ჩაიწერება, არა ღამით: ჯერ დეპოზიტი, მერე კვირა.',
    },
  },
};
