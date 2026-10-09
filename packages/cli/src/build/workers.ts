import { isAbsolute, join, relative, sep } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { GkmError } from '../errors';
import { appKey } from '../workspace/derive.js';
import type { NormalizedWorkspace } from '../workspace/types.js';

/**
 * A Worker as a deploy unit: one process, one image, one service.
 *
 * A worker declares no app — it names a process, not a directory — so the
 * image is built from the app whose code holds its work: `gkm build` there
 * writes the worker's entry beside the server's, and the worker's image
 * copies that bundle out instead.
 */
export interface WorkerUnit {
	/** The construct, `Jobs`. */
	id: string;
	/** Its service and image name, `jobs`. */
	name: string;
	/** The backend app whose build writes its entry, `api`. */
	app: string;
}

/** A worker with background work and no backend app to build it from. */
export class WorkerHasNoApp extends GkmError {
	constructor(readonly worker: string) {
		super(
			`The worker '${worker}' has crons, queues or subscribers, and the ` +
				`workspace has no backend app that builds a server to carry its ` +
				`entry. Declare a RestApi whose app holds the worker's code.`,
		);
		this.name = 'WorkerHasNoApp';
	}
}

/** A worker whose service name an app already has. */
export class WorkerNameTaken extends GkmError {
	constructor(
		readonly worker: string,
		readonly service: string,
	) {
		super(
			`The worker '${worker}' runs as the service '${service}', and an app is ` +
				`already called that. Rename the worker — new Worker('${worker}Worker') ` +
				`— so each container has a name of its own.`,
		);
		this.name = 'WorkerNameTaken';
	}
}

/**
 * The workers a workspace deploys — each one that has background work — and
 * the app each is built from.
 *
 * The host is the backend app whose directory holds the most of the worker's
 * files; one whose work sits outside every app (a shared `jobs/` directory)
 * is built by the first backend, by name, that generates a server. An app
 * with its own entry is never one — gkm's generators do not build it — and a
 * surface that serves itself, an auth server, only when it holds the work.
 *
 * @param background Each worker's files, from discovery's `background`.
 */
export function workerUnits(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	background: Readonly<Record<string, readonly string[]>>,
): WorkerUnit[] {
	const hosts = Object.entries(workspace.apps)
		.filter(([, app]) => app.type === 'backend' && !app.entry)
		.map(([name, app]) => {
			const surface = Object.entries(manifest).find(
				([id, d]) => d.kind === 'rest-api' && appKey(id) === name,
			)?.[1];
			return {
				name,
				root: isAbsolute(app.path) ? app.path : join(workspace.root, app.path),
				// Endpoints declared on the surface itself are one that serves
				// itself — an auth server — whose build generates no server.
				generated: !(
					surface?.kind === 'rest-api' && surface.endpoints.length > 0
				),
			};
		})
		.sort((a, b) => a.name.localeCompare(b.name));

	const units: WorkerUnit[] = [];
	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind !== 'worker') continue;
		const files = background[id] ?? [];
		if (files.length === 0) continue;

		const name = appKey(id);
		if (workspace.apps[name]) throw new WorkerNameTaken(id, name);

		// The app holding the most of its work; then one that generates a
		// server; then by name.
		const ranked = hosts
			.map((host) => ({
				host,
				holds: files.filter((file) => isUnder(file, host.root)).length,
			}))
			.sort(
				(a, b) =>
					b.holds - a.holds ||
					Number(b.host.generated) - Number(a.host.generated),
			);
		const host = ranked[0]?.host;
		if (!host || (ranked[0]!.holds === 0 && !host.generated)) {
			throw new WorkerHasNoApp(id);
		}

		units.push({ id, name, app: host.name });
	}

	return units.sort((a, b) => a.name.localeCompare(b.name));
}

function isUnder(file: string, dir: string): boolean {
	const rel = relative(dir, file);
	return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
		? !rel.startsWith(`..${sep}`)
		: false;
}
