#!/usr/bin/env -S npx tsx

import { Command } from 'commander';
import pkg from '../package.json' assert { type: 'json' };
import { buildCommand } from './build/index.ts';
import { devCommand } from './dev/index.ts';
import { type InitOptions, initCommand } from './init/index.ts';
import { generateReactQueryCommand } from './openapi-react-query.ts';
import { openapiCommand } from './openapi.ts';
import type { LegacyProvider, MainProvider } from './types.ts';

const program = new Command();

program
  .name('gkm')
  .description('GeekMidas backend framework CLI')
  .version(pkg.version)
  .option('--cwd <path>', 'Change working directory');

program
  .command('init')
  .description('Scaffold a new project')
  .argument('[name]', 'Project name')
  .option(
    '--template <template>',
    'Project template (minimal, api, serverless, worker)',
  )
  .option('--skip-install', 'Skip dependency installation', false)
  .option('-y, --yes', 'Skip prompts, use defaults', false)
  .option('--monorepo', 'Setup as monorepo with packages/models', false)
  .option('--api-path <path>', 'API app path in monorepo (default: apps/api)')
  .action(async (name: string | undefined, options: InitOptions) => {
    try {
      const globalOptions = program.opts();
      if (globalOptions.cwd) {
        process.chdir(globalOptions.cwd);
      }
      await initCommand(name, options);
    } catch (error) {
      console.error('Init failed:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('build')
  .description('Build handlers from endpoints, functions, and crons')
  .option(
    '--provider <provider>',
    'Target provider for generated handlers (aws, server)',
  )
  .option(
    '--providers <providers>',
    '[DEPRECATED] Use --provider instead. Target providers for generated handlers (comma-separated)',
  )
  .option(
    '--enable-openapi',
    'Enable OpenAPI documentation generation for server builds',
  )
  .action(
    async (options: {
      provider?: string;
      providers?: string;
      enableOpenapi?: boolean;
    }) => {
      try {
        const globalOptions = program.opts();
        if (globalOptions.cwd) {
          process.chdir(globalOptions.cwd);
        }

        // Handle new single provider option
        if (options.provider) {
          if (!['aws', 'server'].includes(options.provider)) {
            console.error(
              `Invalid provider: ${options.provider}. Must be 'aws' or 'server'.`,
            );
            process.exit(1);
          }
          await buildCommand({
            provider: options.provider as MainProvider,
            enableOpenApi: options.enableOpenapi || false,
          });
        }
        // Handle legacy providers option
        else if (options.providers) {
          console.warn(
            '⚠️  --providers flag is deprecated. Use --provider instead.',
          );
          const providerList = [
            ...new Set(options.providers.split(',').map((p) => p.trim())),
          ] as LegacyProvider[];
          await buildCommand({
            providers: providerList,
            enableOpenApi: options.enableOpenapi || false,
          });
        }
        // Default to config-driven build
        else {
          await buildCommand({
            enableOpenApi: options.enableOpenapi || false,
          });
        }
      } catch (error) {
        console.error('Build failed:', (error as Error).message);
        process.exit(1);
      }
    },
  );

program
  .command('dev')
  .description('Start development server with automatic reload')
  .option('-p, --port <port>', 'Port to run the development server on')
  .option(
    '--enable-openapi',
    'Enable OpenAPI documentation for development server',
    true,
  )
  .action(async (options: { port?: string; enableOpenapi?: boolean }) => {
    try {
      const globalOptions = program.opts();
      if (globalOptions.cwd) {
        process.chdir(globalOptions.cwd);
      }

      await devCommand({
        port: options.port ? Number.parseInt(options.port) : 3000,
        portExplicit: !!options.port,
        enableOpenApi: options.enableOpenapi ?? true,
      });
    } catch (error) {
      console.error('Dev server failed:', (error as Error).message);
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
  .description(
    'Generate OpenAPI specification from endpoints (TypeScript by default)',
  )
  .option(
    '--output <path>',
    'Output file path for the OpenAPI spec',
    'openapi.ts',
  )
  .option('--json', 'Generate JSON instead of TypeScript (legacy)', false)
  .action(async (options: { output?: string; json?: boolean }) => {
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
