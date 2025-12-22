import { describe, expect, it, vi } from 'vitest';

import { EnvironmentBuilder, environmentCase } from '../EnvironmentBuilder';

describe('environmentCase', () => {
  it('should convert camelCase to UPPER_SNAKE_CASE', () => {
    expect(environmentCase('myVariable')).toBe('MY_VARIABLE');
    expect(environmentCase('apiUrl')).toBe('API_URL');
    expect(environmentCase('databaseName')).toBe('DATABASE_NAME');
  });

  it('should handle already snake_case', () => {
    expect(environmentCase('my_variable')).toBe('MY_VARIABLE');
    expect(environmentCase('api_url')).toBe('API_URL');
  });

  it('should remove underscore directly before numbers', () => {
    // The regex /_\d+/g only removes underscores that are directly followed by digits
    expect(environmentCase('api_v2')).toBe('API_V2');
    expect(environmentCase('value_123')).toBe('VALUE123');
    expect(environmentCase('my_var_2')).toBe('MY_VAR2');
  });

  it('should handle single words', () => {
    expect(environmentCase('name')).toBe('NAME');
    expect(environmentCase('port')).toBe('PORT');
  });
});

describe('EnvironmentBuilder', () => {
  describe('basic functionality', () => {
    it('should pass through plain string values with key transformation', () => {
      const env = new EnvironmentBuilder(
        {
          appName: 'my-app',
          nodeEnv: 'production',
        },
        {},
      ).build();

      expect(env).toEqual({
        APP_NAME: 'my-app',
        NODE_ENV: 'production',
      });
    });

    it('should resolve object values using type-based resolvers', () => {
      const env = new EnvironmentBuilder(
        {
          apiKey: { type: 'secret', value: 'xyz' },
        },
        {
          secret: (key, value: { type: string; value: string }) => ({
            [key]: value.value,
          }),
        },
      ).build();

      expect(env).toEqual({
        API_KEY: 'xyz',
      });
    });

    it('should transform resolver output keys to UPPER_SNAKE_CASE', () => {
      const env = new EnvironmentBuilder(
        {
          auth: { type: 'auth0', domain: 'example.auth0.com', clientId: 'abc' },
        },
        {
          auth0: (
            key,
            value: { type: string; domain: string; clientId: string },
          ) => ({
            [`${key}Domain`]: value.domain,
            [`${key}ClientId`]: value.clientId,
          }),
        },
      ).build();

      expect(env).toEqual({
        AUTH_DOMAIN: 'example.auth0.com',
        AUTH_CLIENT_ID: 'abc',
      });
    });

    it('should handle mixed string and object values', () => {
      const env = new EnvironmentBuilder(
        {
          appName: 'my-app',
          apiKey: { type: 'secret', value: 'secret-key' },
          nodeEnv: 'production',
        },
        {
          secret: (key, value: { type: string; value: string }) => ({
            [key]: value.value,
          }),
        },
      ).build();

      expect(env).toEqual({
        APP_NAME: 'my-app',
        API_KEY: 'secret-key',
        NODE_ENV: 'production',
      });
    });
  });

  describe('nested values', () => {
    it('should support nested object values', () => {
      const env = new EnvironmentBuilder(
        {
          database: {
            type: 'multi-db',
            primary: 'pg://primary',
            replica: 'pg://replica',
          },
        },
        {
          'multi-db': (
            key,
            value: { type: string; primary: string; replica: string },
          ) => ({
            [key]: {
              primary: value.primary,
              replica: value.replica,
            },
          }),
        },
      ).build();

      expect(env).toEqual({
        DATABASE: {
          primary: 'pg://primary',
          replica: 'pg://replica',
        },
      });
    });

    it('should not transform nested object keys', () => {
      const env = new EnvironmentBuilder(
        {
          config: { type: 'nested', camelCase: 'value', snake_case: 'value2' },
        },
        {
          nested: (
            key,
            value: { type: string; camelCase: string; snake_case: string },
          ) => ({
            [key]: {
              camelCase: value.camelCase,
              snake_case: value.snake_case,
            },
          }),
        },
      ).build();

      expect(env).toEqual({
        CONFIG: {
          camelCase: 'value',
          snake_case: 'value2',
        },
      });
    });
  });

  describe('unmatched values', () => {
    it('should call onUnmatchedValue for objects without matching resolver', () => {
      const onUnmatchedValue = vi.fn();

      new EnvironmentBuilder(
        {
          unknown: { type: 'unknown-type', data: 'test' },
        },
        {},
        { onUnmatchedValue },
      ).build();

      expect(onUnmatchedValue).toHaveBeenCalledWith('unknown', {
        type: 'unknown-type',
        data: 'test',
      });
    });

    it('should default to console.warn for unmatched values', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      new EnvironmentBuilder(
        {
          unknown: { type: 'unknown-type', data: 'test' },
        },
        {},
      ).build();

      expect(warnSpy).toHaveBeenCalledWith(
        'No resolver found for key "unknown":',
        {
          value: { type: 'unknown-type', data: 'test' },
        },
      );

      warnSpy.mockRestore();
    });
  });

  describe('value types', () => {
    it('should support number values', () => {
      const env = new EnvironmentBuilder(
        {
          port: { type: 'port', value: 3000 },
        },
        {
          port: (key, value: { type: string; value: number }) => ({
            [key]: value.value,
          }),
        },
      ).build();

      expect(env).toEqual({
        PORT: 3000,
      });
    });

    it('should support boolean values', () => {
      const env = new EnvironmentBuilder(
        {
          enabled: { type: 'flag', value: true },
        },
        {
          flag: (key, value: { type: string; value: boolean }) => ({
            [key]: value.value,
          }),
        },
      ).build();

      expect(env).toEqual({
        ENABLED: true,
      });
    });
  });

  describe('multiple resolvers', () => {
    it('should use the correct resolver for each type', () => {
      const env = new EnvironmentBuilder(
        {
          secret: { type: 'secret', value: 'my-secret' },
          database: { type: 'postgres', host: 'localhost', port: 5432 },
          bucket: { type: 'bucket', name: 'my-bucket' },
        },
        {
          secret: (key, value: { type: string; value: string }) => ({
            [key]: value.value,
          }),
          postgres: (
            key,
            value: { type: string; host: string; port: number },
          ) => ({
            [`${key}Host`]: value.host,
            [`${key}Port`]: value.port,
          }),
          bucket: (key, value: { type: string; name: string }) => ({
            [`${key}Name`]: value.name,
          }),
        },
      ).build();

      expect(env).toEqual({
        SECRET: 'my-secret',
        DATABASE_HOST: 'localhost',
        DATABASE_PORT: 5432,
        BUCKET_NAME: 'my-bucket',
      });
    });
  });
});
