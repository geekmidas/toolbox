import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'path';
import { loadFunctions } from '../loadFunctions';
import type { FunctionInfo, LegacyProvider } from '../types';
import type { BuildContext, ProcessedFunction } from './types';

const logger = console;

export async function buildFunctions(
  provider: LegacyProvider,
  outputDir: string,
  functions: ProcessedFunction[],
  context: BuildContext,
): Promise<FunctionInfo[]> {
  const functionInfos: FunctionInfo[] = [];

  if (functions.length === 0 || provider !== 'aws-lambda') {
    return functionInfos;
  }

  // Create functions subdirectory
  const functionsDir = join(outputDir, 'functions');
  await mkdir(functionsDir, { recursive: true });

  // Generate function handlers
  for (const { file, exportName, fn } of functions) {
    const handlerFile = await generateFunctionHandler(
      functionsDir,
      file,
      exportName,
      context.envParserPath,
      context.envParserImportPattern,
      context.loggerPath,
      context.loggerImportPattern,
    );

    functionInfos.push({
      name: exportName,
      handler: relative(process.cwd(), handlerFile).replace(
        /\.ts$/,
        '.handler',
      ),
      timeout: fn.timeout,
    });

    logger.log(`Generated function handler: ${exportName}`);
  }

  return functionInfos;
}

export async function processFunctions(
  functionPatterns?: string | string[],
): Promise<ProcessedFunction[]> {
  if (!functionPatterns) {
    return [];
  }

  const loadedFunctions = await loadFunctions(functionPatterns);

  return loadedFunctions.map(({ name, fn, file }) => {
    logger.log(`Found function: ${name}`);

    return {
      file: relative(process.cwd(), file),
      exportName: name,
      fn,
    };
  });
}

// Generator function for functions

async function generateFunctionHandler(
  outputDir: string,
  sourceFile: string,
  exportName: string,
  envParserPath: string,
  envParserImportPattern: string,
  loggerPath: string,
  loggerImportPattern: string,
): Promise<string> {
  const handlerFileName = `${exportName}.ts`;
  const handlerPath = join(outputDir, handlerFileName);

  const relativePath = relative(dirname(handlerPath), sourceFile);
  const importPath = relativePath.replace(/\.ts$/, '.js');

  const relativeEnvParserPath = relative(dirname(handlerPath), envParserPath);
  const relativeLoggerPath = relative(dirname(handlerPath), loggerPath);

  const content = `import { AWSLambdaFunction } from '@geekmidas/api/aws-lambda';
import { ${exportName} } from '${importPath}';
import ${envParserImportPattern} from '${relativeEnvParserPath}';
import ${loggerImportPattern} from '${relativeLoggerPath}';

const adapter = new AWSLambdaFunction(envParser, ${exportName});

export const handler = adapter.handler;
`;

  await writeFile(handlerPath, content);
  return handlerPath;
}
