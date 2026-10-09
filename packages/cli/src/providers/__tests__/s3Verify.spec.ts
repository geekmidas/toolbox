import type { ConstructManifest } from '@geekmidas/manifest';
import * as s3Url from '@geekmidas/storage/s3-url';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import type { ResourceRecord } from '../../deploy/StateStore';
import type { NormalizedWorkspace } from '../../workspace/types';
import { useNewKeyWaits } from '../iam';
import {
	BucketRegionMismatch,
	ProvisionedBucketUnreachable,
} from '../s3/errors';
import { s3Provider } from '../s3/index';

/**
 * The deploy's check of a provisioned bucket, against S3 answering exactly
 * what the real one answers a `HEAD` with: a status and headers, no body.
 * SDK v3 names every such failure but a 404 `Unknown`, so the reason has to
 * come from the status and the headers.
 */

const ENDPOINT = 'http://s3.test';
const BUCKET = 'app-prod-uploads';
const KEY_ID = 'AKIAEXAMPLEKEY';
const STAGE = 'prod';
const REQUEST_ID = 'R3QU35T1D';
const ID2 = 'ext/id+2=';

const manifest = {
	Uploads: { kind: 'objects', id: 'Uploads', provides: ['UPLOADS_URL'] },
} as unknown as ConstructManifest;

const server = setupServer();
let heads = 0;

/** Every `HEAD /<bucket>` answers the next of `answers`, the last one after. */
function answering(...answers: { status: number; region?: string }[]) {
	server.use(
		http.head(`${ENDPOINT}/${BUCKET}`, () => {
			const answer = answers[Math.min(heads, answers.length - 1)]!;
			heads += 1;
			return new HttpResponse(null, {
				status: answer.status,
				headers: {
					'x-amz-request-id': REQUEST_ID,
					'x-amz-id-2': ID2,
					...(answer.region ? { 'x-amz-bucket-region': answer.region } : {}),
				},
			});
		}),
	);
}

function urlIn(region?: string): string {
	return s3Url.build({
		bucket: BUCKET,
		...(region ? { region } : {}),
		endpoint: ENDPOINT,
		forcePathStyle: true,
		accessKeyId: KEY_ID,
		secretAccessKey: 'wJal/rXUtnFEMI+K7MDENG/bPxRfi+CYEXAMPLE=',
	});
}

const lines: string[] = [];

function verify(
	options: { url?: string; resources?: Record<string, ResourceRecord> } = {},
) {
	return s3Provider.verify({
		workspace: {} as NormalizedWorkspace,
		manifest,
		stage: STAGE,
		config: { provider: 's3' },
		secrets: { UPLOADS_URL: options.url ?? urlIn('eu-west-1') },
		...(options.resources ? { resources: options.resources } : {}),
		log: (line) => lines.push(line),
	});
}

/** The stage's record of a key issued `ago` milliseconds back. */
function issued(ago: number): Record<string, ResourceRecord> {
	return {
		'iam-access-key:Uploads': {
			key: 'iam-access-key:Uploads',
			type: 'iam-access-key',
			id: KEY_ID,
			status: 'ready',
			data: {
				user: 'gkm-app-prod-uploads',
				issuedAt: new Date(Date.now() - ago).toISOString(),
			},
			updatedAt: new Date().toISOString(),
		},
	};
}

async function failure(run: Promise<unknown>): Promise<Error> {
	const error = await run.then(
		() => undefined,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(Error);
	return error as Error;
}

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
	heads = 0;
	lines.length = 0;
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('verify: a bucket in another region than its URL says', () => {
	it('names both regions on a 301', async () => {
		answering({ status: 301, region: 'us-east-1' });

		const error = await failure(verify());

		expect(error).toBeInstanceOf(BucketRegionMismatch);
		const mismatch = error as BucketRegionMismatch;
		expect(mismatch.bucketRegion).toBe('us-east-1');
		expect(mismatch.urlRegion).toBe('eu-west-1');
		expect(mismatch.message).toContain(
			`The bucket '${BUCKET}' (Uploads) is in us-east-1, but UPLOADS_URL in the stage 'prod''s secrets says eu-west-1 (HTTP 301`,
		);
		expect(mismatch.message).toContain(`x-amz-request-id: ${REQUEST_ID}`);
		expect(mismatch.message).toContain(
			"Set deploy.objects.prod.region to 'us-east-1'",
		);
	});

	it('names both regions on a 400 that says where the bucket is', async () => {
		answering({ status: 400, region: 'us-east-1' });

		const error = await failure(verify());

		expect(error).toBeInstanceOf(BucketRegionMismatch);
		expect((error as BucketRegionMismatch).bucketRegion).toBe('us-east-1');
		expect((error as BucketRegionMismatch).urlRegion).toBe('eu-west-1');
		expect(error.message).toContain('(HTTP 400');
	});

	it('says what was asked when the URL names no region', async () => {
		answering({ status: 301, region: 'eu-west-2' });

		const error = await failure(verify({ url: urlIn() }));

		expect(error).toBeInstanceOf(BucketRegionMismatch);
		expect((error as BucketRegionMismatch).urlRegion).toBeUndefined();
		expect(error.message).toContain(
			"is in eu-west-2, but UPLOADS_URL in the stage 'prod''s secrets names no region, so us-east-1 was asked",
		);
	});
});

describe('verify: every other failure says what S3 answered', () => {
	it('a 403 is the key refused, with the status and request ids', async () => {
		answering({ status: 403, region: 'eu-west-1' });

		const error = await failure(verify());

		expect(error).toBeInstanceOf(ProvisionedBucketUnreachable);
		expect(error.message).toContain(
			'the key is refused — AccessDenied, or an invalid or not-yet-active key (HTTP 403',
		);
		expect(error.message).toContain('x-amz-bucket-region: eu-west-1');
		expect(error.message).toContain(`x-amz-id-2: ${ID2}`);
		expect(error.message).not.toContain(': Unknown.');
	});

	it('a 404 is a bucket that does not exist', async () => {
		answering({ status: 404 });

		const error = await failure(verify());

		expect(error).toBeInstanceOf(ProvisionedBucketUnreachable);
		expect(error.message).toContain('it does not exist (HTTP 404 NotFound');
	});

	it('any other status is named by its code', async () => {
		answering({ status: 409 });

		const error = await failure(verify());

		expect(error).toBeInstanceOf(ProvisionedBucketUnreachable);
		expect(error.message).toMatch(
			/cannot be reached with the key in the stage 'prod''s secrets: HTTP 409 Unknown/,
		);
		expect(error.message).toContain(`x-amz-request-id: ${REQUEST_ID}`);
	});
});

describe('verify: a key this deploy just issued', () => {
	let previous: readonly number[];
	beforeAll(() => {
		previous = useNewKeyWaits([5, 5, 5]);
	});
	afterAll(() => {
		useNewKeyWaits(previous);
	});

	it('waits for it to become active, and passes once it is', async () => {
		answering({ status: 403 }, { status: 403 }, { status: 200 });

		await verify({ resources: issued(1000) });

		expect(heads).toBe(3);
		expect(lines).toEqual([
			`   Uploads: waiting for the new key ${KEY_ID} to become active…`,
		]);
	});

	it('says it was new when it is still refused after the wait', async () => {
		answering({ status: 403 });

		const error = await failure(verify({ resources: issued(1000) }));

		expect(heads).toBe(4);
		expect(error).toBeInstanceOf(ProvisionedBucketUnreachable);
		expect(error.message).toMatch(
			/\(HTTP 403 [^)]*\)\. The key was issued at \S+ by this deploy, and IAM keys take seconds to become usable: it was still refused after waiting 0s/,
		);
	});

	it('does not wait for a key issued long ago', async () => {
		answering({ status: 403 });

		const error = await failure(verify({ resources: issued(60 * 60 * 1000) }));

		expect(heads).toBe(1);
		expect(lines).toEqual([]);
		expect(error.message).not.toContain('issued at');
	});
});
