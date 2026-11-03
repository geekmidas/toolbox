import { EnvironmentParser } from '@geekmidas/envkit';
import type { Logger } from '@geekmidas/logger';
import { beforeEach, describe, expect, it } from 'vitest';
import { WebSocketApi } from '../../websocket-api';
import {
	registerWebSocketSinkDriver,
	UnregisteredWebSocketScheme,
} from '../drivers';
import { RecordingSink } from '../testing';

const silent = {
	debug() {},
	info() {},
	warn() {},
	error() {},
	fatal() {},
	trace() {},
	child() {
		return silent;
	},
} as unknown as Logger;

const API_GATEWAY =
	'apigateway://eu-west-1?endpoint=https%3A%2F%2Fexample.com&table=connections';

function register(
	realtime: WebSocketApi<'Realtime'>,
	connectionString: string,
) {
	return realtime.service.register({
		envParser: new EnvironmentParser({
			REALTIME_PUBLISHER_CONNECTION_STRING: connectionString,
		}),
		context: undefined as never,
	});
}

describe('services.<surface> by publisher-string scheme', () => {
	beforeEach(() => {
		(globalThis as { [k: symbol]: Map<string, unknown> | undefined })[
			Symbol.for('@geekmidas/constructs/websocket-sinks')
		]?.clear();
	});

	it('names the build to use when nothing registered the apigateway: sink', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});

		const error = await register(realtime, API_GATEWAY).catch((e) => e);

		expect(error).toBeInstanceOf(UnregisteredWebSocketScheme);
		expect(error).toMatchObject({
			surface: 'Realtime',
			scheme: 'apigateway:',
		});
	});

	it('sends through the sink the entry registered for the scheme', async () => {
		const realtime = new WebSocketApi('Realtime', {
			path: '.',
			logger: silent,
		});
		const sink = new RecordingSink();
		const seen: string[] = [];
		registerWebSocketSinkDriver({
			scheme: 'apigateway:',
			sink: (connectionString) => {
				seen.push(connectionString);
				return sink;
			},
		});

		const publisher = await register(realtime, API_GATEWAY);
		await publisher.close('c1');

		expect(seen).toEqual([API_GATEWAY]);
		expect(sink.closed).toEqual([{ ids: ['c1'], code: 1000, reason: '' }]);
	});
});
