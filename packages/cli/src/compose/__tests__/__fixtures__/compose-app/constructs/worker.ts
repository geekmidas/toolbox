import { Worker } from '@geekmidas/constructs/worker';
import { database } from './database.js';
import { logger } from './logger.js';

/** The background work: a process of its own, with no route and no port. */
export const worker = new Worker('Jobs', { logger }).database(database);
