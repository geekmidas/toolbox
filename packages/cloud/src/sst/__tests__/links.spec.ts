import { describe, expect, it } from 'vitest';
import { Cache, CacheNeedsProvider, CacheNeedsVpc } from '../aws/Cache';
import { Database } from '../aws/Database';
import { DatabaseReader, DatabaseSchema } from '../aws/DerivedDatabase';
import { Email } from '../aws/Email';
import { FileServer } from '../aws/FileServer';
import { Queue } from '../aws/Queue';
import { RestApiSurface } from '../aws/RestApiSurface';
import { Secret } from '../aws/Secret';
import { StaticSite } from '../aws/StaticSite';
import { Storage } from '../aws/Storage';
import { Topic } from '../aws/Topic';
import { ResourceType } from '../Linkable';

/**
 * What a linked function receives from each component, and the type that
 * decides which variables a link provides. `getSSTLink()` is the payload SST
 * injects into every handler linked to the resource; `_type` is what
 * `LinkedEnvironment` keys the variable names off.
 */

const stack = {} as never;
const vpc = { subnets: ['subnet-1'], securityGroups: ['sg-1'] } as never;

/** Resolves `$util.output(promise)`, which the stub leaves as the promise. */
const settle = async (value: unknown) =>
	(value as { apply: (fn: (v: unknown) => unknown) => unknown }).apply(
		(v) => v,
	);

describe('link payloads', () => {
	it('a queue adds its ARN and connection string to SST’s own link', () => {
		const queue = new Queue(stack, 'Emails');

		expect(queue._type).toBe(ResourceType.Queue);
		// The connection string itself is parsed back in provides.spec; here, the
		// link carries exactly what `provides()` resolved.
		expect(queue.getSSTLink().properties).toEqual({
			name: 'Emails',
			arn: queue.arn,
			...queue.provides(),
		});
	});

	it('a topic carries its publisher connection string', () => {
		const topic = new Topic(stack, 'Users');

		expect(topic._type).toBe(ResourceType.SnsTopic);
		expect(topic.getSSTLink().properties).toEqual({
			name: 'Users',
			...topic.provides(),
		});
	});

	it('a secret carries its value', () => {
		const secret = new Secret(stack, 'AuthSecret');

		expect(secret._type).toBe(ResourceType.SSTSecret);
		expect(secret.getSSTLink().properties).toMatchObject(secret.provides());
	});

	it('a mailer carries its URL and sending identity, and nothing else', () => {
		const email = new Email(stack, 'Mail', {
			backend: 'smtp',
			url: 'smtp://relay.test:587',
			from: 'hello@shop.test',
		} as never);

		expect(email._type).toBe(ResourceType.Email);
		expect(email.getSSTLink()).toEqual({
			properties: { url: 'smtp://relay.test:587', from: 'hello@shop.test' },
		});
	});

	it('a file server routes everything to its bucket, and links its URL', () => {
		const origin = new Storage(stack, 'Uploads');
		const server = new FileServer(stack, 'Files', { origin } as never);

		expect(origin._type).toBe(ResourceType.ObjectStorage);
		expect(origin._id).toBe('Uploads');
		expect(server._type).toBe(ResourceType.FileServer);
		expect((server as unknown as { routed: unknown[] }).routed).toEqual([
			{ pattern: '/*', bucket: origin },
		]);
		expect(server.getSSTLink().properties).toMatchObject({
			url: server.url,
		});
	});

	it('a site is built the way its variant builds, and links its URL', () => {
		const vite = new StaticSite(stack, 'Web');
		const next = new StaticSite(stack, 'Admin', {
			variant: 'next',
			build: { command: 'pnpm build:custom', output: 'out' },
		} as never);
		const args = (site: unknown) => (site as { args: { build: unknown } }).args;

		expect(vite._type).toBe(ResourceType.StaticSite);
		expect(args(vite).build).toEqual(expect.objectContaining({}));
		// A build the caller supplied wins over the variant's.
		expect(args(next).build).toEqual({
			command: 'pnpm build:custom',
			output: 'out',
		});
		expect(vite.getSSTLink().properties).toMatchObject({ url: vite.url });
	});

	it('a surface links its address and, once resolved, who may call it', async () => {
		const bare = new RestApiSurface(stack, 'Api');
		const called = new RestApiSurface(stack, 'Api', {
			callers: Promise.resolve({
				trustedOrigins: 'https://web.shop.test',
				cookieDomain: 'shop.test',
			}),
		});

		expect(bare._type).toBe(ResourceType.ApiGatewayV2);
		expect(await settle(bare.provides().trustedOrigins)).toBe('');
		expect(await settle(bare.provides().cookieDomain)).toBe('');

		const link = called.getSSTLink().properties as Record<string, unknown>;
		expect(link.url).toBe(called.url);
		expect(await settle(link.trustedOrigins)).toBe('https://web.shop.test');
		expect(await settle(link.cookieDomain)).toBe('shop.test');
	});

	it('a database and the nodes derived from it each link only their own URL', () => {
		const cluster = new Database(stack, 'Orders', { vpc, schema: 'app' });
		const reader = new DatabaseReader('OrdersReader', cluster);
		const tenant = new DatabaseSchema('AuthDb', cluster, 'authdb');

		expect(cluster._type).toBe(ResourceType.SSTPostgres);
		expect(reader._type).toBe(ResourceType.SSTPostgres);
		expect(tenant._type).toBe(ResourceType.SSTPostgres);
		expect(cluster.getSSTLink().properties).toMatchObject({
			url: cluster.provides().url,
		});
		// Least privilege: the reader's link is its URL and not the writer's.
		expect(reader.getSSTLink()).toEqual({
			properties: { url: reader.provides().url },
		});
		expect(tenant.getSSTLink()).toEqual({
			properties: { url: tenant.provides().url },
		});
	});

	it('a cache given its URL links it as-is', () => {
		const cache = new Cache(stack, 'Sessions', {
			backend: 'db',
			url: 'postgres://db.test/app',
		});

		expect(cache._type).toBe(ResourceType.Cache);
		expect(cache.getSSTLink()).toEqual({
			properties: { url: 'postgres://db.test/app' },
		});
	});
});

describe('Cache on Upstash', () => {
	/** `sst add upstash` installs this global; here, a recording stand-in. */
	const created: { name: string; args: Record<string, unknown> }[] = [];
	class RedisDatabase {
		readonly endpoint = 'eu1-cache.upstash.io';
		readonly restToken = 'tok/en+1';
		constructor(name: string, args: Record<string, unknown>) {
			created.push({ name, args });
		}
	}

	it('creates a TLS database and puts its token in the URL', () => {
		(globalThis as Record<string, unknown>).upstash = { RedisDatabase };
		try {
			const defaulted = new Cache(stack, 'Sessions', { backend: 'upstash' });
			new Cache(stack, 'Rates', { backend: 'upstash', region: 'us-east-1' });

			expect(created).toEqual([
				{
					name: 'SessionsCache',
					args: { databaseName: 'Sessions', region: 'eu-west-1', tls: true },
				},
				{
					name: 'RatesCache',
					args: { databaseName: 'Rates', region: 'us-east-1', tls: true },
				},
			]);
			// The address and the credential that opens it are one fact.
			expect(defaulted.provides().url).toBe(
				`https://:${encodeURIComponent('tok/en+1')}@eu1-cache.upstash.io`,
			);
		} finally {
			delete (globalThis as Record<string, unknown>).upstash;
		}
	});
});

describe('Cache provisioning refusals', () => {
	it('asks for the Upstash provider when it is not installed', () => {
		expect(() => new Cache(stack, 'Sessions', { backend: 'upstash' })).toThrow(
			CacheNeedsProvider,
		);
	});

	it('asks for a VPC before creating an ElastiCache', () => {
		expect(
			() => new Cache(stack, 'Sessions', { backend: 'elasticache' }),
		).toThrow(CacheNeedsVpc);
	});
});
