import type { Kysely } from 'kysely';
import type { Database } from '../../../constructs/database.js';

/**
 * The plans every stage offers.
 *
 * A seed runs on every deploy, every stage, production included — after the
 * migrations, before any app starts — so it is an upsert: run again, it
 * changes nothing but what it says. Changing a price here and deploying is how
 * the price changes.
 */
export const PLANS = [
	{ id: 'free', name: 'Free', monthly_cents: 0 },
	{ id: 'team', name: 'Team', monthly_cents: 2_000 },
] as const;

export async function seed(db: Kysely<Database>): Promise<void> {
	await db
		.insertInto('plans')
		.values([...PLANS])
		.onConflict((oc) =>
			oc.column('id').doUpdateSet((eb) => ({
				name: eb.ref('excluded.name'),
				monthly_cents: eb.ref('excluded.monthly_cents'),
			})),
		)
		.execute();
}
