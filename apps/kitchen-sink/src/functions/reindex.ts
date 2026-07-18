import { f } from '@geekmidas/constructs/functions';
import { z } from 'zod';
import logger from '../config/logger.js';
import { DatabaseService } from '../services/DatabaseService.js';

/**
 * A standalone function (`f`) — not an HTTP route and not schedule-driven.
 * Invoked directly (or as a Lambda). Demonstrates typed `input`, services, and
 * a typed `output`.
 */
export const reindexUsers = f
	.logger(logger)
	.services([DatabaseService])
	.input(z.object({ since: z.string().datetime().optional() }))
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
