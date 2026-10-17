import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	cleanupDir,
	createTempDir,
	createTestFile,
} from '../../__tests__/test-helpers';
import { LocalSandbox } from '../../sandbox/local';
import {
	type BoundSubscriber,
	discover,
	ProcessorServerUnknown,
} from '../discover';

/**
 * A runnable's edges, collected by the discovery that already imports it.
 *
 * A surface's endpoints are found by the glob, not listed by the surface, so
 * its node says `endpoints: []` and the manifest has no edge for them until a
 * build folds the routes in. An app container composed from edges needs them
 * before any build — without them the API was given no database at all.
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

	it('records what each owner’s runnables reach, under the owner', async () => {
		const runnables: Record<string, string[]> = {};

		const manifest = await discover({
			patterns: [
				'constructs/**/*.ts',
				'endpoints/**/*.ts',
				'crons/**/*.ts',
				'queues/**/*.ts',
			],
			cwd: dir,
			runnables,
		});

		// The surface's own node is unchanged — the edges are beside it.
		expect(manifest.Api).toMatchObject({ kind: 'rest-api', endpoints: [] });
		expect(runnables).toEqual({
			// `api.database(orders)` is an edge like `.dependsOn()`, and so is
			// `.event(users, …)`: without it the API's container was composed
			// without `USERS_PUBLISHER_CONNECTION_STRING`.
			Api: ['Orders', 'Uploads', 'Users'],
			// The queue's consumer runs in the worker, so its bucket is the worker's
			// too — a queue is a declaration *and* a runnable — and so is the
			// queue it drains.
			Jobs: expect.arrayContaining(['Orders', 'Uploads', 'Receipts']),
		});
		expect(runnables.Jobs).toHaveLength(3);
		expect(manifest.Receipts).toMatchObject({ kind: 'queue' });
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
			const here: Record<string, string[]> = {};
			const there: Record<string, string[]> = {};

			const local = await discover({ patterns, cwd: dir, runnables: here });
			const sandboxed = await discover({
				patterns,
				cwd: dir,
				runnables: there,
				sandbox: new LocalSandbox({ root: dir }),
			});

			expect(sandboxed).toEqual(local);
			// The same edges, in whatever order the glob streamed their files —
			// which is not fixed, here or there.
			const sorted = (edges: Record<string, string[]>) =>
				Object.fromEntries(
					Object.entries(edges).map(([owner, ids]) => [owner, [...ids].sort()]),
				);
			expect(sorted(there)).toEqual(sorted(here));
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
const reports = new Worker('Reports');

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
		const runnables: Record<string, string[]> = {};

		await discover({
			patterns: ['constructs/**/*.ts', 'subscribers/**/*.ts'],
			cwd: dir,
			runnables,
		});

		// The handler's `db` reaches the database, so the process running it has
		// to be composed with it — and each reaches what it consumes: the
		// subscriber its topic, the consumer its queue.
		expect([...(runnables.Reports ?? [])].sort()).toEqual([
			'Orders',
			'Rollup',
			'Users',
		]);
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
				Jobs: [{ name: 'welcome', topic: 'Users' }],
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
			const runnables: Record<string, string[]> = {};

			const local = await discover({ patterns, cwd: dir, runnables });
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
			expect(runnables.MediaServer).toEqual(['Media']);
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
