import { describe, expect, it } from 'vitest';
import { type ProvidesMismatch, UnknownDeclarationKind } from '../errors';
import { assertProvides, provisionerFor } from '../fromManifest';
import { ObjectStorage } from '../ObjectStorage';

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
