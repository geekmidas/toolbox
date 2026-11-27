import type {
	DeclaredResponsesOf,
	DefaultSchemaOf,
} from '@geekmidas/constructs/endpoints';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { StandardSchemaV1 } from '@standard-schema/spec';

/**
 * The `responses` of an operation inferred from an endpoint: `.output()` under
 * 200, as before, and each response `.response()` declared under its own
 * status, with every content type it lists.
 */
export type InferResponses<TOutput> =
	keyof DeclaredResponsesOf<TOutput> extends never
		? { 200: { content: DefaultContentOf<TOutput> } }
		: {
				[S in 200 | keyof DeclaredResponsesOf<TOutput>]: {
					content: S extends 200
						? Content200<TOutput>
						: DeclaredContentOf<
								DeclaredResponsesOf<TOutput>[S &
									keyof DeclaredResponsesOf<TOutput>]
							>;
				};
			};

/** `.output()`'s body, as JSON — `never` when there is no `.output()`. */
type DefaultContentOf<TOutput> =
	DefaultSchemaOf<TOutput> extends StandardSchemaV1
		? { 'application/json': InferStandardSchema<DefaultSchemaOf<TOutput>> }
		: never;

/** Content type → the body a declared response's schema parses to. */
type DeclaredContentOf<M> = { [C in keyof M]: InferStandardSchema<M[C]> };

/**
 * What 200 answers. The endpoint's type does not say which status `.output()`
 * answers, so a declared 200 is merged with it rather than replacing it.
 */
type Content200<TOutput> = 200 extends keyof DeclaredResponsesOf<TOutput>
	? [DefaultContentOf<TOutput>] extends [never]
		? DeclaredContentOf<
				DeclaredResponsesOf<TOutput>[200 & keyof DeclaredResponsesOf<TOutput>]
			>
		: MergeContent<
				DefaultContentOf<TOutput>,
				DeclaredContentOf<
					DeclaredResponsesOf<TOutput>[200 & keyof DeclaredResponsesOf<TOutput>]
				>
			>
	: DefaultContentOf<TOutput>;

type MergeContent<A, B> = {
	[K in keyof A | keyof B]:
		| (K extends keyof A ? A[K] : never)
		| (K extends keyof B ? B[K] : never);
};

/** The 2xx statuses, as openapi-typescript and the generator key them. */
type SuccessKey =
	| 200
	| 201
	| 202
	| 203
	| 204
	| 205
	| 206
	| 207
	| 208
	| 226
	| '200'
	| '201'
	| '202'
	| '203'
	| '204'
	| '205'
	| '206'
	| '207'
	| '208'
	| '226'
	| '2XX';

/** An operation's `responses`, or `never` when it documents none. */
type ResponsesOf<Op> = 'responses' extends keyof Op
	? NonNullable<Op['responses' & keyof Op]>
	: never;

/**
 * A response's `application/json` body, or `never` when it has none. Read by
 * key rather than with `infer` against an optional key, which this compiler
 * matches even when the key is absent.
 */
type JsonBodyOf<Res> = 'content' extends keyof Res
	? [NonNullable<Res['content' & keyof Res]>] extends [never]
		? never
		: 'application/json' extends keyof NonNullable<Res['content' & keyof Res]>
			? NonNullable<Res['content' & keyof Res]>['application/json' &
					keyof NonNullable<Res['content' & keyof Res]>]
			: never
	: never;

/** The union of every 2xx JSON body an operation documents. */
export type JsonSuccessBody<Op> = {
	[S in keyof ResponsesOf<Op> & SuccessKey]: JsonBodyOf<ResponsesOf<Op>[S]>;
}[keyof ResponsesOf<Op> & SuccessKey];
