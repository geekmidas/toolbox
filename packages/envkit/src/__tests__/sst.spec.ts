import { describe, expect, it, vi } from 'vitest';
import {
  type ApiGatewayV2,
  type Bucket,
  type Function,
  type Postgres,
  ResourceType,
  type Secret,
  type Vpc,
  environmentCase,
  normalizeResourceEnv,
} from '../sst';

describe('sst', () => {
  describe('environmentCase', () => {
    it('should convert camelCase to UPPER_SNAKE_CASE', () => {
      expect(environmentCase('myVariable')).toBe('MY_VARIABLE');
      expect(environmentCase('somePropertyName')).toBe('SOME_PROPERTY_NAME');
      expect(environmentCase('APIKey')).toBe('API_KEY');
    });

    it('should convert snake_case to UPPER_SNAKE_CASE', () => {
      expect(environmentCase('my_variable')).toBe('MY_VARIABLE');
      expect(environmentCase('some_property_name')).toBe('SOME_PROPERTY_NAME');
    });

    it('should handle numbers correctly', () => {
      // The function only removes underscore before digits
      expect(environmentCase('api_v2')).toBe('API_V2');
      expect(environmentCase('value_123')).toBe('VALUE123');
      expect(environmentCase('test_1_thing')).toBe('TEST1_THING');
      expect(environmentCase('api_2')).toBe('API2');
    });

    it('should handle already uppercase strings', () => {
      expect(environmentCase('ALREADY_UPPER')).toBe('ALREADY_UPPER');
      expect(environmentCase('TEST')).toBe('TEST');
    });

    it('should handle kebab-case', () => {
      expect(environmentCase('my-variable')).toBe('MY_VARIABLE');
      expect(environmentCase('kebab-case-example')).toBe('KEBAB_CASE_EXAMPLE');
    });

    it('should handle mixed cases', () => {
      expect(environmentCase('MixedCASE')).toBe('MIXED_CASE');
      expect(environmentCase('XMLParser')).toBe('XML_PARSER');
      expect(environmentCase('IOStream')).toBe('IO_STREAM');
    });

    it('should handle empty string', () => {
      expect(environmentCase('')).toBe('');
    });

    it('should handle single character', () => {
      expect(environmentCase('a')).toBe('A');
      expect(environmentCase('A')).toBe('A');
    });

    it('should handle strings with special characters', () => {
      expect(environmentCase('my.variable')).toBe('MY_VARIABLE');
      expect(environmentCase('my@variable')).toBe('MY_VARIABLE');
      expect(environmentCase('my#variable')).toBe('MY_VARIABLE');
    });
  });

  describe('normalizeResourceEnv', () => {
    describe('string values', () => {
      it('should convert string values to environment case', () => {
        const input = {
          apiUrl: 'https://api.example.com',
          secretKey: 'my-secret-key',
          NODE_ENV: 'production',
        };

        const result = normalizeResourceEnv(input);

        expect(result).toEqual({
          API_URL: 'https://api.example.com',
          SECRET_KEY: 'my-secret-key',
          NODE_ENV: 'production',
        });
      });

      it('should handle empty object', () => {
        expect(normalizeResourceEnv({})).toEqual({});
      });
    });

    describe('Secret resource', () => {
      it('should process Secret resource correctly', () => {
        const secret: Secret = {
          type: ResourceType.Secret,
          value: 'super-secret-value',
        };

        const result = normalizeResourceEnv({
          mySecret: secret,
        });

        expect(result).toEqual({
          MY_SECRET: 'super-secret-value',
        });
      });

      it('should process SSTSecret resource correctly', () => {
        const secret = {
          type: ResourceType.SSTSecret as ResourceType.SSTSecret,
          value: 'another-secret',
        };

        const result = normalizeResourceEnv({
          appSecret: secret as any,
        });

        expect(result).toEqual({
          APP_SECRET: 'another-secret',
        });
      });
    });

    describe('Postgres resource', () => {
      it('should process Postgres resource correctly', () => {
        const postgres: Postgres = {
          type: ResourceType.Postgres,
          database: 'myapp',
          host: 'localhost',
          password: 'password123',
          port: 5432,
          username: 'postgres',
        };

        const result = normalizeResourceEnv({
          database: postgres,
        });

        expect(result).toEqual({
          DATABASE_NAME: 'myapp',
          DATABASE_HOST: 'localhost',
          DATABASE_PASSWORD: 'password123',
          DATABASE_PORT: 5432,
          DATABASE_USERNAME: 'postgres',
        });
      });

      it('should process SSTPostgres resource correctly', () => {
        const postgres = {
          type: ResourceType.SSTPostgres as ResourceType.SSTPostgres,
          database: 'prod_db',
          host: 'prod.example.com',
          password: 'prod-password',
          port: 5433,
          username: 'prod_user',
        };

        const result = normalizeResourceEnv({
          mainDb: postgres as any,
        });

        expect(result).toEqual({
          MAIN_DB_NAME: 'prod_db',
          MAIN_DB_HOST: 'prod.example.com',
          MAIN_DB_PASSWORD: 'prod-password',
          MAIN_DB_PORT: 5433,
          MAIN_DB_USERNAME: 'prod_user',
        });
      });
    });

    describe('Bucket resource', () => {
      it('should process Bucket resource correctly', () => {
        const bucket: Bucket = {
          type: ResourceType.Bucket,
          name: 'my-s3-bucket',
        };

        const result = normalizeResourceEnv({
          uploadBucket: bucket,
        });

        expect(result).toEqual({
          UPLOAD_BUCKET_NAME: 'my-s3-bucket',
        });
      });

      it('should process SSTBucket resource correctly', () => {
        const bucket = {
          type: ResourceType.SSTBucket as ResourceType.SSTBucket,
          name: 'assets-bucket-prod',
        };

        const result = normalizeResourceEnv({
          assetStorage: bucket as any,
        });

        expect(result).toEqual({
          ASSET_STORAGE_NAME: 'assets-bucket-prod',
        });
      });
    });

    describe('noop resources', () => {
      it('should not add environment variables for ApiGatewayV2', () => {
        const api: ApiGatewayV2 = {
          type: ResourceType.ApiGatewayV2,
          url: 'https://api.example.com',
        };

        const result = normalizeResourceEnv({
          api: api,
        });

        expect(result).toEqual({});
      });

      it('should not add environment variables for Function', () => {
        const fn: Function = {
          type: ResourceType.Function,
          name: 'my-lambda',
        };

        const result = normalizeResourceEnv({
          handler: fn,
        });

        expect(result).toEqual({});
      });

      it('should not add environment variables for Vpc', () => {
        const vpc: Vpc = {
          type: ResourceType.Vpc,
          bastion: 'bastion-host',
        };

        const result = normalizeResourceEnv({
          network: vpc,
        });

        expect(result).toEqual({});
      });

      it('should handle all SST noop resource types', () => {
        const api = {
          type: ResourceType.SSTApiGatewayV2 as ResourceType.SSTApiGatewayV2,
          url: 'https://api.example.com',
        };

        const fn = {
          type: ResourceType.SSTFunction as ResourceType.SSTFunction,
          name: 'my-function',
        };

        const result = normalizeResourceEnv({
          api: api as any,
          function: fn as any,
        });

        expect(result).toEqual({});
      });
    });

    describe('mixed resources', () => {
      it('should handle mix of strings and resources', () => {
        const postgres: Postgres = {
          type: ResourceType.Postgres,
          database: 'app_db',
          host: 'db.example.com',
          password: 'db-pass',
          port: 5432,
          username: 'app_user',
        };

        const secret: Secret = {
          type: ResourceType.Secret,
          value: 'jwt-secret',
        };

        const bucket: Bucket = {
          type: ResourceType.Bucket,
          name: 'uploads-bucket',
        };

        const result = normalizeResourceEnv({
          nodeEnv: 'production',
          appName: 'My App',
          database: postgres,
          jwtSecret: secret,
          uploads: bucket,
          apiVersion: 'v2',
        });

        expect(result).toEqual({
          NODE_ENV: 'production',
          APP_NAME: 'My App',
          DATABASE_NAME: 'app_db',
          DATABASE_HOST: 'db.example.com',
          DATABASE_PASSWORD: 'db-pass',
          DATABASE_PORT: 5432,
          DATABASE_USERNAME: 'app_user',
          JWT_SECRET: 'jwt-secret',
          UPLOADS_NAME: 'uploads-bucket',
          API_VERSION: 'v2',
        });
      });
    });

    describe('edge cases', () => {
      it('should warn for unknown resource types', () => {
        const consoleWarnSpy = vi
          .spyOn(console, 'warn')
          .mockImplementation(() => {});

        const unknownResource = {
          type: 'unknown.resource.Type' as any,
          value: 'something',
        };

        const result = normalizeResourceEnv({
          unknown: unknownResource,
        });

        expect(result).toEqual({});
        expect(consoleWarnSpy).toHaveBeenCalledWith(
          'No processor found for resource type: ',
          { value: unknownResource },
        );

        consoleWarnSpy.mockRestore();
      });

      it('should handle resources with special characters in keys', () => {
        const secret: Secret = {
          type: ResourceType.Secret,
          value: 'value',
        };

        const result = normalizeResourceEnv({
          'my-secret-key': secret,
          'another.secret': secret,
          'secret@123': secret,
        });

        expect(result).toEqual({
          MY_SECRET_KEY: 'value',
          ANOTHER_SECRET: 'value',
          SECRET123: 'value',
        });
      });

      it('should handle numeric values in postgres port', () => {
        const postgres: Postgres = {
          type: ResourceType.Postgres,
          database: 'test',
          host: 'localhost',
          password: 'pass',
          port: 5432,
          username: 'user',
        };

        const result = normalizeResourceEnv({
          db: postgres,
        });

        expect(result.DB_PORT).toBe(5432);
        expect(typeof result.DB_PORT).toBe('number');
      });

      it('should handle very long keys', () => {
        const secret: Secret = {
          type: ResourceType.Secret,
          value: 'value',
        };

        const result = normalizeResourceEnv({
          thisIsAVeryLongKeyNameThatShouldBeConvertedProperly: secret,
        });

        expect(result).toEqual({
          THIS_IS_A_VERY_LONG_KEY_NAME_THAT_SHOULD_BE_CONVERTED_PROPERLY:
            'value',
        });
      });

      it('should handle multiple underscores and numbers', () => {
        const bucket: Bucket = {
          type: ResourceType.Bucket,
          name: 'test-bucket',
        };

        const result = normalizeResourceEnv({
          s3_bucket_v2_1: bucket,
          bucket_123_456: bucket,
        });

        expect(result).toEqual({
          S3_BUCKET_V21_NAME: 'test-bucket',
          BUCKET123456_NAME: 'test-bucket',
        });
      });
    });
  });

  describe('ResourceType enum', () => {
    it('should have all expected resource types', () => {
      expect(ResourceType.ApiGatewayV2).toBe('sst.aws.ApiGatewayV2');
      expect(ResourceType.Postgres).toBe('sst.aws.Postgres');
      expect(ResourceType.Function).toBe('sst.aws.Function');
      expect(ResourceType.Bucket).toBe('sst.aws.Bucket');
      expect(ResourceType.Vpc).toBe('sst.aws.Vpc');
      expect(ResourceType.Secret).toBe('sst.sst.Secret');
      expect(ResourceType.SSTSecret).toBe('sst:sst:Secret');
      expect(ResourceType.SSTFunction).toBe('sst:sst:Function');
      expect(ResourceType.SSTApiGatewayV2).toBe('sst:aws:ApiGatewayV2');
      expect(ResourceType.SSTPostgres).toBe('sst:aws:Postgres');
      expect(ResourceType.SSTBucket).toBe('sst:aws:Bucket');
    });
  });
});
