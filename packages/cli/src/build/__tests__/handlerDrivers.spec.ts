import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
	cleanupDir,
	createTempDir,
	createTestFile,
} from '../../__tests__/test-helpers';
import { normalizeWorkspace } from '../../workspace/index';
import { buildApp } from '../index';

/**
 * `gkm build --provider aws` writes one Lambda per construct, and each one
 * registers the drivers its own construct reaches — not the app's whole set.
 *
 * Every handler used to register storage, the cache, the broker and the
 * WebSocket sink alike, so a cron that published nothing still bundled
 * pg-boss and the API Gateway SDK.
 */
async function project(dir: string): Promise<void> {
	// `@geekmidas/storage` installed, so the app as a whole registers S3.
	await createTestFile(
		dir,
		'package.json',
		JSON.stringify({
			type: 'module',
			dependencies: { '@geekmidas/storage': '*' },
		}),
	);
	await createTestFile(
		dir,
		'src/constructs.ts',
		`import { Cache } from '@geekmidas/constructs/cache';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import { ObjectStorage } from '@geekmidas/constructs/object-storage';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { Topic } from '@geekmidas/constructs/topic';
import { WebSocketApi } from '@geekmidas/constructs/websocket-api';
import { Worker } from '@geekmidas/constructs/worker';
import { z } from 'zod';

export const shop = new KyselyDatabase('Shop');
export const uploads = new ObjectStorage('Uploads');
export const sessions = new Cache('Sessions');
export const realtime = new WebSocketApi('Realtime', { path: 'realtime' });
export const api = new RestApi('Api', { path: '.', defaultAuthorizer: 'none' });
export const jobs = new Worker('Jobs').database(shop);
export const orders = new Topic('Orders', {
  events: { 'order.placed': z.object({ id: z.string() }) },
});
`,
	);
	await createTestFile(
		dir,
		'src/endpoints.ts',
		`import { api, orders, realtime, sessions, uploads } from './constructs.js';

export const health = api.get('/health').handle(async () => null);

export const upload = api
  .post('/uploads')
  .dependsOn([uploads])
  .handle(async () => null);

export const cached = api
  .get('/cached')
  .dependsOn([sessions])
  .handle(async () => null);

export const notify = api
  .post('/notify')
  .dependsOn([realtime])
  .handle(async () => null);

export const place = api
  .post('/orders')
  .event(orders, { type: 'order.placed', payload: () => ({ id: '1' }) })
  .handle(async () => null);
`,
	);
	await createTestFile(
		dir,
		'src/crons.ts',
		`import { jobs } from './constructs.js';

export const nightly = jobs.cron('rate(1 day)').handle(async () => null);
`,
	);
}

async function build(dir: string): Promise<(file: string) => Promise<string>> {
	vi.spyOn(console, 'log').mockImplementation(() => {});
	await buildApp({
		config: {
			stages: { local: 'development', deployed: ['production'] },
			constructs: './src/**/*.ts',
		},
		workspaceRoot: dir,
		appRoot: dir,
		target: 'aws',
		enableOpenApi: false,
		// The broker and cache the reported bundles carried.
		cacheBackend: 'db',
		eventsBackend: 'pgboss',
		app: 'api',
		// The app the worker's cron is built from.
		workspace: normalizeWorkspace(
			{
				stages: { local: 'development', deployed: ['production'] },
				apps: { api: { type: 'backend', path: '.', port: 3000 } },
			},
			dir,
		),
	});
	return (file) => readFile(join(dir, '.gkm', 'aws', file), 'utf-8');
}

const STORAGE = 'registerStorageDriver(';
const CACHE = 'registerCacheDriver(';
const EVENTS = 'registerEventsDriver(';
const SOCKETS = 'registerWebSocketSinkDriver(';

const ALL = [STORAGE, CACHE, EVENTS, SOCKETS];
const others = (...kept: string[]) => ALL.filter((d) => !kept.includes(d));

describe('aws handler drivers', () => {
	let dir: string;
	let handler: (file: string) => Promise<string>;

	beforeAll(async () => {
		dir = await createTempDir('gkm-handler-drivers-');
		await project(dir);
		handler = await build(dir);
	});

	afterAll(async () => {
		vi.restoreAllMocks();
		await cleanupDir(dir);
	});

	it('registers nothing for an endpoint that reaches nothing', async () => {
		const health = await handler('routes/health.ts');
		for (const driver of ALL) expect(health).not.toContain(driver);
		expect(health).not.toContain('The handler registers the drivers');
	});

	it('registers storage, alone, for an endpoint that reaches a bucket', async () => {
		const upload = await handler('routes/upload.ts');
		expect(upload).toContain('registerStorageDriver(s3Driver);');
		for (const driver of others(STORAGE)) expect(upload).not.toContain(driver);
	});

	it("registers the cache's driver, alone, for an endpoint that reaches one", async () => {
		const cached = await handler('routes/cached.ts');
		expect(cached).toContain('registerCacheDriver(postgresCacheDriver);');
		for (const driver of others(CACHE)) expect(cached).not.toContain(driver);
	});

	it('registers the sink for an endpoint that reaches a WebSocket API', async () => {
		const notify = await handler('routes/notify.ts');
		expect(notify).toContain(
			'registerWebSocketSinkDriver(apiGatewayWebSocketDriver);',
		);
		for (const driver of others(SOCKETS)) expect(notify).not.toContain(driver);
	});

	it('registers the broker for an endpoint that publishes to a topic', async () => {
		const place = await handler('routes/place.ts');
		expect(place).toContain('registerEventsDriver(pgbossEventsDriver);');
		for (const driver of others(EVENTS)) expect(place).not.toContain(driver);
	});

	it('registers no broker or sink for a cron whose worker reaches only the database', async () => {
		// On AWS a cron is an EventBridge rule: pg-boss schedules nothing, so a
		// worker beside a database is no reason to load it.
		const nightly = await handler('crons/nightly.ts');
		for (const driver of ALL) expect(nightly).not.toContain(driver);
		expect(nightly).not.toContain('@geekmidas/events/pgboss');
		expect(nightly).not.toContain('@geekmidas/constructs/aws-websocket');
	});
});
