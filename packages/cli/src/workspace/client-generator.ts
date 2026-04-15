import { join } from 'node:path';
import { isPartitionedRoutes, type Routes } from '../types.js';
import type { NormalizedWorkspace } from './types.js';

/**
 * Normalize routes to an array of patterns.
 * Handles string, string[], and PartitionedRoutes (extracts paths).
 * @internal Exported for use in dev command
 */
export function normalizeRoutes(routes: Routes | undefined): string[] {
	if (!routes) return [];
	if (isPartitionedRoutes(routes)) {
		return Array.isArray(routes.paths) ? routes.paths : [routes.paths];
	}
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
