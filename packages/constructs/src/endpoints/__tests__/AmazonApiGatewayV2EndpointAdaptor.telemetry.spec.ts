import { createMockContext, createMockV2Event } from '@geekmidas/testkit/aws';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RestApi } from '../../rest-api';
import type { Telemetry } from '../../telemetry';
import { AmazonApiGatewayV2Endpoint } from '../AmazonApiGatewayV2EndpointAdaptor';

/**
 * A Lambda endpoint reports every request to the telemetry it was given: the
 * start, then either the response it sent or the error it failed with — each
 * against the context the start returned, which is how a span is closed.
 */

const api = new RestApi('Test', { path: '.', defaultAuthorizer: 'none' });

function recorder() {
	const calls: { hook: string; ctx: unknown; detail: unknown }[] = [];
	let n = 0;
	const telemetry: Telemetry = {
		onRequestStart: (request) => {
			const ctx = { span: ++n };
			calls.push({ hook: 'start', ctx, detail: request.event });
			return ctx;
		},
		onRequestEnd: (ctx, response) => {
			calls.push({ hook: 'end', ctx, detail: response });
		},
		onRequestError: (ctx, error) => {
			calls.push({ hook: 'error', ctx, detail: error });
		},
	};
	return { calls, telemetry };
}

describe('AmazonApiGatewayV2Endpoint — telemetry', () => {
	it('closes the span it opened with the response it sent', async () => {
		const { calls, telemetry } = recorder();
		const endpoint = api
			.get('/ping')
			.output(z.object({ ok: z.boolean() }))
			.handle(async () => ({ ok: true }));
		const adapter = new AmazonApiGatewayV2Endpoint(endpoint, { telemetry });

		const response = await adapter.handler(
			createMockV2Event({ routeKey: 'GET /ping', rawPath: '/ping' }),
			createMockContext(),
		);

		expect(response.statusCode).toBe(200);
		expect(calls.map((call) => call.hook)).toEqual(['start', 'end']);
		expect(calls[1]!.ctx).toBe(calls[0]!.ctx);
		expect(calls[1]!.detail).toMatchObject({
			statusCode: 200,
			body: JSON.stringify({ ok: true }),
		});
	});

	it('reports a failure against the span it opened', async () => {
		const { calls, telemetry } = recorder();
		const endpoint = api
			.get('/boom')
			.output(z.object({ ok: z.boolean() }))
			.handle(async () => {
				throw new TypeError('kaput');
			});
		const adapter = new AmazonApiGatewayV2Endpoint(endpoint, { telemetry });

		const response = await adapter.handler(
			createMockV2Event({ routeKey: 'GET /boom', rawPath: '/boom' }),
			createMockContext(),
		);

		expect(response.statusCode).toBe(500);
		const error = calls.find((call) => call.hook === 'error');
		expect(error?.ctx).toBe(calls[0]!.ctx);
		expect(error?.detail).toBeInstanceOf(TypeError);
		expect((error?.detail as Error).message).toBe('kaput');
	});

	it('stringifies a non-JSON body that is not already text', async () => {
		const endpoint = api
			.get('/count')
			.output(z.number())
			.responseType('text/plain')
			.handle(async () => 42);
		const adapter = new AmazonApiGatewayV2Endpoint(endpoint);

		const response = await adapter.handler(
			createMockV2Event({ routeKey: 'GET /count', rawPath: '/count' }),
			createMockContext(),
		);

		expect(response.body).toBe('42');
		expect(response.headers?.['content-type']).toBe('text/plain');
	});
});
