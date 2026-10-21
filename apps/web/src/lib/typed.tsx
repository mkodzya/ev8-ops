import { translatable, translationFor, type TextTranslation } from '@ev8/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

interface Asker {
  resolve: (t: TextTranslation | null) => void;
  reject: (e: unknown) => void;
}
type Waiting = Map<string, Asker[]>;
let gathered: Waiting = new Map();
let timer: ReturnType<typeof setTimeout> | null = null;

function askFor(text: string): Promise<TextTranslation | null> {
  return new Promise((resolve, reject) => {
    gathered.set(text, [...(gathered.get(text) ?? []), { resolve, reject }]);
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
    let found: (TextTranslation | null)[];
    try {
      found = (await api.ask<{ translations: (TextTranslation | null)[] }>('/api/texts/translations', { texts: part })).translations;
    } catch (e) {
      // The question did not get through — no connection, a gateway, a dropped
      // request. That is not "no translation": a translation already on screen
      // stays there, as every screen's data does after a failed refetch
      // (lib/queryClient.ts), and a text never translated keeps its original.
      // The next look asks again.
      for (const text of part) for (const a of batch.get(text) ?? []) a.reject(e);
      continue;
    }
    part.forEach((text, j) => {
      for (const a of batch.get(text) ?? []) a.resolve(found[j] ?? null);
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

/**
 * The words a list's search should also find a text by: its translation in
 * the reader's language, when the screen already holds one. A list that
 * shows «не тормозит задний» to a Russian reader finds it by «тормоз», though
 * it was typed in Georgian. Nothing is asked for: what is not on screen yet
 * is found by the original, as before.
 */
export function useShownWords(): (text: string | null | undefined) => string | null {
  const client = useQueryClient();
  const { locale } = useLocale();
  return (text) => (text && translatable(text) ? translationFor(client.getQueryData<TextTranslation | null>(['typed', text]), locale) : null);
}

/** The language an element's words are in, for a reader and a screen reader; none for «other». */
const langAttr = (l: string): string | undefined => (l === 'ka' || l === 'ru' || l === 'en' ? l : undefined);

/**
 * A text a person typed, in the reader's language when a translation is
 * ready, with the mark that says so; one tap shows the original.
 *
 * - `quiet` is for a text inside a link that opens its record — a queue row
 *   on «Сегодня», a card in a list: the mark only says it is a translation,
 *   and the record, one tap away, shows the original.
 * - `quoted` puts the words in «», and the mark after them: the mark is not
 *   part of what was typed.
 * - `clip` is the class of a one-line cell that ends a long text in an
 *   ellipsis: the words are clipped and read whole under the pointer, and the
 *   mark stays outside the clip.
 */
export function Typed({ text, quiet = false, quoted = false, clip }: { text: string | null | undefined; quiet?: boolean; quoted?: boolean; clip?: string }) {
  const { locale } = useLocale();
  const t = useT();
  const found = useTranslation(text);
  const [original, setOriginal] = useState(false);
  const words = translationFor(found, locale);
  const shown = (w: string, lang?: string) => (
    <span lang={lang} className={clip} title={clip ? w : undefined}>
      {quoted ? `«${w}»` : w}
    </span>
  );
  if (!text) return null;
  if (!found || !words) return clip || quoted ? shown(text) : <>{text}</>;
  const from = t.typed.from[found.lang] ?? '';
  if (quiet) {
    return (
      <>
        {shown(words, locale)}{' '}
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
      {shown(original ? text : words, original ? langAttr(found.lang) : locale)}{' '}
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
