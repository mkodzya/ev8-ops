// «Прочитать сейчас» on "Деньги → Выписки" (Mika, 29.10.2026: «давай сделаем
// кнопку тоже»): the button under the banks' cards that asks both banks at
// once, and what it says came, account by account. Why a bank gave nothing is
// said in `bankApi.why`. One file, so the Georgian goes to proofreading as one
// list.
//
// The Georgian here was written by a non-native and has not been read by one
// yet.

/** Russian counts one thing, two things and five things three different ways. */
const plural = (n: number, one: string, few: string, many: string): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

export const bankReadNowEn = {
  bankReadNow: {
    button: 'Read now',
    reading: 'Reading the banks…',
    wait: (seconds: number) => `Again in ${seconds} s`,
    busy: 'The bank is being read already: try again in a minute.',
    added: (n: number) => (n === 1 ? '1 new operation' : `${n} new operations`),
    nothing: 'nothing new',
    days: (from: string, to: string, n: number) => (n === 1 ? `the past day ${from} read` : `the past days ${from}–${to} read`),
    // Bank of Georgia gives one statement a minute: when today's stood in for the list of the day, the past days wait for the worker's night.
    later: 'the past days are read within the hour',
    nothingCame: (why: string) => `nothing came: ${why}`,
    notAll: (why: string) => `not everything came: ${why}`,
  },
};

export const bankReadNowRu: typeof bankReadNowEn = {
  bankReadNow: {
    button: 'Прочитать сейчас',
    reading: 'Читаем банки…',
    wait: (seconds) => `Снова через ${seconds} с`,
    busy: 'Банк уже читается, попробуйте через минуту.',
    added: (n) => `${n} ${plural(n, 'новая операция', 'новые операции', 'новых операций')}`,
    nothing: 'новых операций нет',
    days: (from, to, n) => (n === 1 ? `прочитан прошлый день ${from}` : `прочитаны прошлые дни ${from}–${to}`),
    later: 'прошлые дни система прочитает в течение часа',
    nothingCame: (why) => `ничего не пришло: ${why}`,
    notAll: (why) => `пришло не всё: ${why}`,
  },
};

export const bankReadNowKa: typeof bankReadNowEn = {
  bankReadNow: {
    button: 'ახლავე წაკითხვა',
    reading: 'ბანკები იკითხება…',
    wait: (seconds) => `ხელახლა ${seconds} წამში`,
    busy: 'ბანკი უკვე იკითხება, სცადეთ ერთ წუთში.',
    added: (n) => `${n} ახალი ოპერაცია`,
    nothing: 'ახალი ოპერაციები არ არის',
    days: (from, to, n) => (n === 1 ? `წაკითხულია წინა დღე ${from}` : `წაკითხულია წინა დღეები ${from}–${to}`),
    later: 'წინა დღეებს სისტემა ერთი საათის განმავლობაში წაიკითხავს',
    nothingCame: (why) => `არაფერი მოვიდა: ${why}`,
    notAll: (why) => `მოვიდა მხოლოდ ნაწილი: ${why}`,
  },
};
