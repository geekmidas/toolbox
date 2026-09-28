/**
 * What the sniffer says when it cannot see everything.
 *
 * A sniff that half-fails still deploys — the env vars it did capture are
 * real — so the only signal a person gets is the warning. These pin that the
 * warning is there, and names the app and the file.
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedAppConfig } from '../../workspace/types';
import {
	_sniffEntryFile,
	_sniffRouteFiles,
	sniffAppEnvironment,
} from '../sniffer';

const here = dirname(fileURLToPath(import.meta.url));
const entryApps = resolve(here, '__fixtures__/entry-apps');
const envParsers = resolve(here, '__fixtures__/env-parsers');
const routeApps = resolve(here, '__fixtures__/route-apps');

const app = (overrides: Partial<NormalizedAppConfig>): NormalizedAppConfig => ({
	type: 'backend',
	path: entryApps,
	port: 3000,
	dependencies: [],
	resolvedDeployTarget: 'dokploy',
	...overrides,
});

describe('sniffer warnings', () => {
	let warned: string[];
	const warnings = () => warned.join('\n');

	beforeEach(() => {
		warned = [];
		vi.spyOn(console, 'warn').mockImplementation((...a) => {
			warned.push(a.join(' '));
		});
	});

	afterEach(() => vi.restoreAllMocks());

	it('names a web app’s config file that threw, keeping what it read', async () => {
		const result = await sniffAppEnvironment(
			app({
				type: 'web',
				framework: 'nextjs',
				dependencies: ['api'],
				config: { client: './throwing-entry.ts' },
			}),
			'web',
			entryApps,
		);

		expect(result.requiredEnvVars.sort()).toEqual([
			'API_KEY',
			'NEXT_PUBLIC_API_URL',
			'PORT',
		]);
		expect(warnings()).toContain(
			'[sniffer] web: Config file "./throwing-entry.ts" threw error',
		);
	});

	it('adds no dependency URLs for a framework without a public prefix', async () => {
		const result = await sniffAppEnvironment(
			app({ type: 'web', framework: 'remix', dependencies: ['api'] }),
			'web',
			entryApps,
		);

		expect(result.requiredEnvVars).toEqual([]);
	});

	it('names an entry that threw', async () => {
		await sniffAppEnvironment(
			app({ entry: './throwing-entry.ts' }),
			'api',
			entryApps,
		);

		expect(warnings()).toContain(
			'[sniffer] api: Entry file threw error during sniffing',
		);
	});

	it('names an envParser that threw', async () => {
		const result = await sniffAppEnvironment(
			app({
				path: envParsers,
				envParser: './throwing-env-parser.ts#envParser',
			}),
			'api',
			envParsers,
		);

		expect(result.requiredEnvVars.sort()).toEqual(['API_KEY', 'PORT']);
		expect(warnings()).toContain(
			'[sniffer] api: envParser threw error during sniffing',
		);
	});

	it('reports an entry that exited before it could say anything', async () => {
		const result = await _sniffEntryFile(
			'./exiting-entry.ts',
			entryApps,
			entryApps,
		);

		expect(result.envVars).toEqual([]);
		expect(result.error?.message).toMatch(
			/^Failed to sniff entry file \(exit code 3\)/,
		);
	});

	describe('route files', () => {
		it('passes on a route file that failed to load, and sniffs the rest', async () => {
			const result = await sniffAppEnvironment(
				app({ path: routeApps, routes: './{broken,endpoints}/**/*.ts' }),
				'api',
				routeApps,
			);

			expect(result.requiredEnvVars).toContain('DATABASE_URL');
			expect(warnings()).toMatch(
				/\[sniffer\] Failed to import .*broken\/throws\.ts: route exploded/,
			);
		});

		it('names a routes sniff that ended without a report', async () => {
			const result = await sniffAppEnvironment(
				app({ path: routeApps, routes: './exits/*.ts' }),
				'api',
				routeApps,
			);

			expect(result.requiredEnvVars).toEqual([]);
			expect(warnings()).toContain(
				'[sniffer] api: Route sniffing threw error (env vars still captured): Failed to sniff route files (exit code 4)',
			);
		});

		it('needs a pattern to look for', async () => {
			const result = await _sniffRouteFiles([], routeApps, routeApps);

			expect(result.error?.message).toBe('No route patterns provided');
		});
	});
});
