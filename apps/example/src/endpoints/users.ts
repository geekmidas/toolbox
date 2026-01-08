import { z } from 'zod';
import { DatabaseService } from '../services/DatabaseService.js';
import { router } from './router.js';

export const UserSchema = z
	.object({
		id: z.string(),
		name: z.string(),
		email: z.string().email(),
		created_at: z.string(),
	})
	.meta({ id: 'User' });

/**
 * Get all users
 */
export const getUsers = router
	.get('/users')
	.output(
		z.object({
			users: UserSchema.array(),
		}),
	)
	.services([DatabaseService])
	.handle(async ({ services }) => {
		const users = await services.database
			.selectFrom('users')
			.selectAll()
			.execute();

		return {
			users: users.map((user) => ({
				id: user.id,
				name: user.name,
				email: user.email,
				created_at: user.created_at.toISOString(),
			})),
		};
	});

/**
 * Create a new user
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
	.services([DatabaseService])
	.event({
		type: 'user.created',
		payload: (r) => ({
			userId: r.id,
			email: r.email,
		}),
	})
	.handle(async ({ body, services, logger }) => {
		logger.info({ body }, 'Creating user');

		const user = await services.database
			.insertInto('users')
			.values({
				name: body.name,
				email: body.email,
			})
			.returningAll()
			.executeTakeFirstOrThrow();

		return {
			id: user.id,
			name: user.name,
			email: user.email,
			created_at: user.created_at.toISOString(),
		};
	});

/**
 * Get user by ID
 */
export const getUser = router
	.get('/users/:id')
	.params(z.object({ id: z.string().uuid() }))
	.output(UserSchema)
	.services([DatabaseService])
	.handle(async ({ params, services }) => {
		const user = await services.database
			.selectFrom('users')
			.selectAll()
			.where('id', '=', params.id)
			.executeTakeFirstOrThrow();

		return {
			id: user.id,
			name: user.name,
			email: user.email,
			created_at: user.created_at.toISOString(),
		};
	});
