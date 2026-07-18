import { q } from '@geekmidas/constructs/queue';
import { z } from 'zod';
import logger from '../config/logger.js';
import { CacheService } from '../services/CacheService.js';

/** The job payload — point-to-point work for a single consumer. */
export const EmailJob = z.object({
	to: z.string().email(),
	userId: z.string(),
	template: z.enum(['welcome', 'goodbye']),
});

/**
 * The `emails` queue worker. Unlike the topic subscriber (`s`), this drains
 * *every* message of its one `message` type. Producers send to it via
 * `emailsQueue.publisher` (see endpoints/users.ts) — locally that's pg-boss,
 * deployed it's SQS, chosen by the connection-string protocol.
 *
 * Services work here exactly as on endpoints: `CacheService` is sniffed and
 * injected, and used to de-duplicate sends.
 */
export const emailsQueue = q
	.queue('emails')
	.logger(logger)
	.services([CacheService])
	.message(EmailJob)
	.handle(async ({ messages, services, logger }) => {
		for (const { to, userId, template } of messages) {
			const dedupeKey = `email:${userId}:${template}`;
			if (await services.cache.get(dedupeKey)) {
				logger.info({ to, template }, 'Skipping duplicate email');
				continue;
			}
			await services.cache.set(dedupeKey, true, 3600);
			logger.info({ to, template }, 'Sending email');
		}
	});
