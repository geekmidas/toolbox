import { sql } from 'kysely';
import { z } from 'zod';
import { router } from './router';

/**
 * Example endpoint demonstrating access to shared services, database, and auditor.
 * All are inherited from the router configuration.
 */
export const getProfile = router
	.get('/profile')
	.query(z.object({ userId: z.string() }))
	.output(
		z.object({
			id: z.string(),
			email: z.string(),
			data: z.any(),
		}),
	)
	.handle(async ({ query, services, logger, db, auditor }) => {
		// Access services from the router
		const auth = services.auth;

		logger.info({ userId: query.userId }, 'Fetching user profile');

		// Use auth service to get user
		const user = await auth.getUserById(query.userId);
		if (!user) {
			throw new Error('User not found');
		}

		// The declared database, available as `db` in context. When the auditor
		// writes to the same database, `db` is the transaction, so the audit and
		// the read it describes commit together.
		//
		// `user_data` is outside the construct's schema type, so it is reached
		// through `sql` — which also parameterises `userId` rather than
		// interpolating it into the statement.
		const { rows: data } = await sql<{ key: string; value: string }>`
			SELECT * FROM user_data WHERE user_id = ${query.userId}
		`.execute(db);

		// Manual audit logging via auditor - type is inferred from AuditStorageService
		auditor.audit('user.updated', {
			userId: user.id,
			changes: ['profile_viewed'],
		});

		return {
			id: user.id,
			email: user.email,
			data: Object.fromEntries(
				data.map((d: { key: string; value: string }) => [d.key, d.value]),
			),
		};
	});
