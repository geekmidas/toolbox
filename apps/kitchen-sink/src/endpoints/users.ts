import { NotFoundError } from '@geekmidas/errors';
import { z } from 'zod';
import { emailsQueue } from '../queues/emails.js';
import { router } from './router.js';
import { requireUser } from './session.js';

export const UserSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		email: z.email(),
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
	.handle(async ({ services, logger, db }) => {
		const cached =
			await services.sessions.get<z.infer<typeof UserSchema>[]>(
				USERS_CACHE_KEY,
			);
		if (cached) {
			logger.debug('Serving users from cache');
			return { users: cached };
		}

		const rows = await db.selectFrom('users').selectAll().execute();
		const users = rows.map((u) => ({
			id: u.id,
			name: u.name,
			email: u.email,
			created_at: u.created_at.toISOString(),
		}));

		await services.sessions.set(USERS_CACHE_KEY, users, 30);
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
			email: z.email(),
		}),
	)
	.output(UserSchema)
	// Queue producer — the queue derives its own publisher, so the only thing
	// written here is which queue. Its connection string
	// (EMAILS_PUBLISHER_CONNECTION_STRING) is declared by the queue construct and
	// resolved by the target, never by this file.
	.services([emailsQueue.publisher])
	// Topic fan-out — delivered through the router's topic publisher.
	.event({
		type: 'user.created',
		payload: (r) => ({ userId: r.id, email: r.email, name: r.name }),
	})
	.handle(async ({ body, services, logger, auditor, db }) => {
		const user = await db
			.insertInto('users')
			.values({ name: body.name, email: body.email })
			.returningAll()
			.executeTakeFirstOrThrow();

		// Point-to-point: enqueue the welcome email for the single worker.
		await services.emailsPublisher.publish([
			{
				type: 'emails',
				payload: {
					to: user.email,
					name: user.name,
					userId: user.id,
					template: 'welcome',
				},
			},
		]);

		// Imperative audit (the router supplies `auditor`, typed to AppAuditAction).
		auditor.audit('user.created', { userId: user.id, email: user.email });

		await services.sessions.delete(USERS_CACHE_KEY);
		logger.info({ userId: user.id }, 'Created user');

		return {
			id: user.id,
			name: user.name,
			email: user.email,
			created_at: user.created_at.toISOString(),
		};
	});

/**
 * Get a user by id — the session gate, actually closed.
 *
 * `.authorizer('iam')` is the deployed half; `requireUser` is the half that
 * runs everywhere, including here. Before, this endpoint called `getSession`
 * and threw the answer away, which reads as protected and is not.
 */
export const getUser = router
	.get('/users/:id')
	.params(z.object({ id: z.string().uuid() }))
	.authorizer('iam')
	.output(UserSchema)
	.handle(async ({ params, services, auditor, db, header }) => {
		await requireUser({ services, header, db });

		const user = await db
			.selectFrom('users')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirst();

		if (!user) throw new NotFoundError(`No user ${params.id}`);

		auditor.audit('user.viewed', { userId: user.id });

		return {
			id: user.id,
			name: user.name,
			email: user.email,
			created_at: user.created_at.toISOString(),
		};
	});

/**
 * Update your own profile — the topic's *second* event, published for the first
 * time.
 *
 * `user.updated` has been in the topic's contract from the start with nothing
 * emitting it, so the subscriber's branch for it had never run. A declared
 * event nothing publishes is a contract that has never been tested.
 *
 * The session decides whose profile this is, rather than a path parameter: an
 * id in the URL would be an authorization question ("may I edit that one?")
 * dressed up as routing.
 */
export const updateMe = router
	.patch('/me')
	.body(z.object({ name: z.string().min(1) }))
	.output(UserSchema)
	.event({
		type: 'user.updated',
		payload: (r) => ({ userId: r.id, changes: ['name'] }),
	})
	.handle(async ({ body, services, auditor, db, header }) => {
		const session = await requireUser({ services, header, db });

		const user = await db
			.updateTable('users')
			.set({ name: body.name, updated_at: new Date() })
			.where('id', '=', session.id)
			.returningAll()
			.executeTakeFirst();

		if (!user) throw new NotFoundError('Signed in as a user that is not here');

		auditor.audit('user.viewed', { userId: user.id });

		// The list is now stale in exactly the way it is after a create.
		await services.sessions.delete(USERS_CACHE_KEY);

		return {
			id: user.id,
			name: user.name,
			email: user.email,
			created_at: user.created_at.toISOString(),
		};
	});

/**
 * The notifications the topic subscriber wrote — the read side of fan-out.
 *
 * This is what makes the topic a feature rather than a demonstration: an
 * endpoint whose contents exist only because a subscriber ran.
 */
export const listNotifications = router
	.get('/notifications')
	.output(
		z.object({
			notifications: z
				.object({
					id: z.string(),
					type: z.string(),
					body: z.string(),
					created_at: z.string(),
				})
				.array(),
		}),
	)
	.handle(async ({ services, db, header }) => {
		const session = await requireUser({ services, header, db });

		const rows = await db
			.selectFrom('notifications')
			.selectAll()
			.where('user_id', '=', session.id)
			.orderBy('created_at', 'desc')
			.limit(50)
			.execute();

		return {
			notifications: rows.map((n) => ({
				id: n.id,
				type: n.type,
				body: n.body,
				created_at: n.created_at.toISOString(),
			})),
		};
	});
