#!/usr/bin/env -S npx tsx

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadWorkspaceConfig } from './config.js';
import { EndpointGenerator } from './generators/EndpointGenerator.js';
import { OpenApiTsGenerator } from './generators/OpenApiTsGenerator.js';
import type { GkmConfig, OpenApiConfig } from './types.js';
import { normalizeRoutes } from './workspace/client-generator.js';
import type { NormalizedAppConfig } from './workspace/types.js';

interface OpenAPIOptions {
	cwd?: string;
	/**
	 * Workspace mode: generate for a single named backend app. When set,
	 * generation runs in-process against the current CWD. When unset,
	 * workspace mode spawns one subprocess per backend app so each gets a
	 * fresh tsx that loads the app's own tsconfig (path aliases included).
	 */
	app?: string;
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
		// Enable by default when not explicitly set (undefined) or explicitly true
		return {
			enabled: true,
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
	options: { silent?: boolean; bustCache?: boolean } = {},
): Promise<{ outputPath: string; endpointCount: number } | null> {
	const logger = options.silent ? { log: () => {} } : console;
	const openApiConfig = resolveOpenApiConfig(config);

	if (!openApiConfig.enabled) {
		return null;
	}

	const endpointGenerator = new EndpointGenerator();
	const loadedEndpoints = await endpointGenerator.load(
		config.routes,
		undefined,
		options.bustCache,
	);

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
			// Workspace config - generate for each backend app
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

			// Single-app mode: generate in-process. The caller is expected to
			// have CWD set to the app's directory (e.g., when invoked as a
			// subprocess), so tsx picks up the app's tsconfig path aliases.
			if (options.app) {
				const entry = backendApps.find(([name]) => name === options.app);
				if (!entry) {
					throw new Error(
						`App "${options.app}" not found or has OpenAPI disabled`,
					);
				}
				const [appName, app] = entry;
				const result = await generateOpenApiForApp(workspaceRoot, appName, app);
				if (result) {
					logger.log(
						`📄 [${appName}] Generated OpenAPI (${result.endpointCount} endpoints)`,
					);
				}
				return;
			}

			// Multi-app mode: spawn a subprocess per backend app. Each
			// subprocess starts with CWD at the app's directory so that
			// tsx's tsconfig discovery picks up the app's `paths` aliases
			// (e.g., `~/*`) instead of the workspace root's tsconfig.
			for (const [appName, app] of backendApps) {
				if (app.type !== 'backend' || !app.routes) continue;
				const appPath = join(workspaceRoot, app.path);
				await runOpenApiInSubprocess(appPath, appName);
			}
		}
	} catch (error) {
		throw new Error(`OpenAPI generation failed: ${(error as Error).message}`);
	}
}

/**
 * Generate OpenAPI for a single named app within a workspace.
 * Runs in-process. The caller is responsible for ensuring `process.cwd()`
 * is the app's directory so tsx loads the app's tsconfig path aliases.
 */
async function generateOpenApiForApp(
	workspaceRoot: string,
	_appName: string,
	app: NormalizedAppConfig,
): Promise<{ outputPath: string; endpointCount: number } | null> {
	if (app.type !== 'backend' || !app.routes) {
		return null;
	}

	const appPath = join(workspaceRoot, app.path);
	const routes = normalizeRoutes(app.routes);
	const routesGlob = routes.map((r) => join(appPath, r));

	const gkmConfig: GkmConfig = {
		routes: routesGlob,
		envParser: app.envParser || '',
		logger: app.logger || '',
		openapi: app.openapi,
	};

	return generateOpenApi(gkmConfig, { silent: true });
}

/**
 * Resolve the gkm bin path. Tests can override via `GKM_BIN_PATH` env var
 * to avoid depending on the built dist.
 */
function resolveGkmBinPath(): string {
	if (process.env.GKM_BIN_PATH) {
		return process.env.GKM_BIN_PATH;
	}
	return fileURLToPath(new URL('../bin/gkm.mjs', import.meta.url));
}

/**
 * Spawn a subprocess that runs `gkm openapi --app <name>` with `cwd` set to
 * the app's directory. Inherits `NODE_OPTIONS` (which already contains
 * `--import tsx`), so the child gets a fresh tsx instance whose tsconfig
 * discovery picks up the app's tsconfig path aliases.
 */
async function runOpenApiInSubprocess(
	appCwd: string,
	appName: string,
): Promise<void> {
	const binPath = resolveGkmBinPath();

	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			process.execPath,
			[binPath, 'openapi', '--app', appName],
			{
				cwd: appCwd,
				stdio: 'inherit',
				env: process.env,
			},
		);

		child.on('error', reject);
		child.on('close', (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(
					new Error(
						`OpenAPI generation for app "${appName}" exited with code ${code}`,
					),
				);
			}
		});
	});
}
