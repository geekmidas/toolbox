import { e } from '@geekmidas/constructs/endpoints';
import logger from '../config/logger.js';
import { AuditStorageService } from '../services/AuditStorageService.js';
import { AuthService } from '../services/AuthService.js';
import { CacheService } from '../services/CacheService.js';
import { DatabaseService } from '../services/DatabaseService.js';
import { EventsService } from '../services/EventsService.js';

/**
 * The shared endpoint factory. Every endpoint built from `router` inherits:
 *
 * - `logger`                          — the Pino/Telescope logger
 * - `.services([...])`                — database, auth, cache (as `services.*`)
 * - `.database(DatabaseService)`      — `db` in context (and the audit transaction)
 * - `.auditor(AuditStorageService)`   — `auditor` in context + declarative `.audit([...])`
 * - `.publisher(EventsService)`       — declarative `.event(...)` topic publishing
 *
 * No default authorizer → endpoints are public; opt in per-endpoint with
 * `.authorizer('iam')` (see the protected endpoint in users.ts).
 */
export const router = e
	.logger(logger)
	.services([DatabaseService, AuthService, CacheService])
	.database(DatabaseService)
	.auditor(AuditStorageService)
	.publisher(EventsService);
