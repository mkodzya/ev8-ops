import { describe, expect, it } from 'vitest';
import { GROUPS, REDIRECTS, groupHeadingForRole, movedTo } from '../src/index.js';
import { actionsForRole, homePathForRole, menuSectionsForRole, phoneTabsForRole, sectionOfPath, sectionsForRole, tabsForRole } from './navigation-helpers.js';

describe('the structure each role sees (wave 1 §3.2; issue #15, ADR-0048)', () => {
  it('groups the day’s work first: Today, the schedule, «Разобрать», the till — then the fleet, sales and purchases, and the owner’s management', () => {
    expect(sectionsForRole('owner').map((s) => [s.group, s.id])).toEqual([
      ['daily', 'today'],
      ['daily', 'schedule'],
      ['daily', 'sort'],
      ['daily', 'cash'],
      ['fleet', 'fleet'],
      ['fleet', 'rentals'],
      ['fleet', 'service'],
      ['trade', 'sales'],
      // «Склад» (issue #19): in «Продажи и закупки», before the orders.
      ['trade', 'stock'],
      ['trade', 'purchases'],
      ['manage', 'money'],
      ['manage', 'reports'],
      ['manage', 'settings'],
    ]);
    expect(sectionsForRole('manager').map((s) => s.id)).toEqual(['today', 'schedule', 'sort', 'cash', 'fleet', 'rentals', 'service', 'sales', 'stock']);
  });

  it('names a group by what the reader finds in it: «Продажи и склад» for a manager, who has no purchases (QA of #15, the director’s mockup; issue #19)', () => {
    expect(GROUPS.map((g) => groupHeadingForRole(g, 'owner'))).toEqual(['daily', 'fleet', 'trade', 'manage']);
    expect(groupHeadingForRole('trade', 'manager')).toBe('salesStock');
    // The shelf and the sales go by one right; a reader of neither has no such group at all.
    expect(sectionsForRole('mechanic').some((s) => s.group === 'trade')).toBe(false);
    for (const g of ['daily', 'fleet', 'manage'] as const) expect(groupHeadingForRole(g, 'manager'), g).toBe(g);
  });

  it('gives both roles Today · Оплаты · Разобрать · Мопеды on the bar, and the rest under «Ещё» in the rail’s order', () => {
    expect(phoneTabsForRole('owner')).toEqual(['today', 'schedule', 'sort', 'fleet']);
    expect(phoneTabsForRole('manager')).toEqual(['today', 'schedule', 'sort', 'fleet']);
    expect(menuSectionsForRole('manager')).toEqual(['cash', 'rentals', 'service', 'sales', 'stock']);
    // The director's list names Money, Reports and Settings for the owner; the orders are his section too, so they are there.
    expect(menuSectionsForRole('owner')).toEqual(['cash', 'rentals', 'service', 'sales', 'stock', 'purchases', 'money', 'reports', 'settings']);
  });

  it('keeps purchases, reports, settings and Money itself away from a manager everywhere', () => {
    const ids = sectionsForRole('manager').map((s) => s.id);
    for (const owners of ['money', 'purchases', 'reports', 'settings'] as const) expect(ids).not.toContain(owners);
    expect(menuSectionsForRole('manager')).not.toContain('money');
  });

  it('offers the owner seven actions under + and the manager seven (wave 5 §3.7; issue #11; issue #18 B8)', () => {
    expect(actionsForRole('owner').map((a) => a.id)).toEqual(['pickup', 'return', 'takeMoney', 'newCustomer', 'openRepair', 'sell', 'sellGoods']);
    // A manager reports a breakdown; opening the repair itself is an owner's.
    // He sells a part or a charger over the counter (ADR-0045), and since issue #18 a moped too.
    expect(actionsForRole('manager').map((a) => a.id)).toEqual(['pickup', 'return', 'takeCash', 'newCustomer', 'reportBreak', 'sell', 'sellGoods']);
  });

  it('splits Sales into the mopeds and the goods, for both roles (issue #11)', () => {
    for (const role of ['owner', 'manager'] as const) {
      expect(tabsForRole('sales', role)).toEqual([
        { id: 'vehicles', path: '/sales', anyOf: ['fleet.view'] },
        { id: 'goods', path: '/sales/goods', anyOf: ['fleet.view'] },
      ]);
    }
    expect(sectionOfPath('/sales/goods/new')).toBe('sales');
    expect(tabsForRole('sales', 'mechanic')).toEqual([]);
  });

  it('shows the points tab and statements only to the owner', () => {
    // The batteries and chargers left for «Склад» (issue #19).
    expect(tabsForRole('fleet', 'owner').map((t) => t.id)).toEqual(['vehicles', 'models', 'points']);
    expect(tabsForRole('fleet', 'manager').map((t) => t.id)).toEqual(['vehicles', 'models']);
    expect(tabsForRole('money', 'owner').map((t) => t.id)).toEqual(['payments', 'statements', 'deposits']);
    expect(tabsForRole('money', 'manager')).toEqual([]);
    expect(tabsForRole('cash', 'manager').map((t) => t.id)).toEqual(['till', 'mine']);
    expect(tabsForRole('cash', 'owner').map((t) => t.id)).toEqual(['till', 'mine']);
  });

  // Issue #15: «Оплаты по графику» was «Деньги → Календарь», an owner's only.
  it('gives the schedule Today · Late · Calendar to both roles, and the month’s figures to the owner alone', () => {
    expect(tabsForRole('schedule', 'owner').map((t) => [t.id, t.path])).toEqual([
      ['due', '/schedule'],
      ['late', '/schedule/late'],
      ['calendar', '/schedule/calendar'],
      ['month', '/schedule/month'],
    ]);
    expect(tabsForRole('schedule', 'manager').map((t) => t.id)).toEqual(['due', 'late', 'calendar']);
    expect(tabsForRole('schedule', 'mechanic')).toEqual([]);
    expect(sectionOfPath('/schedule/month')).toBe('schedule');
  });

  it('gives «Разобрать» four tabs to the owner and the money coming in alone to a manager', () => {
    expect(tabsForRole('sort', 'owner').map((t) => [t.id, t.path])).toEqual([
      ['sortIn', '/sort'],
      ['sortOut', '/sort/out'],
      ['byRules', '/sort/rules'],
      ['aside', '/sort/aside'],
    ]);
    expect(tabsForRole('sort', 'manager').map((t) => t.id)).toEqual(['sortIn']);
    expect(sectionOfPath('/sort/aside')).toBe('sort');
  });

  it('puts the customers beside the rentals', () => {
    for (const role of ['owner', 'manager'] as const) expect(tabsForRole('rentals', role).map((t) => t.path)).toEqual(['/rentals', '/customers']);
    expect(sectionOfPath('/customers/abc')).toBe('rentals');
    expect(sectionOfPath('/customers')).toBe('rentals');
  });

  it('sends the old addresses of the calendar and «Разобрать» to their new places, the query along', () => {
    expect(movedTo('/money/calendar', '?d=2026-10-20')).toBe('/schedule/calendar?d=2026-10-20');
    expect(movedTo('/money/sort', '')).toBe('/sort');
    expect(movedTo('/money/sort', '?d=out')).toBe('/sort/out');
    expect(movedTo('/money/sort/rules', '')).toBe('/sort/rules');
    expect(movedTo('/money/sort/aside', '')).toBe('/sort/aside');
    expect(movedTo('/money', '')).toBe('/money/payments');
    expect(REDIRECTS.map((r) => r.from)).toContain('/money/calendar');
  });

  // Issue #19 of the director (28.10.2026): the shelf is a section of its own.
  it('gives «Склад» two tabs, the parts and the batteries and chargers, to both roles and to no mechanic', () => {
    for (const role of ['owner', 'manager'] as const) {
      expect(tabsForRole('stock', role).map((t) => [t.id, t.path])).toEqual([
        ['parts', '/stock'],
        ['batteries', '/stock/batteries'],
      ]);
    }
    for (const role of ['mechanic', 'chief_mechanic'] as const) {
      expect(sectionsForRole(role).map((s) => s.id)).not.toContain('stock');
      expect(tabsForRole('stock', role)).toEqual([]);
    }
    // Neither tab is left behind in its old section.
    for (const section of ['fleet', 'service'] as const) {
      expect(tabsForRole(section, 'owner').map((t) => t.path)).not.toContain('/fleet/batteries');
      expect(tabsForRole(section, 'owner').map((t) => t.path)).not.toContain('/service/stock');
    }
  });

  it('sends the shelf’s old addresses to «Склад», the part and the query along', () => {
    expect(movedTo('/service/stock', '?f=short')).toBe('/stock?f=short');
    expect(movedTo('/service/stock/parts/:id', '')).toBe('/stock/parts/:id');
    expect(movedTo('/fleet/batteries', '?item=charger')).toBe('/stock/batteries?item=charger');
    // `/stock` is the section's own address now, no longer an old one.
    expect(REDIRECTS.map((r) => r.from)).not.toContain('/stock');
    expect(REDIRECTS.map((r) => r.from)).not.toContain('/stock/parts/:id');
  });

  // Mika, 28.09.2026: the suppliers are a tab of Purchases, not a section.
  it('gives purchases two tabs, the orders and the suppliers, to the owner only', () => {
    expect(tabsForRole('purchases', 'owner').map((t) => t.path)).toEqual(['/purchases', '/purchases/suppliers']);
    expect(tabsForRole('purchases', 'manager')).toEqual([]);
    expect(sectionOfPath('/purchases/suppliers')).toBe('purchases');
  });

  // Wave 6 §3.4–3.9. Settings grew into tabs; the points did not move with
  // them — one list, one address (designer, 21.09.2026).
  // The expense categories joined them on 15.10.2026 (migration 0046).
  it('gives settings seven tabs, and its points stay in Settings (Mika, 29.09.2026)', () => {
    // «Поступления» beside «Расходы»: the categories of other income (issue #13, migration 0069).
    expect(tabsForRole('settings', 'owner').map((t) => t.id)).toEqual(['people', 'points', 'rental', 'repair', 'expenses', 'incoming', 'drive', 'journal', 'migration', 'login']);
    expect(tabsForRole('settings', 'owner').find((t) => t.id === 'points')?.path).toBe('/settings/points');
    expect(sectionOfPath('/settings/points')).toBe('settings');
    // Fleet keeps its own tab to the same page.
    expect(tabsForRole('fleet', 'owner').find((t) => t.id === 'points')?.path).toBe('/fleet/points');
    expect(tabsForRole('settings', 'manager')).toEqual([]);
  });

  // ADR-0033: a mechanic and a chief mechanic see the repairs and nothing else,
  // and land on them — "Today" is the front office's queue.
  it('gives a mechanic and a chief mechanic the repairs alone, as their first screen', () => {
    for (const role of ['mechanic', 'chief_mechanic'] as const) {
      expect(sectionsForRole(role).map((s) => s.id)).toEqual(['service']);
      expect(phoneTabsForRole(role)).toEqual(['service']);
      expect(menuSectionsForRole(role)).toEqual([]);
      expect(actionsForRole(role)).toEqual([]);
      expect(homePathForRole(role)).toBe('/service');
    }
    // The book of works is the chief mechanic's to keep, not the mechanic's (stage 2).
    // Each reads his own balance (stage 5); marking a mechanic paid is the owners' alone.
    expect(tabsForRole('service', 'mechanic').map((t) => t.id)).toEqual(['jobs', 'balance']);
    expect(tabsForRole('service', 'chief_mechanic').map((t) => t.id)).toEqual(['jobs', 'works', 'balance']);
    // The shelf left the repairs for «Склад» (issue #19): a mechanic takes parts in the repair's card, as before.
    expect(tabsForRole('service', 'owner').map((t) => t.id)).toEqual(['jobs', 'works', 'payouts']);
    expect(tabsForRole('service', 'manager').map((t) => t.id)).toEqual(['jobs']);
    expect(tabsForRole('service', 'manager').map((t) => t.id)).not.toContain('payouts');
    expect(homePathForRole('owner')).toBe('/');
    expect(homePathForRole('manager')).toBe('/');
  });

  it('knows which section an address belongs to', () => {
    expect(sectionOfPath('/')).toBe('today');
    expect(sectionOfPath('/fleet/models/abc')).toBe('fleet');
    expect(sectionOfPath('/stock/parts/x')).toBe('stock');
    expect(sectionOfPath('/stock/batteries')).toBe('stock');
    expect(sectionOfPath('/money/cash')).toBe('cash');
    // The till is the till's section for an owner too since issue #15.
    expect(sectionOfPath('/money/cash', ['payments.view'])).toBe('cash');
    expect(sectionOfPath('/money/mine', ['payments.view'])).toBe('cash');
    expect(sectionOfPath('/money/statements')).toBe('money');
    // A manager reaches his payment's page from «Мои платежи».
    expect(sectionOfPath('/money/payments/abc', ['cash.record'])).toBe('cash');
    expect(sectionOfPath('/money/payments/abc', ['payments.view'])).toBe('money');
    expect(sectionOfPath('/schedule')).toBe('schedule');
    expect(sectionOfPath('/sort/out')).toBe('sort');
    expect(sectionOfPath('/rentals/abc/return')).toBe('rentals');
    expect(sectionOfPath('/settings/journal')).toBe('settings');
    expect(sectionOfPath('/settings/migration')).toBe('settings');
  });
});
