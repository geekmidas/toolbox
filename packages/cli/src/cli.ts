#!/usr/bin/env node

import { Command } from 'commander';
import { buildCommand } from './build.js';
import { openapiCommand } from './openapi.js';
import type { Provider } from './types.js';

const program = new Command();

program
  .name('gkm')
  .description('GeekMidas backend framework CLI')
  .version('0.0.2');

program
  .command('build')
  .description('Build API handlers from endpoints')
  .option(
    '--provider <provider>',
    'Target provider for generated handlers',
    'aws-apigatewayv1',
  )
  .action(async (options: { provider: Provider }) => {
    try {
      await buildCommand(options);
    } catch (error) {
      console.error('Build failed:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('cron')
  .description('Manage cron jobs')
  .action(() => {
    process.stdout.write('Cron management - coming soon\n');
  });

program
  .command('function')
  .description('Manage serverless functions')
  .action(() => {
    process.stdout.write('Serverless function management - coming soon\n');
  });

program
  .command('api')
  .description('Manage REST API endpoints')
  .action(() => {
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
      await openapiCommand(options);
    } catch (error) {
      console.error('OpenAPI generation failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();
