import { database } from '@kitchen-sink/constructs/database.js';
import { worker } from '@kitchen-sink/constructs/worker.js';
import { z } from 'zod';

/**
 * A function — not an HTTP route and not schedule-driven. Invoked directly, or
 * as a Lambda. Built from the worker so it says which process runs it and
 * carries that worker's logger.
 */
export const reindexUsers = worker
	.dependsOn([database])
	.input(z.object({ since: z.iso.datetime().optional() }))
	.output(z.object({ reindexed: z.number() }))
	.handle(async ({ input, services, logger }) => {
		let query = services.database.selectFrom('users').selectAll();
		if (input.since) {
			query = query.where('updated_at', '>=', new Date(input.since));
		}
		const users = await query.execute();
		logger.info({ count: users.length }, 'Reindexed users');
		return { reindexed: users.length };
	});
