// Re-export everything from SstEnvironmentBuilder

// Re-export types from EnvironmentBuilder
export type {
	EnvironmentBuilderOptions,
	EnvRecord,
	EnvValue,
} from './EnvironmentBuilder';

// Re-export environmentCase from EnvironmentBuilder
export { environmentCase } from './EnvironmentBuilder';
export {
	type ApiGatewayV2,
	type Bucket,
	type Function,
	type Postgres,
	type ResourceProcessor,
	ResourceType,
	type Secret,
	type SnsTopic,
	SstEnvironmentBuilder,
	type SstResource,
	sstResolvers,
	type Vpc,
} from './SstEnvironmentBuilder';

// Import for deprecated function
import {
	SstEnvironmentBuilder,
	type SstResource,
} from './SstEnvironmentBuilder';

/**
 * @deprecated Use `new SstEnvironmentBuilder(record).build()` instead.
 *
 * Normalizes SST resources and plain strings into environment variables.
 * Processes resources based on their type and converts names to environment case.
 *
 * @param record - Object containing resources and/or string values
 * @returns Normalized environment variables object
 *
 * @example
 * // Old usage (deprecated):
 * normalizeResourceEnv({ database: postgresResource })
 *
 * // New usage:
 * new SstEnvironmentBuilder({ database: postgresResource }).build()
 */
export function normalizeResourceEnv(
	record: Record<string, SstResource | string>,
): Record<string, string | number | boolean | Record<string, unknown>> {
	return new SstEnvironmentBuilder(record).build();
}

// Keep Resource type as deprecated alias for backwards compatibility
/**
 * @deprecated Use `SstResource` instead.
 */
export type Resource = SstResource;
