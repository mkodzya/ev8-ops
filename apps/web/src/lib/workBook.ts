// The book of works on the screen (stage 2 of the mechanic plan): its rows,
// a name in the language of the screen, a norm in minutes.
import { normMinutes } from '@ev8/shared';
import type { Locale } from '../i18n/index.js';

export interface WorkCategory {
  code: string;
  nameKa: string | null;
  nameRu: string | null;
  nameEn: string | null;
}

export interface WorkType {
  id: string;
  code: string;
  category: string;
  nameKa: string | null;
  nameRu: string | null;
  nameEn: string | null;
  normSec: number;
  active: boolean;
  notes: string | null;
  source: string | null;
}

export interface WorkBook {
  categories: WorkCategory[];
  works: WorkType[];
  fromBot: number;
  botSource: string;
  /** The reader's rate for an hour of norm. */
  rateTetri: number;
}

type Names = { nameKa: string | null; nameRu: string | null; nameEn: string | null };

/**
 * A name in the language of the screen. Where that spelling is empty the
 * Georgian one stands in — the bot wrote the book in Georgian, and a field
 * nobody filled is left empty rather than translated by us (rule 1).
 */
export function nameIn(n: Names, locale: Locale): string {
  const own = locale === 'ka' ? n.nameKa : locale === 'ru' ? n.nameRu : n.nameEn;
  return own || n.nameKa || n.nameRu || n.nameEn || '';
}

/** Is the spelling of the screen's own language missing? */
export function untranslated(n: Names, locale: Locale): boolean {
  return !(locale === 'ka' ? n.nameKa : locale === 'ru' ? n.nameRu : n.nameEn);
}

/** 150 seconds → "2,5" on a Russian or Georgian screen, "2.5" on an English one. */
export function normText(sec: number, locale: Locale): string {
  const m = String(normMinutes(sec));
  return locale === 'en' ? m : m.replace('.', ',');
}

/** 12345 → "12 345": a mileage read at a glance. */
export function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
