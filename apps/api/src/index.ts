import { closeDb } from './lib/db.js';
import { env } from './lib/env.js';
import { importWorkBook } from './lib/workBook.js';
import { buildApp } from './server.js';

const app = buildApp();

app.listen({ port: env.API_PORT, host: '0.0.0.0' }).then(async () => {
  app.log.info(`EV8 Ops API on :${env.API_PORT} (${env.TZ})`);
  // The book of works starts as the mechanic bot's (stage 2 of the mechanic
  // plan). Only what is missing is written, so every start after the first
  // writes nothing, and an edit made on the book's screen is never undone.
  try {
    const r = await importWorkBook();
    app.log.info(`work book: ${r.added.length} added, ${r.same} as in the bot, ${r.differs.length} changed since`);
  } catch (e) {
    app.log.error({ err: e }, 'work book: import failed');
  }
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  });
}
