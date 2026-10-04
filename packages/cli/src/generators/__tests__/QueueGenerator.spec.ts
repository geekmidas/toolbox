import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KyselyDatabase } from '@geekmidas/constructs/database/kysely';
import type { Queue } from '@geekmidas/constructs/queue';
import { Worker } from '@geekmidas/constructs/worker';
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
const orders = new KyselyDatabase('Orders');

/** A queue built from a worker whose database is the default for it. */
const withDatabase = (
	key: string,
): GeneratedConstruct<Queue<any, any, any, any, any, any>> => ({
	key,
	name: key.toLowerCase(),
	construct: new Worker('Jobs')
		.database(orders)
		.queue('orders')
		.message(schema)
		.handle(async () => {}),
	path: { absolute: `/tmp/${key}.ts`, relative: `${key}.ts` },
});

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
		const queue = new Worker('Jobs')
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
			const queue = new Worker('Jobs')
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
				target: 'aws',
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

		it('carries the worker’s database as the queue’s env and edge', async () => {
			const [info] = await generator.build(
				context,
				[withDatabase('ordersQueue')],
				outputDir,
				{ target: 'aws' },
			);

			// The Lambda runs the queue alone, so the database has to be in its
			// own environment and grant — the worker's are not deployed with it.
			expect(info?.environment).toContain('ORDERS_URL');
			expect(info?.dependencies).toEqual(['Orders']);
		});

		it('returns an empty array for no queues', async () => {
			const infos = await generator.build(context, [], outputDir, {
				target: 'aws',
			});
			expect(infos).toEqual([]);
		});
	});

	describe('server provider', () => {
		// The entry calls `setupQueues` whatever the app declares, and an app
		// with no Queue has no reason to install `@geekmidas/events`.
		it('generates a setupQueues that imports nothing at runtime when empty', async () => {
			const infos = await generator.build(context, [], outputDir, {
				target: 'server',
			});

			expect(infos).toEqual([]);

			const content = await readFile(join(outputDir, 'queues.ts'), 'utf-8');
			expect(content).toContain('export async function setupQueues');
			expect(content).not.toContain('@geekmidas/events');
			expect(content).not.toMatch(/^import (?!type )/m);
		});

		it('subscribes each queue by its name and validates the payload', async () => {
			const constructs = [
				createQueueConstruct('ordersQueue', 'orders'),
				createQueueConstruct('emailsQueue', 'emails'),
			];

			await generator.build(context, constructs, outputDir, {
				target: 'server',
			});

			const content = await readFile(join(outputDir, 'queues.ts'), 'utf-8');
			expect(content).toContain('import { ordersQueue }');
			expect(content).toContain('import { emailsQueue }');
			// A queue subscribes to a single "type" — its own name.
			expect(content).toContain('eventSubscriber.subscribe([queue.name]');
			expect(content).toContain("queue.messageSchema['~standard'].validate");
			expect(content).toContain('messages: [validation.value]');
		});

		it('registers each queue’s database and hands it to the handler as db', async () => {
			await generator.build(context, [withDatabase('ordersQueue')], outputDir, {
				target: 'server',
			});

			const content = await readFile(join(outputDir, 'queues.ts'), 'utf-8');
			expect(content).toContain(
				'await serviceDiscovery.register([queue.databaseService])',
			);
			expect(content).toMatch(/logger: queue\.logger,\s+db,/);
		});
	});
});
