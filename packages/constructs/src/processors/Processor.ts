import type { Logger } from '@geekmidas/logger';
import type { InferStandardSchema } from '@geekmidas/schema';
import type { Service, ServiceRecord } from '@geekmidas/services';
import type { StorageClient } from '@geekmidas/storage';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { Construct, ConstructType } from '../Construct';
import type { ParsedPattern, PatternParams } from './pattern';

/**
 * Where a processor's results are kept, under its file server's bucket.
 *
 * Written through on every result marked `immutable` and read before the
 * handler runs, so a derivative is made once. Exported so the bucket's expiry
 * can name it.
 */
export { DERIVED_PREFIX } from '@geekmidas/manifest';

/** How long a response may be kept, by a browser and by the edge. */
export type ProcessorCache =
	/** Never changes for these parameters and this key: kept for a year. */
	| 'immutable'
	/** Kept this many seconds. */
	| { maxAge: number }
	/** Not kept. */
	| 'none';

/** What a processor handler returns. */
export interface ProcessorResult {
	body: Uint8Array | string;
	contentType: string;
	/**
	 * `immutable` results are also kept in the bucket, so the next request
	 * for them never runs the handler. Defaults to an hour, kept nowhere.
	 */
	cache?: ProcessorCache;
}

/** The object a request addresses, read from the bucket on first use. */
export interface SourceObject {
	readonly key: string;
	bytes(): Promise<Uint8Array>;
	stream(): Promise<ReadableStream<Uint8Array>>;
	/** The type it was stored with. */
	contentType(): Promise<string | undefined>;
}

export interface ProcessorContext<
	TParams,
	TServices extends Service[],
	TLogger extends Logger,
> {
	params: TParams;
	key: string;
	object: SourceObject;
	logger: TLogger;
	services: ServiceRecord<TServices>;
}

export type ProcessorHandler<
	TParams,
	TServices extends Service[],
	TLogger extends Logger,
> = (
	context: ProcessorContext<TParams, TServices, TLogger>,
) => Promise<ProcessorResult> | ProcessorResult;

/** What a processor's parameters parse to: its schema's output, or the raw strings. */
export type ProcessorParams<
	TPattern extends string,
	TSchema extends StandardSchemaV1 | undefined,
> = TSchema extends StandardSchemaV1
	? InferStandardSchema<TSchema>
	: PatternParams<TPattern>;

/**
 * A processor — a handler behind one path pattern of a file server, which
 * makes a derivative of an open object on read: a thumbnail, a page of a PDF.
 *
 * Built from the file server (`assets.process('/i/:width/*')`), so it carries
 * the bucket it reads and the open paths it may serve. Its parameters' schema
 * is the allowlist: a request outside it is refused before anything runs, so
 * nobody can mint new work — or new cache entries — by varying a number.
 */
export class Processor<
	TPattern extends string = string,
	TSchema extends StandardSchemaV1 | undefined = undefined,
	TServices extends Service[] = [],
	TLogger extends Logger = Logger,
> extends Construct<TLogger, undefined, TServices> {
	__IS_PROCESSOR__ = true;

	static isProcessor(obj: unknown): obj is Processor<string, any, any, any> {
		return Boolean(
			obj &&
				(obj as { __IS_PROCESSOR__?: boolean }).__IS_PROCESSOR__ === true &&
				(obj as Construct).type === ConstructType.Processor,
		);
	}

	constructor(
		readonly parsed: ParsedPattern,
		readonly handler: ProcessorHandler<
			ProcessorParams<TPattern, TSchema>,
			TServices,
			TLogger
		>,
		readonly options: {
			/** The file server's surface id — the unit that runs it. */
			surfaceId: string;
			/** The bucket it reads from and keeps derivatives in. */
			bucketId: string;
			/** How it reaches that bucket. */
			origin: Service<string, StorageClient>;
			/** Whether a key is one of the file server's open paths. */
			serves: (key: string) => boolean;
			paramsSchema?: TSchema;
			/** Packages with native code, installed for the target. */
			native: readonly string[];
			logger: TLogger;
			services: TServices;
			constructs: string[];
			timeout?: number;
			memorySize?: number;
		},
	) {
		super(
			ConstructType.Processor,
			options.logger,
			// The bucket is reached like any service — which is also how its URL
			// is found by the environment sniffer.
			[options.origin, ...options.services] as unknown as TServices,
			[],
			undefined,
			options.timeout,
			options.memorySize,
			undefined,
			// The bucket is an edge of its process, so the unit running it is
			// handed the bucket's address.
			[...new Set([options.bucketId, ...options.constructs])],
		);
		this.owner = options.surfaceId;
	}

	/** The pattern it answers, as written. */
	get pattern(): TPattern {
		return this.parsed.pattern as TPattern;
	}

	/** The literal path the edge routes to it — `/i/`. */
	get prefix(): string {
		return this.parsed.prefix;
	}

	get native(): readonly string[] {
		return this.options.native;
	}

	get surfaceId(): string {
		return this.options.surfaceId;
	}

	get bucketId(): string {
		return this.options.bucketId;
	}
}
