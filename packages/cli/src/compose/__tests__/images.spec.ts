import { describe, expect, it } from 'vitest';
import {
	type ImageLookup,
	isLoopbackRegistry,
	isMissingManifest,
	pushedDigest,
} from '../docker';
import {
	assertImagesExist,
	ImageDigestsInvalid,
	ImageTagNotFound,
	parseDigests,
	pinnedRef,
	RegistryUnreachable,
	siteTag,
} from '../images';

/** A registry that holds exactly `present`, or does not answer at all. */
function registry(
	present: readonly string[],
	options: { unreachable?: string } = {},
) {
	const asked: string[] = [];
	return {
		asked,
		async lookup(ref: string): Promise<ImageLookup> {
			asked.push(ref);
			if (options.unreachable) {
				return { ref, status: 'unreachable', detail: options.unreachable };
			}
			return present.includes(ref)
				? { ref, status: 'found' }
				: { ref, status: 'missing' };
		},
	};
}

const images = [
	{ app: 'api', ref: 'ghcr.io/acme/shop/shop-api:v1.4.0', tag: 'v1.4.0' },
	{ app: 'auth', ref: 'ghcr.io/acme/shop/shop-auth:v1.4.0', tag: 'v1.4.0' },
	{
		app: 'web',
		ref: 'ghcr.io/acme/shop/shop-web:v1.4.0-production',
		tag: 'v1.4.0-production',
	},
];

describe('assertImagesExist', () => {
	it('passes when the registry has every image', async () => {
		const docker = registry(images.map((image) => image.ref));

		await expect(
			assertImagesExist(docker, 'v1.4.0', images),
		).resolves.toBeUndefined();
		expect(docker.asked).toEqual(images.map((image) => image.ref));
	});

	it('names every missing image at once, not the first', async () => {
		const docker = registry([images[0]!.ref]);

		const error = await assertImagesExist(docker, 'v1.4.0', images).catch(
			(e: unknown) => e,
		);

		expect(error).toBeInstanceOf(ImageTagNotFound);
		expect((error as ImageTagNotFound).refs).toEqual([
			images[1]!.ref,
			images[2]!.ref,
		]);
		expect((error as Error).message).toContain(images[1]!.ref);
		expect((error as Error).message).toContain(images[2]!.ref);
		expect((error as Error).message).toMatch(/run without --tag/);
	});

	it('does not mistake a registry that refused this machine for a missing tag', async () => {
		const docker = registry([], {
			unreachable: 'unauthorized: authentication required',
		});

		await expect(
			assertImagesExist(docker, 'v1.4.0', images),
		).rejects.toBeInstanceOf(RegistryUnreachable);
	});
});

describe('isMissingManifest', () => {
	it.each([
		'no such manifest: ghcr.io/acme/shop/shop-api:v9',
		'manifest unknown: manifest unknown',
		'Error response from daemon: manifest for acme/shop-api:v9 not found: manifest unknown',
	])('reads "%s" as a missing tag', (output) => {
		expect(isMissingManifest(output)).toBe(true);
	});

	it.each([
		'unauthorized: authentication required',
		'denied: requested access to the resource is denied',
		'dial tcp: lookup ghcr.example: no such host',
		'net/http: TLS handshake timeout',
	])('reads "%s" as the registry not answering', (output) => {
		expect(isMissingManifest(output)).toBe(false);
	});
});

describe('siteTag', () => {
	it('is the release tag and the stage, since a site is built per stage', () => {
		expect(siteTag('v1.4.0', 'production')).toBe('v1.4.0-production');
	});
});

const DIGEST = `sha256:${'ab'.repeat(32)}`;

describe('a push', () => {
	it("reads the digest the registry stored from docker push's last line", () => {
		const output = [
			'The push refers to repository [localhost:5000/acme/shop-api]',
			'5f70bf18a086: Pushed',
			`v2: digest: ${DIGEST} size: 1784`,
		].join('\n');

		expect(pushedDigest(output)).toBe(DIGEST);
		expect(pushedDigest('5f70bf18a086: Pushed')).toBeUndefined();
	});

	it('pins an image by its ref and digest, whatever the ref already had', () => {
		expect(pinnedRef('r.example.com/acme/shop-api:v2', DIGEST)).toBe(
			`r.example.com/acme/shop-api:v2@${DIGEST}`,
		);
		expect(
			pinnedRef(
				`r.example.com/acme/shop-api:v2@sha256:${'0'.repeat(64)}`,
				DIGEST,
			),
		).toBe(`r.example.com/acme/shop-api:v2@${DIGEST}`);
	});
});

describe('a digests file', () => {
	it('is a JSON object of app to <ref>@sha256:…', () => {
		const content = JSON.stringify({ api: `r/acme/shop-api:v2@${DIGEST}` });
		expect(parseDigests('d.json', content)).toEqual({
			api: `r/acme/shop-api:v2@${DIGEST}`,
		});
	});

	it('refuses anything else, naming the file', () => {
		for (const content of [
			'not json',
			'[]',
			JSON.stringify({ api: 'r/acme/shop-api:v2' }),
		]) {
			expect(() => parseDigests('d.json', content)).toThrow(
				ImageDigestsInvalid,
			);
		}
	});
});

describe('a registry on loopback', () => {
	it('is asked over plain HTTP, as the daemon pushes to it — and no other is', () => {
		expect(isLoopbackRegistry('localhost:5000/acme/shop-api:v2')).toBe(true);
		expect(isLoopbackRegistry('127.0.0.1:5000/acme/shop-api:v2')).toBe(true);
		expect(isLoopbackRegistry('localhost/acme/shop-api:v2')).toBe(true);
		expect(isLoopbackRegistry('ghcr.io/acme/shop-api:v2')).toBe(false);
		expect(isLoopbackRegistry('localhost.evil.example/a/b:v2')).toBe(false);
		// A Docker Hub name whose first segment is `localhost`-ish is not one.
		expect(isLoopbackRegistry('acme/shop-api:v2')).toBe(false);
	});
});
