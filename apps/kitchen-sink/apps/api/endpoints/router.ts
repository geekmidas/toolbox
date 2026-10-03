import { api } from '@kitchen-sink/constructs/api.js';
import { database } from '@kitchen-sink/constructs/database.js';
import { AuditStorageService } from '../services/AuditStorageService.js';

/**
 * What a group of endpoints shares, and deliberately not what any of them may
 * reach.
 *
 * Branched from `api`, so everything built here still knows which
 * surface serves it — and therefore which logger and environment parser it runs
 * with, neither of which is named anywhere any more.
 *
 * - `.database(database)`           — `db` in context, typed by the construct's
 *                                     schema (and the audit transaction)
 * - `.auditor(AuditStorageService)` — `auditor` in context + declarative `.audit([...])`
 *
 * Nothing that publishes is here either: an endpoint that publishes names the
 * topic itself, `.event(users, …)`, so only the routes that publish to `users`
 * can.
 *
 * `.dependsOn([auth, sessions])` used to be here too, and that was the mistake.
 * It injects a client, so putting it on a shared factory hands the auth server
 * to a health check because a profile endpoint needed it. Each endpoint names
 * its own, which is why `listUsers` reaches the cache and nothing else.
 *
 * No default authorizer → endpoints are public; opt in per-endpoint with
 * `.authorizer('iam')` (see the protected endpoint in users.ts).
 */
export const router = api.database(database).auditor(AuditStorageService);
