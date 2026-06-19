import { c } from '@geekmidas/constructs/crons';
import logger from '../config/logger.js';
import { DatabaseService } from '../services/DatabaseService.js';

/**
 * A scheduled task (`c`). The `schedule` expression is deploy-time infra (an
 * EventBridge rule); the handler is the same function-style handler with services.
 */
export const cleanupStaleUsers = c
	.logger(logger)
	.services([DatabaseService])
	.schedule('rate(1 day)')
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
