import { e } from '@geekmidas/constructs/endpoints';
import logger from '../config/logger.js';
import { auth } from '../constructs/auth.js';
import { sessions } from '../constructs/cache.js';
import { database } from '../constructs/database.js';
import { users } from '../constructs/topics.js';
import { AuditStorageService } from '../services/AuditStorageService.js';

/**
 * The shared endpoint factory. Every endpoint built from `router` inherits:
 *
 * - `logger`                        — the Pino/Telescope logger
 * - `.dependsOn([...])`             — the auth server and the cache, under
 *                                     their own ids: `services.auth`,
 *                                     `services.sessions`
 * - `.database(database)`           — `db` in context, typed by the construct's
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
	.dependsOn([auth, sessions])
	.database(database)
	.auditor(AuditStorageService)
	.publisher(users.publisher);
