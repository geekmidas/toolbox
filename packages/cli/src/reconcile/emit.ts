/**
 * The manifest, written out as a module.
 *
 * Discovery imports the application's own code — that is how it finds
 * constructs — so anything calling it evaluates the whole runtime graph: React
 * email templates, database clients, modules that read env at import time. That
 * is fine inside `gkm dev`, which is already running the app. It is not fine
 * inside a deploy config, where it fails on the first thing the deploy toolchain
 * does not expect and would keep failing on the next.
 *
 * So discovery happens once, in the build, and everything downstream reads what
 * it wrote. The same split `RestApi` makes by naming a routes glob rather than
 * importing route modules.
 *
 * A module rather than JSON, because a manifest is not just data to this
 * codebase — `as const satisfies ConstructManifest` is what keeps every id,
 * kind and provided key a *literal*, so `IdsOf`, `ProvidedKeys` and the rest
 * can select out of it. `JSON.parse` returns `any` and gives all of that up.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type {
	ConstructManifest,
	RestApiEndpoint,
	RouteInfo,
} from '@geekmidas/manifest';
import type { CacheBackend, EmailBackend } from '../types.js';

/** Where the build writes it, relative to the app root. */
export const MANIFEST_PATH = '.gkm/manifest.ts';

/**
 * Fold the build's generated routes into the surface that serves them.
 *
 * The routes already exist: `gkm build` generates one handler per endpoint and
 * records its path, method and environment. What was missing is that the
 * *construct* manifest never learned about them, so a `rest-api` node said
 * `endpoints: []` while five handlers sat in `.gkm/`. Two documents describing
 * the same routes, one of them wrong.
 *
 * Merging here rather than making the construct name a glob or import its
 * endpoints: the build is the thing that already walked the filesystem and
 * already knows where it wrote each handler. Asking the declaration to restate
 * any of that is how the two come to disagree.
 *
 * Attribution is by exclusion — routes go to the surface that declared none of
 * its own. A surface with static endpoints (an auth server's single wildcard)
 * keeps them. That is exact while an app has one API of its own, and needs a
 * real answer the day it has two; the alternative today would be inventing one
 * before anything needs it.
 *
 * **Only from a provider that generates one handler per route.** The `server`
 * provider generates a single catch-all — `ALL *` pointing at the Hono app that
 * routes in-process — which is a true description of that build and a false
 * description of the application. Merging it wrote `endpoints: [{ method:
 * 'ALL', path: '*' }]` into a manifest for an app with five routes, and made the
 * document's contents depend on which `--provider` ran last. A manifest must not
 * do that.
 */
export function withRoutes(
	manifest: ConstructManifest,
	routes: readonly RouteInfo[],
	options: { perRoute: boolean },
): ConstructManifest {
	if (routes.length === 0 || !options.perRoute) return manifest;

	const target = Object.entries(manifest).find(
		([, declaration]) =>
			declaration.kind === 'rest-api' && declaration.endpoints.length === 0,
	);

	if (!target) return manifest;

	const [id, declaration] = target;
	if (declaration.kind !== 'rest-api') return manifest;

	return {
		...manifest,
		[id]: {
			...declaration,
			endpoints: routes.map((route) => asEndpoint(id, route)),
		},
	};
}

/** One generated route as the manifest's shape. */
function asEndpoint(surface: string, route: RouteInfo): RestApiEndpoint {
	return {
		// The handler path is already unique per route and is what a target needs
		// to point a function at, so it is also the natural id.
		id: `${surface}${route.method}${route.path}`,
		handler: route.handler,
		method: route.method,
		path: route.path,
		// Empty, and stated rather than implied: an endpoint's `.dependsOn()`
		// collapses into `.services()` before the endpoint exists, so the
		// construct *ids* are gone by the time anything can read them. The
		// generated route carries `environment` — the keys it reads — which is
		// the shadow of those edges, not the edges.
		dependencies: [],
		...(route.authorizer ? { authorizer: route.authorizer } : {}),
	};
}

/**
 * The manifest as TypeScript source.
 *
 * Pure, so what gets written can be asserted without touching a filesystem.
 */
export function manifestModule(
	manifest: ConstructManifest,
	backends: Backends = {},
): string {
	return `${HEADER}
export const manifest = ${serialise(manifest)} as const satisfies ConstructManifest;

/**
 * Where the backends that are *config* rather than declaration resolved to.
 *
 * Recorded because they were being answered twice: once by the build, which
 * registers exactly one cache driver, and once by a deploy config, which told
 * the provisioner something else. The result was a deployed URL the running code
 * had no driver for — two documents disagreeing about one fact, which is what
 * this manifest exists to stop.
 */
export const backends = ${serialise(backends)} as const;

// Derived types
export type Ids = IdsOf<typeof manifest>;
export type Construct<Id extends Ids> = DeclarationOf<typeof manifest, Id>;
export type Kind = Construct<Ids>['kind'];

// Useful union types
export type ProvidedKeys = AllProvidedKeys<typeof manifest>;
export type Surfaces = IdsOfKind<typeof manifest, 'rest-api'>;
export type CacheBackend = (typeof backends)['cache'];
export type EmailBackend = (typeof backends)['email'];
`;
}

/** Write it where the deploy config expects to import it from. */
export async function writeManifestModule(
	manifest: ConstructManifest,
	appRoot: string,
	backends: Backends = {},
): Promise<string> {
	const path = join(appRoot, MANIFEST_PATH);

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, manifestModule(manifest, backends), 'utf8');

	return path;
}

/** The choices that are deployment config rather than declaration. */
export interface Backends {
	cache?: CacheBackend;
	email?: EmailBackend;
}

const HEADER = `// Generated by \`gkm build\`. Do not edit.
//
// Discovery imports application code, so it runs once here rather than in every
// consumer — a deploy config that discovered for itself would evaluate the whole
// runtime graph inside its own toolchain. This is the result, as literals.

import type {
	AllProvidedKeys,
	ConstructManifest,
	DeclarationOf,
	IdsOf,
	IdsOfKind,
} from '@geekmidas/manifest';
`;

/**
 * JSON, re-indented with tabs and with keys left unquoted where they can be.
 *
 * Cosmetic, and worth it: this file is read by people trying to work out what
 * their app declares, and a wall of quoted keys reads as output rather than as
 * something anyone is expected to understand.
 */
function serialise(value: object): string {
	return JSON.stringify(value, null, '\t')
		.replace(/^(\t*)"([A-Za-z_$][\w$]*)":/gm, '$1$2:')
		.replace(/"/g, "'");
}
