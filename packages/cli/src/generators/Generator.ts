import { relative } from 'node:path';
import type { Construct } from '@geekmidas/constructs';
import fg from 'fast-glob';
import kebabCase from 'lodash.kebabcase';
import type { BuildContext } from '../build/types';
import type { LegacyProvider, Routes } from '../types';

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
	): Promise<GeneratedConstruct<T>[]> {
		const logger = console;

		// Normalize patterns to array
		const globPatterns = Array.isArray(patterns)
			? patterns
			: patterns
				? [patterns]
				: [];

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
				const module = await import(file);

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
						});
					}
				}
			} catch (error) {
				logger.warn(`Failed to load ${f}:`, (error as Error).message);
				throw new Error(
					'Failed to load constructs. Please check the logs for details.',
				);
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
}
