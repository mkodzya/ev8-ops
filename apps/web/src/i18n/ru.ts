import type { Dict } from './en.js';

// Typed as Dict: a missing or misspelled key fails the build.
const days = (n: number): string => {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня';
  return 'дней';
};

export const ru: Dict = {
  lang: { label: 'Язык', ka: 'ქართული', ru: 'Русский', en: 'English' },

  common: {
    signIn: 'Войти',
    signOut: 'Выйти',
    email: 'Почта',
    password: 'Пароль',
    checking: 'Проверяем…',
    loading: 'Загрузка…',
    loginFailed: 'Почта и пароль не совпадают.',
    search: 'Поиск',
    all: 'Все',
    yes: 'Да',
    no: 'Нет',
    dash: '—',
  },

  login: {
    note: 'Операционная система E-Motion Motors. Войдите с логином, который выдал владелец.',
  },

  nav: {
    today: 'Сегодня',
    fleet: 'Парк',
    rentals: 'Аренды',
    customers: 'Клиенты',
  },

  states: {
    available: 'Свободен',
    rented: 'В аренде',
    service: 'В сервисе',
    out: 'Списан',
    sold: 'Продан',
  },

  rentalStatus: {
    booked: 'Бронь',
    active: 'Активна',
    overdue: 'Просрочена',
    paused: 'Пауза',
    returned: 'Возвращена',
    disputed: 'Спорная',
  },

  today: {
    title: 'Сегодня',
    fleet: 'Парк по состояниям',
    activeRentals: 'Активные аренды',
    overdue: 'Просрочки',
    withoutVin: 'Без подтверждённого VIN',
    customers: 'Клиенты',
    depositsHeld: 'Залоги на руках',
    empty: 'Данных пока нет. Запустите импорт из Odoo (tools/migrate_stage1.py), чтобы заполнить парк, клиентов и аренды.',
  },

  fleet: {
    title: 'Парк',
    vin: 'VIN',
    model: 'Модель',
    color: 'Цвет',
    year: 'Год',
    arrived: 'Приход',
    state: 'Состояние',
    renter: 'Арендатор',
    paidThrough: 'Оплачено по',
    searchHint: 'Последние 4 знака VIN',
    empty: 'Парк пуст.',
    count: (n: number) => {
      const m10 = n % 10;
      const m100 = n % 100;
      const word = m10 === 1 && m100 !== 11 ? 'мопед' : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 'мопеда' : 'мопедов';
      return `${n} ${word}`;
    },
  },

  rentals: {
    title: 'Аренды',
    number: '№',
    customer: 'Клиент',
    vehicle: 'Мопед',
    rate: 'Тариф',
    perWeek: '/нед',
    deposit: 'Залог',
    pickedUp: 'Выдача',
    returned: 'Возврат',
    paidThrough: 'Оплачено по',
    vinUnconfirmed: 'VIN не подтверждён',
    overdueDays: (n: number) => `просрочка ${n} ${days(n)}`,
    empty: 'Аренд пока нет.',
  },

  customers: {
    title: 'Клиенты',
    name: 'Имя',
    phone: 'WhatsApp',
    personalId: 'Личный номер',
    tags: 'Теги',
    openRentals: 'Текущие аренды',
    empty: 'Клиентов пока нет.',
  },
};
