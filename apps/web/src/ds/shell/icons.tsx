import type { ActionId, SectionId } from '@ev8/shared';
import {
  Banknote,
  Bike,
  CalendarCheck,
  ChartColumn,
  FileText,
  Send,
  Settings,
  ShoppingBag,
  Truck,
  Undo2,
  UserPlus,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

/** One linear icon per section and per "+" action (brand.md, "Значки"). */
export const SECTION_ICON: Record<SectionId, LucideIcon> = {
  today: CalendarCheck,
  rentals: FileText,
  fleet: Bike,
  service: Wrench,
  money: Wallet,
  cash: Banknote,
  sales: ShoppingBag,
  purchases: Truck,
  reports: ChartColumn,
  settings: Settings,
  customers: Users,
};

export const ACTION_ICON: Record<ActionId, LucideIcon> = {
  pickup: Send,
  return: Undo2,
  newCustomer: UserPlus,
  openRepair: Wrench,
  sell: ShoppingBag,
};

export const ICON = { size: 24, strokeWidth: 1.75 } as const;
