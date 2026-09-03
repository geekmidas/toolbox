/**
 * The declared half of a Dokploy deploy.
 *
 * `fromManifest.ts` decides what each construct resolves to; this runs it —
 * discovers the manifest, walks it parents-first, and applies the DDL the
 * provisioners deferred.
 *
 * It is deliberately separate from the engine in `index.ts`. That file deploys
 * *applications*: images, registries, domains, the things a project has whether
 * or not it declares anything. This is the part that exists because the app
 * declared it, and keeping the two apart is what lets a project adopt the model
 * without rewriting its deploy — and lets this one be tested without one.
 */

import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import { discover } from '../reconcile/discover.js';
import {
	applyPostgres,
	type SqlClient,
	type Statement,
} from '../reconcile/provision.js';
import { constructGlobs, usesConstructs } from '../reconcile/workspace.js';
import { cacheBackendOf } from '../workspace/backends.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import type { DokployApi } from './dokploy-api';
import {
	type DokployProvisionContext,
	type Provisioned,
	provisionerFor,
} from './fromManifest';

export interface DeclaredResult {
	/** Every env key the manifest resolved, and its value. */
	env: Record<string, string>;
	/** The DDL still to run, once a connection to the cluster exists. */
	statements: Statement[];
	/** What was provisioned, keyed by construct id. */
	provisioned: Record<string, Provisioned>;
}

export interface DeclaredOptions {
	api: DokployApi;
	workspace: NormalizedWorkspace;
	projectId: string;
	environmentId: string;
	stage: string;
	/**
	 * Where each app answers, keyed by *app* name — `https://api.example.com`.
	 *
	 * Computed by the engine before it saves any environment, which is what
	 * makes a surface's own URL available to the constructs that depend on it.
	 */
	appUrls: Readonly<Record<string, string>>;
	/** Secrets already generated for this stage, so a redeploy rotates none. */
	secrets?: Readonly<Record<string, string>>;
	/** A manifest already in hand, for a caller that has discovered one. */
	manifest?: ConstructManifest;
}

/**
 * Provision everything the workspace declares, and return what it resolved.
 *
 * Nothing happens for a project that has not adopted the model: `usesConstructs`
 * is the same hard switch reconcile reads, so an existing deploy is untouched
 * until it declares something.
 */
export async function provisionDeclared(
	options: DeclaredOptions,
): Promise<DeclaredResult> {
	const { workspace } = options;
	const empty: DeclaredResult = { env: {}, statements: [], provisioned: {} };

	if (!usesConstructs(workspace)) return empty;

	const manifest =
		options.manifest ??
		(await discover({
			patterns: constructGlobs(workspace),
			cwd: workspace.root,
		}));

	if (Object.keys(manifest).length === 0) return empty;

	const context: DokployProvisionContext = {
		manifest,
		provisioned: {},
		api: options.api,
		projectId: options.projectId,
		environmentId: options.environmentId,
		stage: options.stage,
		project: workspace.name,
		cache: cacheBackendOf(workspace.services.cache),
		addresses: surfaceAddresses(workspace, manifest, options.appUrls),
		...(options.secrets ? { secrets: options.secrets } : {}),
		deferred: [],
	};

	const env: Record<string, string> = {};

	// Parents first. A derived construct reads its parent's resolved URL, and
	// `provisionOrder` is what guarantees there is one to read.
	for (const id of provisionOrder(manifest)) {
		const declaration = manifest[id];
		if (!declaration) continue;

		const provisioner = provisionerFor(declaration.kind);

		// A kind this target cannot provision yet is skipped rather than fatal:
		// storage, mail and the brokers have no Dokploy primitive, and refusing
		// to deploy an app because it also declares a bucket would be worse than
		// deploying it without one. What it costs is honest — the key is absent,
		// and the construct that needs it says so on first use.
		if (!provisioner) continue;

		const result = await provisioner(declaration, context);
		context.provisioned[id] = result;
		Object.assign(env, result.provides);
	}

	return {
		env,
		statements: context.deferred.map((statement) => ({
			id: statement.id,
			describe: statement.describe,
			...(statement.database ? { database: statement.database } : {}),
			...(statement.exists ? { exists: statement.exists } : {}),
			// `create` is what the applier calls it — the same convergent applier
			// the local target runs, so a statement that already applied reports
			// unchanged here exactly as it does there.
			create: statement.sql,
		})),
		provisioned: context.provisioned,
	};
}

/**
 * Run the deferred DDL against a cluster that is now reachable.
 *
 * The same applier the local target uses: every statement asks whether it is
 * needed first, so a redeploy is free and a half-applied run recovers by being
 * run again.
 */
export async function applyDeclared(
	client: SqlClient,
	statements: readonly Statement[],
): Promise<number> {
	const applied = await applyPostgres(client, statements);

	return applied.filter((entry) => entry.created).length;
}

/**
 * Where each declared surface answers.
 *
 * Every `rest-api` in a process answers on that process's address, so an app
 * serving both its own API and an auth server publishes one address twice —
 * which is exactly what it does at runtime, and the same rule the local target
 * applies.
 *
 * A workspace with two backends is the case this does not answer, and the
 * manifest cannot yet: which surface belongs to which app is what §2's endpoint
 * merge would record. Until then the first backend's address is used, and a
 * second backend's surfaces would be wrong rather than missing — worth knowing
 * before relying on it.
 */
function surfaceAddresses(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	appUrls: Readonly<Record<string, string>>,
): Record<string, string> {
	const addresses: Record<string, string> = {};

	const backend = Object.entries(workspace.apps).find(
		([, app]) => app.type === 'backend',
	);
	const url = backend ? appUrls[backend[0]] : undefined;

	if (!url) return addresses;

	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind === 'rest-api') addresses[id] = url;
	}

	return addresses;
}
