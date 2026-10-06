/**
 * DokployApi against a stand-in Dokploy.
 *
 * The stand-in serves one project tree from `project.one` — which is where
 * current Dokploy nests every resource, per environment — answers the
 * `*.one` hydration calls, and records every request, so each test asserts
 * both what a method returns and exactly what it sent.
 */

import { delay, HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	DokployApi,
	DokployApiError,
	DokployRequestTimedOut,
} from '../dokploy-api';

const BASE = 'https://dokploy.test';

interface Call {
	method: string;
	endpoint: string;
	query: Record<string, string>;
	body: Record<string, unknown> | undefined;
}

const server = setupServer();
let calls: Call[] = [];

/**
 * Serves `routes[endpoint]` (a value, or a function of the query), `{}` for
 * anything else, and records the call.
 */
function dokploy(
	routes: Record<
		string,
		unknown | ((query: Record<string, string>) => unknown)
	>,
) {
	server.use(
		http.all(`${BASE}/api/:endpoint`, async ({ request, params }) => {
			const url = new URL(request.url);
			const query = Object.fromEntries(url.searchParams);
			const text = request.method === 'POST' ? await request.text() : '';
			const endpoint = String(params.endpoint);
			calls.push({
				method: request.method,
				endpoint,
				query,
				body: text ? JSON.parse(text) : undefined,
			});
			const route = routes[endpoint];
			const value = typeof route === 'function' ? route(query) : route;
			return HttpResponse.json(value ?? {});
		}),
	);
}

/** Only the requests after setup: the POST bodies a method sent. */
const posted = (endpoint: string) =>
	calls.filter((c) => c.endpoint === endpoint).map((c) => c.body);

const api = () => new DokployApi({ baseUrl: BASE, token: 't' });

/** A project with a prod and a staging environment, both running `api`. */
const tree = {
	projectId: 'p1',
	environments: [
		{
			environmentId: 'prod',
			applications: [{ applicationId: 'a-prod', name: 'api', appName: 'api' }],
			postgres: [{ postgresId: 'pg1', name: 'Orders', appName: 'orders' }],
			redis: [{ redisId: 'r1', name: 'Cache', appName: 'cache' }],
			compose: [{ composeId: 'c1', name: 'uploads' }],
		},
		{
			environmentId: 'staging',
			applications: [
				{ applicationId: 'a-staging', name: 'api', appName: 'api' },
			],
		},
		{ environmentId: 'empty' },
	],
};

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
	server.resetHandlers();
	calls = [];
});
afterAll(() => server.close());

describe('the request layer', () => {
	it('retries a dropped connection and then succeeds', async () => {
		let attempts = 0;
		server.use(
			http.get(`${BASE}/api/project.all`, () => {
				attempts += 1;
				return attempts === 1
					? HttpResponse.error()
					: HttpResponse.json([{ projectId: 'p1', name: 'Shop' }]);
			}),
		);

		await expect(api().listProjects()).resolves.toEqual([
			{ projectId: 'p1', name: 'Shop' },
		]);
		expect(attempts).toBe(2);
	});

	it('names the server when it cannot be reached at all', async () => {
		server.use(http.get(`${BASE}/api/project.all`, () => HttpResponse.error()));

		const error = await api()
			.listProjects()
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(DokployApiError);
		expect(error).toMatchObject({ status: 0, statusText: 'Network error' });
		expect((error as Error).message).toContain(
			`Could not reach Dokploy at ${BASE} (project.all)`,
		);
	});

	it('gives up on a server that never answers', async () => {
		let attempts = 0;
		server.use(
			http.get(`${BASE}/api/project.all`, async () => {
				attempts += 1;
				await delay('infinite');
			}),
		);

		const error = await new DokployApi({
			baseUrl: BASE,
			token: 't',
			timeoutMs: 50,
		})
			.listProjects()
			.catch((e: unknown) => e);

		expect(error).toBeInstanceOf(DokployRequestTimedOut);
		expect(error).toMatchObject({
			baseUrl: BASE,
			endpoint: 'project.all',
			timeoutMs: 50,
		});
		// It may have arrived: sending it again could repeat what it asked for.
		expect(attempts).toBe(1);
	});

	it("rejects with the caller's reason when they abort", async () => {
		const controller = new AbortController();
		const reason = new Error('deploy cancelled');
		server.use(
			http.get(`${BASE}/api/project.all`, async () => {
				controller.abort(reason);
				await delay('infinite');
			}),
		);

		const error = await new DokployApi({
			baseUrl: BASE,
			token: 't',
			signal: controller.signal,
		})
			.listProjects()
			.catch((e: unknown) => e);

		expect(error).toBe(reason);
	});

	it('stops retrying once the caller aborts', async () => {
		const controller = new AbortController();
		const reason = new Error('deploy cancelled');
		let attempts = 0;
		server.use(
			http.get(`${BASE}/api/project.all`, () => {
				attempts += 1;
				// Lands in the backoff before the second attempt.
				setTimeout(() => controller.abort(reason), 20);
				return HttpResponse.error();
			}),
		);

		const started = Date.now();
		const error = await new DokployApi({
			baseUrl: BASE,
			token: 't',
			signal: controller.signal,
		})
			.listProjects()
			.catch((e: unknown) => e);

		expect(error).toBe(reason);
		expect(attempts).toBe(1);
		// Did not sit out the 750ms backoff.
		expect(Date.now() - started).toBeLessThan(500);
	});

	it('sends nothing when the caller has already aborted', async () => {
		const controller = new AbortController();
		const reason = new Error('deploy cancelled');
		controller.abort(reason);
		dokploy({ 'project.all': [] });

		const error = await new DokployApi({
			baseUrl: BASE,
			token: 't',
			signal: controller.signal,
		})
			.listProjects()
			.catch((e: unknown) => e);

		expect(error).toBe(reason);
		expect(calls).toHaveLength(0);
	});

	it('keeps the status line when the error body is not JSON', async () => {
		server.use(
			http.get(
				`${BASE}/api/project.all`,
				() =>
					new HttpResponse('<html>bad gateway</html>', {
						status: 502,
						statusText: 'Bad Gateway',
					}),
			),
		);

		await expect(api().listProjects()).rejects.toThrow(
			'Dokploy API error: 502 Bad Gateway',
		);
	});
});

describe('an error body that says nothing', () => {
	it('keeps the status line', async () => {
		server.use(
			http.get(`${BASE}/api/project.all`, () =>
				HttpResponse.json(
					{ code: 'INTERNAL' },
					{ status: 500, statusText: 'Internal Server Error' },
				),
			),
		);

		await expect(api().listProjects()).rejects.toThrow(
			'Dokploy API error: 500 Internal Server Error',
		);
	});
});

describe('a project with no environments', () => {
	it('holds nothing and publishes nothing', async () => {
		dokploy({ 'project.all': [{ projectId: 'p1' }], 'project.one': {} });

		await expect(api().listPostgres('p1')).resolves.toEqual([]);
		expect([...(await api().publishedPorts())]).toEqual([]);
	});
});

describe('publishedPorts', () => {
	it('collects every published port across projects and resource kinds', async () => {
		dokploy({
			'project.all': [{ projectId: 'p1' }, { projectId: 'p2' }],
			'project.one': ({ projectId }: Record<string, string>) =>
				projectId === 'p1'
					? {
							environments: [
								{
									postgres: [{ externalPort: 5432 }, { externalPort: null }],
									redis: [{ externalPort: 6379 }],
								},
							],
						}
					: {
							environments: [{ applications: [{ externalPort: 8080 }] }, {}],
						},
		});

		expect([...(await api().publishedPorts())].sort()).toEqual([
			5432, 6379, 8080,
		]);
	});
});

describe('projects and environments', () => {
	it('removes a project', async () => {
		dokploy({});
		await api().deleteProject('p1');
		expect(posted('project.remove')).toEqual([{ projectId: 'p1' }]);
	});

	it('creates an environment, describing it by name unless told', async () => {
		dokploy({ 'environment.create': { environmentId: 'e1' } });

		await expect(api().createEnvironment('p1', 'qa')).resolves.toEqual({
			environmentId: 'e1',
		});
		await api().createEnvironment('p1', 'qa', 'Quality');

		expect(posted('environment.create')).toEqual([
			{ projectId: 'p1', name: 'qa', description: 'qa environment' },
			{ projectId: 'p1', name: 'qa', description: 'Quality' },
		]);
	});
});

describe('applications', () => {
	it('lists them across environments, tagged with where they live', async () => {
		dokploy({ 'project.one': tree });

		expect(await api().listApplications('p1')).toEqual([
			{
				applicationId: 'a-prod',
				name: 'api',
				appName: 'api',
				environmentId: 'prod',
			},
			{
				applicationId: 'a-staging',
				name: 'api',
				appName: 'api',
				environmentId: 'staging',
			},
		]);
	});

	it('finds the application of the environment asked for', async () => {
		dokploy({ 'project.one': tree });

		const found = await api().findApplicationByName('p1', 'api', 'staging');

		expect(found?.applicationId).toBe('a-staging');
	});

	it('matches on the normalised app name as well as the name', async () => {
		dokploy({ 'project.one': tree });

		// `API` normalises to the stored appName `api`.
		const found = await api().findApplicationByName('p1', 'API');

		expect(found?.applicationId).toBe('a-prod');
	});

	it('reuses an existing application rather than creating a second', async () => {
		dokploy({ 'project.one': tree });

		const result = await api().findOrCreateApplication('api', 'p1', 'prod');

		expect(result).toMatchObject({
			created: false,
			application: { applicationId: 'a-prod' },
		});
		expect(posted('application.create')).toEqual([]);
	});

	it('creates one when the environment has none', async () => {
		dokploy({
			'project.one': tree,
			'application.create': { applicationId: 'a-new' },
		});

		const result = await api().findOrCreateApplication(
			'Web App',
			'p1',
			'empty',
		);

		expect(result).toEqual({
			created: true,
			application: { applicationId: 'a-new' },
		});
		expect(posted('application.create')).toEqual([
			{
				name: 'Web App',
				projectId: 'p1',
				environmentId: 'empty',
				appName: 'web-app',
			},
		]);
	});

	it('answers null for an application Dokploy cannot find', async () => {
		server.use(
			http.get(
				`${BASE}/api/application.one`,
				() => new HttpResponse(null, { status: 404 }),
			),
		);

		await expect(api().getApplication('missing')).resolves.toBeNull();
	});

	it('returns an application it can find', async () => {
		dokploy({ 'application.one': { applicationId: 'a1', name: 'api' } });

		await expect(api().getApplication('a1')).resolves.toEqual({
			applicationId: 'a1',
			name: 'api',
		});
		expect(calls[0]?.query).toEqual({ applicationId: 'a1' });
	});

	it('sends updates, env with nulls for what is absent, and removal', async () => {
		dokploy({});
		const client = api();

		await client.updateApplication('a1', {
			command: 'node server.js',
		} as never);
		await client.saveApplicationEnv('a1', 'A=1');
		await client.saveApplicationEnv('a1', 'A=1', {
			buildArgs: 'X=1',
			buildSecrets: 'S=1',
		});
		await client.deleteApplication('a1');

		expect(posted('application.update')).toEqual([
			{ applicationId: 'a1', command: 'node server.js' },
		]);
		expect(posted('application.saveEnvironment')).toEqual([
			{
				applicationId: 'a1',
				env: 'A=1',
				buildArgs: null,
				buildSecrets: null,
				createEnvFile: false,
			},
			{
				applicationId: 'a1',
				env: 'A=1',
				buildArgs: 'X=1',
				buildSecrets: 'S=1',
				createEnvFile: false,
			},
		]);
		expect(posted('application.remove')).toEqual([{ applicationId: 'a1' }]);
	});
});

describe('postgres', () => {
	it('lists them across environments', async () => {
		dokploy({ 'project.one': tree });

		expect(await api().listPostgres('p1')).toEqual([
			{
				postgresId: 'pg1',
				name: 'Orders',
				appName: 'orders',
				environmentId: 'prod',
			},
		]);
	});

	it('hydrates a found database, since the listing carries no credentials', async () => {
		dokploy({
			'project.one': tree,
			'postgres.one': { postgresId: 'pg1', databasePassword: 'secret' },
		});

		const found = await api().findPostgresByName('p1', 'orders');

		expect(found).toEqual({ postgresId: 'pg1', databasePassword: 'secret' });
		expect(calls.at(-1)).toMatchObject({
			endpoint: 'postgres.one',
			query: { postgresId: 'pg1' },
		});
	});

	it('finds nothing without asking for details', async () => {
		dokploy({ 'project.one': tree });

		await expect(api().findPostgresByName('p1', 'Billing')).resolves.toBe(
			undefined,
		);
		expect(calls.map((c) => c.endpoint)).toEqual(['project.one']);
	});

	it('reuses an existing database, or creates one with its options', async () => {
		dokploy({
			'project.one': tree,
			'postgres.one': { postgresId: 'pg1' },
			'postgres.create': { postgresId: 'pg2' },
		});
		const client = api();

		await expect(
			client.findOrCreatePostgres('Orders', 'p1', 'prod'),
		).resolves.toEqual({ postgres: { postgresId: 'pg1' }, created: false });
		await expect(
			client.findOrCreatePostgres('Billing', 'p1', 'prod', {
				databaseName: 'billing',
				databasePassword: 'pw',
			}),
		).resolves.toEqual({ postgres: { postgresId: 'pg2' }, created: true });

		expect(posted('postgres.create')).toEqual([
			{
				name: 'Billing',
				projectId: 'p1',
				environmentId: 'prod',
				appName: 'billing',
				databaseName: 'billing',
				databaseUser: 'postgres',
				databasePassword: 'pw',
				dockerImage: 'postgres:18',
				description: 'Postgres database for Billing',
			},
		]);
	});

	it('sends env, external port, updates and removal', async () => {
		dokploy({});
		const client = api();

		await client.savePostgresEnv('pg1', 'X=1');
		await client.savePostgresExternalPort('pg1', 5433);
		await client.savePostgresExternalPort('pg1', null);
		await client.updatePostgres('pg1', { memoryLimit: 512 } as never);
		await client.deletePostgres('pg1');

		expect(posted('postgres.saveEnvironment')).toEqual([
			{ postgresId: 'pg1', env: 'X=1' },
		]);
		expect(posted('postgres.saveExternalPort')).toEqual([
			{ postgresId: 'pg1', externalPort: 5433 },
			{ postgresId: 'pg1', externalPort: null },
		]);
		expect(posted('postgres.update')).toEqual([
			{ postgresId: 'pg1', memoryLimit: 512 },
		]);
		expect(posted('postgres.remove')).toEqual([{ postgresId: 'pg1' }]);
	});
});

describe('compose', () => {
	it('lists stacks and hydrates one found by name', async () => {
		dokploy({
			'project.one': tree,
			'compose.one': { composeId: 'c1', composeFile: 'services: {}' },
		});
		const client = api();

		expect(await client.listCompose('p1')).toEqual([
			{ composeId: 'c1', name: 'uploads', environmentId: 'prod' },
		]);
		await expect(client.findComposeByName('p1', 'uploads')).resolves.toEqual({
			composeId: 'c1',
			composeFile: 'services: {}',
		});
		await expect(client.findComposeByName('p1', 'nope')).resolves.toBe(
			undefined,
		);
	});

	it('writes the file into an existing stack on every deploy', async () => {
		dokploy({ 'project.one': tree, 'compose.one': { composeId: 'c1' } });

		const result = await api().findOrCreateCompose(
			'uploads',
			'p1',
			'prod',
			'services: { minio: {} }',
		);

		expect(result).toEqual({ compose: { composeId: 'c1' }, created: false });
		expect(posted('compose.create')).toEqual([]);
		expect(posted('compose.update')).toEqual([
			{
				composeId: 'c1',
				sourceType: 'raw',
				composeFile: 'services: { minio: {} }',
			},
		]);
	});

	it('creates a stack, then writes its file as raw', async () => {
		dokploy({ 'project.one': tree, 'compose.create': { composeId: 'c2' } });

		const result = await api().findOrCreateCompose(
			'media',
			'p1',
			'prod',
			'services: {}',
		);

		expect(result.created).toBe(true);
		expect(posted('compose.create')).toEqual([
			{ name: 'media', environmentId: 'prod', composeType: 'docker-compose' },
		]);
		expect(posted('compose.update')).toEqual([
			{ composeId: 'c2', sourceType: 'raw', composeFile: 'services: {}' },
		]);
	});

	it('deploys, and deletes without taking the volumes', async () => {
		dokploy({});
		await api().deployCompose('c1');
		await api().deleteCompose('c1');

		expect(posted('compose.deploy')).toEqual([{ composeId: 'c1' }]);
		expect(posted('compose.delete')).toEqual([
			{ composeId: 'c1', deleteVolumes: false },
		]);
	});
});

describe('redis', () => {
	it('lists instances and hydrates one found by name', async () => {
		dokploy({
			'project.one': tree,
			'redis.one': { redisId: 'r1', databasePassword: 'pw' },
		});
		const client = api();

		expect(await client.listRedis('p1')).toHaveLength(1);
		await expect(client.findRedisByName('p1', 'cache')).resolves.toEqual({
			redisId: 'r1',
			databasePassword: 'pw',
		});
		await expect(client.findRedisByName('p1', 'Sessions')).resolves.toBe(
			undefined,
		);
	});

	it('reuses an existing instance, or creates one', async () => {
		dokploy({
			'project.one': tree,
			'redis.one': { redisId: 'r1' },
			'redis.create': { redisId: 'r2' },
		});
		const client = api();

		await expect(
			client.findOrCreateRedis('Cache', 'p1', 'prod'),
		).resolves.toEqual({ redis: { redisId: 'r1' }, created: false });
		await expect(
			client.findOrCreateRedis('Sessions', 'p1', 'prod', {
				databasePassword: 'pw',
			}),
		).resolves.toEqual({ redis: { redisId: 'r2' }, created: true });

		expect(posted('redis.create')).toEqual([
			{
				name: 'Sessions',
				projectId: 'p1',
				environmentId: 'prod',
				appName: 'sessions',
				databasePassword: 'pw',
				dockerImage: 'redis:8',
				description: 'Redis instance for Sessions',
			},
		]);
	});

	it('sends env, external port, updates and removal', async () => {
		dokploy({});
		const client = api();

		await client.saveRedisEnv('r1', 'X=1');
		await client.saveRedisExternalPort('r1', 6380);
		await client.updateRedis('r1', { memoryLimit: 256 } as never);
		await client.deleteRedis('r1');

		expect(posted('redis.saveEnvironment')).toEqual([
			{ redisId: 'r1', env: 'X=1' },
		]);
		expect(posted('redis.saveExternalPort')).toEqual([
			{ redisId: 'r1', externalPort: 6380 },
		]);
		expect(posted('redis.update')).toEqual([
			{ redisId: 'r1', memoryLimit: 256 },
		]);
		expect(posted('redis.remove')).toEqual([{ redisId: 'r1' }]);
	});
});

describe('domains', () => {
	it('creates, reads, updates, validates, generates and deletes', async () => {
		dokploy({
			'domain.create': { domainId: 'd1' },
			'domain.one': { domainId: 'd1', host: 'api.example.com' },
			'domain.byApplicationId': [{ domainId: 'd1' }],
			'domain.validateDomain': { isValid: true, resolvedIp: '1.2.3.4' },
			'domain.generateDomain': { domain: 'api-abc.traefik.me' },
		});
		const client = api();

		await expect(
			client.createDomain({
				host: 'api.example.com',
				applicationId: 'a1',
			} as never),
		).resolves.toEqual({ domainId: 'd1' });
		await expect(client.getDomain('d1')).resolves.toMatchObject({
			host: 'api.example.com',
		});
		await expect(client.getDomainsByApplicationId('a1')).resolves.toEqual([
			{ domainId: 'd1' },
		]);
		await client.updateDomain('d1', { https: true } as never);
		await expect(client.validateDomain('api.example.com')).resolves.toEqual({
			isValid: true,
			resolvedIp: '1.2.3.4',
		});
		await expect(client.generateDomain('api', 'srv1')).resolves.toEqual({
			domain: 'api-abc.traefik.me',
		});
		await client.deleteDomain('d1');

		expect(posted('domain.update')).toEqual([{ domainId: 'd1', https: true }]);
		expect(posted('domain.generateDomain')).toEqual([
			{ appName: 'api', serverId: 'srv1' },
		]);
		expect(posted('domain.delete')).toEqual([{ domainId: 'd1' }]);
		expect(
			calls.find((c) => c.endpoint === 'domain.byApplicationId')?.query,
		).toEqual({ applicationId: 'a1' });
	});
});

describe('backup destinations', () => {
	const s3 = {
		provider: 's3',
		accessKey: 'k',
		secretAccessKey: 's',
		bucket: 'backups',
		region: 'eu-west-1',
		endpoint: 'https://s3.eu-west-1.amazonaws.com',
	};

	it('reuses a destination of the same name', async () => {
		dokploy({
			'destination.all': [{ destinationId: 'dst1', name: 'shop-backups' }],
		});

		await expect(
			api().findOrCreateDestination('shop-backups', s3 as never),
		).resolves.toEqual({
			destination: { destinationId: 'dst1', name: 'shop-backups' },
			created: false,
		});
		expect(posted('destination.create')).toEqual([]);
	});

	it('creates one when none has the name', async () => {
		dokploy({
			'destination.all': [],
			'destination.create': { destinationId: 'dst2' },
		});

		await expect(
			api().findOrCreateDestination('shop-backups', s3 as never),
		).resolves.toEqual({
			destination: { destinationId: 'dst2' },
			created: true,
		});
		expect(posted('destination.create')).toEqual([
			{ name: 'shop-backups', ...s3 },
		]);
	});

	it('reads, updates, tests and removes one', async () => {
		dokploy({
			'destination.one': { destinationId: 'dst1' },
			'destination.testConnection': { success: true },
		});
		const client = api();

		await expect(client.getDestination('dst1')).resolves.toEqual({
			destinationId: 'dst1',
		});
		await client.updateDestination('dst1', { bucket: 'other' } as never);
		await expect(client.testDestinationConnection('dst1')).resolves.toEqual({
			success: true,
		});
		await client.deleteDestination('dst1');

		expect(posted('destination.update')).toEqual([
			{ destinationId: 'dst1', bucket: 'other' },
		]);
		expect(posted('destination.remove')).toEqual([{ destinationId: 'dst1' }]);
	});
});

describe('scheduled backups', () => {
	it('creates a Postgres backup and manages it', async () => {
		dokploy({
			'backup.create': { backupId: 'b1' },
			'backup.all': [{ backupId: 'b1' }],
			'backup.one': { backupId: 'b1', schedule: '0 3 * * *' },
		});
		const client = api();

		await expect(
			client.createPostgresBackup({
				postgresId: 'pg1',
				destinationId: 'dst1',
				schedule: '0 3 * * *',
			} as never),
		).resolves.toEqual({ backupId: 'b1' });
		await expect(client.listPostgresBackups('pg1')).resolves.toEqual([
			{ backupId: 'b1' },
		]);
		await expect(client.getBackup('b1')).resolves.toMatchObject({
			schedule: '0 3 * * *',
		});
		await client.updateBackup('b1', { enabled: false } as never);
		await client.runBackupManually('b1');
		await client.deleteBackup('b1');

		// Always a Postgres backup, whatever the caller passed.
		expect(posted('backup.create')).toEqual([
			{
				postgresId: 'pg1',
				destinationId: 'dst1',
				schedule: '0 3 * * *',
				databaseType: 'postgres',
			},
		]);
		expect(calls.find((c) => c.endpoint === 'backup.all')?.query).toEqual({
			postgresId: 'pg1',
			databaseType: 'postgres',
		});
		expect(posted('backup.update')).toEqual([
			{ backupId: 'b1', enabled: false },
		]);
		expect(posted('backup.manualBackup')).toEqual([{ backupId: 'b1' }]);
		expect(posted('backup.remove')).toEqual([{ backupId: 'b1' }]);
	});
});
