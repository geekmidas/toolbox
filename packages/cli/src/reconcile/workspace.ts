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
import type { ConstructManifest } from '@geekmidas/manifest';
import { loadPortState, savePortState } from '../credentials/index.js';
import type { Routes } from '../types.js';
import { cacheBackendOf, providerOf } from '../workspace/backends.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { discover } from './discover.js';
import { type ReconcileResult, reconcile } from './index.js';

/**
 * Containers a construct can imply, so config only has to name the rest.
 *
 * `services: { cache: true }` is still how you get Redis — no construct implies
 * one yet — while `services: { db: true }` is now redundant with declaring a
 * database and is ignored rather than obeyed, so the two cannot disagree.
 */
const DERIVED_CONTAINERS = new Set(['postgres', 'minio', 'mailpit']);

/** How a `services:` key names a container. */
const SERVICE_CONTAINERS: Readonly<Record<string, string>> = {
	db: 'postgres',
	cache: 'redis',
	storage: 'minio',
	mail: 'mailpit',
};

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
 * Containers config asks for that no construct implies.
 *
 * A list of exceptions rather than a list you maintain: everything derivable is
 * already in the plan before this is read, and naming one here is a no-op rather
 * than a conflict.
 */
export function extraContainers(workspace: NormalizedWorkspace): string[] {
	const extras: string[] = [];

	for (const [key, config] of Object.entries(workspace.services)) {
		const container = SERVICE_CONTAINERS[key];
		if (!container || DERIVED_CONTAINERS.has(container)) continue;
		if (config === undefined || config === false) continue;
		// A string names a *backend*, which says where the thing lives rather
		// than asking for a container — and the plan has already decided which
		// container that implies, including none. Reading it as a request is how
		// `cache: 'db'` started a Redis for a cache that is a table in Postgres.
		if (typeof config === 'string') continue;

		extras.push(container);
	}

	return extras;
}

/** Image pins, by container. The config half of the derived/config split. */
export function imagePins(
	workspace: NormalizedWorkspace,
): Record<string, string> {
	const images: Record<string, string> = {};

	for (const [key, config] of Object.entries(workspace.services)) {
		const container = SERVICE_CONTAINERS[key];
		if (!container || typeof config !== 'object' || config === null) continue;

		const pin = config as { image?: string; version?: string };
		if (pin.image) images[container] = pin.image;
		else if (pin.version) images[container] = `${container}:${pin.version}`;
	}

	return images;
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
		extraContainers: extraContainers(workspace),
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
