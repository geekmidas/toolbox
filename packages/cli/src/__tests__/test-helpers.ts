import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CronBuilder,
  FunctionBuilder,
  type ScheduleExpression,
} from '@geekmidas/constructs';
import { e } from '@geekmidas/constructs';
import { z } from 'zod';

/**
 * Creates a temporary directory for testing
 */
export async function createTempDir(prefix = 'cli-test-'): Promise<string> {
  const tempPath = join(
    tmpdir(),
    `${prefix}${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await mkdir(tempPath, { recursive: true });
  return tempPath;
}

/**
 * Cleans up a directory
 */
export async function cleanupDir(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors during cleanup
  }
}

/**
 * Creates a test file with content
 */
export async function createTestFile(
  dir: string,
  filename: string,
  content: string,
): Promise<string> {
  const filePath = join(dir, filename);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
  return filePath;
}

/**
 * Creates a mock endpoint file with real endpoint construct
 */
export async function createMockEndpointFile(
  dir: string,
  filename: string,
  exportName: string,
  path: string = '/test',
  method: string = 'GET',
): Promise<string> {
  const content = `
import { e } from '@geekmidas/constructs';
import { z } from 'zod';

export const ${exportName} = e
  .${method.toLowerCase()}('${path}')
  .output(z.object({ message: z.string() }))
  .handle(async () => ({ message: 'Hello from ${exportName}' }));
`;
  return createTestFile(dir, filename, content);
}

/**
 * Creates a mock function file with real function construct
 */
export async function createMockFunctionFile(
  dir: string,
  filename: string,
  exportName: string,
  timeout = 30,
): Promise<string> {
  const content = `
import { f } from '@geekmidas/api/function';
import { z } from 'zod';

export const ${exportName} = f
  .input(z.object({ name: z.string() }))
  .output(z.object({ greeting: z.string() }))
  .timeout(${timeout})
  .handle(async ({ input }) => ({ greeting: \`Hello, \${input.name}!\` }));
`;
  return createTestFile(dir, filename, content);
}

/**
 * Creates a mock cron file with real cron construct
 */
export async function createMockCronFile(
  dir: string,
  filename: string,
  exportName: string,
  schedule = 'rate(1 hour)',
): Promise<string> {
  const content = `
import { CronBuilder } from '@geekmidas/constructs';
import { z } from 'zod';

export const ${exportName} = new CronBuilder()
  .schedule('${schedule}')
  .output(z.object({ processed: z.number() }))
  .handle(async () => {
    console.log('Running cron job: ${exportName}');
    return { processed: 10 };
  });
`;
  return createTestFile(dir, filename, content);
}

/**
 * Helper functions to create real constructs for testing
 */
export function createTestEndpoint(path: string, method: HttpMethod = 'GET') {
  const m = method.toLowerCase() as Lowercase<HttpMethod>;
  const builder = e[m](path);
  builder.output(z.object({ message: z.string() }));
  return builder.handle(async () => ({ message: `Hello from ${path}` }));
}

export function createTestFunction(timeout: number = 30) {
  const builder = new FunctionBuilder();
  builder.input(z.object({ name: z.string() }));
  builder.output(z.object({ greeting: z.string() }));
  builder.timeout(timeout);
  return builder.handle(async ({ input }: any) => ({
    greeting: `Hello, ${input.name}!`,
  }));
}

export function createTestCron(
  schedule: ScheduleExpression = 'rate(1 hour)',
  timeout: number = 30,
) {
  const builder = new CronBuilder();
  builder.schedule(schedule);
  builder.output(z.object({ processed: z.number() }));
  builder.timeout(timeout);
  return builder.handle(async () => {
    return { processed: 10 };
  });
}

/**
 * Creates a mock build context
 */
export function createMockBuildContext() {
  return {
    envParserPath: './env',
    envParserImportPattern: 'envParser',
    loggerPath: './logger',
    loggerImportPattern: 'logger',
  };
}

/**
 * Waits for a condition to be true
 */
export async function waitFor(
  condition: () => boolean,
  timeout = 5000,
  interval = 100,
): Promise<void> {
  const start = Date.now();
  while (!condition() && Date.now() - start < timeout) {
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  if (!condition()) {
    throw new Error('Timeout waiting for condition');
  }
}

import { dirname } from 'node:path';
import type { HttpMethod } from '../../../api/src/constructs/types';
