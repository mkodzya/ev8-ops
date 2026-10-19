import type { FastifyInstance } from 'fastify';
import { driveReconciliation, scanDrive } from '../lib/driveScan.js';

// The rentals folders in Drive beside the rentals here (ADR-0031): an owner's
// screen, and a button that reads Drive now instead of waiting for the night.

export function driveRoutes(app: FastifyInstance): void {
  app.get('/api/drive/reconciliation', { config: { scope: 'users.manage' } }, async () => driveReconciliation());

  app.post('/api/drive/scan', { config: { scope: 'users.manage' } }, async () => {
    const outcome = await scanDrive();
    if (outcome.status === 'failed') app.log.warn(outcome, 'drive did not answer');
    return outcome;
  });
}
