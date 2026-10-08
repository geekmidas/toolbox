import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	cacheBackendsIn,
	driversFor,
	eventsBackendsIn,
	storageDriversFor,
} from '../drivers';

/** A manifest as `cacheBackendsIn` reads it — kind and parent, nothing else. */
const manifest = (
	entries: Record<string, { kind: string; of?: string }>,
): Record<string, { kind: string; of?: string }> => entries;

describe('cacheBackendsIn', () => {
	it('takes the config for a cache that named nowhere', () => {
		expect(
			cacheBackendsIn(manifest({ Sessions: { kind: 'cache' } }), 'upstash'),
		).toEqual(['upstash']);
	});

	it('takes the database for a cache that named one, whatever the config says', () => {
		// `orders.cache('Sessions')` is a statement about the application, so a
		// deployment cannot move that cache — and an entry that registered the
		// configured driver instead would fail at the first request with
		// `UnregisteredCacheScheme` on a `postgres://` URL.
		expect(
			cacheBackendsIn(
				manifest({
					Orders: { kind: 'database' },
					Sessions: { kind: 'cache', of: 'Orders' },
				}),
				'upstash',
			),
		).toEqual(['db']);
	});

	it('registers nothing when nothing declared a cache', () => {
		// An app that never caches should not resolve a cache client at all.
		expect(
			cacheBackendsIn(manifest({ Orders: { kind: 'database' } }), 'upstash'),
		).toEqual([]);
	});

	it('covers both when an app caches in two different places', () => {
		const backends = cacheBackendsIn(
			manifest({
				Orders: { kind: 'database' },
				Sessions: { kind: 'cache', of: 'Orders' },
				Rates: { kind: 'cache' },
			}),
			'upstash',
		);

		expect(backends.sort()).toEqual(['db', 'upstash']);
	});
});

describe('driversFor', () => {
	const appRoot = '/nonexistent';

	it('registers exactly one cache driver for one backend', () => {
		// The lazy boundary: an app caching in Postgres never resolves ioredis.
		const { imports, setup } = driversFor({ appRoot, cache: ['db'] });

		expect(imports).toContain('@geekmidas/cache/postgres');
		expect(imports).not.toContain('@geekmidas/cache/upstash');
		expect(setup).toContain('registerCacheDriver(postgresCacheDriver)');
	});

	it('registers both when both are in play', () => {
		const { imports } = driversFor({ appRoot, cache: ['db', 'upstash'] });

		expect(imports).toContain('@geekmidas/cache/postgres');
		expect(imports).toContain('@geekmidas/cache/upstash');
	});

	it('still accepts a bare backend name', () => {
		expect(driversFor({ appRoot, cache: 'elasticache' }).imports).toContain(
			'@geekmidas/cache/redis',
		);
	});

	it('registers no cache driver for an app that declared none', () => {
		expect(driversFor({ appRoot, cache: [] }).imports).not.toContain(
			'@geekmidas/cache',
		);
		expect(driversFor({ appRoot }).imports).not.toContain('@geekmidas/cache');
	});
});

describe('eventsBackendsIn', () => {
	it('takes the target’s broker when a topic or a queue is declared', () => {
		expect(
			eventsBackendsIn(manifest({ Users: { kind: 'topic' } }), 'sns'),
		).toEqual(['sns']);
		expect(
			eventsBackendsIn(manifest({ Emails: { kind: 'queue' } }), 'pgboss'),
		).toEqual(['pgboss']);
	});

	it('registers nothing for a project with no events', () => {
		expect(
			eventsBackendsIn(manifest({ Orders: { kind: 'database' } }), 'pgboss'),
		).toEqual([]);
	});

	it('counts a worker beside a database on pg-boss, which schedules its crons', () => {
		const worker = manifest({
			Jobs: { kind: 'worker' },
			Orders: { kind: 'database' },
		});

		expect(eventsBackendsIn(worker, 'pgboss')).toEqual(['pgboss']);
		// On AWS a cron is an EventBridge rule: no broker for it.
		expect(eventsBackendsIn(worker, 'sns')).toEqual([]);
		expect(
			eventsBackendsIn(manifest({ Jobs: { kind: 'worker' } }), 'pgboss'),
		).toEqual([]);
	});
});

describe('driversFor events', () => {
	const appRoot = '/nonexistent';

	it('registers only pg-boss on a server', () => {
		const { imports, setup } = driversFor({ appRoot, events: ['pgboss'] });

		expect(imports).toContain(
			"import { pgbossEventsDriver } from '@geekmidas/events/pgboss';",
		);
		expect(setup).toBe('registerEventsDriver(pgbossEventsDriver);');
		expect(imports).not.toMatch(/events\/(sns|sqs|rabbitmq)/);
	});

	it('registers SNS and SQS on AWS — topics and queues', () => {
		const { imports, setup } = driversFor({ appRoot, events: 'sns' });

		expect(imports).toContain('@geekmidas/events/sns');
		expect(imports).toContain('@geekmidas/events/sqs');
		expect(imports).not.toMatch(/events\/(pgboss|rabbitmq)/);
		expect(setup).toBe(
			'registerEventsDriver(snsEventsDriver);\nregisterEventsDriver(sqsEventsDriver);',
		);
	});

	it('registers RabbitMQ for RabbitMQ', () => {
		expect(driversFor({ appRoot, events: ['rabbitmq'] }).setup).toBe(
			'registerEventsDriver(rabbitmqEventsDriver);',
		);
	});

	it('registers nothing, and imports no events at all, without a broker', () => {
		for (const events of [undefined, false, []] as const) {
			const { imports, setup } = driversFor({ appRoot, events });
			expect(imports).not.toContain('@geekmidas/events');
			expect(setup).not.toContain('registerEventsDriver');
		}
	});
});

describe('storageDriversFor', () => {
	let root: string;
	let app: string;

	const pkg = (dir: string, dependencies: Record<string, string> = {}) =>
		writeFile(
			join(dir, 'package.json'),
			JSON.stringify({ name: 'x', dependencies }),
		);

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), 'gkm-drivers-'));
		app = join(root, 'apps', 'api');
		await mkdir(app, { recursive: true });
		await pkg(app);
	});

	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});

	it('registers S3 for a workspace that lists storage once, at its root', async () => {
		// Where Node resolves it from, and where a workspace with one copy of
		// every dependency keeps it. Reading only the app's file left the entry
		// without a driver, and every bucket service threw on injection.
		await pkg(root, { '@geekmidas/storage': '~10.0.0' });

		expect(storageDriversFor(app).setup).toBe(
			'registerStorageDriver(s3Driver);',
		);
	});

	it('registers S3 for an app that lists it itself', async () => {
		await pkg(app, { '@geekmidas/storage': '~10.0.0' });

		expect(storageDriversFor(app).imports).toContain('@geekmidas/storage/aws');
	});

	it('registers nothing where storage is not installed', async () => {
		await pkg(root);

		expect(storageDriversFor(app)).toEqual({ imports: '', setup: '' });
	});
});
