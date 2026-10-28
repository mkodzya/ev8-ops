import type { ActionId, SectionId } from '@ev8/shared';
import {
  ArrowLeftRight,
  Banknote,
  Bike,
  CalendarCheck,
  CalendarClock,
  ChartColumn,
  FileText,
  Package,
  Send,
  Settings,
  ShoppingBag,
  TriangleAlert,
  Truck,
  Undo2,
  UserPlus,
  Wallet,
  Warehouse,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/** One linear icon per section and per "+" action (brand.md, "Значки"). */
export const SECTION_ICON: Record<SectionId, LucideIcon> = {
  today: CalendarCheck,
  // «Оплаты по графику» and «Разобрать» (issue #15): who pays when, and lines to place.
  schedule: CalendarClock,
  sort: ArrowLeftRight,
  cash: Banknote,
  fleet: Bike,
  rentals: FileText,
  service: Wrench,
  sales: ShoppingBag,
  // «Склад» (issue #19): the shelf of parts, batteries and chargers.
  stock: Warehouse,
  purchases: Truck,
  money: Wallet,
  reports: ChartColumn,
  settings: Settings,
};

export const ACTION_ICON: Record<ActionId, LucideIcon> = {
  pickup: Send,
  return: Undo2,
  takeMoney: Banknote,
  takeCash: Banknote,
  newCustomer: UserPlus,
  openRepair: Wrench,
  reportBreak: TriangleAlert,
  sell: ShoppingBag,
  // A part or a charger over the counter (ADR-0045).
  sellGoods: Package,
};

export const ICON = { size: 24, strokeWidth: 1.75 } as const;
