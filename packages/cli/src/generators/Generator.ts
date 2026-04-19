import { relative } from 'node:path';
import type { Construct } from '@geekmidas/constructs';
import fg from 'fast-glob';
import kebabCase from 'lodash.kebabcase';
import type { BuildContext } from '../build/types';
import {
	isPartitionedRoutes,
	type LegacyProvider,
	type Routes,
} from '../types';

/**
 * Zod v4 maintains a process-wide registry of schemas registered via
 * `.meta({ id })`. When we cache-bust user module imports (by appending a
 * `?t=timestamp` query), those modules re-execute and try to register the
 * same ids again, which throws `ID X already exists in the registry`.
 *
 * Clearing the registry in the CLI process is safe: the user's running
 * server lives in a subprocess and has its own isolated registry.
 *
 * Exported for tests.
 */
export function clearZodGlobalRegistry(): void {
	const registry = (
		globalThis as { __zod_globalRegistry?: { clear?: () => void } }
	).__zod_globalRegistry;
	if (registry && typeof registry.clear === 'function') {
		registry.clear();
	}
}

export interface GeneratorOptions {
	provider?: LegacyProvider;
	[key: string]: any;
}

export abstract class ConstructGenerator<T extends Construct, R = void> {
	abstract isConstruct(value: any): value is T;

	static async build<T extends Construct, R = void>(
		context: BuildContext,
		outputDir: string,
		generator: ConstructGenerator<T, R>,
		patterns?: Routes,
		options?: GeneratorOptions,
	): Promise<R> {
		const constructs = await generator.load(patterns);
		return generator.build(context, constructs, outputDir, options);
	}

	abstract build(
		context: BuildContext,
		constructs: GeneratedConstruct<T>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<R>;

	async load(
		patterns?: Routes,
		cwd = process.cwd(),
		bustCache = false,
	): Promise<GeneratedConstruct<T>[]> {
		const logger = console;

		// Extract glob patterns and optional partition function
		let globPatterns: string[];
		let partitionFn: ((filepath: string) => string) | undefined;

		if (isPartitionedRoutes(patterns)) {
			globPatterns = Array.isArray(patterns.paths)
				? patterns.paths
				: [patterns.paths];
			partitionFn = patterns.partition;
		} else {
			globPatterns = Array.isArray(patterns)
				? patterns
				: patterns
					? [patterns]
					: [];
		}

		// Find all files
		const files = fg.stream(globPatterns, {
			cwd,
			absolute: true,
		});

		// Load constructs
		const constructs: GeneratedConstruct<T>[] = [];

		for await (const f of files) {
			try {
				const file = f.toString();
				// Append cache-busting query param to force re-import of changed modules
				const importPath = bustCache ? `${file}?t=${Date.now()}` : file;
				const module = await import(importPath);

				// Compute partition name for this file (if partition function provided)
				const partition = partitionFn ? partitionFn(file) : undefined;

				// Check all exports for constructs
				for (const [key, construct] of Object.entries(module)) {
					if (this.isConstruct(construct)) {
						constructs.push({
							key,
							name: kebabCase(key),
							construct,
							path: {
								absolute: file,
								relative: relative(process.cwd(), file),
							},
							partition,
						});
					}
				}
			} catch (error) {
				const err = error as Error;
				logger.error(`Failed to load ${f}: ${err.message}`);
				if (err.stack) {
					logger.error(err.stack);
				}
				throw error;
			}
		}

		return constructs;
	}
}

export interface GeneratedConstruct<T extends Construct> {
	key: string;
	name: string;
	construct: T;
	path: {
		absolute: string;
		relative: string;
	};
	/** Partition name assigned by the partition function, if configured. */
	partition?: string;
}
