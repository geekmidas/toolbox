#!/usr/bin/env -S npx tsx

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { Endpoint } from '@geekmidas/constructs/endpoints';
import { loadConfig } from './config.js';
import { EndpointGenerator } from './generators/EndpointGenerator.js';
import { OpenApiTsGenerator } from './generators/OpenApiTsGenerator.js';
import type { GkmConfig, OpenApiConfig } from './types.js';

interface OpenAPIOptions {
  output?: string;
  json?: boolean;
  cwd?: string;
}

const DEFAULT_OUTPUT = './src/api/openapi.ts';

/**
 * Resolve OpenAPI config from GkmConfig
 */
export function resolveOpenApiConfig(
  config: GkmConfig,
): OpenApiConfig & { enabled: boolean } {
  if (config.openapi === false) {
    return { enabled: false };
  }

  if (config.openapi === true || config.openapi === undefined) {
    return {
      enabled: config.openapi === true,
      output: DEFAULT_OUTPUT,
      json: false,
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Auto-generated API documentation from endpoints',
    };
  }

  return {
    enabled: config.openapi.enabled !== false,
    output: config.openapi.output || DEFAULT_OUTPUT,
    json: config.openapi.json || false,
    title: config.openapi.title || 'API Documentation',
    version: config.openapi.version || '1.0.0',
    description:
      config.openapi.description ||
      'Auto-generated API documentation from endpoints',
  };
}

/**
 * Generate OpenAPI spec from endpoints
 * @returns Object with output path and endpoint count, or null if disabled
 */
export async function generateOpenApi(
  config: GkmConfig,
  options: { silent?: boolean } = {},
): Promise<{ outputPath: string; endpointCount: number } | null> {
  const logger = options.silent ? { log: () => {} } : console;
  const openApiConfig = resolveOpenApiConfig(config);

  if (!openApiConfig.enabled) {
    return null;
  }

  const endpointGenerator = new EndpointGenerator();
  const loadedEndpoints = await endpointGenerator.load(config.routes);

  if (loadedEndpoints.length === 0) {
    logger.log('No valid endpoints found for OpenAPI generation');
    return null;
  }

  const endpoints = loadedEndpoints.map(({ construct }) => construct);
  const outputPath = isAbsolute(openApiConfig.output!)
    ? openApiConfig.output!
    : join(process.cwd(), openApiConfig.output!);

  await mkdir(dirname(outputPath), { recursive: true });

  if (openApiConfig.json) {
    const spec = await Endpoint.buildOpenApiSchema(endpoints, {
      title: openApiConfig.title!,
      version: openApiConfig.version!,
      description: openApiConfig.description!,
    });

    await writeFile(outputPath, JSON.stringify(spec, null, 2));
    logger.log(`📄 OpenAPI JSON generated: ${openApiConfig.output}`);
  } else {
    const tsGenerator = new OpenApiTsGenerator();
    const tsContent = await tsGenerator.generate(endpoints, {
      title: openApiConfig.title!,
      version: openApiConfig.version!,
      description: openApiConfig.description!,
    });

    await writeFile(outputPath, tsContent);
    logger.log(`📄 OpenAPI TypeScript generated: ${openApiConfig.output}`);
  }

  return { outputPath, endpointCount: loadedEndpoints.length };
}

export async function openapiCommand(
  options: OpenAPIOptions = {},
): Promise<void> {
  const logger = console;

  try {
    const config = await loadConfig(options.cwd);

    // CLI options override config
    if (options.output || options.json !== undefined) {
      const openApiConfig = resolveOpenApiConfig(config);
      config.openapi = {
        ...openApiConfig,
        enabled: true,
        output: options.output || openApiConfig.output,
        json: options.json ?? openApiConfig.json,
      };
    } else if (!config.openapi) {
      // Enable with defaults if not configured
      config.openapi = { enabled: true };
    }

    const result = await generateOpenApi(config);

    if (result) {
      logger.log(`Found ${result.endpointCount} endpoints`);
    }
  } catch (error) {
    throw new Error(`OpenAPI generation failed: ${(error as Error).message}`);
  }
}
