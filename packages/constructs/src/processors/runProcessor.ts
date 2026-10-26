import type { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { runWithRequestContext, ServiceDiscovery } from '@geekmidas/services';
import type { StorageClient } from '@geekmidas/storage';
import { defaultEnvParser } from '../endpoints/surfaceEnv';
import {
	DERIVED_PREFIX,
	type Processor,
	type ProcessorCache,
	type SourceObject,
} from './Processor';
import { fillPattern, matchPattern } from './pattern';

/** What a processor answers, for whichever server or function carries it. */
export interface ProcessorResponse {
	status: number;
	headers: Record<string, string>;
	body?: Uint8Array | string;
}

/** The object a request addressed is not in the bucket. */
export class ProcessorSourceMissing extends Error {
	constructor(readonly key: string) {
		super(`'${key}' is not in the bucket, so there is nothing to process.`);
		this.name = 'ProcessorSourceMissing';
	}
}

/** What a refusal or a miss may be kept for: long enough to absorb a burst. */
const SHORT = 'public, max-age=60';

/** The header a response carries, by how long it may be kept. */
export function cacheControl(cache: ProcessorCache | undefined): string {
	if (cache === 'immutable') return 'public, max-age=31536000, immutable';
	if (cache === 'none') return 'no-store';
	return `public, max-age=${cache?.maxAge ?? 3600}`;
}

/** Where a processor keeps the derivative for one request. */
export function derivedKey(
	processor: Processor<string, any, any, any>,
	params: Readonly<Record<string, string>>,
	key: string,
): string {
	return `${DERIVED_PREFIX}${fillPattern(processor.parsed, params, key).slice(1)}`;
}

export interface ProcessorRequestOptions {
	serviceDiscovery: ServiceDiscovery<any>;
	/** How the bucket is read through a presigned address. */
	fetch?: typeof fetch;
}

/**
 * Answer one request with the first processor whose pattern matches it, or
 * `undefined` when none does.
 *
 * In order: the parameters are parsed by the processor's schema (400 when it
 * refuses them); the key must be one of the file server's open paths (404
 * otherwise, as an unsigned read of it would be); a derivative already in the
 * bucket is answered without running anything; and only then is the handler
 * run, its `immutable` result written through for next time.
 */
export async function handleProcessorRequest(
	processors: readonly Processor<string, any, any, any>[],
	request: { method: string; path: string },
	options: ProcessorRequestOptions,
): Promise<ProcessorResponse | undefined> {
	const method = request.method.toUpperCase();

	for (const processor of processors) {
		const match = matchPattern(processor.parsed, request.path);
		if (!match) continue;

		if (method !== 'GET' && method !== 'HEAD') {
			return text(405, 'Method Not Allowed', 'no-store', {
				allow: 'GET, HEAD',
			});
		}

		return runWithRequestContext(
			{
				logger: processor.logger,
				requestId: `processor-${Date.now()}`,
				startTime: Date.now(),
				operation: `processor ${processor.pattern}`,
			},
			() => run(processor, match, options),
		);
	}

	return undefined;
}

/**
 * A request handler for a set of processors — what a generated entry serves
 * — with its services discovered from the default environment parser: the
 * process's environment and the credentials `gkm` injected.
 */
export function processorServer(
	processors: readonly Processor<string, any, any, any>[],
	envParser: EnvironmentParser<{}> = defaultEnvParser(),
): (request: {
	method: string;
	path: string;
}) => Promise<ProcessorResponse | undefined> {
	const serviceDiscovery = ServiceDiscovery.getInstance(envParser);
	return (request) =>
		handleProcessorRequest(processors, request, { serviceDiscovery });
}

async function run(
	processor: Processor<string, any, any, any>,
	match: { params: Record<string, string>; key: string },
	options: ProcessorRequestOptions,
): Promise<ProcessorResponse> {
	const logger = processor.logger as Logger;
	const fetcher = options.fetch ?? fetch;
	const { key } = match;

	const schema = processor.options.paramsSchema;
	let params: unknown = match.params;
	if (schema) {
		const parsed = await schema['~standard'].validate(match.params);
		if (parsed.issues) return text(400, 'Bad Request', SHORT);
		params = parsed.value;
	}

	// A derivative is never itself a source, and a private object is never
	// processed: a processor serves exactly what an unsigned read would.
	if (key.startsWith(DERIVED_PREFIX) || !processor.options.serves(key)) {
		return text(404, 'Not Found', SHORT);
	}

	const services: Record<string, unknown> =
		await options.serviceDiscovery.register(processor.services);
	const storage = services[
		processor.options.origin.serviceName
	] as StorageClient;

	const derived = derivedKey(processor, match.params, key);
	const kept = await read(storage, derived, fetcher);
	if (kept) {
		return {
			status: 200,
			headers: {
				'content-type': kept.contentType ?? 'application/octet-stream',
				'cache-control': cacheControl('immutable'),
				'x-gkm-processor': 'kept',
			},
			body: new Uint8Array(await kept.response.arrayBuffer()),
		};
	}

	let source: Response | undefined;
	const load = async (): Promise<Response> => {
		if (source) return source;
		const found = await read(storage, key, fetcher);
		if (!found) throw new ProcessorSourceMissing(key);
		source = found.response;
		return source;
	};
	const object: SourceObject = {
		key,
		bytes: async () => new Uint8Array(await (await load()).arrayBuffer()),
		stream: async () => {
			const body = (await load()).body;
			if (!body) throw new ProcessorSourceMissing(key);
			return body;
		},
		contentType: async () =>
			(await load()).headers.get('content-type') ?? undefined,
	};

	let result: Awaited<ReturnType<typeof processor.handler>>;
	try {
		result = await processor.handler({
			params,
			key,
			object,
			logger,
			services,
		} as never);
	} catch (error) {
		if (error instanceof ProcessorSourceMissing) {
			return text(404, 'Not Found', SHORT);
		}
		logger.error({ err: error, key }, 'Processor failed');
		return text(500, 'Internal Server Error', 'no-store');
	}

	const body =
		typeof result.body === 'string'
			? new TextEncoder().encode(result.body)
			: result.body;

	// Kept only when it can never change: anything else would be served from
	// the bucket long after its handler would have answered differently.
	if (result.cache === 'immutable') {
		await storage
			.upload(derived, Buffer.from(body), result.contentType)
			.catch((error: unknown) =>
				logger.warn({ err: error, key: derived }, 'Could not keep derivative'),
			);
	}

	return {
		status: 200,
		headers: {
			'content-type': result.contentType,
			'cache-control': cacheControl(result.cache),
			'x-gkm-processor': 'made',
		},
		body,
	};
}

/** An object through a presigned address, or nothing when it is not there. */
async function read(
	storage: StorageClient,
	key: string,
	fetcher: typeof fetch,
): Promise<{ response: Response; contentType?: string } | undefined> {
	const url = await storage.getDownloadURL({ path: key });
	const response = await fetcher(url);
	if (!response.ok) {
		await response.body?.cancel().catch(() => undefined);
		return undefined;
	}
	const contentType = response.headers.get('content-type') ?? undefined;
	return { response, ...(contentType ? { contentType } : {}) };
}

function text(
	status: number,
	body: string,
	cache: string,
	extra: Record<string, string> = {},
): ProcessorResponse {
	return {
		status,
		headers: {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': cache,
			...extra,
		},
		body,
	};
}
