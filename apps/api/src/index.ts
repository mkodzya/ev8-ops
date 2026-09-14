import { closeDb } from './lib/db.js';
import { env } from './lib/env.js';
import { buildApp } from './server.js';

const app = buildApp();

app.listen({ port: env.API_PORT, host: '0.0.0.0' }).then(() => {
  app.log.info(`EV8 Ops API on :${env.API_PORT} (${env.TZ})`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close();
    await closeDb();
    process.exit(0);
  });
}
