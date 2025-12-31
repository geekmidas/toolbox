#!/usr/bin/env -S npx tsx

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadConfig } from './config.js';
import { EndpointGenerator } from './generators/EndpointGenerator.js';
import { OpenApiTsGenerator } from './generators/OpenApiTsGenerator.js';
import type { GkmConfig, OpenApiConfig } from './types.js';

interface OpenAPIOptions {
  cwd?: string;
}

/**
 * Fixed output path for generated OpenAPI client (not configurable)
 */
export const OPENAPI_OUTPUT_PATH = './.gkm/openapi.ts';

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
      title: 'API Documentation',
      version: '1.0.0',
      description: 'Auto-generated API documentation from endpoints',
    };
  }

  return {
    enabled: config.openapi.enabled !== false,
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
  const outputPath = join(process.cwd(), OPENAPI_OUTPUT_PATH);

  await mkdir(dirname(outputPath), { recursive: true });

  const tsGenerator = new OpenApiTsGenerator();
  const tsContent = await tsGenerator.generate(endpoints, {
    title: openApiConfig.title!,
    version: openApiConfig.version!,
    description: openApiConfig.description!,
  });

  await writeFile(outputPath, tsContent);
  logger.log(`📄 OpenAPI client generated: ${OPENAPI_OUTPUT_PATH}`);

  return { outputPath, endpointCount: loadedEndpoints.length };
}

export async function openapiCommand(
  options: OpenAPIOptions = {},
): Promise<void> {
  const logger = console;

  try {
    const config = await loadConfig(options.cwd);

    // Enable openapi if not configured
    if (!config.openapi) {
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
