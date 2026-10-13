import { hasGeorgian, kommoLeadId, looseNames } from '@ev8/shared';
import { prisma } from './db.js';
import { brief, ownerBy } from './rentalLoader.js';

// One form of a name on every card, from a list (Mika, 13.10.2026): the
// Georgian name and its Latin transcript, first name first. The cards came
// from Kommo with whatever spelling a person typed there — Latin in the main
// field, Georgian on some, the family name first on some.
//
//   · The card is resolved, never typed: the one card whose Kommo field names
//     the row's deal — as the rental loader does.
//   · Everything is checked before anything is written; one problem anywhere
//     and nothing is written. The rows are written in one transaction.
//   · A card that already reads as the row says is left alone, so the list
//     can be run again.
//   · The main name becomes the Latin one: screens that print the main name
//     then read alike, and the Georgian one stays in its own field. A row
//     without a Georgian name leaves the card's Georgian name as it is.
//
// The report is for the owner, in Russian, and is the only output. It prints
// names — that is what it is about — and nothing else of a card: no phone, no
// personal number, no address. The list itself is never stored.

const FIELDS = ['kommoLead', 'nameKa', 'nameLat'] as const;
/** Notes a list may carry for the person who reads it; the setter does not read them. */
const NOTES = ['label', 'rental', 'kaSource', 'check'] as const;
const MAX_NAME = 200;

export type NameVerdict = 'ready' | 'written' | 'same' | 'problem' | 'failed';

export interface NameRowReport {
  label: string;
  /** The card as the stand has it now: its main name and its Georgian one. */
  was: { name: string; nameKa: string | null; nameLat: string | null } | null;
  /** What the card will read, or reads now. */
  becomes: { name: string; nameKa: string | null; nameLat: string } | null;
  verdict: NameVerdict;
  problems: string[];
  /** Said beside a ready row: something a person should look at, that stops nothing. */
  notes: string[];
}

export interface NamesReport {
  mode: 'check' | 'commit';
  ownerName: string | null;
  /** The run did not start: the list could not be read, or the owner is not one. */
  refused: string | null;
  rows: NameRowReport[];
  written: number;
}

interface Row {
  report: NameRowReport;
  lead: string | null;
  nameKa: string | null;
  nameLat: string | null;
  customerId: string | null;
}

/** Latin letters, with the marks a name may carry: a space, a hyphen, an apostrophe, a full stop. */
const LATIN_NAME = /^[A-Za-z][A-Za-z .'’-]*$/;
/** Georgian letters and the same marks. */
const GEORGIAN_NAME = /^[ა-ჿ][ა-ჿ .'’-]*$/;

const tidy = (s: string): string => s.trim().replace(/\s+/g, ' ');

function readRow(raw: unknown, index: number): Row {
  const report: NameRowReport = { label: `строка ${index + 1}`, was: null, becomes: null, verdict: 'problem', problems: [], notes: [] };
  const row: Row = { report, lead: null, nameKa: null, nameLat: null, customerId: null };
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    report.problems.push('это не запись в фигурных скобках');
    return row;
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.label === 'string' && o.label.trim()) report.label = o.label.trim().slice(0, 40);
  if (typeof o.rental === 'string' && o.rental.trim()) report.label = `${report.label}  ${o.rental.trim().slice(0, 20)}`;

  const unknown = Object.keys(o).filter((k) => !(FIELDS as readonly string[]).includes(k) && !(NOTES as readonly string[]).includes(k));
  if (unknown.length) report.problems.push(`незнакомые поля: ${unknown.join(', ')}`);
  const missing = FIELDS.filter((k) => !(k in o));
  if (missing.length) report.problems.push(`нет полей: ${missing.join(', ')}`);

  if ('kommoLead' in o) {
    row.lead = typeof o.kommoLead === 'string' || (typeof o.kommoLead === 'number' && Number.isInteger(o.kommoLead)) ? kommoLeadId(String(o.kommoLead)) : null;
    if (!row.lead) report.problems.push('kommoLead — не номер сделки Kommo');
  }
  if ('nameLat' in o) {
    const v = typeof o.nameLat === 'string' ? tidy(o.nameLat) : '';
    if (!v) report.problems.push('nameLat — пусто: латинское имя нужно каждой карточке');
    else if (v.length > MAX_NAME) report.problems.push(`nameLat длиннее ${MAX_NAME} знаков`);
    else if (!LATIN_NAME.test(v)) report.problems.push('nameLat — только латинские буквы');
    else if (v.split(' ').length < 2) report.problems.push('nameLat — имя и фамилия, два слова или больше');
    else row.nameLat = v;
  }
  if ('nameKa' in o && o.nameKa !== null) {
    const v = typeof o.nameKa === 'string' ? tidy(o.nameKa) : '';
    if (!v) report.problems.push('nameKa — текст или null, если грузинского написания нет');
    else if (v.length > MAX_NAME) report.problems.push(`nameKa длиннее ${MAX_NAME} знаков`);
    else if (!GEORGIAN_NAME.test(v)) report.problems.push('nameKa — только грузинские буквы');
    else row.nameKa = v;
  }
  return row;
}

function readList(text: string): { rows: Row[]; refused: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { rows: [], refused: text.trim() ? 'Список не читается: это не JSON.' : 'Список пуст: на вход ничего не пришло.' };
  }
  if (!Array.isArray(parsed)) return { rows: [], refused: 'Список не читается: ждём перечень записей в квадратных скобках.' };
  if (parsed.length === 0) return { rows: [], refused: 'В списке нет ни одной записи.' };
  return { rows: parsed.map(readRow), refused: null };
}

/** Do the two spellings read as one name? Looser than letters: what a passport does not tell apart is one sound. */
function oneName(nameKa: string, nameLat: string): boolean {
  const ka = new Set(looseNames(nameKa)[0] ?? []);
  const lat = looseNames(nameLat)[0] ?? [];
  return lat.length === ka.size && lat.every((w) => ka.has(w));
}

export interface NamesInput {
  /** The list, as JSON text. */
  text: string;
  /** In whose name the cards are changed. Null: the stand's only owner. */
  ownerEmail: string | null;
  /** False checks and writes nothing. */
  commit: boolean;
}

export async function setNames(input: NamesInput): Promise<NamesReport> {
  const report: NamesReport = { mode: input.commit ? 'commit' : 'check', ownerName: null, refused: null, rows: [], written: 0 };

  const owner = await ownerBy(input.ownerEmail);
  if (!owner.actor) return { ...report, refused: (owner.refused ?? '').replace('Действующие аренды переносит только владелец.', 'Имена в карточках списком меняет только владелец.') };
  report.ownerName = owner.actor.name;

  const list = readList(input.text);
  if (list.refused) return { ...report, refused: list.refused };
  const rows = list.rows;
  report.rows = rows.map((r) => r.report);

  // The same deal twice is two answers about one card.
  const seen = new Map<string, number>();
  for (const r of rows) if (r.lead) seen.set(r.lead, (seen.get(r.lead) ?? 0) + 1);
  for (const r of rows) if (r.lead && (seen.get(r.lead) ?? 0) > 1) r.report.problems.push(`сделка Kommo ${r.lead} стоит в списке больше одного раза`);

  const cards = await prisma.customer.findMany({
    where: { kommoRef: { not: null }, archived: false, mergedIntoId: null },
    select: { id: true, name: true, nameKa: true, nameLat: true, kommoRef: true },
    orderBy: { createdAt: 'asc' },
  });
  const cardsOf = new Map<string, typeof cards>();
  for (const c of cards) {
    const lead = kommoLeadId(c.kommoRef);
    if (lead) cardsOf.set(lead, [...(cardsOf.get(lead) ?? []), c]);
  }

  const ready: Row[] = [];
  for (const r of rows) {
    const problems = r.report.problems;
    const found = r.lead ? (cardsOf.get(r.lead) ?? []) : [];
    if (r.lead && found.length === 0) problems.push(`карточки клиента со сделкой Kommo ${r.lead} на стенде нет`);
    if (found.length > 1) problems.push(`на сделку Kommo ${r.lead} ссылается больше одной карточки`);
    const card = found.length === 1 ? found[0]! : null;
    if (card) {
      r.customerId = card.id;
      r.report.was = { name: card.name, nameKa: card.nameKa, nameLat: card.nameLat };
    }
    if (!card || !r.nameLat || problems.length > 0) continue;

    // A row without a Georgian name leaves the card's own in place.
    const nameKa = r.nameKa ?? (card.nameKa?.trim() || (hasGeorgian(card.name) ? card.name.trim() : null));
    r.report.becomes = { name: r.nameLat, nameKa, nameLat: r.nameLat };
    if (nameKa && !oneName(nameKa, r.nameLat)) r.report.notes.push('грузинское и латинское написание не сводятся одно к другому буква в букву — посмотрите глазами, тот ли это человек');
    if (!nameKa) r.report.notes.push('грузинского написания нет ни в списке, ни в карточке — поле останется пустым');

    const same = card.name === r.nameLat && (card.nameLat ?? null) === r.nameLat && (card.nameKa ?? null) === nameKa;
    r.report.verdict = same ? 'same' : 'ready';
    if (!same) ready.push(r);
  }

  if (!input.commit || ready.length === 0 || rows.some((r) => r.report.verdict === 'problem')) return report;

  // All of them or none.
  try {
    await prisma.$transaction(async (tx) => {
      for (const r of ready) {
        const before = r.report.was!;
        const after = r.report.becomes!;
        await tx.customer.update({ where: { id: r.customerId! }, data: { name: after.name, nameKa: after.nameKa, nameLat: after.nameLat, updatedAt: new Date() } });
        await tx.auditLog.create({
          data: { actorId: owner.actor!.id, action: 'customer.update', entityType: 'customer', entityId: r.customerId!, before, after, note: 'one form of names, from a list' },
        });
      }
    });
  } catch (e) {
    for (const r of ready) {
      r.report.verdict = 'failed';
      r.report.problems.push(brief(e));
    }
    return report;
  }
  for (const r of ready) r.report.verdict = 'written';
  report.written = ready.length;
  return report;
}

/** 0 — as asked; 1 — the list has problems, nothing written; 2 — the run did not start; 3 — the write was refused, nothing written. */
export function namesExitCode(report: NamesReport): number {
  if (report.refused) return 2;
  if (report.rows.some((r) => r.verdict === 'failed')) return 3;
  return report.rows.some((r) => r.verdict === 'problem') ? 1 : 0;
}

/** A card's names on one line: the Latin one, and the Georgian one beside it when there is one. */
const both = (c: { name: string; nameKa: string | null }): string => (c.nameKa && c.nameKa !== c.name ? `${c.name} · ${c.nameKa}` : c.name);

export function formatNamesReport(report: NamesReport): string {
  const out: string[] = [];
  out.push(`Имена клиентов в один вид — ${report.mode === 'commit' ? 'запись' : 'проверка, без записи'}.`);
  if (report.refused) {
    out.push(report.refused, 'Ничего не записано.');
    return out.join('\n');
  }
  if (report.ownerName) out.push(`От имени: ${report.ownerName}.`);
  out.push('');

  const width = Math.max(...report.rows.map((r) => r.label.length));
  const count = (v: NameVerdict) => report.rows.filter((r) => r.verdict === v).length;
  for (const r of report.rows) {
    const head = r.label.padEnd(width);
    const was = r.was ? both(r.was) : '—';
    const now = r.becomes ? both(r.becomes) : '—';
    if (r.verdict === 'written') out.push(`${head}  записано: ${now}   (было: ${was})`);
    else if (r.verdict === 'ready') out.push(`${head}  станет: ${now}   (сейчас: ${was})`);
    else if (r.verdict === 'same') out.push(`${head}  уже так: ${now}`);
    else out.push(`${head}  ${r.verdict === 'failed' ? 'ОТКАЗ' : 'ПРОБЛЕМА'}: ${r.problems.join('; ')}${r.was ? `   (карточка: ${was})` : ''}`);
    for (const n of r.notes) if (r.verdict !== 'problem' && r.verdict !== 'failed') out.push(`${' '.repeat(width)}  · ${n}`);
  }
  out.push('');

  const problems = count('problem');
  const failed = count('failed');
  const ready = count('ready');
  out.push(
    `Итого строк: ${report.rows.length}. ` +
      [report.written ? `записано — ${report.written}` : null, ready ? `к записи — ${ready}` : null, `уже так — ${count('same')}`, `с проблемой — ${problems + failed}`].filter(Boolean).join(', ') +
      '.',
  );
  if (failed) out.push('Стенд отказал при записи. Не записано ничего: карточки меняются все вместе или никак.');
  else if (problems) out.push('Ничего не записано: пока в списке есть хоть одна проблема, не меняется ни одна карточка.');
  else if (report.mode === 'commit') out.push(report.written ? `Изменено карточек: ${report.written}.` : 'Все карточки из списка уже в этом виде. Ничего не записано.');
  else out.push(ready ? `Список в порядке. Ничего не записано — это была проверка; к записи готово: ${ready}.` : 'Все карточки из списка уже в этом виде.');
  return out.join('\n');
}
