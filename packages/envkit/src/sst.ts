import snakecase from 'lodash.snakecase';

/**
 * Converts a string to environment variable case format (UPPER_SNAKE_CASE).
 * Numbers following underscores are preserved without the underscore.
 * 
 * @param name - The string to convert
 * @returns The converted string in environment variable format
 * 
 * @example
 * environmentCase('myVariable') // 'MY_VARIABLE'
 * environmentCase('api_v2') // 'APIV2'
 */
export function environmentCase(name: string) {
  return snakecase(name)
    .toUpperCase()
    .replace(/_\d+/g, (r) => {
      return r.replace('_', '');
    });
}

/**
 * Enumeration of supported SST (Serverless Stack Toolkit) resource types.
 * Used to identify and process different AWS and SST resources.
 */
export enum ResourceType {
  ApiGatewayV2 = 'sst.aws.ApiGatewayV2',
  Postgres = 'sst.aws.Postgres',
  Function = 'sst.aws.Function',
  Bucket = 'sst.aws.Bucket',
  Vpc = 'sst.aws.Vpc',
  Secret = 'sst.sst.Secret',
  SSTSecret = 'sst:sst:Secret',
  SSTFunction = 'sst:sst:Function',
  SSTApiGatewayV2 = 'sst:aws:ApiGatewayV2',
  SSTPostgres = 'sst:aws:Postgres',
  SSTBucket = 'sst:aws:Bucket',
}

/**
 * Processes a Secret resource into environment variables.
 * 
 * @param name - The resource name
 * @param value - The Secret resource
 * @returns Object with environment variable mappings
 */
const secret = (name: string, value: Secret) => ({
  [environmentCase(name)]: value.value,
});
/**
 * Processes a Postgres database resource into environment variables.
 * Creates multiple environment variables for database connection details.
 * 
 * @param key - The resource key
 * @param value - The Postgres resource
 * @returns Object with database connection environment variables
 */
const postgres = (key: string, value: Postgres) => {
  const prefix = `${environmentCase(key)}`;
  return {
    [`${prefix}_NAME`]: value.database,
    [`${prefix}_HOST`]: value.host,
    [`${prefix}_PASSWORD`]: value.password,
    [`${prefix}_PORT`]: value.port,
    [`${prefix}_USERNAME`]: value.username,
  };
};

/**
 * Processes a Bucket resource into environment variables.
 * 
 * @param name - The resource name
 * @param value - The Bucket resource
 * @returns Object with bucket name environment variable
 */
const bucket = (name: string, value: Bucket) => {
  const prefix = `${environmentCase(name)}`;
  return {
    [`${prefix}_NAME`]: value.name,
  };
};

/**
 * No-operation processor for resources that don't require environment variables.
 * 
 * @param name - The resource name (unused)
 * @param value - The resource value (unused)
 * @returns Empty object
 */
const noop = (name: string, value: any) => ({});

/**
 * Map of resource types to their corresponding processor functions.
 * Each processor converts resource data into environment variables.
 */
const processors: Record<ResourceType, ResourceProcessor<any>> = {
  [ResourceType.ApiGatewayV2]: noop,
  [ResourceType.Function]: noop,
  [ResourceType.Vpc]: noop,
  [ResourceType.Secret]: secret,
  [ResourceType.Postgres]: postgres,
  [ResourceType.Bucket]: bucket,

  [ResourceType.SSTSecret]: secret,
  [ResourceType.SSTBucket]: bucket,
  [ResourceType.SSTFunction]: noop,
  [ResourceType.SSTPostgres]: postgres,
  [ResourceType.SSTApiGatewayV2]: noop,
};

/**
 * Normalizes SST resources and plain strings into environment variables.
 * Processes resources based on their type and converts names to environment case.
 * 
 * @param record - Object containing resources and/or string values
 * @returns Normalized environment variables object
 * 
 * @example
 * normalizeResourceEnv({
 *   apiUrl: 'https://api.example.com',
 *   database: { type: ResourceType.Postgres, ... }
 * })
 */
export function normalizeResourceEnv(
  record: Record<string, Resource | string>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      env[environmentCase(k)] = value;
      continue;
    }

    const processor = processors[value.type];
    if (processor) {
      Object.assign(env, processor(k, value));
    } else {
      console.warn(`No processor found for resource type: `, { value });
    }
  }

  return env;
}

/**
 * AWS API Gateway V2 resource type.
 * Represents an HTTP/WebSocket API.
 */
export type ApiGatewayV2 = {
  type: ResourceType.ApiGatewayV2;
  url: string;
};

/**
 * PostgreSQL database resource type.
 * Contains all connection details needed to connect to the database.
 */
export type Postgres = {
  database: string;
  host: string;
  password: string;
  port: number;
  type: ResourceType.Postgres;
  username: string;
};

/**
 * AWS Lambda Function resource type.
 */
export type Function = {
  name: string;
  type: ResourceType.Function;
};

/**
 * AWS S3 Bucket resource type.
 */
export type Bucket = {
  name: string;
  type: ResourceType.Bucket;
};

/**
 * AWS VPC (Virtual Private Cloud) resource type.
 */
export type Vpc = {
  bastion: string;
  type: ResourceType.Vpc;
};

/**
 * Secret resource type for storing sensitive values.
 */
export type Secret = {
  type: ResourceType.Secret;
  value: string;
};

/**
 * Union type of all supported SST resource types.
 */
export type Resource =
  | ApiGatewayV2
  | Postgres
  | Function
  | Bucket
  | Vpc
  | Secret;

/**
 * Function type for processing a specific resource type into environment variables.
 * 
 * @template K - The specific resource type
 * @param name - The resource name
 * @param value - The resource value
 * @returns Object mapping environment variable names to values
 */
export type ResourceProcessor<K extends Resource> = (
  name: string,
  value: K,
) => Record<string, string | number>;
