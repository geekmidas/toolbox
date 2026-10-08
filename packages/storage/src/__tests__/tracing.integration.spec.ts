import { context, propagation, SpanKind, trace } from '@opentelemetry/api';
import {
	InMemorySpanExporter,
	NodeTracerProvider,
	SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-node';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MINIO_URL } from '../../../testkit/test/ports';
import { AmazonStorageClient } from '../AmazonStorageClient';

/**
 * Storage spans against the test MinIO: presigning and putting an object, and
 * nothing without a provider.
 */

const client = AmazonStorageClient.create({
	bucket: 'geekmidas',
	region: 'us-east-1',
	accessKeyId: 'geekmidas',
	secretAccessKey: 'geekmidas',
	endpoint: MINIO_URL,
	forcePathStyle: true,
});
const KEY = `traced/${Math.random().toString(36).slice(2)}.txt`;

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
	spanProcessors: [new SimpleSpanProcessor(exporter)],
});

afterAll(async () => {
	await client.delete(KEY);
	await provider.shutdown();
	trace.disable();
	context.disable();
	propagation.disable();
});

it('records nothing without a provider', async () => {
	await client.upload(KEY, Buffer.from('hello'), 'text/plain');
	expect(exporter.getFinishedSpans()).toEqual([]);
});

describe('with a provider', () => {
	beforeAll(() => provider.register());
	beforeEach(() => exporter.reset());

	it('presign, put and delete each record a span with the bucket, never the key', async () => {
		const url = await client.getUploadURL({
			path: KEY,
			contentType: 'text/plain',
			contentLength: 5,
		});
		expect(url).toContain(MINIO_URL);
		await client.getDownloadURL({ path: KEY });
		await client.upload(KEY, Buffer.from('hello'), 'text/plain');
		await client.getUpload({
			path: KEY,
			contentType: 'text/plain',
			contentLength: 5,
		});

		const spans = exporter.getFinishedSpans();
		expect(
			spans.map((s) => [s.name, s.attributes['storage.presign.method']]),
		).toEqual([
			['storage.presign', 'PUT'],
			['storage.presign', 'GET'],
			['storage.put', undefined],
			['storage.presign', 'POST'],
		]);
		for (const span of spans) {
			expect(span.kind).toBe(SpanKind.CLIENT);
			expect(span.attributes).toMatchObject({
				'storage.system': 's3',
				'storage.bucket': 'geekmidas',
			});
			expect(JSON.stringify(span.attributes)).not.toContain(KEY);
		}
		expect(spans[2]!.attributes['storage.object.size']).toBe(5);
	});
});
