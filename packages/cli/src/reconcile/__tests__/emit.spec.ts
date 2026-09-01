import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { manifestModule, withCompute, withRoutes } from '../emit';

const base = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		endpoints: [],
		defaultAuthorizer: 'none',
	},
	Auth: {
		kind: 'rest-api',
		id: 'Auth',
		endpoints: [
			{
				id: 'AuthHandler',
				handler: 'Auth.handler',
				method: 'ANY',
				path: '/api/auth/*',
				dependencies: [],
			},
		],
	},
	Emails: {
		kind: 'queue',
		id: 'Emails',
		worker: { id: 'x', handler: 'x', dependencies: [] },
	},
	Users: {
		kind: 'topic',
		id: 'Users',
		events: ['user.created'],
		subscribers: [],
	},
} as const satisfies ConstructManifest;

const route = {
	path: '/users',
	method: 'POST',
	handler: '.gkm/aws-apigatewayv2/createUser.handler',
	authorizer: 'none',
};

describe('withRoutes', () => {
	it('folds routes into the surface that declared none', () => {
		const merged = withRoutes(base, [route], { perRoute: true });
		const api = merged.Api as { endpoints: unknown[] };

		expect(api.endpoints).toEqual([
			{
				id: 'ApiPOST/users',
				handler: '.gkm/aws-apigatewayv2/createUser.handler',
				method: 'POST',
				path: '/users',
				dependencies: [],
				authorizer: 'none',
			},
		]);
	});

	it('leaves a surface that enumerated its own alone', () => {
		// An auth server declares its wildcard statically; discovered routes are
		// not its.
		const merged = withRoutes(base, [route], { perRoute: true });

		expect((merged.Auth as { endpoints: unknown[] }).endpoints).toHaveLength(1);
	});

	it('ignores a provider that does not generate one handler per route', () => {
		// `server` mounts everything in one process and emits a single catch-all,
		// which is a true description of that build and a false one of the app.
		// Merging it wrote `ALL *` into a manifest for an app with five routes.
		const merged = withRoutes(base, [route], { perRoute: false });

		expect((merged.Api as { endpoints: unknown[] }).endpoints).toEqual([]);
	});
});

describe('withCompute', () => {
	it('adds a function as its own node, because nothing triggers it but a caller', () => {
		const merged = withCompute(base, {
			functions: [
				{ name: 'SendEmail', handler: '.gkm/aws-lambda/sendEmail.handler' },
			],
		});

		expect(merged.SendEmail).toMatchObject({
			kind: 'function',
			handler: '.gkm/aws-lambda/sendEmail.handler',
			provides: ['SEND_EMAIL_URL'],
		});
	});

	it('keeps a cron’s schedule, which is structural', () => {
		const merged = withCompute(base, {
			crons: [{ name: 'Nightly', handler: 'h', schedule: 'rate(1 day)' }],
		});

		expect(merged.Nightly).toMatchObject({
			kind: 'cron',
			schedule: 'rate(1 day)',
		});
	});

	it('nests a worker inside the queue that triggers it', () => {
		// Position carries the trigger: this handler is reached by messages on
		// this queue and by nothing else, so there is no `trigger` field.
		const merged = withCompute(base, {
			queues: [{ name: 'Emails', handler: '.gkm/aws-lambda/emails.handler' }],
		});

		expect(merged.Emails).toMatchObject({
			kind: 'queue',
			worker: { handler: '.gkm/aws-lambda/emails.handler' },
		});
	});

	it('nests a subscriber inside the topic it bound to', () => {
		const merged = withCompute(base, {
			subscribers: [
				{
					name: 'SendWelcome',
					handler: 'h',
					topic: 'Users',
					subscribedEvents: ['user.created'],
				},
			],
		});

		expect((merged.Users as { subscribers: unknown[] }).subscribers).toEqual([
			{
				id: 'SendWelcome',
				handler: 'h',
				events: ['user.created'],
				dependencies: [],
			},
		]);
	});

	it('ignores a subscriber whose topic is not declared', () => {
		// Better a missing binding than a topic invented to hold it — the
		// reference check is what should report this, not a silent creation.
		const merged = withCompute(base, {
			subscribers: [
				{
					name: 'Orphan',
					handler: 'h',
					topic: 'Nowhere',
					subscribedEvents: [],
				},
			],
		});

		expect(merged.Nowhere).toBeUndefined();
	});
});

describe('manifestModule', () => {
	it('emits literals, not data', () => {
		// `as const satisfies` is what keeps every id and key selectable by
		// `IdsOf` and friends; `JSON.parse` would give all of that up.
		const source = manifestModule(base);

		expect(source).toContain('as const satisfies ConstructManifest');
	});

	it('records the backends the build resolved', () => {
		// Because they were being answered twice — once by the build registering
		// a driver, once by a deploy telling the provisioner otherwise.
		const source = manifestModule(base, { cache: 'db', email: 'ses' });

		expect(source).toContain("cache: 'db'");
	});
});

/**
 * The edges, arriving from the build.
 *
 * The manifest's whole job here is to say which function may reach which
 * construct. It said nothing for a long time — every generated handler carried
 * `dependencies: []` — because `.dependsOn()` dissolved into services and the
 * ids never made it out of the builder. These assert the other end of that wire.
 */
describe('withRoutes — the edges it records', () => {
	const manifest = {
		...base,
		Uploads: { kind: 'objects', id: 'Uploads' },
		Orders: { kind: 'database', id: 'Orders' },
	} as unknown as ConstructManifest;

	it('resolves an id to the kind the manifest gives it', () => {
		// The kind is read off the target rather than recorded beside the edge:
		// one fact, one place, so the copy cannot go stale.
		const merged = withRoutes(
			manifest,
			[{ ...route, dependencies: ['Uploads', 'Orders'] }],
			{ perRoute: true },
		);

		expect(
			(merged.Api as { endpoints: { dependencies: unknown }[] }).endpoints[0]
				?.dependencies,
		).toEqual([
			{ target: 'Uploads', kind: 'objects' },
			{ target: 'Orders', kind: 'database' },
		]);
	});

	it('drops an id that names no declaration', () => {
		// A lifted `Service` is a legitimate dependency that declares no node, so
		// this is not an error — a target can only grant what it can find.
		const merged = withRoutes(
			manifest,
			[{ ...route, dependencies: ['Uploads', 'Clock'] }],
			{ perRoute: true },
		);

		expect(
			(merged.Api as { endpoints: { dependencies: unknown }[] }).endpoints[0]
				?.dependencies,
		).toEqual([{ target: 'Uploads', kind: 'objects' }]);
	});
});

describe('withCompute — the edges it records', () => {
	const manifest = {
		...base,
		Uploads: { kind: 'objects', id: 'Uploads' },
	} as unknown as ConstructManifest;

	it('carries them onto a function and a cron', () => {
		const merged = withCompute(manifest, {
			functions: [
				{ name: 'Resize', handler: 'r.handler', dependencies: ['Uploads'] },
			],
			crons: [
				{
					name: 'Sweep',
					handler: 's.handler',
					schedule: 'rate(1 day)',
					dependencies: ['Uploads'],
				},
			],
		});

		expect((merged.Resize as { dependencies: unknown }).dependencies).toEqual([
			{ target: 'Uploads', kind: 'objects' },
		]);
		expect((merged.Sweep as { dependencies: unknown }).dependencies).toEqual([
			{ target: 'Uploads', kind: 'objects' },
		]);
	});

	it('carries them onto a nested worker and subscriber', () => {
		// Nested rather than top-level because position carries the trigger — and
		// the edge has to survive that nesting, which is where it is easiest to
		// drop.
		const merged = withCompute(manifest, {
			queues: [
				{ name: 'emails', handler: 'w.handler', dependencies: ['Uploads'] },
			],
			subscribers: [
				{
					name: 'OnCreated',
					handler: 'sub.handler',
					subscribedEvents: ['user.created'],
					topic: 'users',
					dependencies: ['Uploads'],
				},
			],
		});

		expect(
			(merged.Emails as { worker: { dependencies: unknown } }).worker
				.dependencies,
		).toEqual([{ target: 'Uploads', kind: 'objects' }]);
		expect(
			(merged.Users as { subscribers: { dependencies: unknown }[] })
				.subscribers[0]?.dependencies,
		).toEqual([{ target: 'Uploads', kind: 'objects' }]);
	});
});
