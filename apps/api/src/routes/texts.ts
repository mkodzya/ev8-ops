import type { FastifyInstance } from 'fastify';
import { badRequest } from '../lib/errors.js';
import { MAX_LOOKUP, translationsOf } from '../lib/translations.js';

// Typed text in the reader's language (ADR-0042). A screen sends the texts it
// shows — exactly as it shows them — and gets back, for each, the ready
// translation or nothing. Every signed-in person may ask, the workshop
// tablet's mechanics too: what comes back is only the words of records the
// same screen already holds. Asking writes nothing and calls no outside
// service, so this is not a translator anybody can feed.

/** A note is at most 4 000 characters where the longest is kept (a moped's notes). */
const MAX_TEXT = 4000;

export function textRoutes(app: FastifyInstance): void {
  app.post<{ Body: { texts?: unknown } }>('/api/texts/translations', { config: { scope: 'session' } }, async (req) => {
    const texts = req.body?.texts;
    if (!Array.isArray(texts) || !texts.every((t) => typeof t === 'string')) {
      throw badRequest('bad_field', 'texts must be a list of strings', { field: 'texts' });
    }
    if (texts.length > MAX_LOOKUP) throw badRequest('bad_field', `at most ${MAX_LOOKUP} texts at once`, { field: 'texts' });
    if (texts.some((t) => t.length > MAX_TEXT)) throw badRequest('bad_field', 'a text is too long', { field: 'texts' });
    // Not trimmed: a text is found by its exact bytes, as the record keeps it.
    return { translations: await translationsOf(texts as string[]) };
  });
}
