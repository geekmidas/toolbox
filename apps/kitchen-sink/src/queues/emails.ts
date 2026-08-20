import { q } from '@geekmidas/constructs/queue';
import { z } from 'zod';
import logger from '../config/logger.js';
import { mail } from '../constructs/email.js';
import { CacheService } from '../services/CacheService.js';

/** The job payload — point-to-point work for a single consumer. */
export const EmailJob = z.object({
	to: z.email(),
	name: z.string(),
	userId: z.string(),
	template: z.enum(['welcome']),
});

/**
 * The `emails` queue and its worker.
 *
 * The queue is a construct in its own right: declaring it is what puts a broker
 * in the local plan and what resolves `EMAILS_PUBLISHER_CONNECTION_STRING` for
 * whoever produces to it. Unlike a topic subscriber it drains *every* message of
 * its one type — locally from pg-boss, deployed from SQS, chosen by the protocol
 * in that string and by nothing in this file.
 *
 * The mail construct's client is injected the same way a database or a bucket
 * is, so `sendTemplate` is checked against the templates the construct was given
 * and the SMTP host is whatever the stage supplied — Mailpit here.
 */
export const emailsQueue = q
	.queue('emails')
	.logger(logger)
	.services([CacheService, mail.service])
	.message(EmailJob)
	.handle(async ({ messages, services, logger }) => {
		for (const { to, name, userId, template } of messages) {
			const dedupeKey = `email:${userId}:${template}`;
			if (await services.cache.get(dedupeKey)) {
				logger.info({ to, template }, 'Skipping duplicate email');
				continue;
			}

			const { messageId } = await services.mail.sendTemplate(template, {
				to,
				subject: 'Welcome aboard',
				props: { name, appUrl: 'http://localhost:3000' },
			});

			await services.cache.set(dedupeKey, true, 3600);
			logger.info({ to, template, messageId }, 'Sent email');
		}
	});
