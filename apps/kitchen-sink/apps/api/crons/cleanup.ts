import { database } from '@kitchen-sink/constructs/database.js';
import { worker } from '@kitchen-sink/constructs/worker.js';

/**
 * A scheduled task, built from the worker that runs it.
 *
 * The schedule is infrastructure on AWS (an EventBridge rule) and a row in
 * Postgres on a server, where the process schedules itself. Either way the
 * handler is the same function-style handler with services — and the logger
 * comes from the worker, so this file opens with the schedule.
 */
export const cleanupStaleUsers = worker
	.cron('rate(1 day)')
	.dependsOn([database])
	.handle(async ({ services, logger }) => {
		const cutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30);
		const result = await services.database
			.deleteFrom('users')
			.where('updated_at', '<', cutoff)
			.executeTakeFirst();

		const deleted = Number(result.numDeletedRows ?? 0n);
		logger.info({ deleted }, 'Cleaned up stale users');
		return { deleted };
	});
