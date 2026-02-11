import {
	EnvironmentBuilder,
	type EnvironmentBuilderOptions,
	type EnvironmentResolver,
	type EnvRecord,
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
	SSTDynamo = 'sst:aws:Dynamo',
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
 * AWS DynamoDB Table resource type.
 */
export type Dynamo = {
	type: ResourceType.SSTDynamo;
	name: string;
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
	| SnsTopic
	| Dynamo;

// Value types without the `type` key (for resolver parameters)
type SecretValue = Omit<Secret, 'type'>;
type PostgresValue = Omit<Postgres, 'type'>;
type BucketValue = Omit<Bucket, 'type'>;
type SnsTopicValue = Omit<SnsTopic, 'type'>;
type DynamoValue = Omit<Dynamo, 'type'>;

/**
 * Function type for processing a specific resource type into environment variables.
 *
 * @template K - The specific resource type (without `type` key)
 * @param name - The resource name
 * @param value - The resource value (without `type` key)
 * @returns Object mapping environment variable names to values
 */
export type ResourceProcessor<K> = (name: string, value: K) => EnvRecord;

// SST Resource Resolvers (receive values without `type` key)

const secretResolver = (name: string, value: SecretValue) => ({
	[name]: value.value,
});

const postgresResolver = (key: string, value: PostgresValue) => ({
	[`${key}Name`]: value.database,
	[`${key}Host`]: value.host,
	[`${key}Password`]: value.password,
	[`${key}Port`]: value.port,
	[`${key}Username`]: value.username,
});

const bucketResolver = (name: string, value: BucketValue) => ({
	[`${name}Name`]: value.name,
});

const topicResolver = (name: string, value: SnsTopicValue) => ({
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
 * All known SST resource type strings.
 */
type SstResourceTypeString = `${ResourceType}`;

/**
 * Extracts the `type` string value from an input value.
 */
type ExtractType<T> = T extends { type: infer U extends string } ? U : never;

/**
 * Removes the `type` key from an object type.
 */
type OmitType<T> = T extends { type: string } ? Omit<T, 'type'> : never;

/**
 * Extracts all unique `type` values from a record (excluding plain strings).
 */
type AllTypeValues<TRecord extends Record<string, InputValue>> = {
	[K in keyof TRecord]: ExtractType<TRecord[K]>;
}[keyof TRecord];

/**
 * Extracts only the custom (non-SST) type values from a record.
 */
type CustomTypeValues<TRecord extends Record<string, InputValue>> = Exclude<
	AllTypeValues<TRecord>,
	SstResourceTypeString
>;

/**
 * For a given type value, finds the corresponding value type (without `type` key).
 */
type ValueForType<
	TRecord extends Record<string, InputValue>,
	TType extends string,
> = {
	[K in keyof TRecord]: TRecord[K] extends { type: TType }
		? OmitType<TRecord[K]>
		: never;
}[keyof TRecord];

/**
 * Generates typed resolvers for custom (non-SST) types in the input record.
 */
type CustomResolvers<TRecord extends Record<string, InputValue>> =
	CustomTypeValues<TRecord> extends never
		? Resolvers | undefined
		: {
				[TType in CustomTypeValues<TRecord>]: EnvironmentResolver<
					ValueForType<TRecord, TType>
				>;
			};

/**
 * SST-specific environment builder with built-in resolvers for all known
 * SST resource types.
 *
 * Wraps the generic EnvironmentBuilder with pre-configured SST resolvers.
 *
 * @template TRecord - The input record type for type inference
 *
 * @example
 * ```typescript
 * const env = new SstEnvironmentBuilder({
 *   database: { type: 'sst:aws:Postgres', host: '...', ... },
 *   apiKey: { type: 'sst:sst:Secret', value: 'secret' },
 *   appName: 'my-app',
 * }).build();
 *
 * // With custom resolvers (typed based on input)
 * const env = new SstEnvironmentBuilder(
 *   {
 *     database: postgresResource,
 *     custom: { type: 'my-custom' as const, data: 'foo' },
 *   },
 *   {
 *     // TypeScript requires 'my-custom' resolver with typed value
 *     'my-custom': (key, value) => ({ [`${key}Data`]: value.data }),
 *   }
 * ).build();
 * ```
 */
export class SstEnvironmentBuilder<
	TRecord extends Record<string, SstResource | InputValue | string>,
> {
	private readonly builder: EnvironmentBuilder<
		Record<string, InputValue>,
		Resolvers
	>;

	/**
	 * Create a new SST environment builder.
	 *
	 * @param record - Object containing SST resources, custom resources, and/or string values
	 * @param additionalResolvers - Optional custom resolvers (typed based on custom types in record)
	 * @param options - Optional configuration options
	 */
	constructor(
		record: TRecord,
		additionalResolvers?: CustomResolvers<TRecord>,
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

export type {
	EnvironmentBuilderOptions,
	EnvRecord,
	EnvValue,
} from './EnvironmentBuilder';
// Re-export useful types
export { environmentCase } from './EnvironmentBuilder';
