import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import {
	CronBuilder,
	type ScheduleExpression,
} from '@geekmidas/constructs/crons';
import { RestApi } from '@geekmidas/constructs/rest-api';
import { z } from 'zod';

/**
 * Creates a temporary directory for testing
 */
export async function createTempDir(prefix = 'cli-test-'): Promise<string> {
	const tempPath = join(
		tmpdir(),
		`${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	await mkdir(tempPath, { recursive: true });
	return tempPath;
}

/**
 * Cleans up a directory
 */
export async function cleanupDir(path: string): Promise<void> {
	try {
		await rm(path, { recursive: true, force: true });
	} catch (_error) {
		// Ignore errors during cleanup
	}
}

/**
 * Creates a test file with content
 */
export async function createTestFile(
	dir: string,
	filename: string,
	content: string,
): Promise<string> {
	const filePath = join(dir, filename);
	await mkdir(dirname(filePath), { recursive: true });
	await writeFile(filePath, content);
	return filePath;
}

/**
 * Creates a mock endpoint file with real endpoint construct
 */
/** A relative specifier ESM accepts: always prefixed, never bare. */
function relativeSpecifier(from: string, target: string): string {
	const rel = relative(from, target).replace(/\.ts$/, '.js');

	return rel.startsWith('.') ? rel : `./${rel}`;
}

/**
 * The worker a fixture's crons and functions are built from.
 *
 * Everything runnable comes from the process that runs it, so a fixture that
 * built one free-standing had no owner — and no owner is where the build stops,
 * because there is nothing to take a logger and an environment parser from.
 */
export async function createWorkerFile(dir: string): Promise<string> {
	return createTestFile(
		dir,
		'src/constructs/worker.ts',
		`import { Worker } from '@geekmidas/constructs/worker';

export const worker = new Worker('Jobs');
`,
	);
}

/**
 * The one surface a fixture's endpoints are built from.
 *
 * Shared rather than declared per file, and exported rather than local. Both
 * matter: discovery needs to *find* a surface, so it has to be exported; and
 * two files each declaring `RestApi('Test')` are two constructs with one id,
 * which fails discovery for the whole fixture rather than for the second file.
 *
 * Idempotent — every endpoint helper call writes it, and writes the same thing.
 */
export async function createSurfaceFile(dir: string): Promise<string> {
	return createTestFile(
		dir,
		'src/constructs/api.ts',
		`import { RestApi } from '@geekmidas/constructs/rest-api';

export const api = new RestApi('Test', { defaultAuthorizer: 'none' });
`,
	);
}

export async function createMockEndpointFile(
	dir: string,
	filename: string,
	exportName: string,
	path: string = '/test',
	method: string = 'GET',
): Promise<string> {
	const surface = await createSurfaceFile(dir);

	// Relative, because the fixture's files sit wherever the caller put them and
	// the import has to resolve from there rather than from the temp root.
	const from = dirname(join(dir, filename));
	const importPath = relative(from, surface).replace(/\.ts$/, '.js');
	const specifier = importPath.startsWith('.') ? importPath : `./${importPath}`;

	const content = `
import { z } from 'zod';
import { api } from '${specifier}';

export const ${exportName} = api
  .${method.toLowerCase()}('${path}')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'Hello from ${exportName}' }));
`;
	return createTestFile(dir, filename, content);
}

/**
 * Creates a mock function file with real function construct
 */
export async function createMockFunctionFile(
	dir: string,
	filename: string,
	exportName: string,
	timeout = 30,
): Promise<string> {
	const worker = await createWorkerFile(dir);
	const from = dirname(join(dir, filename));
	const specifier = relativeSpecifier(from, worker);

	const content = `
import { z } from 'zod';
import { worker } from '${specifier}';

export const ${exportName} = worker.functions
  .input(z.object({ name: z.string() }))
  .output(z.object({ greeting: z.string() }))
  .timeout(${timeout})
  .handle(async ({ input }) => ({ greeting: \`Hello, \${input.name}!\` }));
`;
	return createTestFile(dir, filename, content);
}

/**
 * Creates a mock cron file with real cron construct
 */
export async function createMockCronFile(
	dir: string,
	filename: string,
	exportName: string,
	schedule = 'rate(1 hour)',
): Promise<string> {
	const worker = await createWorkerFile(dir);
	const from = dirname(join(dir, filename));
	const specifier = relativeSpecifier(from, worker);

	const content = `
import { z } from 'zod';
import { worker } from '${specifier}';

export const ${exportName} = worker.crons
  .schedule('${schedule}')
  .output(z.object({ processed: z.number() }))
  .handle(async () => {
    console.log('Running cron job: ${exportName}');
    return { processed: 10 };
  });
`;
	return createTestFile(dir, filename, content);
}

/**
 * Helper functions to create real constructs for testing
 */
/** The surface these helpers build endpoints from. */
const api = new RestApi('Test', { defaultAuthorizer: 'none' });

export function createTestEndpoint(path: string, method: HttpMethod = 'GET') {
	const m = method.toLowerCase() as Lowercase<HttpMethod>;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const builder = (api as any)[m](path);
	builder.output(z.object({ message: z.string() }));
	return builder.handle(async () => ({ message: `Hello from ${path}` }));
}

export function createTestFunction(timeout: number = 30) {
	const builder = new FunctionBuilder();
	builder.input(z.object({ name: z.string() }));
	builder.output(z.object({ greeting: z.string() }));
	builder.timeout(timeout);
	return builder.handle(async ({ input }: any) => ({
		greeting: `Hello, ${input.name}!`,
	}));
}

export function createTestCron(
	schedule: ScheduleExpression = 'rate(1 hour)',
	timeout: number = 30,
) {
	const builder = new CronBuilder();
	builder.schedule(schedule);
	builder.output(z.object({ processed: z.number() }));
	builder.timeout(timeout);
	return builder.handle(async () => {
		return { processed: 10 };
	});
}

/**
 * Creates a mock build context.
 *
 * It used to carry four module paths — an `envParserPath` and a `loggerPath`
 * with their import patterns — because that is what the generators printed into
 * every handler. They import the construct that owns the handler now, so what a
 * context has to supply is where that construct is exported from.
 */
export function createMockBuildContext(
	options: { owner?: string; specifier?: string; exportName?: string } = {},
) {
	const owner = options.owner ?? 'Api';
	const module = {
		specifier: options.specifier ?? './constructs/api.ts',
		exportName: options.exportName ?? 'api',
	};

	return {
		surface: {
			id: owner,
			trustedOriginsKey: `${owner.toUpperCase()}_TRUSTED_ORIGINS`,
			module,
		},
		owners: { [owner]: module },
	};
}

/**
 * Waits for a condition to be true
 */
export async function waitFor(
	condition: () => boolean,
	timeout = 5000,
	interval = 100,
): Promise<void> {
	const start = Date.now();
	while (!condition() && Date.now() - start < timeout) {
		await new Promise((resolve) => setTimeout(resolve, interval));
	}
	if (!condition()) {
		throw new Error('Timeout waiting for condition');
	}
}

import { FunctionBuilder } from '@geekmidas/constructs/functions';
import type { HttpMethod } from '@geekmidas/constructs/types';
