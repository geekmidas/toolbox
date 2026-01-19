import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import type { NormalizedWorkspace } from './types.js';

const logger = console;

/**
 * Result of copying a client to a frontend app.
 */
export interface ClientCopyResult {
	frontendApp: string;
	backendApp: string;
	outputPath: string;
	endpointCount: number;
	success: boolean;
	error?: string;
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
 * Get the path to a backend's OpenAPI spec file.
 */
export function getBackendOpenApiPath(
	workspace: NormalizedWorkspace,
	backendAppName: string,
): string | null {
	const app = workspace.apps[backendAppName];
	if (!app || app.type !== 'backend') {
		return null;
	}

	return join(workspace.root, app.path, '.gkm', 'openapi.ts');
}

/**
 * Count endpoints in an OpenAPI spec content.
 */
function countEndpoints(content: string): number {
	const endpointMatches = content.match(
		/'(GET|POST|PUT|PATCH|DELETE)\s+\/[^']+'/g,
	);
	return endpointMatches?.length ?? 0;
}

/**
 * Copy the OpenAPI client from a backend to all dependent frontend apps.
 * Called when the backend's .gkm/openapi.ts file changes.
 */
export async function copyClientToFrontends(
	workspace: NormalizedWorkspace,
	backendAppName: string,
	options: { silent?: boolean } = {},
): Promise<ClientCopyResult[]> {
	const log = options.silent ? () => {} : logger.log.bind(logger);
	const results: ClientCopyResult[] = [];

	const backendApp = workspace.apps[backendAppName];
	if (!backendApp || backendApp.type !== 'backend') {
		return results;
	}

	// Get the backend's OpenAPI spec
	const openApiPath = join(
		workspace.root,
		backendApp.path,
		'.gkm',
		'openapi.ts',
	);

	if (!existsSync(openApiPath)) {
		return results;
	}

	const content = await readFile(openApiPath, 'utf-8');
	const endpointCount = countEndpoints(content);

	// Get all frontends that depend on this backend
	const dependentFrontends = getDependentFrontends(workspace, backendAppName);

	for (const frontendAppName of dependentFrontends) {
		const frontendApp = workspace.apps[frontendAppName];
		if (!frontendApp || frontendApp.type !== 'frontend') {
			continue;
		}

		// Check if frontend has client output configured
		const clientOutput = frontendApp.client?.output;
		if (!clientOutput) {
			continue;
		}

		const result: ClientCopyResult = {
			frontendApp: frontendAppName,
			backendApp: backendAppName,
			outputPath: '',
			endpointCount,
			success: false,
		};

		try {
			const frontendPath = join(workspace.root, frontendApp.path);
			const outputDir = join(frontendPath, clientOutput);
			await mkdir(outputDir, { recursive: true });

			// Use backend app name as filename
			const fileName = `${backendAppName}.ts`;
			const outputPath = join(outputDir, fileName);

			// Add header comment with backend reference
			const backendRelPath = relative(
				dirname(outputPath),
				join(workspace.root, backendApp.path),
			);

			const clientContent = `/**
 * Auto-generated API client for ${backendAppName}
 * Generated from: ${backendRelPath}
 *
 * DO NOT EDIT - This file is automatically regenerated when backend schemas change.
 */

${content}
`;

			await writeFile(outputPath, clientContent);

			result.outputPath = outputPath;
			result.success = true;

			log(
				`📦 Copied client to ${frontendAppName} from ${backendAppName} (${endpointCount} endpoints)`,
			);
		} catch (error) {
			result.error = (error as Error).message;
		}

		results.push(result);
	}

	return results;
}

/**
 * Copy clients from all backends to their dependent frontends.
 * Useful for initial setup or force refresh.
 */
export async function copyAllClients(
	workspace: NormalizedWorkspace,
	options: { silent?: boolean } = {},
): Promise<ClientCopyResult[]> {
	const allResults: ClientCopyResult[] = [];

	for (const [appName, app] of Object.entries(workspace.apps)) {
		if (app.type === 'backend' && app.routes) {
			const results = await copyClientToFrontends(workspace, appName, options);
			allResults.push(...results);
		}
	}

	return allResults;
}
