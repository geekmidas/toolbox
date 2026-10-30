import { dependentsOf, provisionOrder } from '@geekmidas/manifest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	cleanupDir,
	createTempDir,
	createTestFile,
} from '../../__tests__/test-helpers';
import { LocalSandbox } from '../../sandbox/local';
import { processorEnvKeys, workerEnvKeys } from '../apps';
import { portKeys } from '../containers';
import {
	type BoundSubscriber,
	discover,
	ProcessorServerUnknown,
} from '../discover';
import { workerEdges } from '../edges';
import { envFor } from '../env';
import { planFor } from '../plan';
import { TEST_CREDENTIALS } from './__helpers__/credentials';

/**
 * Every runnable, nested in the manifest by the discovery that already
 * imports it — with its edges, and its source as its handler.
 *
 * The manifest is the whole application in every command. When a surface's
 * endpoints were left for a build to fold in, `gkm dev` saw an API with no
 * edges: no database for its container, and no caller for the buckets its
 * endpoints sign links to.
 */
describe('discover — runnables', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await createTempDir('discover-runnables-');
		await createTestFile(dir, 'package.json', '{ "type": "module" }');
		await createTestFile(
			dir,
			'constructs/index.ts',
			`import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { ObjectStorage } from '@geekmidas/constructs/object-storage';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { Topic } from '@geekmidas/constructs/topic';
import { Worker } from '@geekmidas/constructs/worker';
import { z } from 'zod';

export const orders = new KyselyDatabase('Orders');
export const uploads = new ObjectStorage('Uploads');
export const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
export const jobs = new Worker('Jobs');
export const users = new Topic('users', {
	events: { 'user.created': z.object({ id: z.string() }) },
});
`,
		);
		await createTestFile(
			dir,
			'endpoints/orders.ts',
			`import { api, orders, uploads, users } from '../constructs/index.js';

// The database through the surface's branch, the bucket per endpoint, and the
// topic the endpoint publishes to.
export const listOrders = api
	.database(orders)
	.get('/orders')
	.dependsOn([uploads])
	.event(users, { type: 'user.created', payload: () => ({ id: '1' }) })
	.handle(async () => null);
`,
		);
		await createTestFile(
			dir,
			'queues/receipts.ts',
			`import { z } from 'zod';
import { jobs, uploads } from '../constructs/index.js';

// A queue and its consumer, run by the worker: what it reaches is the worker's.
export const receipts = jobs
	.queue('Receipts')
	.message(z.object({ orderId: z.string() }))
	.dependsOn([uploads])
	.handle(async () => {});
`,
		);
		await createTestFile(
			dir,
			'crons/nightly.ts',
			`import { jobs, orders } from '../constructs/index.js';

export const nightly = jobs
	.cron('rate(1 day)')
	.dependsOn([orders])
	.handle(async () => null);
`,
		);
	});

	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('nests each runnable where it runs, with its edges', async () => {
		const manifest = await discover({
			patterns: [
				'constructs/**/*.ts',
				'endpoints/**/*.ts',
				'crons/**/*.ts',
				'queues/**/*.ts',
			],
			cwd: dir,
		});

		// `api.database(orders)` is an edge like `.dependsOn()`, and so is
		// `.event(users, …)`: without it the API's container was composed
		// without `USERS_PUBLISHER_CONNECTION_STRING`.
		expect(manifest.Api).toMatchObject({
			kind: 'rest-api',
			endpoints: [
				{
					id: 'ApiGET/orders',
					handler: 'endpoints/orders.ts#listOrders',
					method: 'GET',
					path: '/orders',
					dependencies: [
						{ target: 'Orders', kind: 'database' },
						{ target: 'Uploads', kind: 'objects' },
						{ target: 'Users', kind: 'topic' },
					],
					authorizer: 'none',
				},
			],
		});
		// A queue is a declaration *and* a runnable: its consumer is the
		// worker's, with its own edges.
		expect(manifest.Receipts).toMatchObject({
			kind: 'queue',
			worker: {
				handler: 'queues/receipts.ts#receipts',
				dependencies: [{ target: 'Uploads', kind: 'objects' }],
				owner: 'Jobs',
			},
		});
		expect(manifest.nightly).toEqual({
			kind: 'cron',
			id: 'nightly',
			handler: 'crons/nightly.ts#nightly',
			schedule: 'rate(1 day)',
			dependencies: [{ target: 'Orders', kind: 'database' }],
			owner: 'Jobs',
		});
		// The worker's process reaches what everything it owns does, and the
		// queue its consumer drains.
		expect(workerEdges(manifest, 'Jobs').sort()).toEqual([
			'Orders',
			'Receipts',
			'Uploads',
		]);
	});

	it('counts an endpoint’s surface among the callers of what it uses', async () => {
		const manifest = await discover({
			patterns: ['constructs/**/*.ts', 'endpoints/**/*.ts'],
			cwd: dir,
		});

		expect(dependentsOf(manifest, 'Uploads')).toEqual(['Api']);
	});

	// A child process that loads tsx and imports the project: seconds, not
	// milliseconds, when the rest of the suite is competing for the machine.
	it(
		'finds the same manifest and edges when discovering in a sandbox',
		{ timeout: 30_000 },
		async () => {
			const patterns = [
				'constructs/**/*.ts',
				'endpoints/**/*.ts',
				'crons/**/*.ts',
				'queues/**/*.ts',
			];
			const local = await discover({ patterns, cwd: dir });
			const sandboxed = await discover({
				patterns,
				cwd: dir,
				sandbox: new LocalSandbox({ root: dir }),
			});

			expect(sandboxed).toEqual(local);
		},
	);

	it(
		'records where each worker’s crons, queues and subscribers are declared, here and in a sandbox',
		{ timeout: 30_000 },
		async () => {
			const patterns = [
				'constructs/**/*.ts',
				'endpoints/**/*.ts',
				'crons/**/*.ts',
				'queues/**/*.ts',
			];
			const here: Record<string, string[]> = {};
			const there: Record<string, string[]> = {};

			await discover({ patterns, cwd: dir, background: here });
			await discover({
				patterns,
				cwd: dir,
				background: there,
				sandbox: new LocalSandbox({ root: dir }),
			});

			// Each file once, under the worker that runs it — endpoints are no
			// worker's.
			expect(Object.keys(here)).toEqual(['Jobs']);
			expect([...here.Jobs!].sort()).toEqual(
				[`${dir}/crons/nightly.ts`, `${dir}/queues/receipts.ts`].sort(),
			);
			expect([...there.Jobs!].sort()).toEqual([...here.Jobs!].sort());
		},
	);

	it('records a queue’s and a subscriber’s own database under their worker', async () => {
		await createTestFile(
			dir,
			'subscribers/audit.ts',
			`import { Worker } from '@geekmidas/constructs/worker';
import { z } from 'zod';
import { orders, users } from '../constructs/index.js';

// A worker with no database of its own; its runnables name theirs.
export const reports = new Worker('Reports');

export const audit = reports
	.topic(users)
	.database(orders)
	.subscribe(['user.created'])
	.handle(async () => {});

export const rollup = reports
	.queue('Rollup')
	.database(orders)
	.message(z.object({ id: z.string() }))
	.handle(async () => {});
`,
		);
		const manifest = await discover({
			patterns: ['constructs/**/*.ts', 'subscribers/**/*.ts'],
			cwd: dir,
		});

		// The handler's `db` reaches the database, so the process running it has
		// to be composed with it — and each reaches what it consumes: the
		// subscriber its topic, the consumer its queue.
		expect(workerEdges(manifest, 'Reports').sort()).toEqual([
			'Orders',
			'Rollup',
			'Users',
		]);
	});
	it("records the files that export what each surface serves, and a WebSocket route's edges", async () => {
		await createTestFile(
			dir,
			'constructs/realtime.ts',
			`import { WebSocketApi } from '@geekmidas/constructs/websocket-api';

export const realtime = new WebSocketApi('Realtime', { path: '.' });
`,
		);
		await createTestFile(
			dir,
			'routes/chat.ts',
			`import { orders } from '../constructs/index.js';
import { realtime } from '../constructs/realtime.js';

export const send = realtime
	.route('chat.send')
	.dependsOn([orders])
	.handle(() => null);
`,
		);
		const served: Record<string, string[]> = {};

		const manifest = await discover({
			patterns: ['constructs/**/*.ts', 'endpoints/**/*.ts', 'routes/**/*.ts'],
			cwd: dir,
			served,
		});

		expect(manifest.Realtime).toMatchObject({
			kind: 'websocket-api',
			routes: [
				{
					id: 'Realtimechat.send',
					handler: 'routes/chat.ts#send',
					action: 'chat.send',
					dependencies: [{ target: 'Orders', kind: 'database' }],
				},
			],
		});
		expect(served.Realtime).toEqual([
			expect.stringMatching(/routes\/chat\.ts$/),
		]);
		expect(served.Api).toEqual([
			expect.stringMatching(/endpoints\/orders\.ts$/),
		]);
	});

	it('hands a bucket’s subscriber the bucket’s events, and not the bucket', async () => {
		await createTestFile(
			dir,
			'subscribers/avatars.ts',
			`import { jobs, uploads } from '../constructs/index.js';

export const onAvatar = jobs
	.objects(uploads)
	.on(['object.created'], { prefix: 'avatars/' })
	.handle(async () => {});
`,
		);
		const patterns = ['constructs/**/*.ts', 'subscribers/**/*.ts'];
		const subscribers: Record<string, BoundSubscriber[]> = {};

		const manifest = await discover({ patterns, cwd: dir, subscribers });

		expect(subscribers).toEqual({
			Jobs: [
				{ name: 'onAvatar', connectionKey: 'UPLOADS_EVENTS_CONNECTION_STRING' },
			],
		});
		expect(manifest.Uploads).toMatchObject({
			subscribers: [
				{
					id: 'onAvatar',
					handler: 'subscribers/avatars.ts#onAvatar',
					events: ['object.created'],
					prefix: 'avatars/',
					dependencies: [],
					owner: 'Jobs',
				},
			],
		});
		const keys = workerEnvKeys(manifest, 'Jobs');
		expect(keys).toContain('UPLOADS_EVENTS_CONNECTION_STRING');
		// Reading the objects takes `.dependsOn([uploads])`; being told they
		// changed does not.
		expect(keys).not.toContain('UPLOADS_URL');
		expect(keys).not.toContain('AWS_SECRET_ACCESS_KEY');
	});

	it(
		'records each worker’s topic subscribers by export and topic, here and in a sandbox',
		{ timeout: 30_000 },
		async () => {
			await createTestFile(
				dir,
				'subscribers/welcome.ts',
				`import { jobs, users } from '../constructs/index.js';

export const welcome = jobs
	.topic(users)
	.subscribe(['user.created'])
	.handle(async () => {});
`,
			);
			// The same subscriber again, through a barrel: one route, not two.
			await createTestFile(
				dir,
				'subscribers/index.ts',
				`export { welcome } from './welcome.js';
`,
			);
			const patterns = [
				'constructs/**/*.ts',
				'queues/**/*.ts',
				'subscribers/**/*.ts',
			];
			const here: Record<string, BoundSubscriber[]> = {};
			const there: Record<string, BoundSubscriber[]> = {};

			await discover({ patterns, cwd: dir, subscribers: here });
			await discover({
				patterns,
				cwd: dir,
				subscribers: there,
				sandbox: new LocalSandbox({ root: dir }),
			});

			// A queue's consumer is no topic subscriber: SNS never pushes to it.
			expect(here).toEqual({
				Jobs: [
					{
						name: 'welcome',
						connectionKey: 'USERS_PUBLISHER_CONNECTION_STRING',
						// Its subscription's filter.
						events: ['user.created'],
					},
				],
			});
			expect(there).toEqual(here);
		},
	);

	it(
		'nests each processor in its file server, with its source as its handler, here and in a sandbox',
		{ timeout: 30_000 },
		async () => {
			await createTestFile(
				dir,
				'constructs/media.ts',
				`import { FileServer } from '@geekmidas/constructs/file-server';

export const media = new FileServer('Media', { open: ['public/**'] });
`,
			);
			await createTestFile(
				dir,
				'processors/thumbnails.ts',
				`import { media } from '../constructs/media.js';

export const thumbnails = media
	.process('/i/:width/*')
	.native(['sharp'])
	.timeout(15_000)
	.handle(async () => ({ body: '', contentType: 'image/webp' }));

export const pages = media
	.process('/pdf/:page/*')
	.handle(async () => ({ body: '', contentType: 'image/png' }));
`,
			);
			// The same processor again, through a barrel: one processor.
			await createTestFile(
				dir,
				'processors/index.ts',
				`export { thumbnails } from './thumbnails.js';\n`,
			);
			const patterns = ['constructs/**/*.ts', 'processors/**/*.ts'];
			const local = await discover({ patterns, cwd: dir });
			const sandboxed = await discover({
				patterns,
				cwd: dir,
				sandbox: new LocalSandbox({ root: dir }),
			});

			expect(local.MediaServer).toMatchObject({
				kind: 'file-server',
				processors: [
					{
						id: 'pages',
						handler: 'processors/thumbnails.ts#pages',
						path: '/pdf/:page/*',
						prefix: '/pdf/',
						dependencies: [{ target: 'Media', kind: 'objects' }],
					},
					{
						id: 'thumbnails',
						handler: 'processors/thumbnails.ts#thumbnails',
						path: '/i/:width/*',
						prefix: '/i/',
						native: ['sharp'],
						timeout: 15_000,
						dependencies: [{ target: 'Media', kind: 'objects' }],
					},
				],
			});
			expect(sandboxed).toEqual(local);
			// Its unit reaches the bucket, as a worker reaches what its work does.
			expect(processorEnvKeys(local, 'MediaServer')).toContain('MEDIA_URL');
		},
	);

	it('refuses a processor whose file server it never found', async () => {
		await createTestFile(
			dir,
			'processors/orphan.ts',
			`import { FileServer } from '@geekmidas/constructs/file-server';

// Declared here, and not exported: discovery never sees the server.
const hidden = new FileServer('Hidden');

export const orphan = hidden
	.process('/i/*')
	.handle(async () => ({ body: '', contentType: 'image/webp' }));
`,
		);

		await expect(
			discover({ patterns: ['processors/orphan.ts'], cwd: dir }),
		).rejects.toBeInstanceOf(ProcessorServerUnknown);
	});
});

/**
 * #337: a bucket an endpoint uses, found by the same discovery `gkm dev` runs.
 * Its links reach a phone when a mobile app calls the endpoint's surface, so
 * the local stage resolves it on the LAN address.
 */
describe('discover — a bucket an endpoint hands a phone', () => {
	let dir: string;

	beforeEach(async () => {
		dir = await createTempDir('discover-device-');
		await createTestFile(dir, 'package.json', '{ "type": "module" }');
		await createTestFile(
			dir,
			'constructs/index.ts',
			`import { FileServer } from '@geekmidas/constructs/file-server';
import { MobileApp } from '@geekmidas/constructs/mobile-app';
import { ObjectStorage } from '@geekmidas/constructs/object-storage';
import { RestApi } from '@geekmidas/constructs/rest-api';

export const documents = new ObjectStorage('Documents');
export const assets = new FileServer('Assets', { open: ['**'] });
export const api = new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none' });
export const app = new MobileApp('App', { path: 'apps/app' }).dependsOn([api]);
`,
		);
		await createTestFile(
			dir,
			'endpoints/trips.ts',
			`import { api, assets, documents } from '../constructs/index.js';

export const getTrip = api
	.get('/trips/:id')
	.dependsOn([documents, assets])
	.handle(async () => null);
`,
		);
	});

	afterEach(async () => {
		await cleanupDir(dir);
	});

	it('presigns and links on the LAN address', async () => {
		const manifest = await discover({
			patterns: ['constructs/**/*.ts', 'endpoints/**/*.ts'],
			cwd: dir,
		});
		const plan = planFor(manifest, 'dev', provisionOrder(manifest), {
			localStage: 'dev',
		});
		const ports = Object.fromEntries(
			portKeys(plan.containers).map((key, index) => [key, 28000 + index]),
		);
		const env = envFor(plan, {
			ports,
			project: 'shop',
			addresses: { Api: 'http://localhost:3000' },
			credentials: TEST_CREDENTIALS,
			lanAddress: '192.168.1.20',
		});

		expect(env.DOCUMENTS_URL).toContain(
			`endpoint=http://192.168.1.20:${ports.minio}&`,
		);
		// The edge is to the bucket; the server fronting it follows.
		expect(env.ASSETS_URL).toContain(
			`endpoint=http://192.168.1.20:${ports.minio}&`,
		);
		expect(env.ASSETS_SERVER_URL).toBe(
			`http://192.168.1.20:${ports.minio}/assets`,
		);
	});
});
