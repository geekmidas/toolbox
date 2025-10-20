import { describe, expect, it } from 'vitest';
import { ResponseBuilder, SuccessStatus } from '../Endpoint';

describe('ResponseBuilder', () => {
  describe('header', () => {
    it('should set a single header', () => {
      const builder = new ResponseBuilder();
      builder.header('X-Custom-Header', 'custom-value');

      const metadata = builder.getMetadata();
      expect(metadata.headers).toEqual({
        'X-Custom-Header': 'custom-value',
      });
    });

    it('should set multiple headers', () => {
      const builder = new ResponseBuilder();
      builder
        .header('X-Header-1', 'value1')
        .header('X-Header-2', 'value2')
        .header('Content-Type', 'application/json');

      const metadata = builder.getMetadata();
      expect(metadata.headers).toEqual({
        'X-Header-1': 'value1',
        'X-Header-2': 'value2',
        'Content-Type': 'application/json',
      });
    });

    it('should allow method chaining', () => {
      const builder = new ResponseBuilder();
      const result = builder.header('X-Test', 'value');

      expect(result).toBe(builder);
    });
  });

  describe('cookie', () => {
    it('should set a simple cookie', () => {
      const builder = new ResponseBuilder();
      builder.cookie('session', 'abc123');

      const metadata = builder.getMetadata();
      expect(metadata.cookies?.has('session')).toBe(true);
      expect(metadata.cookies?.get('session')).toEqual({
        value: 'abc123',
        options: undefined,
      });
    });

    it('should set cookie with options', () => {
      const builder = new ResponseBuilder();
      builder.cookie('session', 'abc123', {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        maxAge: 3600,
        path: '/',
      });

      const metadata = builder.getMetadata();
      const cookie = metadata.cookies?.get('session');
      expect(cookie).toEqual({
        value: 'abc123',
        options: {
          httpOnly: true,
          secure: true,
          sameSite: 'strict',
          maxAge: 3600,
          path: '/',
        },
      });
    });

    it('should set multiple cookies', () => {
      const builder = new ResponseBuilder();
      builder
        .cookie('session', 'abc123')
        .cookie('theme', 'dark')
        .cookie('lang', 'en');

      const metadata = builder.getMetadata();
      expect(metadata.cookies?.size).toBe(3);
      expect(metadata.cookies?.get('session')?.value).toBe('abc123');
      expect(metadata.cookies?.get('theme')?.value).toBe('dark');
      expect(metadata.cookies?.get('lang')?.value).toBe('en');
    });

    it('should allow method chaining', () => {
      const builder = new ResponseBuilder();
      const result = builder.cookie('test', 'value');

      expect(result).toBe(builder);
    });
  });

  describe('deleteCookie', () => {
    it('should set cookie with empty value and maxAge 0', () => {
      const builder = new ResponseBuilder();
      builder.deleteCookie('session');

      const metadata = builder.getMetadata();
      const cookie = metadata.cookies?.get('session');
      expect(cookie?.value).toBe('');
      expect(cookie?.options?.maxAge).toBe(0);
      expect(cookie?.options?.expires?.getTime()).toBe(0);
    });

    it('should preserve domain and path options', () => {
      const builder = new ResponseBuilder();
      builder.deleteCookie('session', {
        domain: '.example.com',
        path: '/app',
      });

      const metadata = builder.getMetadata();
      const cookie = metadata.cookies?.get('session');
      expect(cookie?.options).toMatchObject({
        domain: '.example.com',
        path: '/app',
        maxAge: 0,
      });
    });

    it('should allow method chaining', () => {
      const builder = new ResponseBuilder();
      const result = builder.deleteCookie('test');

      expect(result).toBe(builder);
    });
  });

  describe('status', () => {
    it('should set status code', () => {
      const builder = new ResponseBuilder();
      builder.status(SuccessStatus.Created);

      const metadata = builder.getMetadata();
      expect(metadata.status).toBe(201);
    });

    it('should allow method chaining', () => {
      const builder = new ResponseBuilder();
      const result = builder.status(SuccessStatus.OK);

      expect(result).toBe(builder);
    });
  });

  describe('send', () => {
    it('should return data with metadata', () => {
      const builder = new ResponseBuilder();
      builder.header('X-Test', 'value').status(SuccessStatus.Created);

      const result = builder.send({ id: '123', name: 'Test' });

      expect(result).toEqual({
        data: { id: '123', name: 'Test' },
        metadata: {
          headers: { 'X-Test': 'value' },
          cookies: new Map(),
          status: SuccessStatus.Created,
        },
      });
    });

    it('should work with complex data', () => {
      const builder = new ResponseBuilder();
      const complexData = {
        user: { id: '1', name: 'John' },
        posts: [{ id: '1', title: 'Post' }],
      };

      const result = builder.send(complexData);

      expect(result.data).toEqual(complexData);
      expect(result.metadata).toBeDefined();
    });
  });

  describe('fluent API', () => {
    it('should support full fluent chain', () => {
      const builder = new ResponseBuilder();

      const result = builder
        .status(SuccessStatus.Created)
        .header('Location', '/users/123')
        .header('X-User-Id', '123')
        .cookie('session', 'abc123', { httpOnly: true })
        .cookie('preferences', 'dark-mode')
        .send({ id: '123', name: 'John' });

      expect(result).toEqual({
        data: { id: '123', name: 'John' },
        metadata: {
          status: 201,
          headers: {
            Location: '/users/123',
            'X-User-Id': '123',
          },
          cookies: new Map([
            ['session', { value: 'abc123', options: { httpOnly: true } }],
            ['preferences', { value: 'dark-mode', options: undefined }],
          ]),
        },
      });
    });
  });

  describe('getMetadata', () => {
    it('should return current metadata', () => {
      const builder = new ResponseBuilder();
      builder.header('X-Test', 'value').cookie('test', 'cookie-value');

      const metadata = builder.getMetadata();

      expect(metadata).toEqual({
        headers: { 'X-Test': 'value' },
        cookies: new Map([['test', { value: 'cookie-value', options: undefined }]]),
      });
    });

    it('should return empty objects for unused features', () => {
      const builder = new ResponseBuilder();
      const metadata = builder.getMetadata();

      expect(metadata.headers).toEqual({});
      expect(metadata.cookies?.size).toBe(0);
      expect(metadata.status).toBeUndefined();
    });
  });
});
