import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	cleanupDir,
	createTempDir,
	createTestFile,
} from '../../__tests__/test-helpers';
import { discover } from '../discover';

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
import { t } from '@geekmidas/constructs/topic';
import { Worker } from '@geekmidas/constructs/worker';

export const orders = new KyselyDatabase('Orders');
export const uploads = new ObjectStorage('Uploads');
export const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
export const jobs = new Worker('Jobs');
export const users = t.topic('users').events({});
`,
		);
		await createTestFile(
			dir,
			'endpoints/orders.ts',
			`import { api, orders, uploads, users } from '../constructs/index.js';

// The database through the surface's branch, the bucket per endpoint, and the
// topic through the publisher derived from it.
export const listOrders = api
	.database(orders)
	.publisher(users.publisher)
	.get('/orders')
	.dependsOn([uploads])
	.handle(async () => null);
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
			patterns: ['constructs/**/*.ts', 'endpoints/**/*.ts', 'crons/**/*.ts'],
			cwd: dir,
			runnables,
		});

		// The surface's own node is unchanged — the edges are beside it.
		expect(manifest.Api).toMatchObject({ kind: 'rest-api', endpoints: [] });
		expect(runnables).toEqual({
			// `api.database(orders)` is an edge like `.dependsOn()`, and so is
			// `.publisher(users.publisher)`: without it the API's container was
			// composed without `USERS_PUBLISHER_CONNECTION_STRING`.
			Api: ['Orders', 'Users', 'Uploads'],
			Jobs: ['Orders'],
		});
	});
});
