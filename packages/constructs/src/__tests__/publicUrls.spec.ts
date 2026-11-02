import { EnvironmentParser } from '@geekmidas/envkit';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { RestApi } from '../rest-api';
import { StaticSite } from '../site';
import { Worker } from '../worker';

const register = <T>(
	service: { register: (options: never) => T },
	env: Record<string, string>,
) => service.register({ envParser: new EnvironmentParser(env) } as never);

const api = new RestApi('Api', { path: 'apps/api', defaultAuthorizer: 'none' });
const web = new StaticSite('Web', { path: 'apps/web', variant: 'next' });
const worker = new Worker('Jobs');

describe('depending on a public URL', () => {
	it('a site is a service under its id, whose client is its public URL', () => {
		expect(web.service.serviceName).toBe('web');
		expect(register(web.service, { WEB_URL: 'https://web.example.com' })).toBe(
			'https://web.example.com',
		);
	});

	it('an API is a service under its id, whose client is its public URL', () => {
		expect(api.service.serviceName).toBe('api');
		expect(register(api.service, { API_URL: 'https://api.example.com' })).toBe(
			'https://api.example.com',
		);
	});

	it('keeps the service on the copy `.auth()` returns', () => {
		const authed = api.auth({
			id: 'Auth',
			declare: () => [],
			verify: async () => null,
		} as never);
		expect(authed.service.serviceName).toBe('api');
	});

	it('lets a cron depend on a site and an API, and records both edges', async () => {
		const cron = worker
			.cron('rate(1 day)')
			.dependsOn([web, api])
			.handle(async ({ services }) => {
				expectTypeOf(services.web).toEqualTypeOf<string>();
				expectTypeOf(services.api).toEqualTypeOf<string>();
				return `${services.web}/inbox`;
			});

		expect(cron.constructs).toEqual(['Web', 'Api']);
		// What a deploy reads to hand the worker its keys.
		expect(await cron.getEnvironment()).toEqual(['API_URL', 'WEB_URL']);
	});

	it('lets an endpoint depend on the site it builds links to', async () => {
		const endpoint = api
			.post('/invites')
			.dependsOn([web])
			.handle(async ({ services }) => {
				expectTypeOf(services.web).toEqualTypeOf<string>();
				return {};
			});

		expect(endpoint.constructs).toEqual(['Web']);
		expect(await endpoint.getEnvironment()).toEqual(['WEB_URL']);
	});
});
