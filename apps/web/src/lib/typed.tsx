import { translatable, translationFor, type TextTranslation } from '@ev8/shared';
import { useQuery } from '@tanstack/react-query';
import { useState, type MouseEvent } from 'react';
import { api } from '../api.js';
import { useLocale, useT } from '../i18n/index.js';

// Typed text in the reader's language (ADR-0042; Mika, 21.10.2026).
//
// What a person typed about a moped or a repair is shown in the language the
// reader's screen is in, when a translation is ready — with a mark that says
// it is one. A tap on the mark shows the original, marked «оригинал»; another
// tap goes back. With no translation yet, or a text already in the reader's
// language, the original is shown with no mark at all. The original stays the
// record: this only changes what one screen shows, never what is kept, and
// search, inputs, exports and PDFs keep the original.
//
// The texts a screen renders in one moment go to the API as one request, and
// each is kept in the shared cache by its words, so a list of fifty repairs
// is one question. Asking costs nothing and writes nothing: the API only
// answers what the background job has already translated.

/** The API takes at most this many texts in one request. */
const PER_REQUEST = 100;
/** How long the texts of one render are gathered before they are asked about. */
const GATHER_MS = 20;

type Waiting = Map<string, ((t: TextTranslation | null) => void)[]>;
let gathered: Waiting = new Map();
let timer: ReturnType<typeof setTimeout> | null = null;

function askFor(text: string): Promise<TextTranslation | null> {
  return new Promise((resolve) => {
    gathered.set(text, [...(gathered.get(text) ?? []), resolve]);
    timer ??= setTimeout(() => void send(), GATHER_MS);
  });
}

async function send(): Promise<void> {
  const batch = gathered;
  gathered = new Map();
  timer = null;
  const texts = [...batch.keys()];
  for (let i = 0; i < texts.length; i += PER_REQUEST) {
    const part = texts.slice(i, i + PER_REQUEST);
    let found: (TextTranslation | null)[] = [];
    try {
      found = (await api.ask<{ translations: (TextTranslation | null)[] }>('/api/texts/translations', { texts: part })).translations;
    } catch {
      // No translation is no harm: the original is shown, and the next look asks again.
    }
    part.forEach((text, j) => {
      for (const resolve of batch.get(text) ?? []) resolve(found[j] ?? null);
    });
  }
}

/** The ready translation of a typed text, or null. Only texts worth one are asked about. */
export function useTranslation(text: string | null | undefined): TextTranslation | null {
  const worth = translatable(text);
  const q = useQuery({
    queryKey: ['typed', text ?? ''],
    queryFn: () => askFor(text!),
    enabled: worth,
    // A text is translated within a minute or two of being written; a screen
    // opened again later asks again.
    staleTime: 60_000,
  });
  return worth ? (q.data ?? null) : null;
}

/** The language an element's words are in, for a reader and a screen reader; none for «other». */
const langAttr = (l: string): string | undefined => (l === 'ka' || l === 'ru' || l === 'en' ? l : undefined);

/**
 * A text a person typed, in the reader's language when a translation is
 * ready, with the mark that says so; one tap shows the original. `quiet` is
 * for a text inside a link that opens its record — a queue row on «Сегодня»:
 * the mark only says it is a translation, and the record, one tap away,
 * shows the original.
 */
export function Typed({ text, quiet = false }: { text: string | null | undefined; quiet?: boolean }) {
  const { locale } = useLocale();
  const t = useT();
  const found = useTranslation(text);
  const [original, setOriginal] = useState(false);
  const words = translationFor(found, locale);
  if (!text) return null;
  if (!found || !words) return <>{text}</>;
  const from = t.typed.from[found.lang] ?? '';
  if (quiet) {
    return (
      <>
        <span lang={locale}>{words}</span>{' '}
        <span className="typed-mark" title={t.typed.quietHint(from)}>
          {t.typed.translated}
        </span>
      </>
    );
  }
  const toggle = (e: MouseEvent) => {
    // The mark sits inside rows that open a record: a tap here only turns the words.
    e.preventDefault();
    e.stopPropagation();
    setOriginal(!original);
  };
  const hint = original ? t.typed.showTranslation(t.typed.writtenIn[found.lang] ?? '') : t.typed.showOriginal(from);
  return (
    <>
      <span lang={original ? langAttr(found.lang) : locale}>{original ? text : words}</span>{' '}
      <button type="button" className={original ? 'typed-mark on' : 'typed-mark'} aria-pressed={original} title={hint} aria-label={hint} onClick={toggle}>
        {original ? t.typed.original : t.typed.translated}
      </button>
    </>
  );
}

/** Where the typed text goes inside a sentence of the dictionary. */
const SLOT = '\u0000';

/**
 * A sentence of the dictionary with a typed text inside it — «Отклонена:
 * {причина}»: the sentence in the reader's language, the text translated
 * where it can be, wherever each language puts it.
 */
export function TypedIn({ words, text }: { words: (inner: string) => string; text: string }) {
  const [before, after = ''] = words(SLOT).split(SLOT);
  return (
    <>
      {before}
      <Typed text={text} />
      {after}
    </>
  );
}
