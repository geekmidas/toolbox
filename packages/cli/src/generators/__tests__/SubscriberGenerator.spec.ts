import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  type Subscriber,
  SubscriberBuilder,
} from '@geekmidas/constructs/subscribers';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanupDir,
  createMockBuildContext,
  createTempDir,
} from '../../__tests__/test-helpers';
import type { GeneratedConstruct } from '../Generator';
import { SubscriberGenerator } from '../SubscriberGenerator';

describe('SubscriberGenerator', () => {
  let tempDir: string;
  let outputDir: string;
  let generator: SubscriberGenerator;
  let context: ReturnType<typeof createMockBuildContext>;

  beforeEach(async () => {
    tempDir = await createTempDir();
    outputDir = join(tempDir, 'output');
    generator = new SubscriberGenerator();
    context = createMockBuildContext();
  });

  afterEach(async () => {
    await cleanupDir(tempDir);
  });

  describe('isConstruct', () => {
    it('should identify valid subscribers', async () => {
      const testSubscriber = new SubscriberBuilder()
        .subscribe(['user.created'] as any)
        .handle(async ({ events, logger }) => {
          logger.info({ eventCount: events.length }, 'Processing events');
        });

      expect(generator.isConstruct(testSubscriber)).toBe(true);
    });

    it('should reject invalid constructs', () => {
      expect(generator.isConstruct({})).toBe(false);
      expect(generator.isConstruct('string')).toBe(false);
      expect(generator.isConstruct(null)).toBe(false);
    });
  });

  describe('build', () => {
    const createSubscriberConstruct = (
      key: string,
      subscribedEvents: string[],
      timeout: number = 30000,
    ): GeneratedConstruct<Subscriber<any, any, any, any, any, any>> => {
      const subscriber = new SubscriberBuilder()
        .subscribe(subscribedEvents as any)
        .timeout(timeout)
        .handle(async ({ events, logger }) => {
          logger.info({ eventCount: events.length }, 'Processing events');
        });

      return {
        key,
        name: key.toLowerCase(),
        construct: subscriber,
        path: {
          absolute: join(tempDir, `${key}.ts`),
          relative: `${key}.ts`,
        },
      };
    };

    it('should generate subscriber handlers', async () => {
      const constructs = [
        createSubscriberConstruct('userEventSubscriber', [
          'user.created',
          'user.updated',
        ]),
        createSubscriberConstruct('orderEventSubscriber', ['order.placed']),
      ];

      const subscriberInfos = await generator.build(
        context,
        constructs,
        outputDir,
        { provider: 'aws-lambda' },
      );

      expect(subscriberInfos).toHaveLength(2);
      expect(subscriberInfos[0]).toMatchObject({
        name: 'userEventSubscriber',
        handler: expect.stringContaining(
          'subscribers/userEventSubscriber.handler',
        ),
        subscribedEvents: ['user.created', 'user.updated'],
        timeout: 30000,
      });
      expect(subscriberInfos[1]).toMatchObject({
        name: 'orderEventSubscriber',
        handler: expect.stringContaining(
          'subscribers/orderEventSubscriber.handler',
        ),
        subscribedEvents: ['order.placed'],
        timeout: 30000,
      });

      // Check that handler files were created
      const userHandlerPath = join(
        outputDir,
        'subscribers',
        'userEventSubscriber.ts',
      );
      const userContent = await readFile(userHandlerPath, 'utf-8');
      expect(userContent).toContain('AWSLambdaSubscriber');
      expect(userContent).toContain('import { userEventSubscriber }');
      expect(userContent).toContain('import envParser');

      const orderHandlerPath = join(
        outputDir,
        'subscribers',
        'orderEventSubscriber.ts',
      );
      const orderContent = await readFile(orderHandlerPath, 'utf-8');
      expect(orderContent).toContain('AWSLambdaSubscriber');
      expect(orderContent).toContain('import { orderEventSubscriber }');
    });

    it('should generate correct relative import paths', async () => {
      const subscriber = new SubscriberBuilder()
        .subscribe(['event.type'] as any)
        .timeout(45000)
        .handle(async ({ events, logger }) => {
          logger.info({ eventCount: events.length }, 'Processing events');
        });

      const construct: GeneratedConstruct<
        Subscriber<any, any, any, any, any, any>
      > = {
        key: 'deepSubscriber',
        name: 'deep-subscriber',
        construct: subscriber,
        path: {
          absolute: join(tempDir, 'src/subscribers/deep/processor.ts'),
          relative: 'src/subscribers/deep/processor.ts',
        },
      };

      await generator.build(context, [construct], outputDir);

      const handlerPath = join(outputDir, 'subscribers', 'deepSubscriber.ts');
      const handlerContent = await readFile(handlerPath, 'utf-8');

      // Check relative imports are correct
      expect(handlerContent).toMatch(
        /from ['"].*src\/subscribers\/deep\/processor\.js['"]/,
      );
      expect(handlerContent).toMatch(/from ['"].*\/env['"]/);
    });

    it('should handle subscribers with different timeout values', async () => {
      const constructs = [
        createSubscriberConstruct('quickSubscriber', ['fast.event'], 15000),
        createSubscriberConstruct('slowSubscriber', ['slow.event'], 300000),
      ];

      const subscriberInfos = await generator.build(
        context,
        constructs,
        outputDir,
      );

      expect(subscriberInfos[0].timeout).toBe(15000);
      expect(subscriberInfos[1].timeout).toBe(300000);
    });

    it('should handle subscribers with no subscribed events', async () => {
      const subscriber = new SubscriberBuilder()
        .timeout(30000)
        .handle(async ({ events, logger }) => {
          logger.info({ eventCount: events.length }, 'Processing all events');
        });

      const construct: GeneratedConstruct<
        Subscriber<any, any, any, any, any, any>
      > = {
        key: 'catchAllSubscriber',
        name: 'catch-all-subscriber',
        construct: subscriber,
        path: {
          absolute: join(tempDir, 'catchAllSubscriber.ts'),
          relative: 'catchAllSubscriber.ts',
        },
      };

      const subscriberInfos = await generator.build(
        context,
        [construct],
        outputDir,
      );

      expect(subscriberInfos[0].subscribedEvents).toEqual([]);
    });

    it('should handle subscribers with multiple event types', async () => {
      const constructs = [
        createSubscriberConstruct('multiEventSubscriber', [
          'user.created',
          'user.updated',
          'user.deleted',
          'order.placed',
        ]),
      ];

      const subscriberInfos = await generator.build(
        context,
        constructs,
        outputDir,
      );

      expect(subscriberInfos[0].subscribedEvents).toEqual([
        'user.created',
        'user.updated',
        'user.deleted',
        'order.placed',
      ]);
    });

    it('should log generation progress', async () => {
      const logSpy = vi.spyOn(console, 'log');

      const constructs = [
        createSubscriberConstruct('testSubscriber', ['test.event']),
      ];

      await generator.build(context, constructs, outputDir);

      expect(logSpy).toHaveBeenCalledWith(
        'Generated subscriber handler: testSubscriber',
      );

      logSpy.mockRestore();
    });

    it('should return empty array for empty constructs', async () => {
      const subscriberInfos = await generator.build(context, [], outputDir);
      expect(subscriberInfos).toEqual([]);
    });

    it('should handle subscribers with custom environment parser patterns', async () => {
      const customContext = {
        ...context,
        envParserImportPattern: '{ customParser as envParser }',
      };

      const constructs = [
        createSubscriberConstruct('customSubscriber', ['custom.event']),
      ];

      await generator.build(customContext, constructs, outputDir);

      const handlerPath = join(outputDir, 'subscribers', 'customSubscriber.ts');
      const handlerContent = await readFile(handlerPath, 'utf-8');

      expect(handlerContent).toContain('import { customParser as envParser }');
    });

    it('should create subscribers directory if it does not exist', async () => {
      const constructs = [
        createSubscriberConstruct('firstSubscriber', ['first.event']),
      ];

      // outputDir does not exist yet
      await generator.build(context, constructs, outputDir);

      const subscribersDir = join(outputDir, 'subscribers');
      const handlerPath = join(subscribersDir, 'firstSubscriber.ts');

      // Should be able to read the file, meaning the directory was created
      const content = await readFile(handlerPath, 'utf-8');
      expect(content).toContain('AWSLambdaSubscriber');
    });

    it('should handle exported subscriber with custom name', async () => {
      const subscriber = new SubscriberBuilder()
        .subscribe(['custom.event'] as any)
        .handle(async ({ events, logger }) => {
          logger.info({ eventCount: events.length }, 'Processing events');
        });

      const construct: GeneratedConstruct<
        Subscriber<any, any, any, any, any, any>
      > = {
        key: 'myCustomSubscriberName',
        name: 'custom-name',
        construct: subscriber,
        path: {
          absolute: join(tempDir, 'subscriber.ts'),
          relative: 'subscriber.ts',
        },
      };

      await generator.build(context, [construct], outputDir);

      const handlerPath = join(
        outputDir,
        'subscribers',
        'myCustomSubscriberName.ts',
      );
      const handlerContent = await readFile(handlerPath, 'utf-8');

      expect(handlerContent).toContain(
        'import { myCustomSubscriberName } from',
      );
      expect(handlerContent).toContain(
        'new AWSLambdaSubscriber(envParser, myCustomSubscriberName)',
      );
    });

    it('should generate handler files that can be imported', async () => {
      const constructs = [
        createSubscriberConstruct('validSubscriber', ['valid.event']),
      ];

      await generator.build(context, constructs, outputDir);

      const handlerPath = join(outputDir, 'subscribers', 'validSubscriber.ts');
      const handlerContent = await readFile(handlerPath, 'utf-8');

      // Check that the generated file has proper structure
      expect(handlerContent).toContain(
        "import { AWSLambdaSubscriber } from '@geekmidas/constructs/aws'",
      );
      expect(handlerContent).toContain(
        'export const handler = adapter.handler',
      );
    });
  });
});
