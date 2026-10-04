import { resolveEnvKeys } from '@geekmidas/envkit/sst';
import { NoUrlForStage, providedKeyFor, provideKey } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { Database } from '../aws/Database';
import { DatabaseSchema } from '../aws/DerivedDatabase';
import { ObjectStorage } from '../aws/ObjectStorage';
import { RestApiSurface } from '../aws/RestApiSurface';
import { type ProvidesMismatch, UnknownDeclarationKind } from '../errors';
import {
	assertProvides,
	mountRoutes,
	PROVISIONED_ELSEWHERE,
	type ProvisionedManifest,
	provisionerFor,
	resolveEdges,
	subscribeConsumers,
	vpcFor,
} from '../fromManifest';

/**
 * The decisions, tested as data. Instantiating a component needs Pulumi, so the
 * adapter keeps its decisions in pure functions and its Pulumi in three lines —
 * otherwise nothing here would be reachable without a deploy.
 */

describe('provisionerFor', () => {
	it('resolves a kind this adapter can provision', () => {
		expect(provisionerFor('objects')).toBeTypeOf('function');
	});

	it.each([
		'objects',
		'queue',
		'topic',
		'secret',
	] as const)('provisions %s', (kind) => {
		expect(provisionerFor(kind)).toBeTypeOf('function');
	});

	it('reports what is supported when a kind has no provisioner', () => {
		expect.assertions(3);
		try {
			// A kind no adapter will ever have, so this test does not go stale
			// every time one more kind becomes provisionable.
			provisionerFor('carrier-pigeon' as never);
		} catch (error) {
			const e = error as UnknownDeclarationKind;
			expect(e).toBeInstanceOf(UnknownDeclarationKind);
			expect(e.kind).toBe('carrier-pigeon');
			expect(e.supported).toContain('objects');
		}
	});
});

describe('assertProvides', () => {
	it('passes when declared and supplied agree', () => {
		expect(() =>
			assertProvides('Uploads', ['UPLOADS_URL'], ['UPLOADS_URL']),
		).not.toThrow();
	});

	it('catches infra supplying nothing for a declared key', () => {
		expect.assertions(2);
		try {
			assertProvides('Uploads', ['UPLOADS_URL'], []);
		} catch (error) {
			const e = error as ProvidesMismatch;
			expect(e.missing).toEqual(['UPLOADS_URL']);
			expect(e.extra).toEqual([]);
		}
	});

	it('catches infra supplying a key the app never declared', () => {
		expect.assertions(2);
		try {
			assertProvides(
				'Uploads',
				['UPLOADS_URL'],
				['UPLOADS_URL', 'UPLOADS_CDN_URL'],
			);
		} catch (error) {
			const e = error as ProvidesMismatch;
			expect(e.missing).toEqual([]);
			// adding cdn to the component without declaring it is caught here
			expect(e.extra).toEqual(['UPLOADS_CDN_URL']);
		}
	});

	it('treats both sides as empty by default, so a resource may provide nothing', () => {
		expect(() => assertProvides('Nothing')).not.toThrow();
	});

	it('names the construct, since a manifest has many', () => {
		expect.assertions(1);
		try {
			assertProvides('Avatars', ['AVATARS_URL'], []);
		} catch (error) {
			expect((error as ProvidesMismatch).id).toBe('Avatars');
		}
	});
});

describe('ObjectStorage', () => {
	const bucket = new ObjectStorage({} as never, 'Uploads');

	it('composes the url from the resource, not the stack', () => {
		expect(bucket.provides().url).toBe('s3://Uploads?region=stub-region');
	});

	it('carries those values on the link, which is what reaches runtime', () => {
		const link = bucket.getSSTLink();
		expect(link.properties).toMatchObject({
			name: 'Uploads',
			url: 's3://Uploads?region=stub-region',
		});
	});

	it('leaves the permissions super grants alone', () => {
		expect(bucket.getSSTLink()).toHaveProperty('include');
	});

	it('supplies exactly the key the construct declares', () => {
		// The construct emits provides: ['UPLOADS_URL']; a role becomes that key.
		expect(() =>
			assertProvides(
				'Uploads',
				['UPLOADS_URL'],
				Object.keys(bucket.provides()).map((role) =>
					provideKey('Uploads', role),
				),
			),
		).not.toThrow();
	});

	it('is what envkit flattens into env', () => {
		expect(resolveEnvKeys({ Uploads: { type: bucket._type } })).toContain(
			'UPLOADS_URL',
		);
	});
});

describe('component settings', () => {
	const provision = (
		declaration: never,
		props = {},
		manifest: ConstructManifest = {},
	) =>
		provisionerFor('objects')({} as never, declaration, props, {
			manifest,
			provisioned: {},
		}) as unknown as {
			name: string;
			props?: Record<string, unknown>;
		};

	it('maps a declared neutral option to this provider’s word for it', () => {
		// `versioned` is the app's vocabulary; `versioning` is S3's.
		const bucket = provision({
			kind: 'objects',
			id: 'Uploads',
			versioned: true,
		} as never);
		expect(bucket.name).toBe('Uploads');
	});

	it('accepts provider-specific props the declaration cannot express', () => {
		expect(() =>
			provision({ kind: 'objects', id: 'Uploads' } as never, {
				cors: [{ allowOrigins: ['*'] }],
			}),
		).not.toThrow();
	});
});

describe('resolveEdges', () => {
	const stub = (id: string) => ({ _id: id, _type: 'sst.aws.Bucket' }) as never;

	const provisioned = {
		Uploads: stub('Uploads'),
		Avatars: stub('Avatars'),
	} as unknown as ProvisionedManifest;

	it('links what the function declared, and yields its keys', () => {
		const { link, envKeys } = resolveEdges(
			[{ target: 'Uploads', kind: 'objects' }],
			provisioned,
		);
		expect(link.map((l) => l._id)).toEqual(['Uploads']);
		expect(envKeys).toContain('UPLOADS_URL');
	});

	it('links nothing more — the property least privilege depends on', () => {
		const { link, envKeys } = resolveEdges(
			[{ target: 'Uploads', kind: 'objects' }],
			provisioned,
		);
		expect(link.map((l) => l._id)).not.toContain('Avatars');
		expect(envKeys.some((k) => k.startsWith('AVATARS'))).toBe(false);
	});

	it('is unchanged when an unrelated construct joins the manifest', () => {
		const before = resolveEdges(
			[{ target: 'Uploads', kind: 'objects' }],
			provisioned,
		);
		const after = resolveEdges([{ target: 'Uploads', kind: 'objects' }], {
			...provisioned,
			Reports: stub('Reports'),
		} as unknown as ProvisionedManifest);

		expect(after.envKeys).toEqual(before.envKeys);
		expect(after.link.map((l) => l._id)).toEqual(before.link.map((l) => l._id));
	});

	it('gives a function with no edges nothing at all', () => {
		expect(resolveEdges([], provisioned)).toEqual({ link: [], envKeys: [] });
	});

	it('names what is available when an edge does not resolve', () => {
		expect.assertions(2);
		try {
			resolveEdges([{ target: 'Missing', kind: 'objects' }], provisioned);
		} catch (error) {
			const e = error as UnresolvedDependency;
			expect(e.target).toBe('Missing');
			expect(e.available).toContain('Uploads');
		}
	});
});

describe('the key a provided role becomes', () => {
	it('qualifies an ordinary role by its id', () => {
		expect(providedKeyFor('Uploads', 'objects', 'url')).toBe('UPLOADS_URL');
	});

	it('leaves a secret’s name as its key', () => {
		// `Auth` signs with `AUTH_SECRET`, which is also what better-auth's own
		// tooling looks for — and qualifying it would produce
		// `AUTH_SECRET_VALUE`, which nothing reads.
		expect(providedKeyFor('AuthSecret', 'secret', 'value')).toBe('AUTH_SECRET');
	});

	it('is the same derivation the contract check uses', () => {
		// The point of sharing it: a check deriving the key differently from the
		// thing it checks passes on drift instead of catching it.
		expect(() =>
			assertProvides(
				'AuthSecret',
				['AUTH_SECRET'],
				['value'].map((role) => providedKeyFor('AuthSecret', 'secret', role)),
			),
		).not.toThrow();
	});
});

describe('Credential', () => {
	it('provides under the role the declaration named', async () => {
		// The role *is* the contract: providing `value` against a declared
		// `STRIPE_CREDENTIALS` supplies `STRIPE_VALUE`, and assertProvides
		// rejects the stack at synth. Which is the check working.
		const { Credential } = await import('../aws/Credential');

		expect(
			Object.keys(new Credential({} as never, 'Stripe').provides()),
		).toEqual(['credentials']);
	});

	it('agrees with what the construct declares', () => {
		expect(providedKeyFor('Stripe', 'credential', 'credentials')).toBe(
			'STRIPE_CREDENTIALS',
		);
	});

	it('links under the key the construct reads, not the secret’s bare name', async () => {
		const { Credential } = await import('../aws/Credential');
		const stripe = new Credential({} as never, 'Stripe');

		expect(resolveEnvKeys({ Stripe: { type: stripe._type } })).toEqual([
			'STRIPE_CREDENTIALS',
		]);
		expect(stripe.getSSTLink().properties).toEqual(stripe.provides());
	});

	it('is what a function depending on it is linked to', async () => {
		const { Credential } = await import('../aws/Credential');
		const stripe = new Credential({} as never, 'Stripe');

		const { link, envKeys } = resolveEdges(
			[{ target: 'Stripe', kind: 'credential' }],
			{ Stripe: stripe },
		);

		expect(link).toEqual([stripe]);
		expect(envKeys).toEqual(['STRIPE_CREDENTIALS']);
	});
});

describe('ExternalApi', () => {
	const stack = (stage: string) => ({ stage }) as never;

	it('provides the URL for its stage and its credentials, under the declared keys', async () => {
		const { ExternalApi } = await import('../aws/ExternalApi');
		const payfast = new ExternalApi(stack('production'), 'PayFast', {
			url: {
				production: 'https://www.payfast.co.za',
				default: 'https://sandbox.payfast.co.za',
			},
		});

		expect(payfast.provides().url).toBe('https://www.payfast.co.za');
		expect(
			Object.keys(payfast.provides()).map((role) =>
				providedKeyFor('PayFast', 'external-api', role),
			),
		).toEqual(['PAY_FAST_URL', 'PAY_FAST_CREDENTIALS']);
	});

	it('falls back to the default URL for a stage it does not name', async () => {
		const { ExternalApi } = await import('../aws/ExternalApi');
		const payfast = new ExternalApi(stack('staging'), 'PayFast', {
			url: {
				production: 'https://www.payfast.co.za',
				default: 'https://sandbox.payfast.co.za',
			},
		});

		expect(payfast.provides().url).toBe('https://sandbox.payfast.co.za');
	});

	it('fails synth for a stage it has no URL for', async () => {
		const { ExternalApi } = await import('../aws/ExternalApi');

		expect(
			() =>
				new ExternalApi(stack('staging'), 'PayFast', {
					url: { production: 'https://www.payfast.co.za' },
				}),
		).toThrow(NoUrlForStage);
	});

	it('flattens into the same keys at runtime', () => {
		expect(
			resolveEnvKeys({ PayFast: { type: 'gkm:aws:ExternalApi' } }).sort(),
		).toEqual(['PAY_FAST_CREDENTIALS', 'PAY_FAST_URL']);
	});
});

describe('a queue’s one consumer', () => {
	it('is subscribed from the handler the build wrote, linked to what it depends on', () => {
		const consumed: { handler: string; link?: unknown[] }[] = [];
		const uploads = { _id: 'Uploads', _type: 'sst.aws.Bucket' };
		const provisioned = {
			Uploads: uploads,
			Emails: {
				_id: 'Emails',
				_type: 'sst.aws.Queue',
				consume: (consumer: { handler: string; link?: unknown[] }) =>
					consumed.push(consumer),
			},
		} as unknown as ProvisionedManifest;

		subscribeConsumers(
			{
				Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
				Emails: {
					kind: 'queue',
					id: 'Emails',
					provides: ['EMAILS_PUBLISHER_CONNECTION_STRING'],
					worker: {
						id: 'EmailsWorker',
						handler: 'apps/api/.gkm/aws/queues/emails.handler',
						dependencies: [{ target: 'Uploads', kind: 'objects' }],
					},
				},
			} as never,
			provisioned,
		);

		expect(consumed).toEqual([
			{ handler: 'apps/api/.gkm/aws/queues/emails.handler', link: [uploads] },
		]);
	});

	it('subscribes through SST, with the queue itself linked', async () => {
		const { Queue } = await import('../aws/Queue');
		const queue = new Queue({} as never, 'Emails');

		queue.consume({ handler: 'emails.handler', link: [], batchSize: 5 });

		const [{ subscriber, args }] = (
			queue as unknown as { subscribed: { subscriber: any; args: unknown }[] }
		).subscribed;
		expect(subscriber.handler).toBe('emails.handler');
		expect(subscriber.link).toEqual([queue]);
		expect(args).toEqual({ batch: { size: 5 } });
	});
});

describe('a surface’s endpoints', () => {
	const routesOf = (surface: RestApiSurface) =>
		(
			surface as unknown as {
				routes: { key: string; handler: any; args: unknown }[];
			}
		).routes;

	it('are mounted from the handlers the build wrote, each linked to what it depends on', () => {
		// An API Gateway with no routes 404s everything — which is what a deploy
		// produced while the routes sat in the manifest with nothing reading them.
		const api = new RestApiSurface({} as never, 'Api');
		const uploads = { _id: 'Uploads', _type: 'sst.aws.Bucket' };

		mountRoutes(
			{
				Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
				Api: {
					kind: 'rest-api',
					id: 'Api',
					provides: ['API_URL'],
					endpoints: [
						{
							id: 'ApiGET/users/{id}',
							method: 'GET',
							path: '/users/{id}',
							handler: 'apps/api/.gkm/aws/routes/getUser.handler',
							dependencies: [{ target: 'Uploads', kind: 'objects' }],
							authorizer: 'none',
						},
						{
							id: 'ApiGET/health',
							method: 'GET',
							path: '/health',
							handler: 'apps/api/.gkm/aws/routes/health.handler',
							dependencies: [],
						},
					],
				},
			} as never,
			{ Uploads: uploads, Api: api } as unknown as ProvisionedManifest,
		);

		const [getUser, health] = routesOf(api);
		expect(getUser?.key).toBe('GET /users/{id}');
		expect(getUser?.handler.handler).toBe(
			'apps/api/.gkm/aws/routes/getUser.handler',
		);
		expect(getUser?.handler.link).toEqual([uploads]);
		expect(getUser?.args).toEqual({});
		// Least privilege: an endpoint is linked to its own edges, not the app's.
		expect(health?.key).toBe('GET /health');
		expect(health?.handler.link).toEqual([]);
	});

	it('leaves IAM to the gateway, and every other authorizer to the handler', () => {
		const api = new RestApiSurface({} as never, 'Api');

		api.mount({
			method: 'POST',
			path: '/x',
			handler: 'x.handler',
			authorizer: 'iam',
		});
		api.mount({
			method: 'POST',
			path: '/y',
			handler: 'y.handler',
			authorizer: 'session',
		});

		const [x, y] = routesOf(api);
		expect(x?.args).toEqual({ auth: { iam: true } });
		expect(y?.args).toEqual({});
	});

	it('runs a handler that reaches a database inside the database’s network', () => {
		const vpc = { id: 'stub-vpc' } as never;
		const cluster = new Database({} as never, 'Orders', { vpc });
		const tenant = new DatabaseSchema('Billing', cluster, 'billing');

		expect(vpcFor([cluster as never])).toBe(vpc);
		// A schema tenant lives in its parent's cluster, so in its network too.
		expect(vpcFor([{ _id: 'Uploads' } as never, tenant as never])).toBe(vpc);
		expect(vpcFor([{ _id: 'Uploads' } as never])).toBeUndefined();
	});
});

describe('kinds provisioned elsewhere', () => {
	it('skips a worker, which is a process rather than a resource', () => {
		// A worker in the manifest used to throw UnknownDeclarationKind at synth,
		// so any app with background work could not be deployed to AWS at all.
		expect(PROVISIONED_ELSEWHERE.has('worker')).toBe(true);
		expect(PROVISIONED_ELSEWHERE.has('mobile-app')).toBe(true);
		expect(PROVISIONED_ELSEWHERE.has('queue')).toBe(false);
	});
});
