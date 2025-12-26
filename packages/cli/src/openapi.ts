#!/usr/bin/env -S npx tsx

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Endpoint } from '@geekmidas/constructs/endpoints';
import { loadConfig } from './config.js';
import { EndpointGenerator } from './generators/EndpointGenerator.js';
import { OpenApiTsGenerator } from './generators/OpenApiTsGenerator.js';

interface OpenAPIOptions {
  output?: string;
  json?: boolean;
  cwd?: string;
}

export async function openapiCommand(
  options: OpenAPIOptions = {},
): Promise<void> {
  const logger = console;

  try {
    // Load config using existing function
    const config = await loadConfig(options.cwd);
    const endpointGenerator = new EndpointGenerator();

    // Load all endpoints using the refactored function
    const loadedEndpoints = await endpointGenerator.load(config.routes);

    if (loadedEndpoints.length === 0) {
      logger.log('No valid endpoints found');
      return;
    }

    // Extract just the endpoint instances for OpenAPI generation
    const endpoints = loadedEndpoints.map(({ construct }) => construct);

    // Determine output format (TypeScript is default)
    const isJson = options.json === true;
    const defaultOutput = isJson ? 'openapi.json' : 'openapi.ts';
    const outputPath = options.output || join(process.cwd(), defaultOutput);

    // Ensure output directory exists
    await mkdir(dirname(outputPath), { recursive: true });

    if (isJson) {
      // Generate JSON OpenAPI spec (legacy)
      const spec = await Endpoint.buildOpenApiSchema(endpoints, {
        title: 'API Documentation',
        version: '1.0.0',
        description: 'Auto-generated API documentation from endpoints',
      });

      await writeFile(outputPath, JSON.stringify(spec, null, 2));
      logger.log(`OpenAPI JSON spec generated: ${outputPath}`);
    } else {
      // Generate TypeScript OpenAPI module (default)
      const tsGenerator = new OpenApiTsGenerator();
      const tsContent = await tsGenerator.generate(endpoints, {
        title: 'API Documentation',
        version: '1.0.0',
        description: 'Auto-generated API documentation from endpoints',
      });

      await writeFile(outputPath, tsContent);
      logger.log(`OpenAPI TypeScript module generated: ${outputPath}`);
    }

    logger.log(`Found ${endpoints.length} endpoints`);
  } catch (error) {
    throw new Error(`OpenAPI generation failed: ${(error as Error).message}`);
  }
}
