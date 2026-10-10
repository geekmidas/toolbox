import { mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { itWithDir } from '@geekmidas/testkit/os';
import { describe, expect } from 'vitest';
import { createTestFile } from '../../__tests__/test-helpers';
import {
	TELEMETRY_PACKAGES,
	TelemetryPackagesMissing,
} from '../../generators/telemetry';
import { normalizeWorkspace } from '../../workspace/index';
import { buildApp } from '../index';

/**
 * `gkm build` (and `gkm dev`, which runs the same build) decides telemetry
 * from the surface's edge to a `Telemetry` construct: with it, the entry's
 * `telemetry.ts` starts the SDK, and the build fails without the packages;
 * without it, the entry gets the stub, whatever is installed.
 */

async function project(
	dir: string,
	options: { telemetry: boolean; site?: boolean },
) {
	if (options.site !== undefined) {
		await createTestFile(
			dir,
			'src/site.ts',
			`import { StaticSite } from '@geekmidas/constructs/site';
import { api, telemetry } from './api.js';

export const web = new StaticSite('Web', {
  path: 'web',
  ${options.site ? 'telemetry,' : ''}
}).dependsOn([api]);
`,
		);
	}
	await createTestFile(
		dir,
		'src/api.ts',
		`import { RestApi } from '@geekmidas/constructs/rest-api';
import { Telemetry } from '@geekmidas/constructs/telemetry';

export const telemetry = new Telemetry('Telemetry', {
  ignorePaths: ['/ready'],
  attributes: { 'service.namespace': 'shop' },
});

export const api = new RestApi('Api', {
  path: '.',
  defaultAuthorizer: 'none',
  ${options.telemetry ? 'telemetry,' : ''}
});
`,
	);
	await createTestFile(
		dir,
		'src/endpoints.ts',
		`import { z } from 'zod';
import { api } from './api.js';

export const probe = api
  .get('/probe')
  .telemetry({ ignore: true })
  .output(z.object({ ok: z.boolean() }))
  .handle(async () => ({ ok: true }));
`,
	);
}

const build = (dir: string) =>
	buildApp({
		config: {
			stages: { local: 'development', deployed: ['production'] },
			constructs: './src/**/*.ts',
			openapi: true,
		},
		workspaceRoot: dir,
		appRoot: dir,
		target: 'server',
		enableOpenApi: false,
		cacheBackend: 'redis',
		eventsBackend: 'pgboss',
		workspaceName: 'shop',
		workspace: normalizeWorkspace(
			{
				name: 'shop',
				stages: { local: 'development', deployed: ['production'] },
			},
			dir,
		),
	});

describe('the build’s telemetry, from the surface’s edge', () => {
	itWithDir(
		'starts the SDK for a surface with the edge, with the node’s and each route’s settings',
		async ({ dir }) => {
			await project(dir, { telemetry: true });

			await build(dir);

			const telemetry = await readFile(
				join(dir, '.gkm', 'server', 'telemetry.ts'),
				'utf-8',
			);
			expect(telemetry).toContain(
				"await import('@geekmidas/telescope/instrumentation')",
			);
			expect(telemetry).toContain('serviceName: "Api",');
			expect(telemetry).toContain('serviceNamespace: "shop",');
			expect(telemetry).toContain(
				'resourceAttributes: {"service.namespace":"shop"},',
			);
			expect(telemetry).toContain('const IGNORE_PATHS: string[] = ["/ready"];');
			expect(telemetry).toContain(
				'"method":"GET","pattern":"^/probe/?$","ignore":true',
			);
		},
	);

	itWithDir(
		'gives a surface without the edge the stub, which loads nothing',
		async ({ dir }) => {
			await project(dir, { telemetry: false });

			await build(dir);

			const telemetry = await readFile(
				join(dir, '.gkm', 'server', 'telemetry.ts'),
				'utf-8',
			);
			expect(telemetry).not.toContain('@geekmidas/telescope');
			expect(telemetry).toContain('return undefined;');
		},
	);

	itWithDir(
		'fails for a surface with the edge when an OpenTelemetry package does not resolve',
		async ({ dir }) => {
			await project(dir, { telemetry: true });
			// A telescope of the app's own, nearer than the workspace's, with
			// none of the OpenTelemetry packages beside it.
			const telescope = join(dir, 'node_modules', '@geekmidas', 'telescope');
			mkdirSync(telescope, { recursive: true });
			writeFileSync(
				join(telescope, 'package.json'),
				JSON.stringify({ name: '@geekmidas/telescope' }),
			);

			const error = await build(dir).catch((e: unknown) => e);

			expect(error).toBeInstanceOf(TelemetryPackagesMissing);
			expect((error as TelemetryPackagesMissing).missing).toEqual([
				...TELEMETRY_PACKAGES,
			]);
			expect((error as TelemetryPackagesMissing).command).toBe(
				`pnpm --dir . add ${TELEMETRY_PACKAGES.join(' ')}`,
			);
		},
	);

	itWithDir(
		'generates a client that propagates trace context for a site with the edge',
		async ({ dir }) => {
			await project(dir, { telemetry: true, site: true });

			await build(dir);

			const client = await readFile(
				join(dir, '.gkm', 'client', 'api.ts'),
				'utf-8',
			);
			expect(client).toContain(
				'export const telemetryDefault: boolean | ClientTelemetryOptions = { sampleRate: 1 };',
			);
		},
	);

	itWithDir(
		'generates one that propagates nothing when no site that calls it has the edge',
		async ({ dir }) => {
			await project(dir, { telemetry: true, site: false });

			await build(dir);

			const client = await readFile(
				join(dir, '.gkm', 'client', 'api.ts'),
				'utf-8',
			);
			expect(client).toContain(
				'export const telemetryDefault: boolean | ClientTelemetryOptions = false;',
			);
		},
	);
});
