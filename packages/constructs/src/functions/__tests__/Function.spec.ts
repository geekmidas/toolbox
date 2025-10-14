import { EnvironmentParser } from '@geekmidas/envkit';

import { ConsoleLogger } from '@geekmidas/logger/console';
import type { Service } from '@geekmidas/services';
import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import { ConstructType } from '../../Construct';

import { createMockContext } from '@geekmidas/testkit/aws';
import { AWSLambdaFunction } from '../AWSLambdaFunction';
import { Function, FunctionFactory, type FunctionHandler } from '../Function';
import { FunctionBuilder } from '../FunctionBuilder';
import { TestFunctionAdaptor } from '../TestFunctionAdaptor';

// Mock service for testing
class TestService implements Service<'TestService', TestService> {
  serviceName = 'TestService' as const;
  static serviceName = 'TestService';

  async register() {
    return this;
  }
}

class AnotherTestService
  implements Service<'AnotherTestService', AnotherTestService>
{
  serviceName = 'AnotherTestService' as const;
  static serviceName = 'AnotherTestService';

  async register() {
    return this;
  }
}

describe('Function', () => {
  describe('FunctionFactory', () => {
    it('should create a function factory with default services', () => {
      const service1 = new TestService();
      const service2 = new AnotherTestService();
      const factory = new FunctionFactory([service1, service2]);

      expect(factory).toBeDefined();
    });

    it('should deduplicate services by name', () => {
      const service1 = new TestService();
      const service2 = new TestService(); // Duplicate
      const service3 = new AnotherTestService();

      const factory = new FunctionFactory([service1, service2, service3]);
      // Internal defaultServices should have only 2 unique services
      expect(factory['defaultServices'].length).toBe(2);
    });

    it('should add services using services() method', () => {
      const service1 = new TestService();
      const factory = new FunctionFactory([]);

      const newFactory = factory.services([service1]);
      expect(newFactory).toBeDefined();
      expect(newFactory['defaultServices'].length).toBe(1);
    });

    it('should merge services when chaining services() calls', () => {
      const service1 = new TestService();
      const service2 = new AnotherTestService();
      const factory = new FunctionFactory([service1]);

      const newFactory = factory.services([service2]);
      expect(newFactory['defaultServices'].length).toBe(2);
    });

    it('should set custom logger using logger() method', () => {
      const customLogger = new ConsoleLogger();
      const factory = new FunctionFactory([]);

      const newFactory = factory.logger(customLogger);
      expect(newFactory['defaultLogger']).toBe(customLogger);
    });
  });

  describe('Function class', () => {
    it('should create a function instance', () => {
      const handler: FunctionHandler = async () => {
        return { result: 'success' };
      };

      const fn = new Function(handler);
      expect(fn).toBeDefined();
      expect(fn.__IS_FUNCTION__).toBe(true);
      expect(fn.timeout).toBe(30000); // Default timeout
      expect(fn.type).toBe(ConstructType.Function);
    });

    it('should create a function with custom timeout', () => {
      const handler: FunctionHandler = async () => ({ result: 'success' });
      const fn = new Function(handler, 60000);

      expect(fn.timeout).toBe(60000);
    });

    it('should create a function with input and output schemas', () => {
      const inputSchema = z.object({ name: z.string() });
      const outputSchema = z.object({ message: z.string() });
      const handler: FunctionHandler = async () => ({ message: 'Hello' });

      const fn = new Function(
        handler,
        30000,
        ConstructType.Function,
        inputSchema,
        outputSchema,
      );

      expect(fn.input).toBe(inputSchema);
      expect(fn.outputSchema).toBe(outputSchema);
    });

    it('should detect function instances using isFunction', () => {
      const handler: FunctionHandler = async () => ({ result: 'success' });
      const fn = new Function(handler);

      expect(Function.isFunction(fn)).toBe(true);
      expect(Function.isFunction({})).toBeFalsy();
      expect(Function.isFunction(null)).toBeFalsy();
      expect(Function.isFunction(undefined)).toBeFalsy();
      expect(Function.isFunction({ __IS_FUNCTION__: false })).toBe(false);
      expect(Function.isFunction({ __IS_FUNCTION__: true })).toBe(false);
    });
  });

  describe('FunctionBuilder', () => {
    describe('isStandardSchemaV1', () => {
      it('should identify standard schema v1', () => {
        const zodSchema = z.string();
        expect(FunctionBuilder.isStandardSchemaV1(zodSchema)).toBe(true);
      });

      it('should return false for non-standard schemas', () => {
        expect(FunctionBuilder.isStandardSchemaV1({})).toBeFalsy();
        expect(FunctionBuilder.isStandardSchemaV1('string')).toBeFalsy();
        expect(FunctionBuilder.isStandardSchemaV1(123)).toBeFalsy();
        expect(FunctionBuilder.isStandardSchemaV1(true)).toBeFalsy();
        expect(
          FunctionBuilder.isStandardSchemaV1({ '~standard': {} }),
        ).toBeFalsy();
        expect(
          FunctionBuilder.isStandardSchemaV1({
            '~standard': { validate: 'not a function' },
          }),
        ).toBeFalsy();
      });
    });

    describe('parseComposableStandardSchema', () => {
      it('should parse standard schema', async () => {
        const schema = z.object({
          name: z.string(),
          age: z.number().optional(),
        });

        const data = { name: 'John', age: 30 };
        const result = await FunctionBuilder.parseComposableStandardSchema(
          data,
          schema,
        );
        expect(result).toEqual({ name: 'John', age: 30 });
      });

      it('should parse composed schema', async () => {
        const schema = {
          name: z.string(),
          age: z.number().optional(),
        };

        const data = { name: 'John', age: 30 };
        const result = await FunctionBuilder.parseComposableStandardSchema(
          data,
          schema,
        );
        expect(result).toEqual({ name: 'John', age: 30 });
      });

      it('should throw validation errors for invalid data', async () => {
        const schema = z.object({
          name: z.string(),
          age: z.number(),
        });

        const invalidData = { name: 'John', age: 'not a number' };
        await expect(
          FunctionBuilder.parseComposableStandardSchema(invalidData, schema),
        ).rejects.toThrow();
      });

      it('should throw validation errors for composed schema with invalid data', async () => {
        const schema = {
          name: z.string(),
          email: z.string().email(),
        };

        const invalidData = { name: 'John', email: 'invalid-email' };
        await expect(
          FunctionBuilder.parseComposableStandardSchema(invalidData, schema),
        ).rejects.toThrow();
      });

      it('should handle nested paths in composed schemas', async () => {
        const schema = {
          'user.name': z.string(),
          'user.email': z.string().email(),
        };

        const data = {
          user: {
            name: 'John',
            email: 'john@example.com',
          },
        };

        const result = await FunctionBuilder.parseComposableStandardSchema(
          data,
          schema,
        );
        expect(result).toEqual({
          'user.name': 'John',
          'user.email': 'john@example.com',
        });
      });
    });

    describe('builder methods', () => {
      it('should create a builder with default type', () => {
        const builder = new FunctionBuilder();
        expect(builder.type).toBe(ConstructType.Function);
      });

      it('should add services', () => {
        const service = new TestService();
        const builder = new FunctionBuilder().services([service]);

        expect(builder._services.length).toBe(1);
        expect(builder._services[0]).toBe(service);
      });

      it('should deduplicate services when adding', () => {
        const builder = new FunctionBuilder();
        const service1 = new TestService();
        const service2 = new TestService(); // Same service name

        const newBuilder = builder.services([service1, service2]);
        expect(newBuilder._services.length).toBe(1);
      });

      it('should set logger', () => {
        const builder = new FunctionBuilder();
        const customLogger = new ConsoleLogger();

        const newBuilder = builder.logger(customLogger);
        expect(newBuilder._logger).toBe(customLogger);
      });

      it('should set timeout', () => {
        const builder = new FunctionBuilder();
        const newBuilder = builder.timeout(60000);

        // We can't access _timeout directly as it's protected
        // But we can verify the method returns the builder for chaining
        expect(newBuilder).toBeInstanceOf(FunctionBuilder);
      });

      it('should set output schema', () => {
        const builder = new FunctionBuilder();
        const outputSchema = z.object({ result: z.string() });

        const newBuilder = builder.output(outputSchema);
        expect(newBuilder['outputSchema']).toBe(outputSchema);
      });

      it('should set input schema', () => {
        const builder = new FunctionBuilder();
        const inputSchema = z.object({ data: z.string() });

        const newBuilder = builder.input(inputSchema);
        expect(newBuilder['inputSchema']).toBe(inputSchema);
      });

      it('should chain multiple builder methods', () => {
        const builder = new FunctionBuilder();
        const service = new TestService();
        const logger = new ConsoleLogger();
        const inputSchema = z.object({ data: z.string() });
        const outputSchema = z.object({ result: z.string() });

        const finalBuilder = builder
          .services([service])
          .logger(logger)
          .timeout(45000)
          .input(inputSchema)
          .output(outputSchema);

        expect(finalBuilder._services.length).toBe(1);
        expect(finalBuilder._logger).toBe(logger);
        // _timeout is protected, so we just verify the builder chain works
        expect(finalBuilder).toBeInstanceOf(FunctionBuilder);
      });
    });
  });

  describe('FunctionHandler type', () => {
    it('should handle function with full context', async () => {
      const handler: FunctionHandler<
        { name: z.ZodString },
        [TestService],
        ConsoleLogger,
        z.ZodObject<{ message: z.ZodString }>
      > = async ({ services, logger, input }) => {
        expect(services).toBeDefined();
        expect(logger).toBeDefined();
        expect(input).toBeDefined();
        return { message: `Hello ${input.name}` };
      };

      const result = await handler({
        services: { TestService: new TestService() },
        logger: new ConsoleLogger(),
        input: {
          name: 'John',
        },
      });

      expect(result).toEqual({ message: 'Hello John' });
    });
  });

  describe('Function Adaptors Integration', () => {
    describe('TestFunctionAdaptor', () => {
      it('should work with TestFunctionAdaptor for testing', async () => {
        const inputSchema = z.object({ name: z.string() });
        const outputSchema = z.object({ greeting: z.string() });

        const fn = new Function(
          async ({ input }) => ({
            greeting: `Hello ${input.name}!`,
          }),
          undefined,
          undefined,
          inputSchema,
          outputSchema,
          [],
        );

        const adaptor = new TestFunctionAdaptor(fn);

        const result = await adaptor.invoke({
          services: {},
          input: { name: 'Integration Test' },
        });

        expect(result).toEqual({
          greeting: 'Hello Integration Test!',
        });
      });
    });

    describe('AWSLambdaFunction', () => {
      it('should work with AWSLambdaFunction for AWS Lambda', async () => {
        const inputSchema = { message: z.string() };
        const outputSchema = z.object({ processed: z.string() });

        const fn = new Function(
          async ({ logger, ...rest }) => {
            logger.info('Processing message');
            return { processed: `Processed: ${rest.input.message}` };
          },
          undefined,
          undefined,
          inputSchema,
          outputSchema,
          [],
          new ConsoleLogger(),
        );

        const adaptor = new AWSLambdaFunction(new EnvironmentParser({}), fn);
        const handler = adaptor.handler.bind(adaptor);

        const mockContext = createMockContext();

        const result = await handler(
          { message: 'Hello Lambda!' },
          mockContext,
          () => {},
        );

        expect(result).toEqual({
          processed: 'Processed: Hello Lambda!',
        });
      });
    });
  });
});
