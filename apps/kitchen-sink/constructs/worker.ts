import { Worker } from '@geekmidas/constructs/worker';
import { database } from './database.js';
import { logger } from './logger.js';

/**
 * The background work this application does, and the process that does it.
 *
 * Not a container: a worker names which process runs a cron or a subscriber
 * and what logger it runs with, and that process is the api's server — the one
 * already running, minus the HTTP surface. Declaring a second worker here would
 * be a second grouping, not a second deployment.
 *
 * `.database(database)` is where its schedules live. Only a server target reads
 * it; on AWS a cron is an EventBridge rule and nothing here is consulted.
 */
export const worker = new Worker('Jobs', { logger }).database(database);
