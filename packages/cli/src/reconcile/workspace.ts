/**
 * Workspace config → reconcile.
 *
 * Nothing here is read from a `services:` block — there is none. Which
 * containers exist comes from the manifest; which backend a cache or a broker
 * resolves to comes from the deploy target; and an image pin is the project's
 * own `docker-compose.yml`, merged over the generated file.
 *
 * Shared by `gkm setup`, `gkm dev`, and `gkm test` so all three converge on the
 * same state, differing only in the stage they pass.
 */

import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { loadPortState, savePortState } from '../credentials/index.js';
import {
	cacheBackendFor,
	eventsBackendFor,
	providerOf,
} from '../workspace/backends.js';
import { appKey } from '../workspace/derive.js';
import { allConstructGlobs } from '../workspace/index.js';
import { TEST_STAGE } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { appServices } from './apps.js';
import { discover } from './discover.js';
import { readCredentialFakes, readFakes } from './fakes.js';
import { type ReconcileResult, reconcile } from './index.js';
import {
	loadLocalCredentials,
	saveLocalCredentials,
} from './localCredentials.js';
import { planFor } from './plan.js';

/**
 * Every constructs glob in the workspace, resolved against its app.
 *
 * Absolute because discovery globs from a single cwd while apps live in
 * different directories.
 */
export function constructGlobs(workspace: NormalizedWorkspace): string[] {
	return allConstructGlobs(workspace);
}

/** The backends a workspace's target implies, as the plan takes them. */
export function backendsOf(workspace: NormalizedWorkspace) {
	const on = providerOf(workspace);
	return { events: eventsBackendFor(on), cache: cacheBackendFor(on) };
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

	// No fakes: they run only for `gkm test` and `gkm dev --fake`, and the
	// commands asking this — `setup`, `secrets:*`, `docker` — are neither.
	return planFor(found, stage, provisionOrder(found), {
		localStage: workspace.stages.local,
		...backendsOf(workspace),
	}).containers;
}

export interface WorkspaceReconcileOptions {
	stage: string;
	/** Start containers and wait for health. */
	start?: boolean;
	/** A manifest already in hand — the dev watcher has one; setup does not. */
	manifest?: ConstructManifest;
	/**
	 * Point every external API at its fake (`test/fakes/<id>.ts`) instead of
	 * the provider, and hand every credential with a fake its fake's value —
	 * `gkm dev --fake`. Always so for the test stage; otherwise an external
	 * API is the real one, at its URL for this stage, and a credential the
	 * stage's own.
	 */
	fake?: boolean;
	/** Told each slow step as it starts — see `ReconcileOptions.progress`. */
	progress?: (message: string) => void;
}

/**
 * Set by `gkm dev --fake` for the apps it starts. Each app's own `gkm dev`
 * reconciles too, and must answer the way the workspace did.
 */
export const FAKE_ENV = 'GKM_FAKE';

/**
 * Whether third parties are faked — external APIs, and credentials with a
 * fake: always for `gkm test`, and for `gkm dev`
 * only when asked — by `--fake`, or by the workspace that started this app
 * with it. Never for anything acting on a deployed stage.
 */
export function fakesApply(
	stage: string,
	fake?: boolean,
	env: NodeJS.ProcessEnv = process.env,
): boolean {
	return fake === true || stage === TEST_STAGE || env[FAKE_ENV] === '1';
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
): Promise<ReconcileResult & { manifest: ConstructManifest }> {
	// Discovered here even when a manifest was handed in: the apps' services
	// are given the keys their runnables reach, and only discovery sees those.
	const runnables: Record<string, string[]> = {};
	const discovered = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
		runnables,
	});
	const manifest = options.manifest ?? discovered;
	const faked = fakesApply(options.stage, options.fake);
	const fakes = faked ? await readFakes(workspace.root, manifest) : {};
	const credentialFakes = faked
		? await readCredentialFakes(workspace.root, manifest)
		: {};

	// Generated the first time anything needs them, and read back after: one
	// set per machine and workspace, shared by the local stage and `test`,
	// which run on the same containers.
	const { credentials } = await loadLocalCredentials(workspace);

	const result = await reconcile({
		credentials,
		root: workspace.root,
		project: workspace.name,
		manifest,
		stage: options.stage,
		localStage: workspace.stages.local,
		...backendsOf(workspace),
		saved: await loadPortState(workspace.root),
		addresses: surfaceAddresses(workspace, manifest),
		metroPorts: metroPorts(workspace, manifest),
		fakes,
		credentialFakes,
		apps: (containers) =>
			appServices(
				workspace,
				manifest,
				containers,
				credentials,
				runnables,
				fakes,
			),
		...(options.start === undefined ? {} : { start: options.start }),
		...(options.progress ? { progress: options.progress } : {}),
	});

	await savePortState(workspace.root, { ...result.ports });
	for (const { key, from, to } of result.moved) {
		console.log(
			`⚠️  Port ${from} (${key}) is held by another process; moved to ${to}.`,
		);
	}

	// A container that could not be moved to its generated login keeps the
	// one it takes, and that is what later runs use.
	if (result.credentials !== credentials) {
		await saveLocalCredentials(workspace, result.credentials);
	}
	for (const outcome of result.logins) {
		if (outcome.notice) console.log(outcome.notice);
	}

	// With the manifest, so `gkm dev` can say what the workspace declares
	// without discovering it a second time.
	return { ...result, manifest };
}

/**
 * Where each mobile app's Metro runs: its app's port, which `gkm exec` hands
 * Expo as `RCT_METRO_PORT`. Kept apart from the surfaces' addresses — a phone
 * reaches Metro by `exp://`, not through the edge.
 */
export function metroPorts(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
): Record<string, number> {
	const ports: Record<string, number> = {};
	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind !== 'mobile-app') continue;
		const port = workspace.apps[appKey(id)]?.port;
		if (port) ports[id] = port;
	}
	return ports;
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
export function surfaceAddresses(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	/**
	 * How an app is addressed: on the host by default, or — for the compose
	 * apps — by service name on the compose network.
	 */
	at: (app: string, port: number) => string = (_app, port) =>
		localAddress(port),
): Record<string, string> {
	const addresses: Record<string, string> = {};

	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind !== 'rest-api' && declaration.kind !== 'site')
			continue;

		// Every site and every surface is its own app, keyed by its id the way
		// the derivation keyed it.
		const host = appKey(id);
		const port = workspace.apps[host]?.port;

		if (port) addresses[id] = at(host, port);
	}

	return addresses;
}

/** Where a local process answers, given the port the workspace gave it. */
function localAddress(port: number): string {
	return `http://localhost:${port}`;
}
