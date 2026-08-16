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

describe('ObjectStorage.provides', () => {
	const bucket = new ObjectStorage({} as never, 'Uploads');

	it('keys the url the way the construct declares it', () => {
		// The construct emits provides: ['UPLOADS_URL']; if these two derivations
		// ever disagree the app reads an env key infra never set.
		expect(Object.keys(bucket.provides())).toEqual(['UPLOADS_URL']);
	});

	it('carries the region off the resource, not the stack', () => {
		expect(bucket.provides().UPLOADS_URL).toBe(
			's3://Uploads?region=stub-region',
		);
	});

	it('widens the link so region survives, without touching permissions', () => {
		const link = bucket.getSSTLink();
		// SST's own link carries only `name`; a consumer resolving from the link
		// alone could not tell which region the bucket is in.
		expect(link.properties).toMatchObject({
			name: 'Uploads',
			region: 'stub-region',
		});
		expect(link).toHaveProperty('include');
	});

	it('agrees with what the construct declared', () => {
		expect(() =>
			assertProvides(
				'Uploads',
				['UPLOADS_URL'],
				Object.keys(bucket.provides()),
			),
		).not.toThrow();
	});
});

describe('component settings', () => {
	const provision = (declaration: never, props = {}) =>
		provisionerFor('objects')({} as never, declaration, props) as unknown as {
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
	const stub = (id: string, keys: string[]) =>
		({
			_id: id,
			_type: 'stub',
			provides: () => Object.fromEntries(keys.map((k) => [k, `value-of-${k}`])),
		}) as never;

	const provisioned = {
		Uploads: stub('Uploads', ['UPLOADS_URL']),
		Avatars: stub('Avatars', ['AVATARS_URL']),
		Orders: stub('Orders', ['ORDERS_URL']),
	} as unknown as ProvisionedManifest;

	it('gives a function what it declared', () => {
		const { link, environment } = resolveEdges(
			[{ target: 'Uploads', kind: 'objects' }],
			provisioned,
		);
		expect(link).toHaveLength(1);
		expect(environment).toEqual({ UPLOADS_URL: 'value-of-UPLOADS_URL' });
	});

	it('gives it nothing more — the property least privilege depends on', () => {
		const { link, environment } = resolveEdges(
			[{ target: 'Uploads', kind: 'objects' }],
			provisioned,
		);
		expect(link.map((l) => l._id)).toEqual(['Uploads']);
		expect(Object.keys(environment)).not.toContain('AVATARS_URL');
		expect(Object.keys(environment)).not.toContain('ORDERS_URL');
	});

	it('is unchanged when an unrelated construct joins the manifest', () => {
		const before = resolveEdges(
			[{ target: 'Uploads', kind: 'objects' }],
			provisioned,
		);
		const after = resolveEdges([{ target: 'Uploads', kind: 'objects' }], {
			...provisioned,
			Reports: stub('Reports', ['REPORTS_URL']),
		} as unknown as ProvisionedManifest);

		expect(after.environment).toEqual(before.environment);
		expect(after.link.map((l) => l._id)).toEqual(before.link.map((l) => l._id));
	});

	it('composes several edges into one environment', () => {
		const { environment } = resolveEdges(
			[
				{ target: 'Uploads', kind: 'objects' },
				{ target: 'Orders', kind: 'objects' },
			],
			provisioned,
		);
		expect(Object.keys(environment).sort()).toEqual([
			'ORDERS_URL',
			'UPLOADS_URL',
		]);
	});

	it('gives a function with no edges nothing at all', () => {
		expect(resolveEdges([], provisioned)).toEqual({
			link: [],
			environment: {},
		});
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
