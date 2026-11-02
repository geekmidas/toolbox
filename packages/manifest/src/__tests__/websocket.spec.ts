import { describe, expect, it } from 'vitest';
import {
	apiGatewayWebSocketUrl,
	InvalidApiGatewayWebSocketUrl,
	parseApiGatewayWebSocketUrl,
} from '../websocket';

describe('apiGatewayWebSocketUrl', () => {
	const target = {
		region: 'eu-west-1',
		endpoint: 'https://abc123.execute-api.eu-west-1.amazonaws.com/$default',
		table: 'myapp-prod-RealtimeConnections',
	};

	it('reads back what it wrote', () => {
		expect(parseApiGatewayWebSocketUrl(apiGatewayWebSocketUrl(target))).toEqual(
			target,
		);
	});

	it('carries an emulator address for the table when given one', () => {
		const withEmulator = { ...target, tableEndpoint: 'http://localhost:4566' };

		expect(
			parseApiGatewayWebSocketUrl(apiGatewayWebSocketUrl(withEmulator)),
		).toEqual(withEmulator);
	});

	it.each([
		['region', 'redis://localhost:6379'],
		['endpoint', 'apigateway://eu-west-1?table=t'],
		['table', 'apigateway://eu-west-1?endpoint=https%3A%2F%2Fx'],
	])('names the missing %s', (missing, value) => {
		expect.assertions(2);
		try {
			parseApiGatewayWebSocketUrl(value);
		} catch (error) {
			expect(error).toBeInstanceOf(InvalidApiGatewayWebSocketUrl);
			expect((error as InvalidApiGatewayWebSocketUrl).missing).toBe(missing);
		}
	});
});
