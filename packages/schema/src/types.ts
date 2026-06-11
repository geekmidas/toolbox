import type { StandardSchemaV1 } from '@standard-schema/spec';

export type InferStandardSchema<T> = T extends StandardSchemaV1
	? StandardSchemaV1.InferOutput<T>
	: never;

/**
 * The *input* type a Standard Schema accepts (before any transform/coercion),
 * as opposed to {@link InferStandardSchema} which is the output type.
 *
 * Use this for the value a producer must HAND TO the schema (e.g. an endpoint
 * handler's return that will be parsed by its output schema): the schema may
 * coerce it (a `Date` → an ISO `string`, a default applied, etc.), so the
 * producer should be allowed to supply the looser input type while consumers
 * still see the narrower output type.
 */
export type InferStandardSchemaInput<T> = T extends StandardSchemaV1
	? StandardSchemaV1.InferInput<T>
	: never;

export type ComposableStandardSchema =
	| StandardSchemaV1
	| {
			[key: string]: StandardSchemaV1 | undefined;
	  };

export type InferComposableStandardSchema<T> = T extends StandardSchemaV1
	? StandardSchemaV1.InferOutput<T>
	: T extends { [key: string]: StandardSchemaV1 | undefined }
		? {
				[K in keyof T as T[K] extends StandardSchemaV1
					? K
					: never]: T[K] extends StandardSchemaV1
					? StandardSchemaV1.InferOutput<T[K]>
					: never;
			}
		: {};
