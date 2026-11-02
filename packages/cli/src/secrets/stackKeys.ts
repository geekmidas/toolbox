/**
 * The stage secrets gkm keeps for the stack itself rather than for the
 * application: the server's address, the logins of the containers it runs
 * (Redis, OpenObserve), the key backups write with, the secret a CDN sends a
 * file server's processors.
 *
 * Nothing in an app reads them, so no process is handed one as "the stage's
 * own" (`processEnvKeys`) — the containers that do read them are given them
 * by name.
 */

import { BACKUPS_URL_KEY } from '../backups/service.js';
import { isReservedStageKey } from '../compose/dnsConfig.js';
import { LOGS_EMAIL_KEY, LOGS_PASSWORD_KEY } from '../compose/logs.js';
import { REDIS_PASSWORD_KEY } from '../compose/redis.js';
import { PROCESSOR_ORIGIN_SECRET_ENV } from '../providers/processorOrigin.js';

const STACK_KEYS: ReadonlySet<string> = new Set([
	BACKUPS_URL_KEY,
	LOGS_EMAIL_KEY,
	LOGS_PASSWORD_KEY,
	REDIS_PASSWORD_KEY,
	PROCESSOR_ORIGIN_SECRET_ENV,
]);

/** A file server's origin secret: `ASSETS_SERVER_ORIGIN_SECRET`. */
const ORIGIN_SECRET = /_ORIGIN_SECRET$/;

/** Whether a stage secret is the stack's own, which no app process reads. */
export function isStackKey(key: string): boolean {
	return (
		isReservedStageKey(key) ||
		key.startsWith('GKM_') ||
		STACK_KEYS.has(key) ||
		ORIGIN_SECRET.test(key)
	);
}
