/**
 * The sniffer runs an app's own code — its entry, its envParser — so it runs
 * it in a sandbox: a real child, with none of the deploy's environment and a
 * timeout it cannot outlive.
 */

import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSandbox } from '../../sandbox/local';
import { type Sandbox, withSandbox } from '../../sandbox/sandbox';
import type { NormalizedAppConfig } from '../../workspace/types';
import {
	_sniffEnvParser,
	SNIFF_TIMEOUT_MS,
	sniffAllApps,
	sniffAppEnvironment,
} from '../sniffer';

const app = (overrides: Partial<NormalizedAppConfig>): NormalizedAppConfig => ({
	type: 'backend',
	path: 'apps/api',
	port: 3000,
	dependencies: [],
	resolvedDeployTarget: 'dokploy',
	...overrides,
});

/** Writes `process.env` where the test can read it, from inside the app. */
const RECORD_ENV = `import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./seen.json', import.meta.url), JSON.stringify(process.env));`;

const isRunning = (pid: number) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
};

describe('sniffing in a sandbox', () => {
	let root: string;
	const appDir = () => join(root, 'apps', 'api');
	const seen = () =>
		JSON.parse(readFileSync(join(appDir(), 'seen.json'), 'utf8')) as Record<
			string,
			string
		>;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-sniff-sandbox-')));
		mkdirSync(appDir(), { recursive: true });
		writeFileSync(
			join(appDir(), 'package.json'),
			JSON.stringify({ name: '@shop/api', type: 'module' }),
		);
		vi.stubEnv('AWS_SECRET_ACCESS_KEY', 'aws-secret-from-the-deploy');
		vi.stubEnv('DOKPLOY_API_TOKEN', 'dokploy-token-from-the-deploy');
		vi.stubEnv('NODE_OPTIONS', '--import tsx');
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		rmSync(root, { recursive: true, force: true });
	});

	it('runs an entry without the deploy’s credentials', async () => {
		writeFileSync(join(appDir(), 'index.ts'), RECORD_ENV);

		const result = await sniffAppEnvironment(
			app({ entry: './index.ts' }),
			'api',
			root,
		);

		expect(result.requiredEnvVars).toEqual([]);
		expect(seen()).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
		expect(seen()).not.toHaveProperty('DOKPLOY_API_TOKEN');
		expect(Object.values(seen()).join('\n')).not.toContain('from-the-deploy');
		expect(seen().PATH).toBe(process.env.PATH);
	});

	it('runs an envParser in a child, not in the deploy', async () => {
		writeFileSync(
			join(appDir(), 'env.ts'),
			`${RECORD_ENV}
export default (parser) =>
	parser.create((get) => ({ url: get('DATABASE_URL').string() }));`,
		);

		const result = await _sniffEnvParser('./env.ts', 'apps/api', root);

		expect(result.envVars).toEqual(['DATABASE_URL']);
		expect(seen()).not.toHaveProperty('AWS_SECRET_ACCESS_KEY');
		// Not this process, which the test runner marks: it was imported here,
		// with everything the deploy held, before.
		expect(seen()).not.toHaveProperty('VITEST');
	});

	it('kills a sniff that hangs, at the timeout', async () => {
		writeFileSync(
			join(appDir(), 'index.ts'),
			`import { writeFileSync } from 'node:fs';
writeFileSync(new URL('./pid', import.meta.url), String(process.pid));
// A server that never closes, as an entry that listens at import does.
setInterval(() => {}, 1000);
await new Promise(() => {});`,
		);

		const started = Date.now();
		const result = await sniffAppEnvironment(
			app({ entry: './index.ts' }),
			'api',
			root,
			{ timeoutMs: 2_000, logWarnings: false },
		);

		expect(Date.now() - started).toBeLessThan(10_000);
		expect(result.requiredEnvVars).toEqual([]);
		const pid = Number(readFileSync(join(appDir(), 'pid'), 'utf8'));
		expect(isRunning(pid)).toBe(false);
	});

	it('reports the hung sniff as timed out', async () => {
		writeFileSync(join(appDir(), 'index.ts'), 'setInterval(() => {}, 1000);');
		const warned: string[] = [];
		vi.spyOn(console, 'warn').mockImplementation((...a) => {
			warned.push(a.join(' '));
		});

		await sniffAppEnvironment(app({ entry: './index.ts' }), 'api', root, {
			timeoutMs: 1_000,
		});

		expect(warned.join('\n')).toMatch(
			/api: Entry file .*still running after 1s/,
		);
		vi.restoreAllMocks();
	});

	it('gives up after 30 seconds by default', () => {
		expect(SNIFF_TIMEOUT_MS).toBe(30_000);
	});

	it('uses the run’s sandbox, and the run’s alone', async () => {
		writeFileSync(join(appDir(), 'index.ts'), RECORD_ENV);
		const local = new LocalSandbox({ root });
		const ran: string[] = [];
		const sandbox: Sandbox = {
			root: local.root,
			isolating: true,
			env: { ...local.env, SANDBOX_MARK: 'host-sandbox' },
			exec: (command, args, options) => {
				ran.push(options.cwd);
				return local.exec(command, args, options);
			},
		};

		await withSandbox(sandbox, () =>
			sniffAllApps({ api: app({ entry: './index.ts' }) }, root),
		);

		expect(ran).toEqual([appDir()]);
		expect(seen().SANDBOX_MARK).toBe('host-sandbox');
	});

	it('refuses an app outside the project, and runs nothing', async () => {
		const outside = realpathSync(mkdtempSync(join(tmpdir(), 'gkm-outside-')));
		writeFileSync(join(outside, 'index.ts'), RECORD_ENV);
		try {
			const result = await sniffAppEnvironment(
				app({ path: outside, entry: './index.ts' }),
				'api',
				root,
				{ logWarnings: false },
			);

			expect(result.requiredEnvVars).toEqual([]);
			expect(existsSync(join(outside, 'seen.json'))).toBe(false);
		} finally {
			rmSync(outside, { recursive: true, force: true });
		}
	});
});
