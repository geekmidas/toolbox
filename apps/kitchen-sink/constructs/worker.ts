import { Worker } from '@geekmidas/constructs/worker';
import { database } from './database.js';
import { logger } from './logger.js';

/**
 * The background work this application does, and the process that does it.
 *
 * A container of its own once deployed: `gkm compose` and Dokploy run it as
 * the `jobs` service, built from the api's directory, with no route and no
 * port — its crons, its queue consumer and its subscriber, and a health check.
 * `gkm dev` runs it in the api's process.
 *
 * `.database(database)` is where its schedules live. Only a server target reads
 * it; on AWS a cron is an EventBridge rule and nothing here is consulted.
 */
export const worker = new Worker('Jobs', { logger }).database(database);
