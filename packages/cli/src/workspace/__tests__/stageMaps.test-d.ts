import { describe, expectTypeOf, it } from 'vitest';
import { defineWorkspace } from '../index';

/**
 * Every per-stage map in `defineWorkspace` is typed from `stages.deployed`,
 * inferred literally without `as const`: a key that is not a deployed stage
 * is a compile error.
 */
describe('per-stage maps typed from the deployed stages', () => {
	it('takes the deployed stages', () => {
		defineWorkspace({
			stages: { local: 'dev', deployed: ['prod', 'staging'] },
			domains: { prod: 'example.com', staging: 'staging.example.com' },
			dns: {
				'example.com': {
					provider: 'godaddy',
					records: { mode: 'cname', target: { prod: 'server.example.com' } },
				},
			},
			deploy: {
				objects: { prod: { provider: 's3' } },
				telemetry: { staging: false },
				compose: {
					proxy: { prod: 'traefik' },
					tls: { prod: { certFile: 'a.pem', keyFile: 'a.key' } },
				},
			},
		});
	});

	it('refuses a stage that is not deployed, in every map', () => {
		defineWorkspace({
			stages: { local: 'dev', deployed: ['prod'] },
			// @ts-expect-error — 'staging' is not a deployed stage
			domains: { staging: 'staging.example.com' },
		});
		defineWorkspace({
			stages: { local: 'dev', deployed: ['prod'] },
			// @ts-expect-error — the local stage has no domain
			domains: { dev: 'dev.example.com' },
		});
		defineWorkspace({
			stages: { local: 'dev', deployed: ['prod'] },
			deploy: {
				// @ts-expect-error — 'staging' is not a deployed stage
				objects: { staging: 'external' },
			},
		});
		defineWorkspace({
			stages: { local: 'dev', deployed: ['prod'] },
			deploy: {
				// @ts-expect-error — 'staging' is not a deployed stage
				telemetry: { staging: false },
			},
		});
		defineWorkspace({
			stages: { local: 'dev', deployed: ['prod'] },
			deploy: {
				compose: {
					// @ts-expect-error — 'staging' is not a deployed stage
					proxy: { staging: 'traefik' },
				},
			},
		});
		defineWorkspace({
			stages: { local: 'dev', deployed: ['prod'] },
			deploy: {
				compose: {
					// @ts-expect-error — 'staging' is not a deployed stage
					tls: { staging: { certFile: 'a.pem', keyFile: 'a.key' } },
				},
			},
		});
		defineWorkspace({
			stages: { local: 'dev', deployed: ['prod'] },
			dns: {
				'example.com': {
					provider: 'godaddy',
					records: {
						mode: 'cname',
						// @ts-expect-error — 'staging' is not a deployed stage
						target: { staging: 'server.example.com' },
					},
				},
			},
		});
	});

	it('infers the stages literally, without as const', () => {
		const config = {
			stages: { local: 'dev', deployed: ['prod'] },
		} as const;
		expectTypeOf(config.stages.deployed[0]).toEqualTypeOf<'prod'>();
		// A stages list built at runtime is a string[]: every key is accepted
		// by the types, and the schema checks them at load.
		const deployed: string[] = ['prod'];
		defineWorkspace({
			stages: { local: 'dev', deployed },
			domains: { anything: 'example.com' },
		});
	});
});
