import { EnvironmentParser } from '@geekmidas/envkit';
import { registerEventsDriver } from '@geekmidas/events';
import { basicEventsDriver } from '@geekmidas/events/basic';
import { ServiceDiscovery } from '@geekmidas/services';
import { registerStorageDriver, type StorageClient } from '@geekmidas/storage';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NotAConstruct } from '../construct-interface';
import { KyselyDatabase } from '../database/kysely';
import { EndpointFactory } from '../endpoints/EndpointFactory';
import { ObjectStorage } from '../object-storage';
import { RestApi } from '../rest-api';
import { Topic } from '../topic';
import { Worker } from '../worker';

// What an entry point does for the broker its target uses.
registerEventsDriver(basicEventsDriver);

/** Endpoints come from a surface now, so the tests build one. */
const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });

/**
 * A factory, for the cases that depend at factory level. The surface offers no
 * `dependsOn` of its own — an endpoint names what it needs — so a group reaches
 * it from a branch. Built directly here so the case is about `dependsOn` alone.
 */
const factory = new EndpointFactory({
	surface: { id: 'Test', envParser: new EnvironmentParser({}) },
});

/**
 * A driver for these tests, registered the way an entry point registers one:
 * the scheme in the URL picks it, and no construct names a provider.
 */
registerStorageDriver({
	scheme: 's3:',
	create: (url) => ({ url }) as unknown as StorageClient,
});

const uploads = new ObjectStorage('Uploads');

const users = new Topic('users', {
	events: { 'user.created': z.object({ id: z.string() }) },
});

/** Everything runnable is built from the process that runs it. */
const testWorker = new Worker('Jobs');

const emails = testWorker
	.queue('emails')
	.message(z.object({ to: z.email() }))
	.handle(async () => {});

/** The env a reconciled stage injects. */
const envParser = new EnvironmentParser({
	UPLOADS_URL: 's3://uploads?region=us-east-1',
	// `basic://` rather than `pgboss://`: the transport is chosen by the
	// protocol, which is exactly what lets a test pick one that needs no
	// container. The construct is identical either way.
	USERS_PUBLISHER_CONNECTION_STRING: 'basic://',
	EMAILS_PUBLISHER_CONNECTION_STRING: 'basic://',
});

/** Resolve an endpoint's services exactly as the adaptors do. */
const resolve = (services: readonly unknown[]) =>
	ServiceDiscovery.getInstance(envParser as never).register(services as never);

describe('.dependsOn', () => {
	it('reaches a construct under its own id', async () => {
		// `services.uploads`, never the name of whatever service it happens to
		// own — the id is the only name, so a call site cannot drift from it.
		const endpoint = api
			.get('/files')
			.dependsOn([uploads])
			.handle(async ({ services }) => services.uploads);

		const services = (await resolve(endpoint.services)) as {
			uploads: { url: string };
		};

		expect(services.uploads.url).toBe('s3://uploads?region=us-east-1');
	});

	it('hands a topic its publisher, because publishing is what depending means', async () => {
		// A subscriber binds with `testWorker.topic(…)` instead, and is never given this.
		const endpoint = api
			.get('/ping')
			.dependsOn([users])
			.handle(async ({ services }) => services.users);

		const services = (await resolve(endpoint.services)) as {
			users: { publish: unknown };
		};

		expect(typeof services.users.publish).toBe('function');
	});

	it('takes several constructs at once', async () => {
		const endpoint = api
			.get('/both')
			.dependsOn([uploads, emails])
			.handle(async ({ services }) => [services.uploads, services.emails]);

		expect(endpoint.services.map((s) => s.serviceName).sort()).toEqual([
			'emails',
			'uploads',
		]);
	});

	it('refuses a bare Service, and says what to do instead', () => {
		const clock = { serviceName: 'clock' as const, register: async () => ({}) };

		// @ts-expect-error - constructs only; a Service does not match the shape.
		expect(() => factory.dependsOn([clock])).toThrow(NotAConstruct);
		// @ts-expect-error - same, with the message a JavaScript caller gets.
		expect(() => factory.dependsOn([clock])).toThrow(
			/services\(\[…\]\) instead/,
		);
	});
});

/**
 * The other half of the same call.
 *
 * `.dependsOn()` used to keep only the services, which is the form a handler
 * runs with — and a service name is not an id, so by the time the build could
 * read the graph the edges were gone and every generated function was granted
 * either everything or nothing. These assert the ids survive as far as the
 * construct, which is where the build reads them.
 */
describe('.dependsOn — the ids it records', () => {
	it('keeps the ids beside the services', () => {
		const endpoint = api
			.get('/files')
			.dependsOn([uploads])
			.handle(async () => null);

		expect(endpoint.constructs).toEqual(['Uploads']);
		expect(endpoint.services.map((s) => s.serviceName)).toEqual(['uploads']);
	});

	it('accumulates across calls and collapses repeats', () => {
		// `.services()` already unions rather than replaces, so the ids that
		// mirror it have to as well or the two halves disagree.
		const endpoint = api
			.get('/both')
			.dependsOn([uploads])
			.dependsOn([emails, uploads])
			.handle(async () => null);

		expect(endpoint.constructs).toEqual(['Uploads', 'Emails']);
	});

	it('carries a factory-level dependency into every endpoint built from it', () => {
		// The `branch.dependsOn([…]).get(…)` form: the factory is cloned by each
		// builder method, so the ids have to survive thirteen clones to arrive.
		const group = factory.dependsOn([uploads]);

		const first = group.get('/a').handle(async () => null);
		const second = group
			.post('/b')
			.dependsOn([emails])
			.handle(async () => null);

		expect(first.constructs).toEqual(['Uploads']);
		expect(second.constructs).toEqual(['Uploads', 'Emails']);
	});

	it('does not leak from one endpoint into the next', () => {
		// Builders are mutable and reused, which is why every other field is reset
		// after `.handle()`; an edge leaking here would over-grant silently.
		const group = factory.dependsOn([uploads]);

		group
			.get('/a')
			.dependsOn([emails])
			.handle(async () => null);
		const after = group.get('/b').handle(async () => null);

		expect(after.constructs).toEqual(['Uploads']);
	});

	it('does not carry one function’s constructs into the next', () => {
		// `f` and `c` are module singletons that mutate and hand-reset, so the
		// second handler built off one inherits whatever the reset forgot. It
		// forgot this field, and because `idsOf` unions rather than assigns, the
		// stale value survived as a *grant* — a function reaching a bucket it
		// never declared. Endpoints never had it: a factory mints a fresh builder
		// per route, so there is no reused state and no reset to forget.
		const first = testWorker.dependsOn([uploads]).handle(async () => null);
		const second = testWorker.dependsOn([emails]).handle(async () => null);

		expect(first.constructs).toEqual(['Uploads']);
		expect(second.constructs).toEqual(['Emails']);

		// The two halves have to agree; the leak showed up as them disagreeing.
		expect(second.services.map((service) => service.serviceName)).toEqual([
			'emails',
		]);
	});

	it('does not carry one cron’s constructs into the next', () => {
		const first = testWorker
			.cron('rate(1 day)')
			.dependsOn([uploads])
			.handle(async () => null);
		const second = testWorker
			.cron('rate(1 hour)')
			.dependsOn([emails])
			.handle(async () => null);

		expect(first.constructs).toEqual(['Uploads']);
		expect(second.constructs).toEqual(['Emails']);
	});

	it('records nothing when the guard rejects the argument', () => {
		// The validating half runs first, so a caught error leaves no partial
		// edge behind — these builders are reused, and `[undefined]` in a
		// `string[]` would ride into the next handler and then the manifest.
		const clock = { serviceName: 'clock' as const, register: async () => ({}) };

		// @ts-expect-error - constructs only.
		expect(() => testWorker.dependsOn([clock])).toThrow(NotAConstruct);

		const fn = testWorker.dependsOn([uploads]).handle(async () => null);
		expect(fn.constructs).toEqual(['Uploads']);
	});

	it('records them on a function, a cron, a queue worker and a subscriber', async () => {
		const fn = testWorker.dependsOn([uploads]).handle(async () => null);
		const cron = testWorker
			.cron('rate(1 day)')
			.dependsOn([uploads])
			.handle(async () => null);
		const worker = testWorker
			.queue('reports')
			.message(z.object({ id: z.string() }))
			.dependsOn([uploads])
			.handle(async () => {});
		const subscriber = testWorker
			.topic(users)
			.dependsOn([uploads])
			.handle(async () => null);

		// Every kind that can hold a handler, because a target reads the same
		// field on all of them to decide what one function may reach.
		expect(fn.constructs).toEqual(['Uploads']);
		expect(cron.constructs).toEqual(['Uploads']);
		expect(worker.constructs).toEqual(['Uploads']);
		expect(subscriber.constructs).toEqual(['Uploads']);
	});

	// `.database(db)` is an edge like any `.dependsOn()`. It wired the service
	// and dropped the id, so an endpoint built from `api.database(db)` reached a
	// database nothing composed from the edges knew about.
	it('records the database a surface branch was given', () => {
		const orders = new KyselyDatabase('Orders');

		const endpoint = api
			.database(orders)
			.get('/orders')
			.dependsOn([uploads])
			.handle(async () => null);

		expect(endpoint.constructs).toEqual(['Orders', 'Uploads']);
	});

	it('records the database a function was given', () => {
		const orders = new KyselyDatabase('Orders');

		const fn = testWorker
			.dependsOn([uploads])
			.database(orders)
			.handle(async () => null);

		expect(fn.constructs).toEqual(['Uploads', 'Orders']);
	});

	it('records the database a cron was given', () => {
		const orders = new KyselyDatabase('Orders');

		const cron = testWorker
			.cron('rate(1 day)')
			.database(orders)
			.handle(async () => null);

		expect(cron.constructs).toEqual(['Orders']);
	});
});
