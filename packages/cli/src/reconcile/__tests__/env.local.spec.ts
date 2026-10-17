import { keyringCipher, parseKeyring } from '@geekmidas/constructs/encryption';
import * as snsUrl from '@geekmidas/events/sns/url';
import * as sqsUrl from '@geekmidas/events/sqs/url';
import type { ConstructManifest } from '@geekmidas/manifest';
import { provisionOrder } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { portKeys } from '../containers';
import { envFor } from '../env';
import { type PlanOptions, planFor } from '../plan';
import { TEST_CREDENTIALS } from './__helpers__/credentials';

/**
 * The local values that are not an address: a secret the platform owns, the
 * `roles: false` downgrade, and events on the AWS emulator.
 */

function resolve(
	manifest: ConstructManifest,
	stage = 'dev',
	options: PlanOptions & { project?: string } = {},
) {
	const plan = planFor(manifest, stage, provisionOrder(manifest), {
		localStage: 'dev',
		...options,
	});
	const ports = Object.fromEntries(
		portKeys(plan.containers).map((key, i) => [key, 21000 + i]),
	);

	return envFor(plan, {
		credentials: TEST_CREDENTIALS,
		ports,
		...(options.project ? { project: options.project } : {}),
	});
}

describe('a declared secret, locally', () => {
	const manifest = {
		Signing: { kind: 'secret', id: 'Signing', provides: ['SIGNING'] },
	} as const satisfies ConstructManifest;

	it('is stable, and never the same across stages or projects', () => {
		const one = resolve(manifest, 'dev', { project: 'shop' }).SIGNING;

		expect(one).toMatch(/^[\w-]{43}$/);
		expect(resolve(manifest, 'dev', { project: 'shop' }).SIGNING).toBe(one);
		expect(resolve(manifest, 'test', { project: 'shop' }).SIGNING).not.toBe(
			one,
		);
		expect(resolve(manifest, 'dev', { project: 'blog' }).SIGNING).not.toBe(one);
	});
});

describe('a declared secret with a format, locally', () => {
	const manifest = {
		RouterPassword: {
			kind: 'secret',
			id: 'RouterPassword',
			provides: ['ROUTER_PASSWORD'],
			length: 16,
			symbols: '!@#',
		},
	} as const satisfies ConstructManifest;

	it('is drawn in it, as a deploy draws it, and is still stable', () => {
		const one = resolve(manifest, 'dev', { project: 'shop' }).ROUTER_PASSWORD;

		expect(one).toMatch(/^[A-Za-z0-9!@#]{16}$/);
		expect(one).toMatch(/[!@#]/);
		expect(resolve(manifest, 'dev', { project: 'shop' }).ROUTER_PASSWORD).toBe(
			one,
		);
	});
});

describe('a declared encryption key, locally', () => {
	const manifest = {
		Pii: { kind: 'encryption', id: 'Pii', provides: ['PII_URL'] },
	} as const satisfies ConstructManifest;

	it('is a keyring derived like a secret: stable, and never shared across stages or projects', async () => {
		const one = resolve(manifest, 'dev', { project: 'shop' }).PII_URL!;

		expect(parseKeyring('Pii', one).keys.map(({ id }) => id)).toEqual(['k1']);
		expect(resolve(manifest, 'dev', { project: 'shop' }).PII_URL).toBe(one);
		expect(resolve(manifest, 'test', { project: 'shop' }).PII_URL).not.toBe(
			one,
		);
		expect(resolve(manifest, 'dev', { project: 'blog' }).PII_URL).not.toBe(one);
	});

	it('opens tomorrow what it encrypted today', async () => {
		const url = () => resolve(manifest, 'dev', { project: 'shop' }).PII_URL!;
		const written = await keyringCipher('Pii', url()).encrypt('kept');

		expect(await keyringCipher('Pii', url()).decrypt(written)).toBe('kept');
	});
});

describe('a database without its own roles', () => {
	const manifest = {
		Orders: {
			kind: 'database',
			id: 'Orders',
			roles: false,
			provides: ['ORDERS_URL'],
		},
	} as const satisfies ConstructManifest;

	it('connects as the cluster’s own credential, with no schema to pin', () => {
		const url = new URL(resolve(manifest).ORDERS_URL!);

		expect(url.username).toBe(TEST_CREDENTIALS.postgres.user);
		expect(decodeURIComponent(url.password)).toBe(
			TEST_CREDENTIALS.postgres.password,
		);
		expect(url.pathname).toBe('/orders');
		expect(url.search).toBe('');
	});
});

describe('events on SNS, locally', () => {
	const manifest = {
		Emails: {
			kind: 'queue',
			id: 'Emails',
			worker: {
				id: 'EmailsWorker',
				handler: 'emails.handler',
				dependencies: [],
			},
			provides: ['EMAILS_PUBLISHER_CONNECTION_STRING'],
		},
		Users: {
			kind: 'topic',
			id: 'Users',
			events: ['user.created'],
			subscribers: [],
			provides: ['USERS_PUBLISHER_CONNECTION_STRING'],
		},
	} as const satisfies ConstructManifest;

	it('addresses each topic and queue by its own emulator ARN or URL', () => {
		const env = resolve(manifest, 'dev', { events: 'sns' });

		const topic = snsUrl.parse(env.USERS_PUBLISHER_CONNECTION_STRING!);
		expect(topic.topicArn).toBe('arn:aws:sns:us-east-1:000000000000:users');
		expect(topic.endpoint).toMatch(/^http:\/\/localhost:\d+$/);

		const queue = sqsUrl.parse(env.EMAILS_PUBLISHER_CONNECTION_STRING!);
		expect(queue.queueUrl).toBe(`${queue.endpoint}/000000000000/emails`);
	});

	it('carries the emulator’s credential, never the developer’s AWS profile', () => {
		const env = resolve(manifest, 'dev', { events: 'sns' });
		const url = new URL(env.USERS_PUBLISHER_CONNECTION_STRING!);

		expect(url.searchParams.get('accessKeyId')).toMatch(/^LSIA/);
		expect(url.searchParams.get('secretAccessKey')).toBe(
			TEST_CREDENTIALS.emulator.secretAccessKey,
		);
	});

	it('has no single broker address, so none is handed out', () => {
		const env = resolve(manifest, 'dev', { events: 'sns' });

		expect(env.EVENT_PUBLISHER_CONNECTION_STRING).toBeUndefined();
		expect(env.EVENT_SUBSCRIBER_CONNECTION_STRING).toBeUndefined();
	});
});

describe('a WebSocket surface, locally', () => {
	const manifest = {
		Realtime: {
			kind: 'websocket-api',
			id: 'Realtime',
			path: 'apps/realtime',
			provides: [
				'REALTIME_URL',
				'REALTIME_TRUSTED_ORIGINS',
				'REALTIME_PUBLISHER_CONNECTION_STRING',
			],
		},
		Web: {
			kind: 'site',
			id: 'Web',
			variant: 'vite',
			app: { path: 'apps/web' },
			dependencies: [{ target: 'Realtime', kind: 'websocket-api' }],
			provides: ['WEB_URL'],
		},
	} as unknown as ConstructManifest;

	function resolveWith(
		addresses: Record<string, string>,
		options: PlanOptions = {},
	) {
		const plan = planFor(manifest, 'dev', provisionOrder(manifest), {
			localStage: 'dev',
			...options,
		});
		const ports = Object.fromEntries(
			portKeys(plan.containers).map((key, i) => [key, 21000 + i]),
		);
		return {
			plan,
			ports,
			env: envFor(plan, {
				credentials: TEST_CREDENTIALS,
				ports,
				project: 'shop',
				addresses,
			}),
		};
	}

	const addresses = {
		Realtime: 'http://localhost:3002',
		Web: 'http://localhost:5173',
	};

	it('runs Redis, and answers on wss:// behind the edge, as a REST surface does', () => {
		const { plan, env, ports } = resolveWith(addresses);

		expect(plan.containers).toContain('redis');
		expect(env.REALTIME_URL).toBe(
			`wss://realtime.shop.localhost:${ports.caddy}`,
		);
		expect(env.REALTIME_TRUSTED_ORIGINS).toBe(
			// The one site holds the base domain.
			`https://shop.localhost:${ports.caddy}`,
		);
	});

	it('answers on ws:// at its own port without the edge', () => {
		const { env } = resolveWith(addresses, { edge: false });

		expect(env.REALTIME_URL).toBe('ws://localhost:3002');
		expect(env.REALTIME_TRUSTED_ORIGINS).toBe('http://localhost:5173');
	});

	it('meets its senders on the local Redis, on channels named for the project', () => {
		const { env, ports } = resolveWith({ Realtime: 'http://localhost:3002' });
		const password = encodeURIComponent(TEST_CREDENTIALS.redis.password);

		expect(env.REALTIME_PUBLISHER_CONNECTION_STRING).toBe(
			`redis://:${password}@localhost:${ports.redis}?channel=gkm%3Aws%3Ashop%3ARealtime`,
		);
	});
	it('counts as a web origin, not a mobile one, to a surface it calls', () => {
		const calling = {
			...manifest,
			Api: {
				kind: 'rest-api',
				id: 'Api',
				path: 'apps/api',
				endpoints: [],
				provides: ['API_URL', 'API_TRUSTED_ORIGINS', 'API_COOKIE_DOMAIN'],
			},
			Realtime: {
				...manifest.Realtime,
				calls: [{ target: 'Api', kind: 'rest-api' }],
			},
		} as unknown as ConstructManifest;
		const plan = planFor(calling, 'dev', provisionOrder(calling), {
			localStage: 'dev',
			edge: false,
		});
		const ports = Object.fromEntries(
			portKeys(plan.containers).map((key, i) => [key, 21000 + i]),
		);

		const env = envFor(plan, {
			credentials: TEST_CREDENTIALS,
			ports,
			project: 'shop',
			addresses: {
				Api: 'http://localhost:3000',
				Realtime: 'http://localhost:3002',
			},
		});

		expect(env.API_TRUSTED_ORIGINS).toBe('http://localhost:3002');
	});
});
