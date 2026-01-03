import { describe, expect, it, vi } from 'vitest';
import { createMockLogger } from '../logger';
import { waitFor } from '../timer';
import {
  createMockContext,
  createMockV1Event,
  createMockV2Event,
} from '../aws';
import { itWithDir } from '../os/directory';
import fs from 'node:fs/promises';
import path from 'node:path';

describe('testkit utilities', () => {
  describe('createMockLogger', () => {
    it('should create a logger with all required methods', () => {
      const logger = createMockLogger();

      expect(logger.debug).toBeDefined();
      expect(logger.info).toBeDefined();
      expect(logger.warn).toBeDefined();
      expect(logger.error).toBeDefined();
      expect(logger.fatal).toBeDefined();
      expect(logger.trace).toBeDefined();
      expect(logger.child).toBeDefined();
    });

    it('should have mock functions that can be called', () => {
      const logger = createMockLogger();

      logger.debug('debug message');
      logger.info({ data: 'test' }, 'info message');
      logger.warn('warning');
      logger.error('error');
      logger.fatal('fatal');
      logger.trace('trace');

      expect(logger.debug).toHaveBeenCalledWith('debug message');
      expect(logger.info).toHaveBeenCalledWith({ data: 'test' }, 'info message');
      expect(logger.warn).toHaveBeenCalledWith('warning');
      expect(logger.error).toHaveBeenCalledWith('error');
      expect(logger.fatal).toHaveBeenCalledWith('fatal');
      expect(logger.trace).toHaveBeenCalledWith('trace');
    });

    it('should return itself from child()', () => {
      const logger = createMockLogger();
      const childLogger = logger.child({ module: 'test' });

      expect(childLogger).toBe(logger);
      expect(logger.child).toHaveBeenCalledWith({ module: 'test' });
    });
  });

  describe('waitFor', () => {
    it('should wait for the specified time', async () => {
      const start = Date.now();
      await waitFor(50);
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeLessThan(150);
    });

    it('should resolve without a value', async () => {
      const result = await waitFor(10);
      expect(result).toBeUndefined();
    });
  });

  describe('AWS mock utilities', () => {
    describe('createMockContext', () => {
      it('should create a valid Lambda context', () => {
        const context = createMockContext();

        expect(context.awsRequestId).toBe('test-request-id');
        expect(context.functionName).toBe('test-function');
        expect(context.functionVersion).toBe('1');
        expect(context.memoryLimitInMB).toBe('128');
        expect(context.logGroupName).toBe('/aws/lambda/test-function');
        expect(context.invokedFunctionArn).toContain('arn:aws:lambda');
      });

      it('should have mock callback functions', () => {
        const context = createMockContext();

        expect(context.done).toBeDefined();
        expect(context.fail).toBeDefined();
        expect(context.succeed).toBeDefined();

        context.done();
        context.fail(new Error('test'));
        context.succeed('result');

        expect(context.done).toHaveBeenCalled();
        expect(context.fail).toHaveBeenCalled();
        expect(context.succeed).toHaveBeenCalled();
      });

      it('should return remaining time', () => {
        const context = createMockContext();
        const remaining = context.getRemainingTimeInMillis();

        expect(remaining).toBe(5000);
      });
    });

    describe('createMockV1Event', () => {
      it('should create a valid API Gateway V1 event', () => {
        const event = createMockV1Event();

        expect(event.httpMethod).toBe('GET');
        expect(event.path).toBe('/test');
        expect(event.headers['content-type']).toBe('application/json');
        expect(event.requestContext.accountId).toBe('123456789012');
        expect(event.requestContext.stage).toBe('test');
      });

      it('should allow overriding properties', () => {
        const event = createMockV1Event({
          httpMethod: 'POST',
          path: '/users',
          body: JSON.stringify({ name: 'test' }),
          pathParameters: { id: '123' },
          queryStringParameters: { page: '1' },
        });

        expect(event.httpMethod).toBe('POST');
        expect(event.path).toBe('/users');
        expect(event.body).toBe(JSON.stringify({ name: 'test' }));
        expect(event.pathParameters).toEqual({ id: '123' });
        expect(event.queryStringParameters).toEqual({ page: '1' });
      });

      it('should have correct identity fields', () => {
        const event = createMockV1Event();

        expect(event.requestContext.identity.sourceIp).toBe('127.0.0.1');
        expect(event.requestContext.identity.userAgent).toBe('test-agent');
      });
    });

    describe('createMockV2Event', () => {
      it('should create a valid API Gateway V2 event', () => {
        const event = createMockV2Event();

        expect(event.version).toBe('2.0');
        expect(event.routeKey).toBe('GET /test');
        expect(event.rawPath).toBe('/test');
        expect(event.headers['content-type']).toBe('application/json');
        expect(event.requestContext.accountId).toBe('123456789012');
      });

      it('should allow overriding properties', () => {
        const event = createMockV2Event({
          routeKey: 'POST /users',
          rawPath: '/users',
          body: JSON.stringify({ name: 'test' }),
          pathParameters: { id: '123' },
          queryStringParameters: { page: '1' },
        });

        expect(event.routeKey).toBe('POST /users');
        expect(event.rawPath).toBe('/users');
        expect(event.body).toBe(JSON.stringify({ name: 'test' }));
        expect(event.pathParameters).toEqual({ id: '123' });
        expect(event.queryStringParameters).toEqual({ page: '1' });
      });

      it('should have correct HTTP context', () => {
        const event = createMockV2Event();

        expect(event.requestContext.http.method).toBe('GET');
        expect(event.requestContext.http.path).toBe('/test');
        expect(event.requestContext.http.sourceIp).toBe('127.0.0.1');
        expect(event.requestContext.http.userAgent).toBe('test-agent');
      });
    });
  });

  describe('itWithDir', () => {
    itWithDir('should provide a temporary directory', async ({ dir }) => {
      expect(dir).toBeDefined();
      expect(typeof dir).toBe('string');

      // Directory should exist
      const stat = await fs.stat(dir);
      expect(stat.isDirectory()).toBe(true);
    });

    itWithDir('should allow creating files in the directory', async ({ dir }) => {
      const testFile = path.join(dir, 'test.txt');
      await fs.writeFile(testFile, 'hello');

      const content = await fs.readFile(testFile, 'utf-8');
      expect(content).toBe('hello');
    });

    itWithDir('should provide unique directories per test', async ({ dir }) => {
      // The directory should have a UUID-like name (uppercase hex)
      const dirName = path.basename(dir);
      expect(dirName).toMatch(/^[A-F0-9]{32}$/);
      expect(dir.length).toBeGreaterThan(10);
    });
  });
});
