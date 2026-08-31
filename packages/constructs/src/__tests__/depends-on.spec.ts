import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { registerStorageDriver, type StorageClient } from '@geekmidas/storage';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NotAConstruct } from '../construct-interface';
import { c } from '../crons';
import { e } from '../endpoints/EndpointFactory';
import { f } from '../functions';
import { ObjectStorage } from '../object-storage';
import { q } from '../queue';
import { s } from '../subscribers';
import { t } from '../topic';

/**
 * A driver for these tests, registered the way an entry point registers one:
 * the scheme in the URL picks it, and no construct names a provider.
 */
registerStorageDriver({
	scheme: 's3:',
	create: (url) => ({ url }) as unknown as StorageClient,
});

const uploads = new ObjectStorage('Uploads');

const users = t
	.topic('users')
	.events({ 'user.created': z.object({ id: z.string() }) });

const emails = q
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
		const endpoint = e
			.dependsOn([uploads])
			.get('/files')
			.handle(async ({ services }) => services.uploads);

		const services = (await resolve(endpoint.services)) as {
			uploads: { url: string };
		};

		expect(services.uploads.url).toBe('s3://uploads?region=us-east-1');
	});

	it('hands a topic its publisher, because publishing is what depending means', async () => {
		// A subscriber binds with `s.topic(…)` instead, and is never given this.
		const endpoint = e
			.dependsOn([users])
			.get('/ping')
			.handle(async ({ services }) => services.users);

		const services = (await resolve(endpoint.services)) as {
			users: { publish: unknown };
		};

		expect(typeof services.users.publish).toBe('function');
	});

	it('takes several constructs at once', async () => {
		const endpoint = e
			.dependsOn([uploads, emails])
			.get('/both')
			.handle(async ({ services }) => [services.uploads, services.emails]);

		expect(endpoint.services.map((s) => s.serviceName).sort()).toEqual([
			'emails',
			'uploads',
		]);
	});

	it('refuses a bare Service, and says what to do instead', () => {
		const clock = { serviceName: 'clock' as const, register: async () => ({}) };

		// @ts-expect-error - constructs only; a Service does not match the shape.
		expect(() => e.dependsOn([clock])).toThrow(NotAConstruct);
		// @ts-expect-error - same, with the message a JavaScript caller gets.
		expect(() => e.dependsOn([clock])).toThrow(/services\(\[…\]\) instead/);
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
		const endpoint = e
			.get('/files')
			.dependsOn([uploads])
			.handle(async () => null);

		expect(endpoint.constructs).toEqual(['Uploads']);
		expect(endpoint.services.map((s) => s.serviceName)).toEqual(['uploads']);
	});

	it('accumulates across calls and collapses repeats', () => {
		// `.services()` already unions rather than replaces, so the ids that
		// mirror it have to as well or the two halves disagree.
		const endpoint = e
			.get('/both')
			.dependsOn([uploads])
			.dependsOn([emails, uploads])
			.handle(async () => null);

		expect(endpoint.constructs).toEqual(['Uploads', 'Emails']);
	});

	it('carries a factory-level dependency into every endpoint built from it', () => {
		// The `e.dependsOn([…]).get(…)` form: the factory is cloned by each
		// builder method, so the ids have to survive thirteen clones to arrive.
		const api = e.dependsOn([uploads]);

		const first = api.get('/a').handle(async () => null);
		const second = api
			.post('/b')
			.dependsOn([emails])
			.handle(async () => null);

		expect(first.constructs).toEqual(['Uploads']);
		expect(second.constructs).toEqual(['Uploads', 'Emails']);
	});

	it('does not leak from one endpoint into the next', () => {
		// Builders are mutable and reused, which is why every other field is reset
		// after `.handle()`; an edge leaking here would over-grant silently.
		const api = e.dependsOn([uploads]);

		api
			.get('/a')
			.dependsOn([emails])
			.handle(async () => null);
		const after = api.get('/b').handle(async () => null);

		expect(after.constructs).toEqual(['Uploads']);
	});

	it('does not carry one function’s constructs into the next', () => {
		// `f` and `c` are module singletons that mutate and hand-reset, so the
		// second handler built off one inherits whatever the reset forgot. It
		// forgot this field, and because `idsOf` unions rather than assigns, the
		// stale value survived as a *grant* — a function reaching a bucket it
		// never declared. Endpoints never had it: a factory mints a fresh builder
		// per route, so there is no reused state and no reset to forget.
		const first = f.dependsOn([uploads]).handle(async () => null);
		const second = f.dependsOn([emails]).handle(async () => null);

		expect(first.constructs).toEqual(['Uploads']);
		expect(second.constructs).toEqual(['Emails']);

		// The two halves have to agree; the leak showed up as them disagreeing.
		expect(second.services.map((service) => service.serviceName)).toEqual([
			'emails',
		]);
	});

	it('does not carry one cron’s constructs into the next', () => {
		const first = c
			.schedule('rate(1 day)')
			.dependsOn([uploads])
			.handle(async () => null);
		const second = c
			.schedule('rate(1 hour)')
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
		expect(() => f.dependsOn([clock])).toThrow(NotAConstruct);

		const fn = f.dependsOn([uploads]).handle(async () => null);
		expect(fn.constructs).toEqual(['Uploads']);
	});

	it('records them on a function, a cron, a queue worker and a subscriber', async () => {
		const fn = f.dependsOn([uploads]).handle(async () => null);
		const cron = c
			.schedule('rate(1 day)')
			.dependsOn([uploads])
			.handle(async () => null);
		const worker = q
			.queue('reports')
			.message(z.object({ id: z.string() }))
			.dependsOn([uploads])
			.handle(async () => {});
		const subscriber = s
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
});
