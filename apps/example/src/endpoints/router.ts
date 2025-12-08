import { e } from '@geekmidas/constructs/endpoints';
import { ConsoleLogger } from '@geekmidas/logger/console';
import { AuthService } from '../services/AuthService';
import { AuditStorageService } from '../services/AuditStorageService';
import { DatabaseService } from '../services/DatabaseService';
import { EventsService } from '../services/EventsService';

/**
 * Example router with shared logger, services, database, and auditor.
 *
 * The pattern:
 * ```typescript
 * e.logger(logger)
 *   .services([DatabaseService, AuthService])
 *   .database(DatabaseService)
 *   .auditor(AuditStorageService)
 *   .publisher(EventsService)
 * ```
 *
 * Creates a factory where all endpoints inherit:
 * - The same logger instance
 * - Access to registered services (database, auth, etc.)
 * - Database connection available as `db` in handler context
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
 *     // services.database, services.auth - registered services
 *   });
 * ```
 */
export const router = e
  .logger(new ConsoleLogger())
  .services([DatabaseService, AuthService])
  .database(DatabaseService)
  .auditor(AuditStorageService)
  .publisher(EventsService);
