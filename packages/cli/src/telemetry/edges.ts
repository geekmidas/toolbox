/**
 * Which processes use a `Telemetry` node — read off the manifest's edges.
 *
 * A process uses telemetry when its own declaration names the node: a
 * surface's `telemetry`, a worker's. The server the build generates for a
 * surface whose endpoints a glob finds also runs the workers' crons and
 * consumers under `gkm dev`, and is handed their edges' keys by `appEnvKeys`,
 * so a worker's edge counts for it too — the same rule, read the same way.
 *
 * A site's edge is recorded and never followed here: a site is handed none of
 * the node's keys (see `PUBLIC.telemetry`).
 */

import {
	type ConstructManifest,
	TELEMETRY_KEYS,
	type TelemetryDeclaration,
} from '@geekmidas/manifest';
import { appKey } from '../workspace/derive.js';

/** The `OTEL_*` keys a `Telemetry` node provides. */
export const TELEMETRY_ENV_KEYS: readonly string[] = TELEMETRY_KEYS;

/** Whether `key` is one of the keys a `Telemetry` node provides. */
export function isTelemetryKey(key: string): boolean {
	return TELEMETRY_ENV_KEYS.includes(key);
}

/** The node a declaration's `telemetry` edge names, when it names one. */
function nodeOf(
	manifest: ConstructManifest,
	id: string | undefined,
): TelemetryDeclaration | undefined {
	if (!id) return undefined;
	const node = manifest[id];
	return node?.kind === 'telemetry' ? node : undefined;
}

/**
 * The `Telemetry` node the process for `id` — a surface or a worker, by
 * construct id — emits through, or undefined when it has no edge to one.
 */
export function telemetryOf(
	manifest: ConstructManifest,
	id: string,
): TelemetryDeclaration | undefined {
	const declaration = manifest[id];
	if (!declaration) return undefined;

	if (declaration.kind === 'worker') {
		return nodeOf(manifest, declaration.telemetry);
	}
	if (declaration.kind !== 'rest-api') return undefined;

	const own = nodeOf(manifest, declaration.telemetry);
	if (own) return own;

	// A generated server — one whose endpoints the glob finds, so it declares
	// none — runs the workers' crons and consumers too.
	if (declaration.endpoints.length > 0) return undefined;
	for (const other of Object.values(manifest)) {
		if (other.kind !== 'worker') continue;
		const node = nodeOf(manifest, other.telemetry);
		if (node) return node;
	}
	return undefined;
}

/**
 * The `Telemetry` node the app `appName` emits through — its surface's, or
 * undefined for a site, an app without one, or one with no edge.
 */
export function appTelemetry(
	manifest: ConstructManifest,
	appName: string,
): TelemetryDeclaration | undefined {
	const id = Object.entries(manifest).find(
		([id, d]) => d.kind === 'rest-api' && appKey(id) === appName,
	)?.[0];
	return id ? telemetryOf(manifest, id) : undefined;
}

/** Whether any process in the manifest emits through a `Telemetry` node. */
export function usesTelemetry(manifest: ConstructManifest): boolean {
	return Object.entries(manifest).some(
		([id, d]) =>
			(d.kind === 'rest-api' || d.kind === 'worker') &&
			telemetryOf(manifest, id) !== undefined,
	);
}

/**
 * One process's share of the telemetry keys a stage resolved: all of them,
 * named for the process, when it has an edge to the node — and none
 * otherwise.
 *
 * `env` is everything else the process is handed; its `OTEL_*` keys are
 * replaced, never merged, so a process without the edge cannot inherit them.
 */
export function scopeTelemetryEnv(
	env: Readonly<Record<string, string>>,
	options: {
		/** Whether the process has an edge to the node. */
		uses: boolean;
		/** The process's name — `OTEL_SERVICE_NAME`. */
		serviceName: string;
		/** What the stage resolved for the node, or nothing when it is off. */
		telemetry?: Readonly<Record<string, string>>;
	},
): Record<string, string> {
	const scoped = Object.fromEntries(
		Object.entries(env).filter(([key]) => !isTelemetryKey(key)),
	);
	if (!options.uses || !options.telemetry) return scoped;

	const values = Object.fromEntries(
		Object.entries(options.telemetry).filter(([key]) => isTelemetryKey(key)),
	);
	if (!values.OTEL_EXPORTER_OTLP_ENDPOINT) return scoped;
	return {
		...scoped,
		...values,
		OTEL_SERVICE_NAME: options.serviceName,
	};
}

/** Whether the site `siteId` has an edge to a `Telemetry` node. */
export function siteUsesTelemetry(
	manifest: ConstructManifest,
	siteId: string,
): boolean {
	const site = manifest[siteId];
	return site?.kind === 'site' && nodeOf(manifest, site.telemetry) !== undefined;
}

/**
 * Whether the client of the surface `surfaceId` propagates trace context:
 * when a site that calls it has an edge to a `Telemetry` node. One client
 * serves every site that calls the surface on the host, so one with the
 * edge turns it on; a site's image generates its own, from its own edge.
 */
export function surfaceClientTraced(
	manifest: ConstructManifest,
	surfaceId: string,
): boolean {
	return Object.entries(manifest).some(
		([id, d]) =>
			d.kind === 'site' &&
			siteUsesTelemetry(manifest, id) &&
			d.dependencies.some((edge) => edge.target === surfaceId),
	);
}
