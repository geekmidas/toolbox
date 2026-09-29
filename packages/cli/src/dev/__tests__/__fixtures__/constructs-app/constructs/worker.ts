import { Worker } from '@geekmidas/constructs/worker';
import { logger } from './logger.js';

export const jobs = new Worker('Jobs', { logger });

export const nightly = jobs
	.cron('rate(1 day)')
	.handle(async ({ logger }) => logger.info('nightly'));
