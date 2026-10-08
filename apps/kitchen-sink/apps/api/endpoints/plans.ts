import { z } from 'zod';
import { router } from './router.js';

export const PlanSchema = z
	.object({ id: z.string(), name: z.string(), monthlyCents: z.number() })
	.meta({ id: 'Plan' });

/**
 * The plans on offer — rows no request writes. The database's seed upserts
 * them on every deploy, after the migrations and before this app starts, so
 * they are here on a fresh stage's first request.
 */
export const listPlans = router
	.get('/plans')
	.output(z.object({ plans: PlanSchema.array() }))
	.handle(async ({ db }) => {
		const rows = await db
			.selectFrom('plans')
			.selectAll()
			.orderBy('monthly_cents')
			.execute();
		return {
			plans: rows.map((plan) => ({
				id: plan.id,
				name: plan.name,
				monthlyCents: plan.monthly_cents,
			})),
		};
	});
