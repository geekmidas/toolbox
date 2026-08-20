import { e } from '@geekmidas/constructs/endpoints';
import logger from '../config/logger.js';
import { database } from '../constructs/database.js';
import { users } from '../constructs/topics.js';
import { AuditStorageService } from '../services/AuditStorageService.js';
import { AuthService } from '../services/AuthService.js';
import { CacheService } from '../services/CacheService.js';

/**
 * The shared endpoint factory. Every endpoint built from `router` inherits:
 *
 * - `logger`                        — the Pino/Telescope logger
 * - `.services([...])`              — auth and cache, the two things that are
 *                                     not resources and so are still `Service`s
 * - `.database(database.service)`   — `db` in context, typed by the construct's
 *                                     schema (and the audit transaction)
 * - `.auditor(AuditStorageService)` — `auditor` in context + declarative `.audit([...])`
 * - `.publisher(users.publisher)`   — the topic's *derived* producer, so
 *                                     `.event(...)` declarations are delivered
 *                                     without a publisher service to write
 *
 * No default authorizer → endpoints are public; opt in per-endpoint with
 * `.authorizer('iam')` (see the protected endpoint in users.ts).
 */
export const router = e
	.logger(logger)
	.services([AuthService, CacheService])
	.database(database.service)
	.auditor(AuditStorageService)
	.publisher(users.publisher);
