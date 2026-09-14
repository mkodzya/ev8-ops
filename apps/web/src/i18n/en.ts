// THE LINE: chrome is translated, content never is. A customer's name, a
// VIN, a note somebody typed — those are data and stay as written. Buttons,
// navigation, states, hints and empty states go through this dictionary.
//
// English fixes the SHAPE: ka.ts and ru.ts are typed as `Dict`, so a missing
// or misspelled key is a build error, never an English word on a Georgian
// screen. Values that need data are functions, so interpolation is checked.
//
// Money keeps ONE format in every language (formatGel in @ev8/shared).
export const en = {
  lang: { label: 'Language', ka: 'ქართული', ru: 'Русский', en: 'English' },

  common: {
    signIn: 'Sign in',
    signOut: 'Sign out',
    email: 'Email',
    password: 'Password',
    checking: 'Checking…',
    loading: 'Loading…',
    loginFailed: 'That email and password don’t match.',
    search: 'Search',
    all: 'All',
    yes: 'Yes',
    no: 'No',
    dash: '—',
  },

  login: {
    note: 'E-Motion Motors operations. Sign in with the login the owner gave you.',
  },

  nav: {
    today: 'Today',
    fleet: 'Fleet',
    rentals: 'Rentals',
    customers: 'Customers',
  },

  // Vehicle states — colour + shape + word, the same everywhere (brand.md).
  states: {
    available: 'Available',
    rented: 'Rented',
    service: 'In service',
    out: 'Written off',
    sold: 'Sold',
  },

  rentalStatus: {
    booked: 'Booked',
    active: 'Active',
    overdue: 'Overdue',
    paused: 'Paused',
    returned: 'Returned',
    disputed: 'Disputed',
  },

  today: {
    title: 'Today',
    fleet: 'Fleet by state',
    activeRentals: 'Active rentals',
    overdue: 'Overdue',
    withoutVin: 'Without a confirmed VIN',
    customers: 'Customers',
    depositsHeld: 'Deposits held',
    empty: 'No data yet. Run the Odoo import (tools/migrate_stage1.py) to fill the fleet, customers and rentals.',
  },

  fleet: {
    title: 'Fleet',
    vin: 'VIN',
    model: 'Model',
    color: 'Colour',
    year: 'Year',
    arrived: 'Arrived',
    state: 'State',
    renter: 'Renter',
    paidThrough: 'Paid through',
    searchHint: 'Last 4 of VIN',
    empty: 'The fleet is empty.',
    count: (n: number) => `${n} moped${n === 1 ? '' : 's'}`,
  },

  rentals: {
    title: 'Rentals',
    number: 'No.',
    customer: 'Customer',
    vehicle: 'Moped',
    rate: 'Rate',
    perWeek: '/wk',
    deposit: 'Deposit',
    pickedUp: 'Picked up',
    returned: 'Returned',
    paidThrough: 'Paid through',
    vinUnconfirmed: 'VIN not confirmed',
    overdueDays: (n: number) => `${n} day${n === 1 ? '' : 's'} behind`,
    empty: 'No rentals yet.',
  },

  customers: {
    title: 'Customers',
    name: 'Name',
    phone: 'WhatsApp',
    personalId: 'Personal number',
    tags: 'Tags',
    openRentals: 'Open rentals',
    empty: 'No customers yet.',
  },
};

export type Dict = typeof en;
