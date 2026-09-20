import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { Function } from '@geekmidas/constructs/functions';
import type { BuildContext } from '../build/types';
import type { FunctionInfo } from '../types';
import { runtimeFor } from './EndpointGenerator.js';
import {
	ConstructGenerator,
	type GeneratedConstruct,
	type GeneratorOptions,
} from './Generator';

export class FunctionGenerator extends ConstructGenerator<
	Function<any, any, any, any, any, any, any, any, any, any, any, any>,
	FunctionInfo[]
> {
	isConstruct(
		value: any,
	): value is Function<
		any,
		any,
		any,
		any,
		any,
		any,
		any,
		any,
		any,
		any,
		any,
		any
	> {
		return Function.isFunction(value);
	}

	async build(
		context: BuildContext,
		constructs: GeneratedConstruct<
			Function<any, any, any, any, any, any, any, any, any, any, any, any>
		>[],
		outputDir: string,
		options?: GeneratorOptions,
	): Promise<FunctionInfo[]> {
		const provider = options?.provider || 'aws-lambda';
		const logger = console;
		const functionInfos: FunctionInfo[] = [];

		if (constructs.length === 0 || provider !== 'aws-lambda') {
			return functionInfos;
		}

		// Create functions subdirectory
		const functionsDir = join(outputDir, 'functions');
		await mkdir(functionsDir, { recursive: true });

		// Generate function handlers
		for (const { key, construct, path } of constructs) {
			const handlerFile = await this.generateFunctionHandler(
				functionsDir,
				path.relative,
				key,
				context,
				construct.owner,
			);

			functionInfos.push({
				name: key,
				handler: relative(process.cwd(), handlerFile).replace(
					/\.ts$/,
					'.handler',
				),
				timeout: construct.timeout,
				memorySize: construct.memorySize,
				environment: await construct.getEnvironment({
					markOptional: context.markOptional,
				}),
				dependencies: construct.constructs,
			});

			logger.log(`Generated function handler: ${key}`);
		}

		return functionInfos;
	}

	private async generateFunctionHandler(
		outputDir: string,
		sourceFile: string,
		exportName: string,
		context: BuildContext,
		/** The construct that owns this — its worker, or its surface. */
		owner: string | undefined,
	): Promise<string> {
		const handlerFileName = `${exportName}.ts`;
		const handlerPath = join(outputDir, handlerFileName);

		const relativePath = relative(dirname(handlerPath), sourceFile);
		const importPath = relativePath.replace(/\.ts$/, '.js');

		// Imports the construct that owns this, and binds `envParser` and
		// `logger` off it — the objects it was declared with, rather than a
		// module path printed in from config.
		const runtime = runtimeFor(context, dirname(handlerPath), owner);

		const content = `import { AWSLambdaFunction } from '@geekmidas/constructs/aws';
import { ${exportName} } from '${importPath}';
${runtime.imports}
${runtime.bindings}

const adapter = new AWSLambdaFunction(envParser, ${exportName});

export const handler = adapter.handler;
`;

		await writeFile(handlerPath, content);
		return handlerPath;
	}
}
