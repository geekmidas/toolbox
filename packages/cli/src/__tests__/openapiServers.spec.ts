import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect, it } from 'vitest';
import { EndpointGenerator } from '../generators/EndpointGenerator';
import { generateOpenApi } from '../openapi';
import { surfaceServers } from '../openapiServers';
import { createMockBuildContext } from './test-helpers';

/**
 * A surface's document lists where it is reached, one server per deployed
 * stage, from the workspace's `domains` — unless the surface lists its own.
 */
const domains = { staging: 'staging.myapp.com', production: 'myapp.com' };

describe('surfaceServers', () => {
	it('is the surface’s label under each stage’s domain, in stage order', () => {
		expect(surfaceServers({ id: 'Api' }, domains)).toEqual([
			{ url: 'https://api.staging.myapp.com', description: 'staging' },
			{ url: 'https://api.myapp.com', description: 'production' },
		]);
	});

	it('uses the surface’s subdomain over its id', () => {
		expect(
			surfaceServers({ id: 'PaymentsApi', subdomain: 'pay' }, domains)[1],
		).toEqual({ url: 'https://pay.myapp.com', description: 'production' });
	});

	it('is none without domains', () => {
		expect(surfaceServers({ id: 'Api' }, undefined)).toEqual([]);
	});
});

describe('a two-stage workspace', () => {
	const api = new RestApi('Api', {
		path: '.',
		defaultAuthorizer: 'none',
		contact: { name: 'Platform', email: 'platform@example.com' },
		license: { name: 'Apache-2.0', identifier: 'Apache-2.0' },
	});
	const health = api.get('/health').handle(async () => ({ ok: true }));

	itWithDir(
		'documents both servers in the generated client',
		async ({ dir }) => {
			const result = await generateOpenApi([health], {
				openapi: { enabled: true },
				root: dir,
				silent: true,
				domains,
			});

			const content = await readFile(result!.outputPaths[0]!, 'utf-8');
			const info = content.slice(
				content.indexOf('export const apiInfo'),
				content.indexOf('as const;', content.indexOf('export const apiInfo')),
			);

			expect(info).toContain('"url": "https://api.staging.myapp.com"');
			expect(info).toContain('"url": "https://api.myapp.com"');
			expect(info).toContain('"email": "platform@example.com"');
			expect(info).toContain('"identifier": "Apache-2.0"');
		},
	);

	itWithDir(
		'documents both servers on the generated server',
		async ({ dir }) => {
			const outputDir = join(dir, 'output');
			await mkdir(outputDir, { recursive: true });

			await new EndpointGenerator().build(
				{ ...createMockBuildContext(), domains },
				[
					{
						key: 'health',
						name: 'health',
						construct: health,
						path: {
							relative: join(dir, 'health.ts'),
							absolute: join(dir, 'health.ts'),
						},
					} as never,
				],
				outputDir,
				{ target: 'server', enableOpenApi: true },
			);

			const endpoints = await readFile(
				join(outputDir, 'endpoints.ts'),
				'utf-8',
			);
			expect(endpoints).toContain(
				'"url":"https://api.staging.myapp.com","description":"staging"',
			);
			expect(endpoints).toContain('"url":"https://api.myapp.com"');
		},
	);
});
