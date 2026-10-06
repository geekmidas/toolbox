import { resolve } from 'node:path';
import { type ConstructManifest, provideKey } from '@geekmidas/manifest';
import type { ConstructSource } from '../reconcile/discover.js';
import { type BuildContext, DEV_DATABASE_API_PATH } from './types';

/**
 * What a generated entry imports its runtime from, read off the discovered
 * constructs: the surface it serves, every construct a runnable can be built
 * from, and the database the dev server's JSON API reads.
 *
 * `gkm build` and `gkm dev` both write entries that import the surface for its
 * logger and environment parser, so both ask here. A dev server that skipped it
 * had nothing to import them from.
 */
export function ownersContext(options: {
	declared: ConstructManifest;
	sources: Record<string, ConstructSource>;
	workspaceRoot: string;
	/** The directory being built — the app a surface's `path` names. */
	appRoot: string;
	/** Whether to serve the database's JSON API — `gkm dev` only. */
	databaseApi?: boolean;
}): Pick<BuildContext, 'owners' | 'surface' | 'databaseApi'> {
	const { declared, sources, workspaceRoot, appRoot, databaseApi } = options;

	// Which surface this server answers on, so the entry can derive its CORS.
	//
	// The app's own API, not the auth server it may also mount: an auth surface
	// declares its own endpoints, and the origins that may call *it* are a
	// different list from the ones that may call the API.
	const surfaces = restApis(declared);
	const served = servedSurface(declared, workspaceRoot, appRoot);
	const primary =
		served ?? surfaces.find((d) => d.endpoints.length === 0) ?? surfaces[0];

	// Which database the JSON API reads: the one the app declared. A reader is
	// not a candidate — it is the same data through a role that cannot write,
	// so browsing it would be the same rows under a second name.
	const browsable = Object.entries(declared).find(
		([, d]) => d.kind === 'database',
	);
	const browsableSource = browsable ? sources[browsable[0]] : undefined;

	// Every construct something can be built from, by id. A generated cron
	// imports the worker that owns it; a generated handler imports its surface.
	const owners: Record<string, { specifier: string; exportName: string }> = {};
	for (const [id, declaration] of Object.entries(declared)) {
		if (declaration.kind !== 'rest-api' && declaration.kind !== 'worker')
			continue;
		const source = sources[id];
		if (!source) continue;
		owners[id] = { specifier: source.file, exportName: source.exportName };
	}

	const primarySource = primary ? sources[primary.id] : undefined;

	return {
		owners,
		...(primary
			? {
					surface: {
						id: primary.id,
						trustedOriginsKey: provideKey(primary.id, 'trustedOrigins'),
						...(primary.cors ? { cors: primary.cors } : {}),
						...(primarySource
							? {
									module: {
										specifier: primarySource.file,
										exportName: primarySource.exportName,
									},
								}
							: {}),
					},
				}
			: {}),
		...(databaseApi && browsableSource
			? {
					databaseApi: {
						path: DEV_DATABASE_API_PATH,
						database: {
							specifier: browsableSource.file,
							exportName: browsableSource.exportName,
						},
					},
				}
			: {}),
	};
}

/**
 * The endpoints one surface serves.
 *
 * One glob finds every surface's endpoints, wherever their files live. A build
 * keeps the ones built from the surface it serves; one built from no surface at
 * all has nowhere else to go.
 */
export function servedBy<T extends { construct: { surface?: { id: string } } }>(
	endpoints: T[],
	surface: BuildContext['surface'],
): T[] {
	if (!surface) return endpoints;

	return endpoints.filter(
		({ construct }) =>
			!construct.surface || construct.surface.id === surface.id,
	);
}

type RestApiDeclaration = Extract<
	ConstructManifest[string],
	{ kind: 'rest-api' }
>;

function restApis(declared: ConstructManifest): RestApiDeclaration[] {
	return Object.values(declared).filter(
		(d): d is RestApiDeclaration => d.kind === 'rest-api',
	);
}

/**
 * The surface whose declared `path` is the directory being built — asked of
 * every surface, because a workspace has several and each app's build serves
 * exactly one.
 */
export function servedSurface(
	declared: ConstructManifest,
	workspaceRoot: string,
	appRoot: string,
): RestApiDeclaration | undefined {
	return restApis(declared).find(
		(d) => resolve(workspaceRoot, d.path) === resolve(appRoot),
	);
}
