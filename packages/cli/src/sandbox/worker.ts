/**
 * Running one of the CLI's own worker scripts inside a sandbox, and reading
 * back the one JSON value it answers with.
 *
 * The worker imports the project's TypeScript — `gkm.config.ts`, construct
 * modules, an app's entry — so it starts with the CLI's own tsx and the two
 * hooks `gkm` itself runs with (JSX by the owning tsconfig, path aliases by
 * the adjacent one). The host process needs none of them loaded: a program
 * calling `deploy()` without `--import tsx` still loads a TypeScript config.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { z } from 'zod';
import { withOwningTsconfigJsx } from '../owningTsconfigJsx';
import { oncePerRun, type Sandbox } from './sandbox';
import { WORKER_RESULT_MARKER } from './workerRuntime';

const here = dirname(fileURLToPath(import.meta.url));

/**
 * A worker's file: `dist/sandbox/<name>.mjs` once built — whether this module
 * was bundled into `dist/` or sits beside it — or the `.ts` source under tsx.
 */
export function workerFile(name: string): string {
	const candidates = [
		join(here, 'sandbox', `${name}.mjs`),
		join(here, `${name}.mjs`),
		join(here, '..', 'sandbox', `${name}.mjs`),
		join(here, `${name}.ts`),
	];
	return (
		candidates.find((path) => existsSync(path)) ?? join(here, `${name}.ts`)
	);
}

/** tsx, from the CLI's own dependencies — never the project's. */
export function tsxUrl(): string {
	return pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;
}

/**
 * `node`'s arguments for `script`: the CLI's TypeScript loaders, then any
 * further `imports`, then the script and its `args` — an argument array, so
 * nothing about a path is read by a shell.
 */
export function nodeWithTsx(
	script: string,
	args: readonly string[],
	imports: readonly string[] = [],
): string[] {
	return [
		...withOwningTsconfigJsx(`--import=${tsxUrl()}`).split(' '),
		...imports.map((path) => `--import=${pathToFileURL(path).href}`),
		script,
		...args,
	];
}

/** A worker ended without the answer it exists to give. */
export class SandboxWorkerFailed extends Error {
	constructor(
		readonly step: string,
		readonly exitCode: number | null,
		readonly stderr: string,
	) {
		super(
			`The sandboxed ${step} ended (exit code ${exitCode}) without an ` +
				`answer.${stderr.trim() ? `\n${stderr.trim()}` : ''}\nIts output ` +
				'above says why; the sandbox must be able to run `node` with the ' +
				"CLI's own files at the paths they have here.",
		);
		this.name = 'SandboxWorkerFailed';
	}
}

export interface WorkerRun<T> {
	/** What the worker answered, as the schema reads it. */
	value: T;
	/** What it wrote to stderr: warnings a caller may pass on. */
	stderr: string;
}

/**
 * Run worker `name` in `sandbox`, and parse its answer with `schema`.
 *
 * The answer is the last marked line on stdout. Anything else the project's
 * code printed is ignored, and an answer the schema refuses is a failure
 * rather than data — a worker in an isolating sandbox runs code the host does
 * not trust.
 *
 * Within a run (`withSandbox`), the same worker asked the same question is
 * started once; every ask gets its own copy of the answer, and its stderr, as
 * though it had run again.
 */
export async function runWorker<S extends z.ZodType>(
	sandbox: Sandbox,
	step: string,
	options: WorkerOptions<S>,
): Promise<WorkerRun<z.infer<S>>> {
	// A step handed secrets acts on something — a database it migrates — and
	// is not a question whose answer can be reused; nor do its secrets belong
	// in a cache key.
	if (options.secrets) return startWorker(sandbox, step, options);

	const key = JSON.stringify([
		options.name,
		options.cwd,
		options.args,
		options.env ?? {},
	]);
	const answer = await oncePerRun(sandbox, key, () =>
		startWorker(sandbox, step, options),
	);
	return structuredClone(answer);
}

interface WorkerOptions<S extends z.ZodType> {
	name: string;
	args: readonly string[];
	cwd: string;
	timeoutMs: number;
	env?: Readonly<Record<string, string>>;
	/** Mounted as files, named by `GKM_SECRETS_DIR` — never variables. */
	secrets?: Readonly<Record<string, string>>;
	signal?: AbortSignal;
	schema: S;
}

async function startWorker<S extends z.ZodType>(
	sandbox: Sandbox,
	step: string,
	options: WorkerOptions<S>,
): Promise<WorkerRun<z.infer<S>>> {
	const result = await sandbox.exec(
		'node',
		nodeWithTsx(workerFile(options.name), options.args),
		{
			cwd: options.cwd,
			env: { ...sandbox.env, ...options.env },
			timeoutMs: options.timeoutMs,
			output: 'capture',
			...(options.secrets ? { secrets: options.secrets } : {}),
			...(options.signal ? { signal: options.signal } : {}),
		},
	);

	const line = result.stdout
		.split('\n')
		.reverse()
		.find((l) => l.startsWith(WORKER_RESULT_MARKER));
	if (line) {
		try {
			const parsed = options.schema.safeParse(
				JSON.parse(line.slice(WORKER_RESULT_MARKER.length)),
			);
			if (parsed.success) return { value: parsed.data, stderr: result.stderr };
		} catch {
			// Not JSON: as good as no answer.
		}
	}

	throw new SandboxWorkerFailed(step, result.exitCode, result.stderr);
}
