#!/usr/bin/env node

import { Command } from 'commander';
import { buildCommand } from './build.js';
import { openapiCommand } from './openapi.js';
import type { Provider } from './types.js';

const program = new Command();

program
  .name('gkm')
  .description('GeekMidas backend framework CLI')
  .version('0.0.2')
  .option('--cwd <path>', 'Change working directory');

program
  .command('build')
  .description('Build API handlers from endpoints')
  .option(
    '--providers <providers>',
    'Target providers for generated handlers (comma-separated)',
    'aws-apigatewayv1',
  )
  .action(async (options: { providers: string }) => {
    try {
      const globalOptions = program.opts();
      if (globalOptions.cwd) {
        process.chdir(globalOptions.cwd);
      }
      const providerList = [...new Set(options.providers.split(',').map(p => p.trim()))] as Provider[];
      await buildCommand({ providers: providerList });
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

program.parse();
