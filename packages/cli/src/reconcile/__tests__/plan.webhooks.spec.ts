import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { planFor } from '../plan';

/**
 * A `webhooks` node provisions nothing: its tables are its tenant's, created
 * by a committed migration, and its key is the encryption construct's. The
 * plan reconciles the rest of the graph around it unchanged.
 */
const manifest = {
	App: { kind: 'database', id: 'App', provides: ['APP_URL'] },
	BillingHooksDb: {
		kind: 'database-schema',
		id: 'BillingHooksDb',
		of: 'App',
		schema: 'billinghooksdb',
		provides: ['BILLING_HOOKS_DB_URL'],
	},
	Pii: { kind: 'encryption', id: 'Pii', provides: ['PII_URL'] },
	Billing: {
		kind: 'topic',
		id: 'Billing',
		provides: ['BILLING_PUBLISHER_CONNECTION_STRING'],
	},
	BillingHooks: {
		kind: 'webhooks',
		id: 'BillingHooks',
		owner: 'Api',
		topic: 'Billing',
		events: ['invoice.paid'],
		database: 'BillingHooksDb',
		encryption: 'Pii',
	},
} as const satisfies ConstructManifest;

describe('a webhooks node', () => {
	it('plans no resource of its own, and leaves the rest of the plan as it was', () => {
		const { BillingHooks: _, ...without } = manifest;
		const withHooks = planFor(manifest, 'test', provisionOrder(manifest), {
			localStage: 'development',
		});
		const withoutHooks = planFor(without, 'test', provisionOrder(without), {
			localStage: 'development',
		});

		expect(withHooks.resources.map((r) => r.id)).not.toContain('BillingHooks');
		expect(withHooks.resources).toEqual(withoutHooks.resources);
	});
});
