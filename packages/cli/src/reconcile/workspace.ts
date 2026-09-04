/**
 * Workspace config → reconcile.
 *
 * The one place the old `services:` block is read, and what it becomes: images
 * stay explicit config, the events backend stays config until `topic` and
 * `queue` are kinds, and anything no construct implies is listed as an
 * exception. What is *derived* — which containers exist at all — comes from the
 * manifest and is never read from here.
 *
 * Shared by `gkm setup`, `gkm dev`, and `gkm test` so all three converge on the
 * same state, differing only in the stage they pass.
 */

import { isAbsolute, join } from 'node:path';
import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { loadPortState, savePortState } from '../credentials/index.js';
import type { Routes } from '../types.js';
import { cacheBackendOf, providerOf } from '../workspace/backends.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { discover } from './discover.js';
import { type ReconcileResult, reconcile } from './index.js';
import { planFor } from './plan.js';

/**
 * Every constructs glob in the workspace, resolved against its app.
 *
 * Absolute because discovery globs from a single cwd while apps live in
 * different directories.
 */
export function constructGlobs(workspace: NormalizedWorkspace): string[] {
	const globs: string[] = [];

	for (const app of Object.values(workspace.apps)) {
		for (const pattern of patternsOf(app.constructs)) {
			const root = isAbsolute(app.path)
				? app.path
				: join(workspace.root, app.path);

			globs.push(isAbsolute(pattern) ? pattern : join(root, pattern));
		}
	}

	return globs;
}

/** Whether any app has adopted the constructs glob. */
export function usesConstructs(workspace: NormalizedWorkspace): boolean {
	return constructGlobs(workspace).length > 0;
}

/**
 * Image pins, by container. The config half of the derived/config split.
 *
 * Read from `services.images` rather than from the backend keys beside it.
 * They used to share one key, which is how `cache: true` came to mean "start a
 * Redis" — the last way a container could exist because config asked for one
 * instead of because something declared it.
 */
export function imagePins(
	workspace: NormalizedWorkspace,
): Record<string, string> {
	return { ...workspace.services.images };
}

/**
 * The containers a workspace's declarations imply, without reconciling.
 *
 * The same derivation `reconcileWorkspace` makes, available to callers that
 * need to know *what would run* without starting anything or writing ports —
 * `gkm setup` deciding which credentials to generate, `gkm docker` writing a
 * compose file. Those used to each read a boolean per service out of config,
 * which is how a container could exist because config asked for one rather than
 * because something declared it.
 */
export async function derivedContainers(
	workspace: NormalizedWorkspace,
	stage: string,
	manifest?: ConstructManifest,
): Promise<readonly string[]> {
	const found =
		manifest ??
		(await discover({
			patterns: constructGlobs(workspace),
			cwd: workspace.root,
		}));

	return planFor(found, stage, provisionOrder(found), {
		events: workspace.services.events,
		cache: cacheBackendOf(workspace.services.cache, providerOf(workspace)),
	}).containers;
}

export interface WorkspaceReconcileOptions {
	stage: string;
	/** Start containers and wait for health. */
	start?: boolean;
	/** A manifest already in hand — the dev watcher has one; setup does not. */
	manifest?: ConstructManifest;
}

/**
 * Reconcile a workspace for one stage.
 *
 * Ports are loaded and saved around the call rather than inside it, so the loop
 * stays a pure-ish function of its inputs and the store keeps its single owner.
 */
export async function reconcileWorkspace(
	workspace: NormalizedWorkspace,
	options: WorkspaceReconcileOptions,
): Promise<ReconcileResult> {
	const manifest =
		options.manifest ??
		(await discover({
			patterns: constructGlobs(workspace),
			cwd: workspace.root,
		}));

	const result = await reconcile({
		root: workspace.root,
		project: workspace.name,
		manifest,
		stage: options.stage,
		events: workspace.services.events,
		// A backend name, not an image pin. `cache: 'db'` says where the cache
		// lives and implies no container at all.
		cache: cacheBackendOf(workspace.services.cache, providerOf(workspace)),
		images: imagePins(workspace),
		saved: await loadPortState(workspace.root),
		addresses: surfaceAddresses(workspace, manifest),
		...(options.start === undefined ? {} : { start: options.start }),
	});

	await savePortState(workspace.root, { ...result.ports });

	return result;
}

/** A `Routes` value as a flat list of patterns. */
function patternsOf(routes: Routes | undefined): string[] {
	if (!routes) return [];
	if (typeof routes === 'string') return [routes];
	if (Array.isArray(routes)) return routes;

	// Partitioned form: surfaces are the deploy slices now, but the shape is
	// still accepted until it retires.
	const paths = (routes as { paths?: string | string[] }).paths;
	if (!paths) return [];

	return Array.isArray(paths) ? paths : [paths];
}

/**
 * Where each declared surface and site answers locally.
 *
 * The addresses come from the ports the workspace already assigns; which
 * construct sits at which one comes from the manifest. That split is the point:
 * this used to answer "who may call whom" by listing every app the workspace
 * runs, which is a different question that happened to give the same answer in
 * a single-repo workspace and no answer at all deployed. Now it answers only
 * "where does this construct answer", and the graph answers the rest.
 *
 * A site is matched to its app by `path`, because that is the one thing a site
 * declaration and a workspace app both name. Surfaces are matched to the
 * backend app: every `rest-api` in a process answers on that process's port, so
 * an app serving both its own API and an auth server publishes one address
 * twice — which is exactly what it does at runtime.
 */
function surfaceAddresses(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
): Record<string, string> {
	const addresses: Record<string, string> = {};

	const backend = Object.values(workspace.apps).find(
		(app) => app.type === 'backend',
	);

	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind === 'rest-api') {
			if (backend?.port) addresses[id] = localAddress(backend.port);
			continue;
		}

		if (declaration.kind !== 'site') continue;

		const app = Object.values(workspace.apps).find(
			(candidate) =>
				normalizePath(candidate.path) === normalizePath(declaration.path),
		);
		if (app?.port) addresses[id] = localAddress(app.port);
	}

	return addresses;
}

/** Where a local process answers, given the port the workspace gave it. */
function localAddress(port: number): string {
	return `http://localhost:${port}`;
}

/** A workspace path and a declared path, comparable. */
function normalizePath(path: string): string {
	return path.replace(/^\.\//, '').replace(/\/+$/, '');
}
