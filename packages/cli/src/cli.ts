#!/usr/bin/env node

import { Command } from 'commander';

const program = new Command();

program
  .name('gms')
  .description('GeekMidas backend framework CLI')
  .version('0.0.2');

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

program.parse();
