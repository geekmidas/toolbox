import { describe, expect, it } from 'vitest';
import { RestApi } from '../../rest-api';
import { Telemetry } from '../../telemetry';

const api = new RestApi('Api', {
	path: 'apps/api',
	defaultAuthorizer: 'none',
	telemetry: new Telemetry('Telemetry'),
});

describe('EndpointBuilder.telemetry', () => {
	it('carries `ignore` to the built endpoint, where the build reads it', () => {
		const health = api
			.get('/health')
			.telemetry({ ignore: true })
			.handle(async () => ({ ok: true }));

		expect(health.telemetry).toEqual({ ignore: true });
	});

	it('carries a route’s own attributes', () => {
		const endpoint = api
			.get('/users/:id')
			.telemetry({ attributes: { 'app.area': 'users' } })
			.handle(async () => ({}));

		expect(endpoint.telemetry).toEqual({
			attributes: { 'app.area': 'users' },
		});
	});

	it('is absent on a route that says nothing', () => {
		const endpoint = api.get('/users').handle(async () => []);

		expect(endpoint.telemetry).toBeUndefined();
	});

	it('leaves the builder it came from as it was', () => {
		const base = api.get('/health');
		const ignored = base.telemetry({ ignore: true });

		expect(ignored).not.toBe(base);
		expect(base.handle(async () => ({})).telemetry).toBeUndefined();
		expect(ignored.handle(async () => ({})).telemetry).toEqual({
			ignore: true,
		});
	});
});
