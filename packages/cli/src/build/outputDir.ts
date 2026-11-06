import { join, resolve } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import type { MainProvider } from '../types';
import { appKey } from '../workspace/derive.js';
import { surfaceAt } from './owners';

/**
 * The name of the tree an app's build writes under, when its directory holds
 * more than one surface — the app key of the surface it serves, `webhooks` —
 * or undefined for a directory with one.
 *
 * Two surfaces can name one folder — an API and its webhooks, `path:
 * 'apps/api'` both — and each is an app of its own, with its own endpoints.
 * Their builds cannot share one output tree: an AWS build empties its tree
 * first, so the second app's would delete the first's handlers, and a server
 * build would overwrite the first's entry with its own.
 *
 * Counted from the declared surfaces rather than the workspace's apps: a
 * single-app config's `api` sits at `.` beside the app its surface derives, and
 * that is one app, not two.
 */
export function sharedDirectoryTree(
	declared: ConstructManifest,
	workspaceRoot: string,
	appRoot: string,
	/** The workspace app being built, when it is known. */
	app?: string,
): string | undefined {
	const here = Object.values(declared).filter(
		(d) =>
			(d.kind === 'rest-api' || d.kind === 'websocket-api') &&
			resolve(workspaceRoot, d.path) === resolve(appRoot),
	);
	if (here.length < 2) return undefined;

	const served = surfaceAt(declared, workspaceRoot, appRoot, app);
	return served ? appKey(served.id) : undefined;
}

/**
 * Where one app's build writes for a target: `<app>/.gkm/<target>`.
 *
 * An app that shares its directory gets a tree of its own under that,
 * `<app>/.gkm/<target>/<tree>`, so its build replaces nothing another app
 * wrote. An app alone in its directory — nearly every one — keeps the path it
 * always had, so no handler a deploy already points at moves.
 */
export function appOutputDir(
	appRoot: string,
	target: MainProvider,
	/** See `sharedDirectoryTree`. */
	tree?: string,
): string {
	const base = join(appRoot, '.gkm', target);
	return tree ? join(base, tree) : base;
}
