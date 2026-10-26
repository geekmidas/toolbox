import type { EnvironmentParser } from '@geekmidas/envkit';
import { defaultEnvParser } from '../endpoints/surfaceEnv';
import type { Processor } from './Processor';
import { processorServer } from './runProcessor';

/** The parts of a Lambda function URL event a processor reads. */
export interface FunctionUrlEvent {
	rawPath: string;
	requestContext: { http: { method: string } };
}

/** What a function URL answers with. */
export interface FunctionUrlResult {
	statusCode: number;
	headers: Record<string, string>;
	body: string;
	isBase64Encoded: boolean;
}

/**
 * A processor as a Lambda behind a function URL — the CDN's origin for its
 * pattern on AWS. The URL takes IAM auth and the CDN signs each request, so
 * the function cannot be called around the cache.
 */
export class AWSLambdaProcessor {
	private readonly serve: ReturnType<typeof processorServer>;

	constructor(
		processor: Processor<string, any, any, any>,
		envParser: EnvironmentParser<{}> = defaultEnvParser(),
	) {
		this.serve = processorServer([processor], envParser);
	}

	handler = async (event: FunctionUrlEvent): Promise<FunctionUrlResult> => {
		const response = await this.serve({
			method: event.requestContext.http.method,
			path: event.rawPath,
		});
		if (!response) {
			return {
				statusCode: 404,
				headers: { 'cache-control': 'public, max-age=60' },
				body: '',
				isBase64Encoded: false,
			};
		}
		const body = response.body ?? '';
		return {
			statusCode: response.status,
			headers: response.headers,
			body:
				typeof body === 'string' ? body : Buffer.from(body).toString('base64'),
			isBase64Encoded: typeof body !== 'string',
		};
	};
}
