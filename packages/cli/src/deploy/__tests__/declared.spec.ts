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
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: '.',
		endpoints: [],
		provides: ['API_URL'],
	},
	// Mail: the stage's own SMTP server, from its secrets.
	Mail: { kind: 'email', id: 'Mail', provides: ['MAIL_URL', 'MAIL_FROM'] },
	// A kind this target provisions nothing for: a site is an app, deployed
	// by the engine, not infrastructure the manifest creates.
	Web: {
		kind: 'site',
		id: 'Web',
		path: 'apps/web',
		variant: 'static',
		provides: [],
	},
} as unknown as ConstructManifest;

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
				constructs: './src/constructs/**/*.ts',
			},
		},
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
		seed: 'stage-seed',
		supplied: {
			MAIL_URL: 'smtp://user:password@smtp.example.com:587',
			MAIL_FROM: 'noreply@example.com',
		},
		manifest,
	});

describe('provisionDeclared', () => {
	it('gives each surface its own app’s address, not the first one’s', async () => {
		// Two APIs: each is an app of its own and answers on its own host. Both
		// used to be handed the first backend's address.
		const twoApis = {
			Api: {
				kind: 'rest-api',
				id: 'Api',
				path: 'apps/api',
				endpoints: [],
				provides: ['API_URL'],
			},
			Webhooks: {
				kind: 'rest-api',
				id: 'Webhooks',
				path: 'apps/webhooks',
				endpoints: [],
				provides: ['WEBHOOKS_URL'],
			},
		} as unknown as ConstructManifest;

		const { env } = await provisionDeclared({
			api,
			workspace: workspaceWith(),
			projectId: 'project',
			environmentId: 'environment',
			stage: 'production',
			appUrls: {
				api: 'https://api.example.com',
				webhooks: 'https://hooks.example.com',
			},
			seed: 'stage-seed',
			manifest: twoApis,
		});

		expect(env.API_URL).toBe('https://api.example.com');
		expect(env.WEBHOOKS_URL).toBe('https://hooks.example.com');
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
			// Mail, as the stage was given it — a construct reads its own key, so
			// no sniffer would have found these either.
			'MAIL_FROM',
			'MAIL_URL',
			'ORDERS_OWNER_URL',
			'ORDERS_URL',
			'SESSIONS_URL',
		]);
	});

	it('points a surface at the domain its app answers on', async () => {
		const { env } = await run(workspaceWith());

		expect(env.API_URL).toBe('https://api.example.com');
	});

	it('skips a kind this target provisions nothing for, rather than failing', async () => {
		const { provisioned } = await run(workspaceWith());

		expect(provisioned).not.toHaveProperty('Web');
	});

	it("takes mail from the stage's secrets, and runs nothing for it", async () => {
		const { env, provisioned } = await run(workspaceWith());

		expect(provisioned).toHaveProperty('Mail');
		expect(env.MAIL_URL).toBe('smtp://user:password@smtp.example.com:587');
		expect(env.MAIL_FROM).toBe('noreply@example.com');
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
