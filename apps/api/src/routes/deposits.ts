import type { FastifyInstance } from 'fastify';
import { depositsOverview } from '../lib/deposits.js';

// Deposits (wave 2 §3.6). The figures themselves live in `lib/deposits.ts`,
// because the week's report quotes them and two screens must not disagree
// about how much deposit money the company is holding.

export function depositRoutes(app: FastifyInstance): void {
  app.get('/api/deposits', { config: { scope: 'payments.view' } }, async () => depositsOverview());
}
