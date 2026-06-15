import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { type Queue, QueueBuilder } from '@geekmidas/constructs/queue';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	cleanupDir,
	createMockBuildContext,
	createTempDir,
} from '../../__tests__/test-helpers';
import type { GeneratedConstruct } from '../Generator';
import { QueueGenerator } from '../QueueGenerator';

const schema = z.object({ orderId: z.string() });

describe('QueueGenerator', () => {
	let tempDir: string;
	let outputDir: string;
	let generator: QueueGenerator;
	let context: ReturnType<typeof createMockBuildContext>;

	beforeEach(async () => {
		tempDir = await createTempDir();
		outputDir = join(tempDir, 'output');
		generator = new QueueGenerator();
		context = createMockBuildContext();
	});

	afterEach(async () => {
		await cleanupDir(tempDir);
	});

	const createQueueConstruct = (
		key: string,
		name: string,
	): GeneratedConstruct<Queue<any, any, any, any>> => {
		const queue = new QueueBuilder()
			.queue(name)
			.batchSize(5)
			.message(schema)
			.handle(async () => {});

		return {
			key,
			name: key.toLowerCase(),
			construct: queue,
			path: {
				absolute: join(tempDir, `${key}.ts`),
				relative: `${key}.ts`,
			},
		};
	};

	describe('isConstruct', () => {
		it('identifies queues and rejects everything else', () => {
			const queue = new QueueBuilder()
				.queue('orders')
				.message(schema)
				.handle(async () => {});

			expect(generator.isConstruct(queue)).toBe(true);
			expect(generator.isConstruct({})).toBe(false);
			expect(generator.isConstruct(null)).toBe(false);
		});
	});

	describe('aws-lambda provider', () => {
		it('generates one AWSLambdaQueue handler per queue', async () => {
			const constructs = [
				createQueueConstruct('ordersQueue', 'orders'),
				createQueueConstruct('emailsQueue', 'emails'),
			];

			const infos = await generator.build(context, constructs, outputDir, {
				provider: 'aws-lambda',
			});

			expect(infos).toHaveLength(2);
			expect(infos[0]).toMatchObject({
				name: 'orders',
				handler: expect.stringContaining('queues/ordersQueue.handler'),
				batchSize: 5,
			});
			// Env requirement from the (sniffed) producer flows nowhere here, but the
			// consumer queue's own services would; assert the field exists.
			expect(infos[0].environment).toBeDefined();

			const handler = await readFile(
				join(outputDir, 'queues', 'ordersQueue.ts'),
				'utf-8',
			);
			expect(handler).toContain(
				"import { AWSLambdaQueue } from '@geekmidas/constructs/aws'",
			);
			expect(handler).toContain('import { ordersQueue }');
			expect(handler).toContain('new AWSLambdaQueue(envParser, ordersQueue)');
			expect(handler).toContain('export const handler = adapter.handler');
		});

		it('returns an empty array for no queues', async () => {
			const infos = await generator.build(context, [], outputDir, {
				provider: 'aws-lambda',
			});
			expect(infos).toEqual([]);
		});
	});

	describe('server provider', () => {
		it('generates queues.ts with the setupQueues poller even when empty', async () => {
			const infos = await generator.build(context, [], outputDir, {
				provider: 'server',
			});

			expect(infos).toEqual([]);

			const content = await readFile(join(outputDir, 'queues.ts'), 'utf-8');
			expect(content).toContain('export async function setupQueues');
			expect(content).toContain('const queues = [');
			expect(content).toContain('EVENT_SUBSCRIBER_CONNECTION_STRING');
		});

		it('subscribes each queue by its name and validates the payload', async () => {
			const constructs = [
				createQueueConstruct('ordersQueue', 'orders'),
				createQueueConstruct('emailsQueue', 'emails'),
			];

			await generator.build(context, constructs, outputDir, {
				provider: 'server',
			});

			const content = await readFile(join(outputDir, 'queues.ts'), 'utf-8');
			expect(content).toContain('import { ordersQueue }');
			expect(content).toContain('import { emailsQueue }');
			// A queue subscribes to a single "type" — its own name.
			expect(content).toContain('eventSubscriber.subscribe([queue.name]');
			expect(content).toContain("queue.messageSchema['~standard'].validate");
			expect(content).toContain('messages: [validation.value]');
		});
	});
});
