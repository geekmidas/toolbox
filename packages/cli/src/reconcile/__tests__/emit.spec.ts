import type { ConstructManifest } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { manifestModule, withHandlers } from '../emit';

/** What discovery nested: every handler at its source, with its edges. */
const base = {
	Api: {
		kind: 'rest-api',
		id: 'Api',
		path: '.',
		endpoints: [
			{
				id: 'ApiPOST/users',
				handler: 'endpoints/users.ts#createUser',
				method: 'POST',
				path: '/users',
				dependencies: [{ target: 'Uploads', kind: 'objects' }],
				authorizer: 'none',
			},
		],
		defaultAuthorizer: 'none',
	},
	Uploads: {
		kind: 'objects',
		id: 'Uploads',
		subscribers: [
			{
				id: 'onAvatar',
				handler: 'subscribers/avatars.ts#onAvatar',
				events: ['object.created'],
				dependencies: [],
				owner: 'Jobs',
			},
		],
	},
	UploadsServer: {
		kind: 'file-server',
		id: 'UploadsServer',
		of: 'Uploads',
		processors: [
			{
				id: 'thumbnails',
				handler: 'processors/thumbnails.ts#thumbnails',
				path: '/i/:width/*',
				prefix: '/i/',
				dependencies: [{ target: 'Uploads', kind: 'objects' }],
			},
		],
	},
	Emails: {
		kind: 'queue',
		id: 'Emails',
		worker: {
			id: 'EmailsWorker',
			handler: 'queues/emails.ts#emails',
			dependencies: [{ target: 'Uploads', kind: 'objects' }],
			owner: 'Jobs',
		},
	},
	Users: {
		kind: 'topic',
		id: 'Users',
		events: ['user.created'],
		subscribers: [
			{
				id: 'welcome',
				handler: 'subscribers/welcome.ts#welcome',
				events: ['user.created'],
				dependencies: [],
				owner: 'Jobs',
			},
		],
	},
	nightly: {
		kind: 'cron',
		id: 'nightly',
		handler: 'crons/nightly.ts#nightly',
		schedule: 'rate(1 day)',
		dependencies: [{ target: 'Uploads', kind: 'objects' }],
		owner: 'Jobs',
	},
} as const satisfies ConstructManifest;

/**
 * The build's one fact: where it wrote each handler. Discovery already
 * nested every runnable with its edges, so a build changes `handler` and
 * nothing else — the graph is the same as `gkm dev`'s.
 */
describe('withHandlers', () => {
	const generated = withHandlers(base, {
		routes: [
			{
				path: '/users',
				method: 'POST',
				handler: '.gkm/aws/routes/createUser.handler',
				authorizer: 'none',
				surface: 'Api',
			},
		],
		crons: [
			{
				name: 'nightly',
				handler: '.gkm/aws/crons/nightly.handler',
				schedule: 'rate(1 day)',
			},
		],
		queues: [{ name: 'Emails', handler: '.gkm/aws/queues/emails.handler' }],
		subscribers: [
			{
				name: 'welcome',
				handler: '.gkm/aws/subscribers/welcome.handler',
				subscribedEvents: ['user.created'],
				topic: 'Users',
			},
			{
				name: 'onAvatar',
				handler: '.gkm/aws/subscribers/onAvatar.handler',
				subscribedEvents: ['object.created'],
				bucket: 'Uploads',
			},
		],
		processors: [
			{
				name: 'thumbnails',
				fileServer: 'UploadsServer',
				handler: '.gkm/aws/processors/thumbnails.handler',
				path: '/i/:width/*',
				prefix: '/i/',
			},
		],
	});

	it('points each handler at the entry the build wrote', () => {
		expect(generated.Api).toMatchObject({
			endpoints: [{ handler: '.gkm/aws/routes/createUser.handler' }],
		});
		expect(generated.nightly).toMatchObject({
			handler: '.gkm/aws/crons/nightly.handler',
		});
		expect(generated.Emails).toMatchObject({
			worker: { handler: '.gkm/aws/queues/emails.handler' },
		});
		expect(generated.Users).toMatchObject({
			subscribers: [{ handler: '.gkm/aws/subscribers/welcome.handler' }],
		});
		expect(generated.Uploads).toMatchObject({
			subscribers: [{ handler: '.gkm/aws/subscribers/onAvatar.handler' }],
		});
		expect(generated.UploadsServer).toMatchObject({
			processors: [{ handler: '.gkm/aws/processors/thumbnails.handler' }],
		});
	});

	it('changes nothing but the handler', () => {
		const strip = (value: unknown): unknown =>
			JSON.parse(
				JSON.stringify(value, (key, v) => (key === 'handler' ? undefined : v)),
			);

		expect(strip(generated)).toEqual(strip(base));
	});

	it('keeps the source where the build generated no entry of its own', () => {
		// The `server` provider generates one catch-all, which is no endpoint.
		const server = withHandlers(base, {
			routes: [
				{
					path: '*',
					method: 'ALL',
					handler: '.gkm/server/app.ts',
					authorizer: 'none',
				},
			],
		});

		expect(server).toEqual(base);
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
