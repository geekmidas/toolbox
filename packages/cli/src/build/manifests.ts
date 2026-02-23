import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import type {
	CronInfo,
	FunctionInfo,
	RouteInfo,
	SubscriberInfo,
} from '../types';

const logger = console;

export type ManifestProvider = 'aws' | 'server';

export interface ServerAppInfo {
	handler: string;
	endpoints: string;
}

/**
 * A manifest field is either a flat array (no partition) or
 * an object keyed by partition name (partitioned).
 */
export type ManifestField<T> = T[] | Record<string, T[]>;

function isPartitioned<T>(
	field: ManifestField<T>,
): field is Record<string, T[]> {
	return !Array.isArray(field);
}

/**
 * Serialize a manifest field to a TypeScript string.
 * Flat arrays serialize as JSON arrays, partitioned fields as objects of arrays.
 */
function serializeField<T>(field: ManifestField<T>, indent = 2): string {
	if (Array.isArray(field)) {
		return JSON.stringify(field, null, indent);
	}
	// Partitioned: { admin: [...], default: [...] }
	const entries = Object.entries(field)
		.map(
			([key, value]) =>
				`    ${JSON.stringify(key)}: ${JSON.stringify(value, null, indent)}`,
		)
		.join(',\n');
	return `{\n${entries},\n  }`;
}

/**
 * Count total items across a manifest field (flat or partitioned).
 */
function countItems<T>(field: ManifestField<T>): number {
	if (Array.isArray(field)) return field.length;
	return Object.values(field).reduce((sum, arr) => sum + arr.length, 0);
}

/**
 * Generate derived types for a construct field.
 * @param fieldName - The field name in the manifest (e.g., 'routes')
 * @param typeName - The exported type name (e.g., 'Route')
 * @param partitioned - Whether this field is partitioned
 */
function generateDerivedType(
	fieldName: string,
	typeName: string,
	partitioned: boolean,
): string {
	if (partitioned) {
		const partitionTypeName = `${typeName}Partition`;
		return [
			`export type ${partitionTypeName} = keyof typeof manifest.${fieldName};`,
			`export type ${typeName}<P extends ${partitionTypeName} = ${partitionTypeName}> = (typeof manifest.${fieldName})[P][number];`,
		].join('\n');
	}
	return `export type ${typeName} = (typeof manifest.${fieldName})[number];`;
}

export async function generateAwsManifest(
	outputDir: string,
	routes: ManifestField<RouteInfo>,
	functions: ManifestField<FunctionInfo>,
	crons: ManifestField<CronInfo>,
	subscribers: ManifestField<SubscriberInfo>,
): Promise<void> {
	const manifestDir = join(outputDir, 'manifest');
	await mkdir(manifestDir, { recursive: true });

	// Filter out 'ALL' method routes (server-specific)
	const awsRoutes = filterAllRoutes(routes);

	const routesPartitioned = isPartitioned(awsRoutes);
	const functionsPartitioned = isPartitioned(functions);
	const cronsPartitioned = isPartitioned(crons);
	const subscribersPartitioned = isPartitioned(subscribers);

	const content = `export const manifest = {
  routes: ${serializeField(awsRoutes)},
  functions: ${serializeField(functions)},
  crons: ${serializeField(crons)},
  subscribers: ${serializeField(subscribers)},
} as const;

// Derived types
${generateDerivedType('routes', 'Route', routesPartitioned)}
${generateDerivedType('functions', 'Function', functionsPartitioned)}
${generateDerivedType('crons', 'Cron', cronsPartitioned)}
${generateDerivedType('subscribers', 'Subscriber', subscribersPartitioned)}

// Useful union types
export type Authorizer = Route['authorizer'];
export type HttpMethod = Route['method'];
export type RoutePath = Route['path'];
`;

	const manifestPath = join(manifestDir, 'aws.ts');
	await writeFile(manifestPath, content);

	logger.log(
		`Generated AWS manifest with ${countItems(awsRoutes)} routes, ${countItems(functions)} functions, ${countItems(crons)} crons, ${countItems(subscribers)} subscribers`,
	);
	logger.log(`Manifest: ${relative(process.cwd(), manifestPath)}`);
}

export async function generateServerManifest(
	outputDir: string,
	appInfo: ServerAppInfo,
	routes: RouteInfo[],
	subscribers: SubscriberInfo[],
): Promise<void> {
	const manifestDir = join(outputDir, 'manifest');
	await mkdir(manifestDir, { recursive: true });

	// For server, extract route metadata (path, method, authorizer)
	const serverRoutes = routes
		.filter((r) => r.method !== 'ALL')
		.map((r) => ({
			path: r.path,
			method: r.method,
			authorizer: r.authorizer,
		}));

	// Server subscribers only need name and events
	const serverSubscribers = subscribers.map((s) => ({
		name: s.name,
		subscribedEvents: s.subscribedEvents,
	}));

	const content = `export const manifest = {
  app: ${JSON.stringify(appInfo, null, 2)},
  routes: ${JSON.stringify(serverRoutes, null, 2)},
  subscribers: ${JSON.stringify(serverSubscribers, null, 2)},
} as const;

// Derived types
export type Route = (typeof manifest.routes)[number];
export type Subscriber = (typeof manifest.subscribers)[number];

// Useful union types
export type Authorizer = Route['authorizer'];
export type HttpMethod = Route['method'];
export type RoutePath = Route['path'];
`;

	const manifestPath = join(manifestDir, 'server.ts');
	await writeFile(manifestPath, content);

	logger.log(
		`Generated server manifest with ${countItems(serverRoutes)} routes, ${countItems(serverSubscribers)} subscribers`,
	);
	logger.log(`Manifest: ${relative(process.cwd(), manifestPath)}`);
}

/**
 * Filter out 'ALL' method routes from a manifest field (flat or partitioned).
 */
function filterAllRoutes(
	routes: ManifestField<RouteInfo>,
): ManifestField<RouteInfo> {
	if (Array.isArray(routes)) {
		return routes.filter((r) => r.method !== 'ALL');
	}
	const result: Record<string, RouteInfo[]> = {};
	for (const [partition, partitionRoutes] of Object.entries(routes)) {
		result[partition] = partitionRoutes.filter((r) => r.method !== 'ALL');
	}
	return result;
}

/**
 * Map routes to server metadata (path, method, authorizer only).
 */
function mapRouteMetadata(
	routes: ManifestField<RouteInfo>,
): ManifestField<{ path: string; method: string; authorizer: string }> {
	const mapFn = (r: RouteInfo) => ({
		path: r.path,
		method: r.method,
		authorizer: r.authorizer,
	});

	if (Array.isArray(routes)) {
		return routes.map(mapFn);
	}
	const result: Record<
		string,
		{ path: string; method: string; authorizer: string }[]
	> = {};
	for (const [partition, partitionRoutes] of Object.entries(routes)) {
		result[partition] = partitionRoutes.map(mapFn);
	}
	return result;
}

/**
 * Map subscribers to server metadata (name, subscribedEvents only).
 */
function mapSubscriberMetadata(
	subscribers: ManifestField<SubscriberInfo>,
): ManifestField<{ name: string; subscribedEvents: string[] }> {
	const mapFn = (s: SubscriberInfo) => ({
		name: s.name,
		subscribedEvents: s.subscribedEvents,
	});

	if (Array.isArray(subscribers)) {
		return subscribers.map(mapFn);
	}
	const result: Record<string, { name: string; subscribedEvents: string[] }[]> =
		{};
	for (const [partition, partitionSubs] of Object.entries(subscribers)) {
		result[partition] = partitionSubs.map(mapFn);
	}
	return result;
}
