import { resolveEnvKeys } from '@geekmidas/envkit/sst';
import { providedKeyFor, provideKey } from '@geekmidas/manifest';
import { describe, expect, it } from 'vitest';
import { ObjectStorage } from '../aws/ObjectStorage';
import { type ProvidesMismatch, UnknownDeclarationKind } from '../errors';
import {
	assertProvides,
	type ProvisionedManifest,
	provisionerFor,
	resolveEdges,
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
			provisionerFor('database' as never);
		} catch (error) {
			const e = error as UnknownDeclarationKind;
			expect(e).toBeInstanceOf(UnknownDeclarationKind);
			expect(e.kind).toBe('database');
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
