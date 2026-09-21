import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { env } from './lib/env.js';
import { ApiError } from './lib/errors.js';
import { installGuard } from './lib/guard.js';
import { installOperationKeys } from './lib/operations.js';
import { authRoutes } from './routes/auth.js';
import { customerRoutes } from './routes/customers.js';
import { documentRoutes } from './routes/documents.js';
import { fileRoutes } from './routes/files.js';
import { economicsRoutes } from './routes/economics.js';
import { stockRoutes } from './routes/stock.js';
import { fleetRoutes } from './routes/fleet.js';
import { modelRoutes } from './routes/models.js';
import { jobRoutes } from './routes/jobs.js';
import { locationRoutes } from './routes/locations.js';
import { opsRoutes } from './routes/ops.js';
import { paymentRoutes } from './routes/payments.js';
import { rentalRoutes } from './routes/rentals.js';
import { contactRoutes } from './routes/contacts.js';
import { purchaseRoutes } from './routes/purchases.js';
import { saleRoutes } from './routes/sales.js';
import { searchRoutes } from './routes/search.js';
import { serviceRoutes } from './routes/service.js';
import { statementRoutes } from './routes/statements.js';
import { tillRoutes } from './routes/till.js';
import { handoverRoutes } from './routes/handover.js';
import { signRoutes } from './routes/documents.js';
import { depositRoutes } from './routes/deposits.js';
import { summaryRoutes } from './routes/summary.js';
import { todayRoutes } from './routes/today.js';
import { batteryRoutes } from './routes/batteries.js';
import { userRoutes } from './routes/users.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === 'test' ? false : { level: 'info' },
    exposeHeadRoutes: false, // keep the auto-registered route table exact
  });

  app.register(cookie, { secret: env.SESSION_SECRET });

  // Everything registered after this is guarded; an undeclared scope is
  // owner-only (default-deny).
  installGuard(app);
  // After the guard: a key is claimed only by a request that may run.
  installOperationKeys(app);

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: err.code, message: err.message, ...err.extra });
    }
    // Fastify's own refusals (malformed body, payload too large) carry a 4xx.
    const framework = err as { statusCode?: unknown; code?: unknown; message?: string };
    const status = typeof framework.statusCode === 'number' ? framework.statusCode : 500;
    if (status >= 400 && status < 500) {
      const code = typeof framework.code === 'string' ? framework.code : 'bad_request';
      return reply.code(status).send({ error: code, message: framework.message ?? 'Bad request.' });
    }
    // A record id that is not an id at all — /sales/new, a truncated link —
    // names no record: that is a 404 for the screen to explain, not a fault
    // (B1-02). Postgres says 22P02; Prisma wraps it in its own codes.
    if (isMalformedId(err)) return reply.code(404).send({ error: 'not_found', message: 'No such record.' });
    app.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Something broke on our side.' });
  });

  authRoutes(app);
  summaryRoutes(app);
  todayRoutes(app);
  batteryRoutes(app);
  fleetRoutes(app);
  modelRoutes(app);
  locationRoutes(app);
  economicsRoutes(app);
  stockRoutes(app);
  customerRoutes(app);
  rentalRoutes(app);
  opsRoutes(app);
  fileRoutes(app);
  documentRoutes(app);
  userRoutes(app);
  paymentRoutes(app);
  statementRoutes(app);
  tillRoutes(app);
  handoverRoutes(app);
  signRoutes(app);
  depositRoutes(app);
  jobRoutes(app);
  serviceRoutes(app);
  saleRoutes(app);
  purchaseRoutes(app);
  contactRoutes(app);
  searchRoutes(app);

  return app;
}

function isMalformedId(err: unknown): boolean {
  const seen = new Set<unknown>();
  for (let e: unknown = err; e && typeof e === 'object' && !seen.has(e); e = (e as { cause?: unknown }).cause) {
    seen.add(e);
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (code === '22P02' || code === 'P2023') return true;
    if (typeof message === 'string' && /invalid input syntax for type uuid|Error creating UUID|invalid character.*UUID/i.test(message)) return true;
  }
  return false;
}
