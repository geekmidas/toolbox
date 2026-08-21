import { EnvironmentParser } from '@geekmidas/envkit';
import { ServiceDiscovery } from '@geekmidas/services';
import { registerStorageDriver, type StorageClient } from '@geekmidas/storage';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { NotAConstruct } from '../construct-interface';
import { e } from '../endpoints/EndpointFactory';
import { ObjectStorage } from '../object-storage';
import { q } from '../queue';
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
