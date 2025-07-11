#!/usr/bin/env -S npx tsx

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Endpoint } from '@geekmidas/api/server';
import { loadConfig } from './config.js';
import { loadEndpoints } from './loadEndpoints.js';

interface OpenAPIOptions {
  output?: string;
}

export async function openapiCommand(
  options: OpenAPIOptions = {},
): Promise<void> {
  const logger = console;

  try {
    // Load config using existing function
    const config = await loadConfig();

    // Load all endpoints using the refactored function
    const loadedEndpoints = await loadEndpoints(config.routes);

    if (loadedEndpoints.length === 0) {
      logger.log('No valid endpoints found');
      return;
    }

    // Extract just the endpoint instances for OpenAPI generation
    const endpoints = loadedEndpoints.map(({ endpoint }) => endpoint);

    // Generate OpenAPI spec using built-in method
    const spec = await Endpoint.buildOpenApiSchema(endpoints, {
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Auto-generated API documentation from endpoints',
    });

    // Write output
    const outputPath = options.output || join(process.cwd(), 'openapi.json');
    await mkdir(join(outputPath, '..'), { recursive: true });
    await writeFile(outputPath, JSON.stringify(spec, null, 2));

    logger.log(`OpenAPI spec generated: ${outputPath}`);
    logger.log(`Found ${endpoints.length} endpoints`);
  } catch (error) {
    throw new Error(`OpenAPI generation failed: ${(error as Error).message}`);
  }
}
