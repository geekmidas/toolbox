import {
  EnvironmentBuilder,
  type EnvRecord,
  type EnvironmentBuilderOptions,
  type InputValue,
  type Resolvers,
} from './EnvironmentBuilder';

/**
 * Enumeration of supported SST (Serverless Stack Toolkit) resource types.
 * Used to identify and process different AWS and SST resources.
 */
export enum ResourceType {
  // Legacy format (dot notation)
  ApiGatewayV2 = 'sst.aws.ApiGatewayV2',
  Postgres = 'sst.aws.Postgres',
  Function = 'sst.aws.Function',
  Bucket = 'sst.aws.Bucket',
  Vpc = 'sst.aws.Vpc',
  Secret = 'sst.sst.Secret',

  // Modern format (colon notation)
  SSTSecret = 'sst:sst:Secret',
  SSTFunction = 'sst:sst:Function',
  SSTApiGatewayV2 = 'sst:aws:ApiGatewayV2',
  SSTPostgres = 'sst:aws:Postgres',
  SSTBucket = 'sst:aws:Bucket',
  SnsTopic = 'sst:aws:SnsTopic',
}

/**
 * AWS API Gateway V2 resource type.
 * Represents an HTTP/WebSocket API.
 */
export type ApiGatewayV2 = {
  type: ResourceType.ApiGatewayV2 | ResourceType.SSTApiGatewayV2;
  url: string;
};

/**
 * PostgreSQL database resource type.
 * Contains all connection details needed to connect to the database.
 */
export type Postgres = {
  type: ResourceType.Postgres | ResourceType.SSTPostgres;
  database: string;
  host: string;
  password: string;
  port: number;
  username: string;
};

/**
 * AWS Lambda Function resource type.
 */
export type Function = {
  type: ResourceType.Function | ResourceType.SSTFunction;
  name: string;
};

/**
 * AWS S3 Bucket resource type.
 */
export type Bucket = {
  type: ResourceType.Bucket | ResourceType.SSTBucket;
  name: string;
};

/**
 * AWS VPC (Virtual Private Cloud) resource type.
 */
export type Vpc = {
  type: ResourceType.Vpc;
  bastion: string;
};

/**
 * Secret resource type for storing sensitive values.
 */
export type Secret = {
  type: ResourceType.Secret | ResourceType.SSTSecret;
  value: string;
};

/**
 * AWS SNS Topic resource type.
 */
export type SnsTopic = {
  type: ResourceType.SnsTopic;
  arn: string;
};

/**
 * Union type of all supported SST resource types.
 */
export type SstResource =
  | ApiGatewayV2
  | Postgres
  | Function
  | Bucket
  | Vpc
  | Secret
  | SnsTopic;

/**
 * Function type for processing a specific resource type into environment variables.
 *
 * @template K - The specific resource type
 * @param name - The resource name
 * @param value - The resource value
 * @returns Object mapping environment variable names to values
 */
export type ResourceProcessor<K extends SstResource> = (
  name: string,
  value: K,
) => EnvRecord;

// SST Resource Resolvers

const secretResolver = (name: string, value: Secret) => ({
  [name]: value.value,
});

const postgresResolver = (key: string, value: Postgres) => ({
  [`${key}Name`]: value.database,
  [`${key}Host`]: value.host,
  [`${key}Password`]: value.password,
  [`${key}Port`]: value.port,
  [`${key}Username`]: value.username,
});

const bucketResolver = (name: string, value: Bucket) => ({
  [`${name}Name`]: value.name,
});

const topicResolver = (name: string, value: SnsTopic) => ({
  [`${name}Arn`]: value.arn,
});

const noopResolver = () => ({});

/**
 * Pre-configured resolvers for all SST resource types.
 */
export const sstResolvers: Resolvers = {
  // Legacy format
  [ResourceType.ApiGatewayV2]: noopResolver,
  [ResourceType.Function]: noopResolver,
  [ResourceType.Vpc]: noopResolver,
  [ResourceType.Secret]: secretResolver,
  [ResourceType.Postgres]: postgresResolver,
  [ResourceType.Bucket]: bucketResolver,

  // Modern format
  [ResourceType.SSTSecret]: secretResolver,
  [ResourceType.SSTBucket]: bucketResolver,
  [ResourceType.SSTFunction]: noopResolver,
  [ResourceType.SSTPostgres]: postgresResolver,
  [ResourceType.SSTApiGatewayV2]: noopResolver,
  [ResourceType.SnsTopic]: topicResolver,
};

/**
 * SST-specific environment builder with built-in resolvers for all known
 * SST resource types.
 *
 * Extends the generic EnvironmentBuilder with SST-specific functionality.
 *
 * @example
 * ```typescript
 * const env = new SstEnvironmentBuilder({
 *   database: { type: 'sst:aws:Postgres', host: '...', ... },
 *   apiKey: { type: 'sst:sst:Secret', value: 'secret' },
 *   appName: 'my-app',
 * }).build();
 * ```
 */
export class SstEnvironmentBuilder {
  private readonly builder: EnvironmentBuilder<Resolvers>;

  /**
   * Create a new SST environment builder.
   *
   * @param record - Object containing SST resources, custom resources, and/or string values
   * @param additionalResolvers - Optional custom resolvers that merge with SST resolvers (custom takes precedence)
   * @param options - Optional configuration options
   */
  constructor(
    record: Record<string, SstResource | InputValue | string>,
    additionalResolvers?: Resolvers,
    options?: EnvironmentBuilderOptions,
  ) {
    // Merge resolvers with custom ones taking precedence
    const mergedResolvers: Resolvers = additionalResolvers
      ? { ...sstResolvers, ...additionalResolvers }
      : sstResolvers;

    this.builder = new EnvironmentBuilder(
      record as Record<string, InputValue>,
      mergedResolvers,
      options,
    );
  }

  /**
   * Build environment variables from the input record.
   *
   * @returns A record of environment variables
   */
  build(): EnvRecord {
    return this.builder.build();
  }
}

// Re-export useful types
export { environmentCase } from './EnvironmentBuilder';
export type {
  EnvRecord,
  EnvValue,
  EnvironmentBuilderOptions,
} from './EnvironmentBuilder';
