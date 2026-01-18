#!/usr/bin/env -S npx tsx

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadConfig, loadWorkspaceConfig } from './config.js';
import { EndpointGenerator } from './generators/EndpointGenerator.js';
import { OpenApiTsGenerator } from './generators/OpenApiTsGenerator.js';
import type { GkmConfig, OpenApiConfig } from './types.js';
import { isWorkspaceConfig } from './workspace/index.js';

interface OpenAPIOptions {
	cwd?: string;
}

/**
 * Default output path for generated OpenAPI client (used for single-app configs)
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
		const loadedConfig = await loadWorkspaceConfig(options.cwd);

		if (loadedConfig.type === 'single') {
			// Single-app config - use existing behavior
			const config = loadedConfig.raw as GkmConfig;

			// Enable openapi if not configured
			if (!config.openapi) {
				config.openapi = { enabled: true };
			}

			const result = await generateOpenApi(config);

			if (result) {
				logger.log(`Found ${result.endpointCount} endpoints`);
			}
		} else {
			// Workspace config - generate for each backend app and copy to frontend clients
			const { workspace } = loadedConfig;
			const workspaceRoot = options.cwd || process.cwd();

			// Find backend apps with openapi enabled
			const backendApps = Object.entries(workspace.apps).filter(
				([_, app]) =>
					app.type === 'backend' &&
					(app.openapi === true ||
						(typeof app.openapi === 'object' && app.openapi.enabled !== false)),
			);

			if (backendApps.length === 0) {
				logger.log('No backend apps with OpenAPI enabled found');
				return;
			}

			// Find frontend apps with client config
			const frontendApps = Object.entries(workspace.apps).filter(
				([_, app]) => app.type === 'frontend' && app.client?.output,
			);

			// Generate OpenAPI for each backend app
			for (const [appName, app] of backendApps) {
				if (app.type !== 'backend' || !app.routes) continue;

				const appPath = join(workspaceRoot, app.path);
				const routes = Array.isArray(app.routes) ? app.routes : [app.routes];
				const routesGlob = routes.map((r) => join(appPath, r));

				const gkmConfig: GkmConfig = {
					routes: routesGlob,
					envParser: app.envParser || '',
					logger: app.logger || '',
					openapi: app.openapi,
				};

				// Change to app directory for generation
				const originalCwd = process.cwd();
				process.chdir(appPath);

				const result = await generateOpenApi(gkmConfig, { silent: true });

				process.chdir(originalCwd);

				if (result) {
					logger.log(`📄 [${appName}] Generated OpenAPI (${result.endpointCount} endpoints)`);

					// Copy to frontend apps that depend on this backend
					for (const [frontendName, frontendApp] of frontendApps) {
						if (frontendApp.type !== 'frontend') continue;

						const dependsOnBackend =
							!frontendApp.dependencies ||
							frontendApp.dependencies.includes(appName);

						if (dependsOnBackend && frontendApp.client?.output) {
							const frontendPath = join(workspaceRoot, frontendApp.path);
							const clientOutputPath = join(
								frontendPath,
								frontendApp.client.output,
								'openapi.ts',
							);

							await mkdir(dirname(clientOutputPath), { recursive: true });

							// Read the generated content and write to frontend
							const { readFile } = await import('node:fs/promises');
							const content = await readFile(result.outputPath, 'utf-8');
							await writeFile(clientOutputPath, content);

							logger.log(`   → [${frontendName}] ${frontendApp.client.output}/openapi.ts`);
						}
					}
				}
			}
		}
	} catch (error) {
		throw new Error(`OpenAPI generation failed: ${(error as Error).message}`);
	}
}
