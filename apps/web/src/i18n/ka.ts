import type { Dict } from './en.js';

// Typed as Dict: a missing or misspelled key fails the build.
export const ka: Dict = {
  lang: { label: 'ენა', ka: 'ქართული', ru: 'Русский', en: 'English' },

  common: {
    signIn: 'შესვლა',
    signOut: 'გასვლა',
    email: 'ელფოსტა',
    password: 'პაროლი',
    checking: 'მოწმდება…',
    loading: 'იტვირთება…',
    loginFailed: 'ელფოსტა და პაროლი არ ემთხვევა.',
    search: 'ძებნა',
    all: 'ყველა',
    yes: 'დიახ',
    no: 'არა',
    dash: '—',
  },

  login: {
    note: 'E-Motion Motors-ის ოპერაციები. შედით მფლობელისგან მიღებული ლოგინით.',
  },

  nav: {
    today: 'დღეს',
    fleet: 'პარკი',
    rentals: 'ქირაობა',
    customers: 'კლიენტები',
  },

  states: {
    available: 'თავისუფალი',
    rented: 'ქირაშია',
    service: 'სერვისში',
    out: 'ჩამოწერილი',
    sold: 'გაყიდული',
  },

  rentalStatus: {
    booked: 'დაჯავშნილი',
    active: 'აქტიური',
    overdue: 'ვადაგადაცილებული',
    paused: 'შეჩერებული',
    returned: 'დაბრუნებული',
    disputed: 'სადავო',
  },

  today: {
    title: 'დღეს',
    fleet: 'პარკი მდგომარეობის მიხედვით',
    activeRentals: 'აქტიური ქირაობა',
    overdue: 'ვადაგადაცილება',
    withoutVin: 'დაუდასტურებელი VIN-ით',
    customers: 'კლიენტები',
    depositsHeld: 'დეპოზიტები ხელზე',
    empty: 'მონაცემები ჯერ არ არის. გაუშვით იმპორტი Odoo-დან (tools/migrate_stage1.py), რომ შეივსოს პარკი, კლიენტები და ქირაობა.',
  },

  fleet: {
    title: 'პარკი',
    vin: 'VIN',
    model: 'მოდელი',
    color: 'ფერი',
    year: 'წელი',
    arrived: 'მოსვლა',
    state: 'მდგომარეობა',
    renter: 'მოქირავნე',
    paidThrough: 'გადახდილია',
    searchHint: 'VIN-ის ბოლო 4 სიმბოლო',
    empty: 'პარკი ცარიელია.',
    count: (n: number) => `${n} მოპედი`,
  },

  rentals: {
    title: 'ქირაობა',
    number: '№',
    customer: 'კლიენტი',
    vehicle: 'მოპედი',
    rate: 'ტარიფი',
    perWeek: '/კვ.',
    deposit: 'დეპოზიტი',
    pickedUp: 'გაცემა',
    returned: 'დაბრუნება',
    paidThrough: 'გადახდილია',
    vinUnconfirmed: 'VIN დაუდასტურებელია',
    overdueDays: (n: number) => `${n} დღის ვადაგადაცილება`,
    empty: 'ქირაობა ჯერ არ არის.',
  },

  customers: {
    title: 'კლიენტები',
    name: 'სახელი',
    phone: 'WhatsApp',
    personalId: 'პირადი ნომერი',
    tags: 'ტეგები',
    openRentals: 'მიმდინარე ქირაობა',
    empty: 'კლიენტები ჯერ არ არიან.',
  },
};
