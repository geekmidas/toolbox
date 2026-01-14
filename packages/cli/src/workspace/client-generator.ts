import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { EndpointGenerator } from '../generators/EndpointGenerator.js';
import { OpenApiTsGenerator } from '../generators/OpenApiTsGenerator.js';
import type { NormalizedWorkspace } from './types.js';

const logger = console;

/**
 * Result of generating a client for a frontend app.
 */
export interface ClientGenerationResult {
	frontendApp: string;
	backendApp: string;
	outputPath: string;
	endpointCount: number;
	generated: boolean;
	reason?: string;
}

/**
 * Cache of OpenAPI spec hashes to detect changes.
 */
const specHashCache = new Map<string, string>();

/**
 * Calculate hash of content for change detection.
 */
function hashContent(content: string): string {
	return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Normalize routes to an array of patterns.
 * @internal Exported for use in dev command
 */
export function normalizeRoutes(
	routes: string | string[] | undefined,
): string[] {
	if (!routes) return [];
	return Array.isArray(routes) ? routes : [routes];
}

/**
 * Get the first routes pattern as a string (for simple cases).
 * @internal Exported for use in dev command
 */
export function getFirstRoute(
	routes: string | string[] | undefined,
): string | null {
	const normalized = normalizeRoutes(routes);
	return normalized[0] || null;
}

/**
 * Generate OpenAPI spec for a backend app.
 * Returns the spec content and endpoint count.
 */
export async function generateBackendOpenApi(
	workspace: NormalizedWorkspace,
	appName: string,
): Promise<{ content: string; endpointCount: number } | null> {
	const app = workspace.apps[appName];
	if (!app || app.type !== 'backend' || !app.routes) {
		return null;
	}

	const appPath = join(workspace.root, app.path);
	const routesPatterns = normalizeRoutes(app.routes);

	if (routesPatterns.length === 0) {
		return null;
	}

	// Load endpoints from all routes patterns
	const endpointGenerator = new EndpointGenerator();
	const allLoadedEndpoints = [];

	for (const pattern of routesPatterns) {
		const fullPattern = join(appPath, pattern);
		const loaded = await endpointGenerator.load(fullPattern);
		allLoadedEndpoints.push(...loaded);
	}

	const loadedEndpoints = allLoadedEndpoints;

	if (loadedEndpoints.length === 0) {
		return null;
	}

	const endpoints = loadedEndpoints.map(({ construct }) => construct);

	const tsGenerator = new OpenApiTsGenerator();
	const content = await tsGenerator.generate(endpoints, {
		title: `${appName} API`,
		version: '1.0.0',
		description: `Auto-generated API client for ${appName}`,
	});

	return { content, endpointCount: loadedEndpoints.length };
}

/**
 * Generate client for a frontend app from its backend dependencies.
 * Only regenerates if the OpenAPI spec has changed.
 */
export async function generateClientForFrontend(
	workspace: NormalizedWorkspace,
	frontendAppName: string,
	options: { force?: boolean } = {},
): Promise<ClientGenerationResult[]> {
	const results: ClientGenerationResult[] = [];
	const frontendApp = workspace.apps[frontendAppName];

	if (!frontendApp || frontendApp.type !== 'frontend') {
		return results;
	}

	const dependencies = frontendApp.dependencies || [];
	const backendDeps = dependencies.filter((dep) => {
		const depApp = workspace.apps[dep];
		return depApp?.type === 'backend' && depApp.routes;
	});

	if (backendDeps.length === 0) {
		return results;
	}

	// Determine output directory
	const clientOutput = frontendApp.client?.output || 'src/api';
	const frontendPath = join(workspace.root, frontendApp.path);
	const outputDir = join(frontendPath, clientOutput);

	for (const backendAppName of backendDeps) {
		const result: ClientGenerationResult = {
			frontendApp: frontendAppName,
			backendApp: backendAppName,
			outputPath: '',
			endpointCount: 0,
			generated: false,
		};

		try {
			// Generate OpenAPI spec for backend
			const spec = await generateBackendOpenApi(workspace, backendAppName);

			if (!spec) {
				result.reason = 'No endpoints found in backend';
				results.push(result);
				continue;
			}

			result.endpointCount = spec.endpointCount;

			// Check if spec has changed (unless force)
			const cacheKey = `${backendAppName}:${frontendAppName}`;
			const newHash = hashContent(spec.content);
			const oldHash = specHashCache.get(cacheKey);

			if (!options.force && oldHash === newHash) {
				result.reason = 'No schema changes detected';
				results.push(result);
				continue;
			}

			// Generate client file
			await mkdir(outputDir, { recursive: true });

			// For single dependency, use openapi.ts; for multiple, use {backend}-api.ts
			const fileName =
				backendDeps.length === 1 ? 'openapi.ts' : `${backendAppName}-api.ts`;
			const outputPath = join(outputDir, fileName);

			// Add header comment with backend reference
			const backendRelPath = relative(
				dirname(outputPath),
				join(workspace.root, workspace.apps[backendAppName]!.path),
			);

			const clientContent = `/**
 * Auto-generated API client for ${backendAppName}
 * Generated from: ${backendRelPath}
 *
 * DO NOT EDIT - This file is automatically regenerated when backend schemas change.
 */

${spec.content}
`;

			await writeFile(outputPath, clientContent);

			// Update cache
			specHashCache.set(cacheKey, newHash);

			result.outputPath = outputPath;
			result.generated = true;
			results.push(result);
		} catch (error) {
			result.reason = `Error: ${(error as Error).message}`;
			results.push(result);
		}
	}

	return results;
}

/**
 * Generate clients for all frontend apps in the workspace.
 */
export async function generateAllClients(
	workspace: NormalizedWorkspace,
	options: { force?: boolean; silent?: boolean } = {},
): Promise<ClientGenerationResult[]> {
	const log = options.silent ? () => {} : logger.log.bind(logger);
	const allResults: ClientGenerationResult[] = [];

	for (const [appName, app] of Object.entries(workspace.apps)) {
		if (app.type === 'frontend' && app.dependencies.length > 0) {
			const results = await generateClientForFrontend(workspace, appName, {
				force: options.force,
			});

			for (const result of results) {
				if (result.generated) {
					log(
						`📦 Generated client for ${result.frontendApp} from ${result.backendApp} (${result.endpointCount} endpoints)`,
					);
				}
				allResults.push(result);
			}
		}
	}

	return allResults;
}

/**
 * Check if a file path matches endpoint patterns that could affect OpenAPI schema.
 * Returns true for changes that should trigger client regeneration.
 */
export function shouldRegenerateClient(
	filePath: string,
	routesPattern: string,
): boolean {
	// Normalize path separators
	const normalizedPath = filePath.replace(/\\/g, '/');
	const normalizedPattern = routesPattern.replace(/\\/g, '/');

	// Check if the file matches the routes pattern
	// This is a simple check - the file should be within the routes directory
	const patternDir = normalizedPattern.split('*')[0] || '';

	if (!normalizedPath.includes(patternDir.replace('./', ''))) {
		return false;
	}

	// Check file extension - only TypeScript endpoint files
	if (!normalizedPath.endsWith('.ts') && !normalizedPath.endsWith('.tsx')) {
		return false;
	}

	return true;
}

/**
 * Get backend apps that a frontend depends on.
 */
export function getBackendDependencies(
	workspace: NormalizedWorkspace,
	frontendAppName: string,
): string[] {
	const frontendApp = workspace.apps[frontendAppName];
	if (!frontendApp || frontendApp.type !== 'frontend') {
		return [];
	}

	return frontendApp.dependencies.filter((dep) => {
		const depApp = workspace.apps[dep];
		return depApp?.type === 'backend' && depApp.routes;
	});
}

/**
 * Get frontend apps that depend on a backend app.
 */
export function getDependentFrontends(
	workspace: NormalizedWorkspace,
	backendAppName: string,
): string[] {
	const dependentApps: string[] = [];

	for (const [appName, app] of Object.entries(workspace.apps)) {
		if (app.type === 'frontend' && app.dependencies.includes(backendAppName)) {
			dependentApps.push(appName);
		}
	}

	return dependentApps;
}

/**
 * Clear the spec hash cache (useful for testing).
 */
export function clearSpecHashCache(): void {
	specHashCache.clear();
}
