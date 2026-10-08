import { spawn } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateTelemetryModule } from '../../generators/telemetry';
import { generateServerEntryContent } from '../index';

/**
 * `gkm dev`'s server entry starts telemetry the way the production entry
 * does: the same generated `telemetry.ts`, after the dev secrets — where the
 * local `OTEL_*` keys arrive — and before the app, with the request spans
 * mounted ahead of every route.
 *
 * Run as a real process, against stand-ins for telescope and Hono that record
 * what they were asked: what is under test is the entry, not OpenTelemetry.
 */

/** Somewhere with no `node_modules` above it — see `telemetry.spec.ts`. */
function bareTmp(): string {
	const dir = realpathSync(tmpdir());
	return basename(dir).startsWith('gkm-cli-tests-') ? dirname(dir) : dir;
}

const TSX = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

async function pkg(dir: string, name: string, files: Record<string, string>) {
	const root = join(dir, 'node_modules', ...name.split('/'));
	await mkdir(root, { recursive: true });
	for (const [file, content] of Object.entries(files)) {
		await writeFile(join(root, file), content);
	}
}

describe('the gkm dev server entry', { timeout: 30_000 }, () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(bareTmp(), 'gkm-dev-entry-telemetry-'));
		await writeFile(
			join(dir, 'package.json'),
			JSON.stringify({ name: 'api', type: 'module' }),
		);
		await pkg(dir, '@geekmidas/telescope', {
			'package.json': JSON.stringify({
				name: '@geekmidas/telescope',
				type: 'module',
				exports: { './instrumentation': './instrumentation.js' },
			}),
			'instrumentation.js': `import { writeFileSync } from 'node:fs';
export function setupTelemetry(options) {
  writeFileSync(process.env.MARKER, JSON.stringify({ options, endpoint: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }));
}
export async function flushTelemetry() {}
export function honoTelemetryMiddleware() {
  return async function requestSpans(_c, next) { return next(); };
}
`,
		});
		await pkg(dir, 'hono', {
			'package.json': JSON.stringify({
				name: 'hono',
				type: 'module',
				exports: './index.js',
			}),
			'index.js': `export class Hono {
  constructor() { this.used = []; }
  use(path, handler) { this.used.push([path, handler.name]); }
  route() {}
}
`,
		});
		// The app records what it was handed before anything was mounted on it.
		await writeFile(
			join(dir, 'app.ts'),
			`import { writeFileSync } from 'node:fs';
export async function createApp(app: { used: unknown[] }) {
  writeFileSync(process.env.MARKER + '.app', JSON.stringify(app.used));
  return { app, start: async () => {} };
}
`,
		);
		// The dev secrets, as `gkm dev` writes them — the local telemetry among them.
		await writeFile(
			join(dir, 'secrets.json'),
			JSON.stringify({
				OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:5080/api/default',
				OTEL_SERVICE_NAME: 'api',
			}),
		);
		await writeFile(
			join(dir, 'server.ts'),
			generateServerEntryContent({
				appImportPath: './app.ts',
				secretsJsonPath: join(dir, 'secrets.json'),
			}),
		);
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	function run(): Promise<{ code: number | null; output: string }> {
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(process.env)) {
			if (value !== undefined && !key.startsWith('OTEL_')) env[key] = value;
		}
		delete env.NODE_OPTIONS;
		env.MARKER = join(dir, 'marker');

		return new Promise((resolve) => {
			const child = spawn(process.execPath, ['--import', TSX, 'server.ts'], {
				cwd: dir,
				env,
			});
			let output = '';
			child.stdout.on('data', (chunk) => {
				output += chunk;
			});
			child.stderr.on('data', (chunk) => {
				output += chunk;
			});
			child.on('close', (code) => resolve({ code, output }));
		});
	}

	it('starts the SDK from the dev secrets, and mounts the request spans before the app', async () => {
		await writeFile(
			join(dir, 'telemetry.ts'),
			generateTelemetryModule({
				serviceName: 'Api',
				serviceNamespace: 'shop',
				ignorePaths: [],
				attributes: {},
				routes: [],
			}),
		);

		const { code, output } = await run();

		expect(code, output).toBe(0);
		const started = JSON.parse(await readFile(join(dir, 'marker'), 'utf-8'));
		expect(started.endpoint).toBe('http://localhost:5080/api/default');
		expect(started.options).toMatchObject({
			serviceName: 'Api',
			serviceNamespace: 'shop',
			incomingHttpSpans: false,
		});
		expect(
			JSON.parse(await readFile(join(dir, 'marker.app'), 'utf-8')),
		).toEqual([['*', 'requestSpans']]);
	});

	it('starts nothing and mounts nothing for an app with no Telemetry edge', async () => {
		await writeFile(
			join(dir, 'telemetry.ts'),
			generateTelemetryModule(undefined),
		);

		const { code, output } = await run();

		expect(code, output).toBe(0);
		expect(existsSync(join(dir, 'marker'))).toBe(false);
		expect(
			JSON.parse(await readFile(join(dir, 'marker.app'), 'utf-8')),
		).toEqual([]);
	});
});
