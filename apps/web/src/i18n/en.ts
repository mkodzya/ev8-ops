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

  actions: {
    newRental: 'New hand-over',
    returnRental: 'Return',
    newCustomer: 'New customer',
    changeState: 'Change state',
    confirmDeposit: 'Confirm deposit decision',
    assignVehicle: 'Assign a moped',
    back: 'Back',
    next: 'Next',
    confirm: 'Confirm',
    save: 'Save',
    cancel: 'Cancel',
    open: 'Open',
  },

  vehicle: {
    title: 'Moped',
    history: 'History',
    rentalsOf: 'Rentals',
    odometer: 'Odometer, km',
    notes: 'Notes',
    toState: 'New state',
    reason: 'Reason',
    reasonHint: 'A reason is required and goes into the journal.',
    rentedLock: 'A rented moped moves only through its rental. Close the rental first.',
    events: {
      arrived: 'Arrived',
      pickup: 'Handed over',
      return: 'Returned',
      service_in: 'To service',
      service_out: 'Back from service',
      sold: 'Sold',
      bought_back: 'Bought back',
      written_off: 'Written off',
      manual: 'By hand',
    },
  },

  rental: {
    title: 'Rental',
    periods: 'Weekly periods',
    week: 'Week',
    from: 'From',
    to: 'To',
    amount: 'Amount',
    paid: 'Paid',
    payStatus: { unpaid: 'Unpaid', partial: 'Partial', paid: 'Paid' },
    acts: 'Acts',
    actKind: { pickup: 'Hand-over act', return: 'Return act' },
    depositStatus: { held: 'Held', returned: 'Returned', withheld: 'Withheld', partial: 'Partly withheld' },
    withheldReason: 'Reason withheld',
    returnedTo: 'Returned to',
    awaitingOwner: 'Awaiting the owner’s confirmation',
    buyout: 'Buy-out',
    buyoutProgress: (target: string, per: string) => `${per} of each payment towards ${target}`,
    notes: 'Notes',
  },

  pickup: {
    title: 'Hand-over',
    steps: { customer: 'Customer', vehicle: 'Moped', terms: 'Terms', act: 'Act', done: 'Done' },
    stepOf: (i: number, n: number) => `Step ${i} of ${n}`,
    searchCustomer: 'Name or phone',
    orCreate: 'Not on the list? Create a card.',
    noVehicle: 'VIN not confirmed — write why',
    noVehicleHint: 'Leave the moped unpicked and say what the contract shows; the rental lands on the “without VIN” list.',
    rate: 'Weekly rate',
    deposit: 'Deposit',
    pickedUpOn: 'Pickup date',
    expectedReturnOn: 'Expected return',
    odometer: 'Odometer, km',
    condition: 'Condition, damage',
    photos: 'Photos',
    photosLater: 'Photo upload arrives with the file store; note the condition in words for now.',
    summary: 'Summary',
    created: (n: string) => `Hand-over ${n} recorded.`,
    noAvailable: 'No moped is available right now.',
  },

  ret: {
    title: 'Return',
    returnedOn: 'Return date',
    odometer: 'Odometer, km',
    condition: 'Condition, damage',
    depositDecision: 'Deposit',
    returnFull: 'Return in full',
    withholdPart: 'Withhold part',
    withholdAll: 'Withhold all',
    withheldAmount: 'Withheld amount',
    withheldReason: 'Reason',
    returnedTo: 'Returned to (blank = the payer)',
    leaveToDirector: 'The director decides on the deposit.',
    done: 'Return recorded.',
  },

  customer: {
    title: 'Customer',
    newTitle: 'New customer',
    name: 'Name (as the team writes it)',
    nameKa: 'Name in Georgian',
    nameLat: 'Name in Latin',
    personalId: 'Personal number',
    phone: 'WhatsApp number',
    email: 'Email',
    kind: 'Type',
    kinds: { person: 'Person', sole_trader: 'Sole trader', company: 'Company' },
    tags: 'Tags (comma separated)',
    notes: 'Notes',
    duplicate: (name: string) => `Already on file: ${name}`,
    rentals: 'Rentals',
    noRentals: 'No rentals yet.',
  },

  photos: {
    add: 'Photo',
    remove: 'Remove',
    hint: 'Four angles and the odometer. Photos are downsized on the phone before upload.',
    cannotRead: (name: string) => `Cannot read ${name}.`,
    uploading: (n: number, total: number) => `Uploading photo ${n} of ${total}…`,
    none: 'No photos.',
  },

  documents: {
    title: 'Documents',
    kinds: { id_card: 'ID card', driver_licence: 'Driver licence', other: 'Other' },
    add: 'Add document',
    restricted: 'Documents are opened by the director and the owner only. You see that they exist.',
    none: 'No documents.',
    pick: 'Take a photo or choose a file',
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
