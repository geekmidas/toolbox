import { t } from '@geekmidas/constructs/topic';
import { z } from 'zod';

/**
 * The `users` topic — pub/sub fan-out, one publisher and any number of
 * subscribers. Distinct from a queue, which is point-to-point work for a single
 * consumer.
 *
 * The event map is the contract. It types the derived publisher
 * (`users.publisher`, injected on the router) and every subscriber that binds
 * with `s.topic(users)`, so a payload cannot be published in one shape and read
 * in another. Declaring the topic is also what puts a broker in the local plan:
 * pg-boss by default, which lives in the database this app already declared.
 */
export const users = t.topic('users').events({
	'user.created': z.object({
		userId: z.string(),
		email: z.email(),
		name: z.string(),
	}),
	'user.updated': z.object({
		userId: z.string(),
		changes: z.array(z.string()),
	}),
});
