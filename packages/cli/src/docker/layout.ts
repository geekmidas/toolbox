/**
 * Where a workspace's images are built from, and what each is built with.
 *
 * Every builder of images — `gkm docker`, `gkm compose`, a Dokploy deploy —
 * builds from the same place with the same templates: the build root (the
 * package manager's root, at or above the gkm workspace), cut by `turbo
 * prune` to one app's slice. Nothing is built on the host.
 */

import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { ClientTelemetryDefault } from '../generators/clientTelemetry.js';
import { allConstructGlobs } from '../workspace/index.js';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';
import {
	type BuildTools,
	findBuildRoot,
	hasTurboConfig,
	type ImageTemplateOptions,
	resolveBuildTools,
} from './templates.js';

/** A workspace of packages with no turbo.json, which every image prunes with. */
export class MonorepoNeedsTurbo extends Error {
	constructor(readonly buildRoot: string) {
		super(
			`${buildRoot} is a workspace of packages, and its images are built from a turbo-pruned slice of it — but it has no turbo.json.\n\n` +
				'To fix this:\n' +
				'  1. Install turbo: pnpm add -Dw turbo\n' +
				`  2. Create turbo.json in ${buildRoot}\n` +
				'  3. Run this command again\n\n' +
				'See: https://turbo.build/repo/docs/guides/tools/docker',
		);
		this.name = 'MonorepoNeedsTurbo';
	}
}

export interface ImageLayout {
	/** The build context of every image, absolute. */
	buildRoot: string;
	/** The gkm workspace's root, relative to the build root (`.` when equal). */
	gkmRoot: string;
	tools: BuildTools;
	/**
	 * The gkm workspace's own package, when it is nested in a monorepo as one:
	 * kept in every backend's slice, since it holds the config, the constructs
	 * and the dependencies they import.
	 */
	workspacePackage?: string;
	/** What under the gkm root a build reads besides the app's own directory. */
	gkmPaths: string[];
}

/**
 * Where a workspace's images are built from.
 *
 * Refuses a workspace of packages with no turbo.json — every image prunes
 * with turbo — so only a caller about to generate or build images asks.
 */
export function imageLayout(workspace: NormalizedWorkspace): ImageLayout {
	const buildRoot = findBuildRoot(workspace.root);
	const tools = resolveBuildTools(buildRoot);
	if (tools.monorepo && !hasTurboConfig(buildRoot)) {
		throw new MonorepoNeedsTurbo(buildRoot);
	}

	const gkmRoot = toPosix(relative(buildRoot, workspace.root)) || '.';
	const workspacePackage =
		gkmRoot !== '.' ? packageName(workspace.root) : undefined;

	return {
		buildRoot,
		gkmRoot,
		tools,
		...(workspacePackage ? { workspacePackage } : {}),
		gkmPaths: ['gkm.config.*', ...constructRoots(workspace)],
	};
}

/**
 * How a compose file builds an app: the build root as the context, relative
 * to the directory the compose file is in, and the Dockerfile — written under
 * the gkm root — relative to that context, which is what compose resolves
 * `dockerfile` against.
 */
export function composeBuildPaths(options: {
	/** The directory the compose file is in, absolute. */
	composeDir: string;
	buildRoot: string;
	workspaceRoot: string;
	/** The Dockerfile, relative to the gkm workspace's root. */
	dockerfile: string;
}): { context: string; dockerfile: string } {
	const { composeDir, buildRoot, workspaceRoot, dockerfile } = options;
	return {
		context: toPosix(relative(composeDir, buildRoot)) || '.',
		dockerfile: toPosix(join(relative(buildRoot, workspaceRoot), dockerfile)),
	};
}

/** A path under the gkm root, as the build root sees it. */
export function fromBuildRoot(layout: ImageLayout, path: string): string {
	if (layout.gkmRoot === '.') return toPosix(path);
	const joined = toPosix(join(layout.gkmRoot, path));
	return joined === '' ? '.' : joined;
}

/** Everything a template needs about one app, relative to the build root. */
export function appImageOptions(
	layout: ImageLayout,
	appName: string,
	app: NormalizedAppConfig,
	workspaceRoot: string,
	/**
	 * Every app in the workspace: a site's image generates the client of each
	 * backend it depends on, so it has to know where they are.
	 */
	apps: Readonly<Record<string, NormalizedAppConfig>> = {},
	/**
	 * Whether a site's clients propagate trace context, at what rate — set
	 * from its edge to a `Telemetry` construct and the stage's sample rate.
	 */
	clientTelemetry?: ClientTelemetryDefault,
): ImageTemplateOptions {
	const turboPackage =
		packageName(
			isAbsolute(app.path) ? app.path : join(workspaceRoot, app.path),
		) ?? appName;
	return {
		imageName: appName,
		baseImage: 'node:22-alpine',
		port: app.port,
		appPath: fromBuildRoot(layout, app.path),
		turboPackage,
		packageManager: layout.tools.packageManager,
		...(layout.tools.packageManagerVersion
			? { packageManagerVersion: layout.tools.packageManagerVersion }
			: {}),
		turboVersion: layout.tools.turboVersion,
		monorepo: layout.tools.monorepo,
		gkmRoot: layout.gkmRoot,
		// A backend is built by gkm, from the workspace's config and constructs.
		// So is half of a site: the typed client it imports is generated from
		// the endpoints of the backends it depends on, in its image, before its
		// bundler runs — so it carries the same workspace, and those backends'
		// packages for what their endpoints import.
		...(app.type === 'backend'
			? {
					gkmPaths: layout.gkmPaths,
					...(layout.workspacePackage &&
					layout.workspacePackage !== turboPackage
						? { prunePackages: [layout.workspacePackage] }
						: {}),
				}
			: app.type === 'web'
				? siteWorkspace(
						layout,
						app,
						apps,
						workspaceRoot,
						turboPackage,
						clientTelemetry,
					)
				: {}),
	};
}

/**
 * What a site's image carries of the gkm workspace: its config and construct
 * directories, the workspace's own package where it is nested in a monorepo
 * (it holds the CLI), and each backend the site calls — whose endpoints its
 * client is generated from, and whose package their imports resolve in.
 */
function siteWorkspace(
	layout: ImageLayout,
	site: NormalizedAppConfig,
	apps: Readonly<Record<string, NormalizedAppConfig>>,
	workspaceRoot: string,
	turboPackage: string,
	clientTelemetry?: ClientTelemetryDefault,
): Pick<ImageTemplateOptions, 'gkmPaths' | 'prunePackages' | 'clients'> {
	const clients = siteClients(site, apps);
	const packages = new Set<string>();
	if (layout.workspacePackage) packages.add(layout.workspacePackage);
	for (const { app } of clients) {
		const backend = apps[app]!;
		const name = packageName(
			isAbsolute(backend.path)
				? backend.path
				: join(workspaceRoot, backend.path),
		);
		if (name) packages.add(name);
	}
	packages.delete(turboPackage);

	return {
		gkmPaths: layout.gkmPaths,
		...(packages.size > 0 ? { prunePackages: [...packages].sort() } : {}),
		...(clients.length > 0
			? {
					clients: clients.map(({ app }) => ({
						app,
						path: fromBuildRoot(layout, apps[app]!.path),
						...(clientTelemetry ? { telemetry: clientTelemetry } : {}),
					})),
				}
			: {}),
	};
}

/**
 * The backends whose clients a site imports: each it depends on that gkm
 * builds from endpoints — not one with an entry of its own, and not one that
 * turned OpenAPI off.
 */
export function siteClients(
	site: NormalizedAppConfig,
	apps: Readonly<Record<string, NormalizedAppConfig>>,
): { app: string }[] {
	return site.dependencies
		.filter((name) => {
			const app = apps[name];
			if (!app || app.type !== 'backend' || app.entry) return false;
			if (app.openapi === false) return false;
			if (typeof app.openapi === 'object' && app.openapi.enabled === false)
				return false;
			return true;
		})
		.sort()
		.map((app) => ({ app }));
}

/**
 * The directories the workspace's construct globs start in, relative to its
 * root: `./constructs/**\/*.ts` reads from `constructs`.
 */
export function constructRoots(workspace: NormalizedWorkspace): string[] {
	const roots = new Set<string>();
	for (const glob of allConstructGlobs(workspace)) {
		const rel = toPosix(relative(workspace.root, glob));
		if (!rel || rel.startsWith('..')) continue;
		const first = rel.split('/')[0]!;
		if (/[*?{}[\]!]/.test(first)) continue;
		roots.add(first);
	}
	return [...roots].sort();
}

function packageName(dir: string): string | undefined {
	try {
		const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
		return typeof pkg.name === 'string' ? pkg.name : undefined;
	} catch {
		return undefined;
	}
}

function toPosix(path: string): string {
	return path.split(sep).join('/');
}
