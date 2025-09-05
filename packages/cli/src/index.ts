#!/usr/bin/env -S npx tsx

import { Command } from 'commander';
import pkg from '../package.json' assert { type: 'json' };
import { buildCommand } from './build.ts';
import { generateReactQueryCommand } from './openapi-react-query.ts';
import { openapiCommand } from './openapi.ts';
import type { Provider } from './types.ts';

const program = new Command();

program
  .name('gkm')
  .description('GeekMidas backend framework CLI')
  .version(pkg.version)
  .option('--cwd <path>', 'Change working directory');

program
  .command('build')
  .description('Build API handlers from endpoints')
  .option(
    '--providers <providers>',
    'Target providers for generated handlers (comma-separated)',
    'aws-apigatewayv1',
  )
  .option(
    '--enable-openapi',
    'Enable OpenAPI documentation generation for server builds',
  )
  .action(async (options: { providers: string; enableOpenapi?: boolean }) => {
    try {
      const globalOptions = program.opts();
      if (globalOptions.cwd) {
        process.chdir(globalOptions.cwd);
      }
      const providerList = [
        ...new Set(options.providers.split(',').map((p) => p.trim())),
      ] as Provider[];
      await buildCommand({
        providers: providerList,
        enableOpenApi: options.enableOpenapi || false,
      });
    } catch (error) {
      console.error('Build failed:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('cron')
  .description('Manage cron jobs')
  .action(() => {
    const globalOptions = program.opts();
    if (globalOptions.cwd) {
      process.chdir(globalOptions.cwd);
    }
    process.stdout.write('Cron management - coming soon\n');
  });

program
  .command('function')
  .description('Manage serverless functions')
  .action(() => {
    const globalOptions = program.opts();
    if (globalOptions.cwd) {
      process.chdir(globalOptions.cwd);
    }
    process.stdout.write('Serverless function management - coming soon\n');
  });

program
  .command('api')
  .description('Manage REST API endpoints')
  .action(() => {
    const globalOptions = program.opts();
    if (globalOptions.cwd) {
      process.chdir(globalOptions.cwd);
    }
    process.stdout.write('REST API management - coming soon\n');
  });

program
  .command('openapi')
  .description('Generate OpenAPI 3.0 specification from endpoints')
  .option(
    '--output <path>',
    'Output file path for the OpenAPI spec',
    'openapi.json',
  )
  .action(async (options: { output?: string }) => {
    try {
      const globalOptions = program.opts();
      if (globalOptions.cwd) {
        process.chdir(globalOptions.cwd);
      }
      await openapiCommand(options);
    } catch (error) {
      console.error('OpenAPI generation failed:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('generate:react-query')
  .description('Generate React Query hooks from OpenAPI specification')
  .option('--input <path>', 'Input OpenAPI spec file path', 'openapi.json')
  .option(
    '--output <path>',
    'Output file path for generated hooks',
    'src/api/hooks.ts',
  )
  .option('--name <name>', 'API name prefix for generated code', 'API')
  .action(
    async (options: { input?: string; output?: string; name?: string }) => {
      try {
        const globalOptions = program.opts();
        if (globalOptions.cwd) {
          process.chdir(globalOptions.cwd);
        }
        await generateReactQueryCommand(options);
      } catch (error) {
        console.error(
          'React Query generation failed:',
          (error as Error).message,
        );
        process.exit(1);
      }
    },
  );

program.parse();
