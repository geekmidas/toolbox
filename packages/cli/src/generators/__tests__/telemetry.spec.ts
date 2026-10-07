import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	generateTelemetryModule,
	TELEMETRY_PACKAGES,
	telemetryFor,
	telemetryResolvesFrom,
} from '../telemetry';

/**
 * The production entry's telemetry, run as a real process.
 *
 * The packages are stand-ins written into the app's `node_modules`: what is
 * under test is whether the entry loads them, and with what — not
 * OpenTelemetry itself, which `setup.spec.ts` in telescope exercises against
 * a real collector.
 */

/**
 * Somewhere with no `node_modules` above it.
 *
 * This package's vitest config points TMPDIR at a scratch directory with the
 * CLI's own `node_modules` linked in, so the real telescope and OpenTelemetry
 * would resolve from every temp project — the opposite of an app without them.
 */
function bareTmp(): string {
	const dir = realpathSync(tmpdir());
	return basename(dir).startsWith('gkm-cli-tests-') ? dirname(dir) : dir;
}

/** tsx, by path — nothing resolves a bare `tsx` from a bare directory. */
const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

/** A stand-in telescope that records being imported and how it was set up. */
async function installTelescope(dir: string) {
	const pkg = join(dir, 'node_modules', '@geekmidas', 'telescope');
	await mkdir(pkg, { recursive: true });
	await writeFile(
		join(pkg, 'package.json'),
		JSON.stringify({
			name: '@geekmidas/telescope',
			type: 'module',
			exports: { './instrumentation': './instrumentation.js' },
		}),
	);
	await writeFile(
		join(pkg, 'instrumentation.js'),
		`import { writeFileSync } from 'node:fs';
writeFileSync(process.env.MARKER, 'imported');
export function setupTelemetry(options) {
  writeFileSync(process.env.MARKER, JSON.stringify(options));
}
export async function flushTelemetry() {}
export function honoTelemetryMiddleware(options) {
  writeFileSync(process.env.MARKER + '.middleware', JSON.stringify(options));
  return async (_c, next) => next();
}
`,
	);
}

/** Stand-ins for the OpenTelemetry packages, all but `except`. */
async function installOpenTelemetry(dir: string, except?: string) {
	for (const name of TELEMETRY_PACKAGES) {
		if (name === except) continue;
		const pkg = join(dir, 'node_modules', ...name.split('/'));
		await mkdir(pkg, { recursive: true });
		await writeFile(
			join(pkg, 'package.json'),
			JSON.stringify({ name, main: 'index.js' }),
		);
		await writeFile(join(pkg, 'index.js'), '');
	}
}

/** Run `startTelemetry()` from the generated module, as the entry does. */
function start(
	dir: string,
	env: Record<string, string | undefined>,
): Promise<{ code: number | null; stderr: string; stdout: string }> {
	const childEnv: Record<string, string> = {};
	for (const [key, value] of Object.entries({
		...process.env,
		OTEL_EXPORTER_OTLP_ENDPOINT: undefined,
		STAGE: undefined,
		// The suite runs under NODE_OPTIONS="--import tsx", which a child in a
		// bare directory cannot resolve; it gets tsx by path below instead.
		NODE_OPTIONS: undefined,
		MARKER: join(dir, 'marker'),
		...env,
	})) {
		if (value !== undefined) childEnv[key] = value;
	}

	// A module file rather than -e: Node 22 evaluates -e as CommonJS,
	// where the entry's top-level await is a syntax error.
	const runner = join(dir, 'run.mjs');
	return writeFile(
		runner,
		`const { startTelemetry } = await import('./telemetry.ts');
const requestSpans = await startTelemetry({ ignorePaths: ['/health'] });
console.log('server started', typeof requestSpans);
`,
	).then(
		() =>
			new Promise((resolve) => {
				const child = spawn(process.execPath, ['--import', TSX, runner], {
					cwd: dir,
					env: childEnv,
				});
				let stderr = '';
				let stdout = '';
				child.stderr.on('data', (chunk) => {
					stderr += chunk;
				});
				child.stdout.on('data', (chunk) => {
					stdout += chunk;
				});
				child.on('close', (code) => resolve({ code, stderr, stdout }));
			}),
	);
}

describe('production entry telemetry', { timeout: 30_000 }, () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(bareTmp(), 'gkm-telemetry-entry-'));
		await writeFile(
			join(dir, 'package.json'),
			JSON.stringify({ name: 'orders', type: 'module' }),
		);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	describe('telemetryResolvesFrom', () => {
		it('is false for an app without the packages', () => {
			expect(telemetryResolvesFrom(dir)).toBe(false);
		});

		it('is true once telescope and every OpenTelemetry package resolve', async () => {
			await installTelescope(dir);
			await installOpenTelemetry(dir);

			expect(telemetryResolvesFrom(dir)).toBe(true);
		});

		it('is false when one OpenTelemetry package is missing', async () => {
			await installTelescope(dir);
			await installOpenTelemetry(dir, '@opentelemetry/sdk-node');

			expect(telemetryResolvesFrom(dir)).toBe(false);
		});
	});

	describe('telemetryFor', () => {
		it('names the service after its surface, in its workspace', async () => {
			expect(
				telemetryFor({
					appRoot: dir,
					surfaceId: 'Api',
					workspaceName: 'shop',
				}),
			).toEqual({
				serviceName: 'Api',
				serviceNamespace: 'shop',
				available: false,
			});
		});

		it("falls back to the app's directory without a surface", () => {
			const telemetry = telemetryFor({ appRoot: dir });

			expect(telemetry.serviceName).toBe(dir.split('/').pop());
			expect(telemetry).not.toHaveProperty('serviceNamespace');
		});
	});

	describe('built with the packages available', () => {
		beforeEach(async () => {
			await installTelescope(dir);
			await writeFile(
				join(dir, 'telemetry.ts'),
				generateTelemetryModule({
					serviceName: 'Api',
					serviceNamespace: 'shop',
					available: true,
				}),
			);
		});

		it('does not import the telemetry packages without OTEL_EXPORTER_OTLP_ENDPOINT', async () => {
			const { code, stdout, stderr } = await start(dir, {});

			expect(code, stderr).toBe(0);
			expect(stdout).toContain('server started undefined');
			expect(existsSync(join(dir, 'marker'))).toBe(false);
			expect(stderr).not.toContain('TelemetryUnavailable');
		});

		it('sets telemetry up, named for the app and its stage, when the endpoint is set', async () => {
			const { code, stderr } = await start(dir, {
				OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
				STAGE: 'production',
			});

			expect(code, stderr).toBe(0);
			expect(JSON.parse(await readFile(join(dir, 'marker'), 'utf-8'))).toEqual({
				serviceName: 'Api',
				serviceNamespace: 'shop',
				deploymentEnvironment: 'production',
				handleSignals: false,
				// The logger and the request middleware do these explicitly.
				instrumentPino: false,
				incomingHttpSpans: false,
			});
		});

		it('returns the request-span middleware, skipping the paths it is given', async () => {
			const { code, stdout, stderr } = await start(dir, {
				OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
			});

			expect(code, stderr).toBe(0);
			expect(stdout).toContain('server started function');
			expect(
				JSON.parse(await readFile(join(dir, 'marker.middleware'), 'utf-8')),
			).toEqual({ ignorePaths: ['/health'] });
		});

		it('warns and still starts when the packages are gone at runtime', async () => {
			await rm(join(dir, 'node_modules'), { recursive: true, force: true });

			const { code, stdout, stderr } = await start(dir, {
				OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
			});

			expect(code, stderr).toBe(0);
			expect(stdout).toContain('server started undefined');
			expect(stderr).toContain('TelemetryUnavailable');
			expect(stderr).toContain('Install them in the app and rebuild');
		});
	});

	describe('built without the packages', () => {
		const source = generateTelemetryModule({
			serviceName: 'Api',
			available: false,
		});

		it('has no import of telescope or OpenTelemetry to bundle', () => {
			expect(source).not.toContain("import('@geekmidas/telescope");
			expect(source).not.toMatch(/from '@opentelemetry/);
			expect(source).not.toMatch(/import\('@opentelemetry/);
		});

		it('says why there is no telemetry when the endpoint is set', async () => {
			// Installed after the build: the entry still never loads it.
			await installTelescope(dir);
			await writeFile(join(dir, 'telemetry.ts'), source);

			const { code, stdout, stderr } = await start(dir, {
				OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318',
			});

			expect(code, stderr).toBe(0);
			expect(stdout).toContain('server started');
			expect(stderr).toContain('TelemetryUnavailable');
			expect(stderr).toContain('built without @geekmidas/telescope');
			expect(existsSync(join(dir, 'marker'))).toBe(false);
		});

		it('is silent without the endpoint', async () => {
			await writeFile(join(dir, 'telemetry.ts'), source);

			const { code, stderr } = await start(dir, {});

			expect(code, stderr).toBe(0);
			expect(stderr).not.toContain('TelemetryUnavailable');
		});
	});
});
