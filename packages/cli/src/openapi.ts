#!/usr/bin/env -S npx tsx

import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Endpoint } from '@geekmidas/constructs/endpoints';
import { kebabCase } from '@geekmidas/manifest';
import { loadWorkspaceConfig } from './config.js';
import { EndpointGenerator } from './generators/EndpointGenerator.js';
import { OpenApiTsGenerator } from './generators/OpenApiTsGenerator.js';
import type { GkmConfig, OpenApiConfig, Routes } from './types.js';
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
 * Where a surface's generated client lands.
 *
 * Named from the surface, so `new RestApi('Webhooks')` writes
 * `.gkm/openapi/webhooks.ts` — the same kebab form that gives it its container
 * name and its `WEBHOOKS_URL`.
 */
export function openApiPathFor(surfaceId: string): string {
	return `./.gkm/openapi/${kebabCase(surfaceId)}.ts`;
}

/**
 * Resolve OpenAPI config from GkmConfig
 */
export function resolveOpenApiConfig(config: {
	openapi?: boolean | OpenApiConfig;
}): OpenApiConfig & { enabled: boolean } {
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

/** What a generation run wrote. */
export interface OpenApiResult {
	/** The first spec written — kept so existing callers still compile. */
	outputPath: string;
	/** Every spec written, one per surface. */
	outputPaths: string[];
	/** Endpoints across all of them. */
	endpointCount: number;
}

/**
 * Load endpoints from a glob, then generate.
 *
 * For the callers that have no endpoints in hand — `gkm openapi`, and `gkm dev`
 * regenerating on reload. The glob is the app's derived one, off `AppSpec.code`,
 * not a `routes` field anybody wrote.
 */
export async function generateOpenApiFrom(
	routes: Routes,
	options: {
		openapi?: boolean | OpenApiConfig;
		silent?: boolean;
		bustCache?: boolean;
	} = {},
): Promise<OpenApiResult | null> {
	const loaded = await new EndpointGenerator().load(
		routes,
		undefined,
		options.bustCache,
	);

	return generateOpenApi(
		loaded.map(({ construct }) => construct),
		options,
	);
}

/**
 * Generate an OpenAPI spec for each surface these endpoints name.
 *
 * Takes the endpoints, not a glob to find them with. The build has already
 * loaded every one of them to generate handlers, so globbing again was a second
 * discovery pass over the same files — and the reason this function needed a
 * `routes` to be told where to look, which is how a retired config field stayed
 * load-bearing.
 *
 * @returns What was written, or null if disabled or there were none
 */
export async function generateOpenApi(
	endpoints: readonly Endpoint<any, any, any, any, any>[],
	options: {
		openapi?: boolean | OpenApiConfig;
		silent?: boolean;
	} = {},
): Promise<OpenApiResult | null> {
	const logger = options.silent ? { log: () => {} } : console;
	const openApiConfig = resolveOpenApiConfig({ openapi: options.openapi });

	if (!openApiConfig.enabled) {
		return null;
	}

	if (endpoints.length === 0) {
		logger.log('No valid endpoints found for OpenAPI generation');
		return null;
	}

	// One spec per surface, not one per glob.
	//
	// The glob is a directory, and a directory is not a surface: two `RestApi`s
	// whose endpoints live side by side produced a single spec describing both,
	// under a filename that named neither. Every endpoint carries the surface
	// that serves it, so that is what the spec is cut along — `Api` becomes
	// `api.ts`, `Webhooks` becomes `webhooks.ts`, by the same kebab rule that
	// gives the surface its container name and its environment keys.
	const bySurface = new Map<string, Endpoint<any, any, any, any, any>[]>();
	for (const endpoint of endpoints) {
		const owner = endpoint.owner ?? endpoint.surface?.id;
		if (!owner) continue;
		const existing = bySurface.get(owner);
		if (existing) existing.push(endpoint);
		else bySurface.set(owner, [endpoint]);
	}

	if (bySurface.size === 0) {
		logger.log('No endpoints named a surface, so no OpenAPI was generated');
		return null;
	}

	const tsGenerator = new OpenApiTsGenerator();
	const written: string[] = [];

	for (const [surfaceId, surfaceEndpoints] of bySurface) {
		const relative = openApiPathFor(surfaceId);
		const outputPath = join(process.cwd(), relative);

		await mkdir(dirname(outputPath), { recursive: true });

		const tsContent = await tsGenerator.generate(surfaceEndpoints, {
			// The surface's own name, so a spec says which API it describes
			// rather than repeating one title across all of them.
			title: openApiConfig.title ?? surfaceId,
			version: openApiConfig.version!,
			description: openApiConfig.description!,
		});

		await writeFile(outputPath, tsContent);
		written.push(relative);
		logger.log(
			`📄 OpenAPI client generated: ${relative} (${surfaceEndpoints.length} endpoints)`,
		);
	}

	return {
		// The first, for a caller that wants one path. `outputPaths` has them all.
		outputPath: join(process.cwd(), written[0]!),
		outputPaths: written.map((r) => join(process.cwd(), r)),
		endpointCount: endpoints.length,
	};
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

			const result = await generateOpenApiFrom(config.constructs, {
				openapi: config.openapi,
			});

			if (result) {
				logger.log(`Found ${result.endpointCount} endpoints`);
			}
		} else {
			// Workspace config - generate for each backend app
			const { workspace } = loadedConfig;
			// Always derive the workspace root from the loaded config rather than
			// CWD. Subprocesses run with CWD set to an app directory, and falling
			// back to CWD there causes `join(workspaceRoot, app.path)` to point at
			// a non-existent nested path (e.g. `apps/api/apps/api`).
			const workspaceRoot = workspace.root;

			// Backend apps with openapi enabled — which is all of them that have
			// routes, unless one says otherwise.
			//
			// This used to require `openapi: true` written out, while the app's
			// own build generated a spec regardless. Two paths disagreeing about
			// the same flag: the app emitted `.gkm/openapi.ts` and this pass,
			// finding nothing "enabled", skipped copying it to the frontends that
			// consume it. A surface whose routes are declared rather than
			// discovered has no spec to generate, so it is not a candidate.
			const backendApps = Object.entries(workspace.apps).filter(
				([_, app]) =>
					app.type === 'backend' &&
					app.openapi !== false &&
					(typeof app.openapi !== 'object' || app.openapi.enabled !== false),
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
				// No `app.routes` check any more: the per-kind globs are gone, and
				// an app's code is found by one glob rather than by a field naming
				// endpoints. Guarding on `routes` here meant every app was skipped
				// the moment that field stopped existing — silently, because a loop
				// that runs zero times looks exactly like one with nothing to do.
				const appPath = join(workspaceRoot, app.path);

				// A subprocess exists to put CWD inside the app, so tsx picks up
				// that app's tsconfig aliases instead of the workspace root's. When
				// the app *is* the root there is nothing to change: spawning would
				// re-enter the same directory, having paid for a process and a
				// module graph, and needing `tsx` resolvable from it.
				if (resolve(appPath) === resolve(workspaceRoot)) {
					// Not silent: silence is for a subprocess whose output the
					// parent relays, and there is no parent here to relay it. The
					// per-surface lines come from the generator; the count is this
					// command's own summary, as in the single-app path.
					const result = await generateOpenApiForApp(
						workspaceRoot,
						appName,
						app,
						false,
					);
					if (result) {
						logger.log(`Found ${result.endpointCount} endpoints`);
					}
					continue;
				}

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
	/**
	 * Quiet by default, because the usual caller is a subprocess whose output
	 * the parent relays. Generating in-process there is no parent to relay to,
	 * and silence would swallow the only report of what happened.
	 */
	silent = true,
): Promise<{ outputPath: string; endpointCount: number } | null> {
	// A backend app, and everything under it.
	//
	// It used to gate on `app.routes` and glob that; derive no longer sets it,
	// because an app has one glob and which kind a module exports is decided by
	// the value. A surface is an app, so an app's own directory contains exactly
	// its own surface's endpoints — and the split inside is by surface anyway.
	if (app.type !== 'backend') {
		return null;
	}

	const appPath = join(workspaceRoot, app.path);
	const globs = [join(appPath, '**/*.ts')];

	return generateOpenApiFrom(globs, {
		// Absent means enabled, which is what the caller's filter already decided
		// when it kept this app: it skips one that says `openapi: false` and keeps
		// every other. Passing `undefined` through let `resolveOpenApiConfig`
		// default it to *disabled*, so an app selected for generation generated
		// nothing and said nothing — two places disagreeing about one flag, which
		// is the failure the filter above was written to describe.
		openapi: app.openapi ?? { enabled: true },
		silent,
	});
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
