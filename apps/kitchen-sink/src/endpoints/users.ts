import { z } from 'zod';
import { emailsQueue } from '../queues/emails.js';
import { router } from './router.js';

export const UserSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		email: z.string().email(),
		created_at: z.string(),
	})
	.meta({ id: 'User' });

const USERS_CACHE_KEY = 'users:all';

/**
 * List users — demonstrates the cache service: serve from cache when warm,
 * otherwise read the DB and populate it.
 */
export const listUsers = router
	.get('/users')
	.output(z.object({ users: UserSchema.array() }))
	.handle(async ({ services, logger }) => {
		const cached =
			await services.cache.get<z.infer<typeof UserSchema>[]>(USERS_CACHE_KEY);
		if (cached) {
			logger.debug('Serving users from cache');
			return { users: cached };
		}

		const rows = await services.database
			.selectFrom('users')
			.selectAll()
			.execute();
		const users = rows.map((u) => ({
			id: u.id,
			name: u.name,
			email: u.email,
			created_at: u.created_at.toISOString(),
		}));

		await services.cache.set(USERS_CACHE_KEY, users, 30);
		return { users };
	});

/**
 * Create a user — the cross-construct centerpiece. A single request:
 *  1. inserts the row (DB service),
 *  2. publishes `user.created` to the **topic** (declarative `.event(...)`),
 *     which the `userEvents` subscriber fans out on,
 *  3. enqueues a welcome email on the **queue** (point-to-point) via the
 *     queue's auto-publisher, which the `emails` worker drains,
 *  4. records an audit entry,
 *  5. invalidates the list cache.
 */
export const createUser = router
	.post('/users')
	.body(
		z.object({
			name: z.string().min(1),
			email: z.string().email(),
		}),
	)
	.output(UserSchema)
	// Queue producer — `emailsQueue.publisher` is a Service; its serviceName is
	// `emailsPublisher`. The env var it needs (EMAILS_PUBLISHER_CONNECTION_STRING)
	// is sniffed into the manifest from here.
	.services([emailsQueue.publisher])
	// Topic fan-out — delivered via the router's EventsService publisher.
	.event({
		type: 'user.created',
		payload: (r) => ({ userId: r.id, email: r.email, name: r.name }),
	})
	.handle(async ({ body, services, logger, auditor }) => {
		const user = await services.database
			.insertInto('users')
			.values({ name: body.name, email: body.email })
			.returningAll()
			.executeTakeFirstOrThrow();

		// Point-to-point: enqueue the welcome email for the single worker.
		await services.emailsPublisher.publish([
			{
				type: 'emails',
				payload: { to: user.email, userId: user.id, template: 'welcome' },
			},
		]);

		// Imperative audit (the router supplies `auditor`, typed to AppAuditAction).
		auditor.audit('user.created', { userId: user.id, email: user.email });

		await services.cache.delete(USERS_CACHE_KEY);
		logger.info({ userId: user.id }, 'Created user');

		return {
			id: user.id,
			name: user.name,
			email: user.email,
			created_at: user.created_at.toISOString(),
		};
	});

/**
 * Get a user by id — protected with `.authorizer('iam')` to show the auth
 * integration point, and uses the `auth` service + `auditor` from context.
 */
export const getUser = router
	.get('/users/:id')
	.params(z.object({ id: z.string().uuid() }))
	.authorizer('iam')
	.output(UserSchema)
	.handle(async ({ params, services, auditor }) => {
		// The auth service is available via DI (mock implementation).
		await services.auth.getUserById(params.id);

		const user = await services.database
			.selectFrom('users')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirstOrThrow();

		auditor.audit('user.viewed', { userId: user.id });

		return {
			id: user.id,
			name: user.name,
			email: user.email,
			created_at: user.created_at.toISOString(),
		};
	});
