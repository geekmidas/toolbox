import { sessions } from '@kitchen-sink/constructs/cache.js';
import { mail } from '@kitchen-sink/constructs/email.js';
import { worker } from '@kitchen-sink/constructs/worker.js';
import { z } from 'zod';

/** The job payload — point-to-point work for a single consumer. */
export const EmailJob = z.object({
	to: z.email(),
	name: z.string(),
	userId: z.string(),
	template: z.enum(['welcome']),
});

/**
 * The `emails` queue and its one consumer, run by the worker.
 *
 * One construct, because a queue has exactly one consumer. Declaring it is what
 * puts a broker in the local plan and what resolves
 * `EMAILS_PUBLISHER_CONNECTION_STRING` for whoever depends on it to send.
 * Unlike a topic subscriber it drains *every* message of its one type — locally
 * from pg-boss, deployed from SQS, chosen by the protocol in that string and by
 * nothing in this file.
 *
 * The mail construct's client is injected the same way a database or a bucket
 * is, so `sendTemplate` is checked against the templates the construct was given
 * and the SMTP host is whatever the stage supplied — Mailpit here.
 */
export const emailsQueue = worker
	.queue('emails')
	.dependsOn([mail, sessions])
	.message(EmailJob)
	.handle(async ({ messages, services, logger }) => {
		for (const { to, name, userId, template } of messages) {
			const dedupeKey = `email:${userId}:${template}`;
			if (await services.sessions.get(dedupeKey)) {
				logger.info({ to, template }, 'Skipping duplicate email');
				continue;
			}

			const { messageId } = await services.mail.sendTemplate(template, {
				to,
				subject: 'Welcome aboard',
				props: { name, appUrl: 'http://localhost:3000' },
			});

			await services.sessions.set(dedupeKey, true, 3600);
			logger.info({ to, template, messageId }, 'Sent email');
		}
	});
