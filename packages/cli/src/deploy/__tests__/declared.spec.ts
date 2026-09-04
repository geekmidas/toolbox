import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import type { NormalizedWorkspace } from '../../workspace/types';
import { provisionDeclared } from '../declared';
import type { DokployApi } from '../dokploy-api';

const manifest = {
	Orders: {
		kind: 'database',
		id: 'Orders',
		engine: 'postgres',
		schema: 'app',
		provides: ['ORDERS_URL'],
	},
	Sessions: { kind: 'cache', id: 'Sessions', provides: ['SESSIONS_URL'] },
	Api: { kind: 'rest-api', id: 'Api', endpoints: [], provides: ['API_URL'] },
	// A kind this target has no primitive for. Dokploy models MinIO as a Compose
	// stack, which is a separate decision — see §4.3.
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
} as const satisfies ConstructManifest;

const api = {
	async findOrCreatePostgres(
		name: string,
		_projectId: string,
		_environmentId: string,
		options?: { databaseName?: string },
	) {
		// `name` is the Dokploy service; `databaseName` is what Postgres calls it.
		const databaseName = options?.databaseName ?? name;

		return {
			postgres: {
				postgresId: `pg-${name}`,
				appName: `${name}-service`,
				databaseName,
				databaseUser: `${databaseName}_master`,
				databasePassword: 'master',
			},
			created: true,
		};
	},
} as unknown as DokployApi;

function workspaceWith(
	overrides: Partial<NormalizedWorkspace> = {},
): NormalizedWorkspace {
	return {
		name: 'shop',
		root: '/tmp/shop',
		apps: {
			api: {
				type: 'backend',
				path: 'apps/api',
				port: 3000,
				dependencies: [],
				resolvedDeployTarget: 'dokploy',
				// The hard switch: reconcile and this both read it, so a project
				// that has not adopted the model is untouched.
				constructs: './src/constructs/**/*.ts',
			},
		},
		services: { cache: 'db' },
		deploy: { default: 'dokploy' },
		shared: { packages: [] },
		secrets: {},
		...overrides,
	} as NormalizedWorkspace;
}

const run = (workspace: NormalizedWorkspace) =>
	provisionDeclared({
		api,
		workspace,
		projectId: 'project',
		environmentId: 'environment',
		stage: 'production',
		appUrls: { api: 'https://api.example.com' },
		manifest,
	});

describe('provisionDeclared', () => {
	it('does nothing for a project that has not adopted the model', async () => {
		// `usesConstructs` is the same hard switch reconcile reads. An existing
		// deploy must be untouched until it declares something.
		const legacy = workspaceWith({
			apps: {
				api: {
					type: 'backend',
					path: 'apps/api',
					port: 3000,
					dependencies: [],
					resolvedDeployTarget: 'dokploy',
				},
			} as NormalizedWorkspace['apps'],
		});

		expect(await run(legacy)).toEqual({
			env: {},
			statements: [],
			provisioned: {},
			clusters: {},
		});
	});

	it('resolves the URLs the sniffer cannot see', async () => {
		// The gap this closes: a construct reads its own key inside
		// `@geekmidas/constructs`, so a walk of application code finds no
		// `get('ORDERS_URL')` and the sniffer reported it as unneeded.
		const { env } = await run(workspaceWith());

		expect(Object.keys(env).sort()).toEqual([
			// A surface publishes three facts, not one: where it answers, who may
			// call it, and where its cookie is readable.
			'API_TRUSTED_ORIGINS',
			'API_URL',
			'ORDERS_OWNER_URL',
			'ORDERS_URL',
			'SESSIONS_URL',
		]);
	});

	it('points a surface at the domain its app answers on', async () => {
		const { env } = await run(workspaceWith());

		expect(env.API_URL).toBe('https://api.example.com');
	});

	it('skips a kind this target cannot provision, rather than failing', async () => {
		// Refusing to deploy an app because it also declares a bucket would be
		// worse than deploying it without one. The cost is honest: the key is
		// absent, and the construct that needs it says so on first use.
		const { env, provisioned } = await run(workspaceWith());

		expect(provisioned).not.toHaveProperty('Uploads');
		expect(env).not.toHaveProperty('UPLOADS_URL');
	});

	it('hands back DDL in the applier’s shape rather than running it', async () => {
		// Statements are `create`, not `sql`, because they go to the local
		// target's convergent applier — so a redeploy asks whether each is needed
		// and reports unchanged instead of reapplying.
		const { statements } = await run(workspaceWith());

		expect(statements.length).toBeGreaterThan(0);
		expect(statements.every((s) => typeof s.create === 'string')).toBe(true);
		expect(statements.map((s) => s.create)).toContainEqual(
			expect.stringContaining('CREATE ROLE "orders_production"'),
		);
	});

	it('records the cluster the manifest created, for the DDL to run against', async () => {
		// Not whichever Postgres happens to be around. A project may also have a
		// legacy `services.postgres`, and applying a construct's roles to that one
		// would create them where nothing connects — which is what the first cut
		// of this did.
		const { clusters, statements } = await run(workspaceWith());

		expect(Object.keys(clusters)).toEqual(['orders_production']);
		// Keyed by the *database* name, while the service it lives in carries the
		// kind — the two names the last fix separated.
		// Keyed by the *database* name, while the service carries the scoped
		// cloud name plus its kind — the two rules the last fix separated.
		expect(clusters.orders_production?.appName).toBe(
			'production-shop-orders-service',
		);
		// Every statement has a cluster to run against, which is the property
		// that stops one being silently skipped.
		expect(statements.every((s) => s.database && clusters[s.database])).toBe(
			true,
		);
	});

	it('names the database each statement belongs to', async () => {
		// Roles are cluster-scoped but their grants are not, so every statement
		// after the first has to run against the database the objects live in.
		const { statements } = await run(workspaceWith());

		expect(statements.every((s) => s.database === 'orders_production')).toBe(
			true,
		);
	});
});
