import { e } from '@geekmidas/constructs/endpoints';
import logger from '../config/logger.js';
import { database } from '../constructs/database';
import { AuditStorageService } from '../services/AuditStorageService';
import { AuthService } from '../services/AuthService';
import { EventsService } from '../services/EventsService';

/**
 * Example router with shared logger, services, database, and auditor.
 *
 * The pattern:
 * ```typescript
 * e.logger(logger)
 *   .services([AuthService])
 *   .database(database.service)
 *   .auditor(AuditStorageService)
 *   .publisher(EventsService)
 * ```
 *
 * Creates a factory where all endpoints inherit:
 * - The same logger instance
 * - Access to registered services (auth, etc.)
 * - The declared database, available as `db` in handler context
 * - Auditor available in handler context for manual audits
 * - Support for declarative audits via `.audit([...])`
 *
 * Usage in endpoints:
 * ```typescript
 * export const myEndpoint = router
 *   .get('/my-route')
 *   .audit([{ type: 'resource.accessed', payload: (r) => ({ id: r.id }) }])
 *   .handle(async ({ services, logger, db, auditor }) => {
 *     // db - database connection (or transaction when audits are atomic)
 *     // auditor - for manual audit logging
 *     // services.auth - registered services
 *   });
 * ```
 */
export const router = e
	.logger(logger)
	.services([AuthService])
	.database(database.service)
	.auditor(AuditStorageService)
	.publisher(EventsService)
	.authorizer('iam');
