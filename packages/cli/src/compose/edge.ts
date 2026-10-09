/**
 * The server's shared Traefik edge, in Docker: started when a stack needs it,
 * and each stack's routes written to — and removed from — the directory it
 * watches.
 *
 * Everything goes through the server's Docker engine, never its filesystem:
 * the edge's static configuration is handed to it inline, and the directories
 * it watches are volumes each stack writes into with `docker exec`. So the
 * deploy runs anywhere that reaches the engine — a CI runner over SSH — and
 * nothing it writes depends on a path on that machine.
 *
 *   gkm-edge (compose project)
 *     traefik.yml                   its static configuration (inline config)
 *     dynamic/<project>.yml         one per stack: routers, services, middlewares
 *     certs/<project>.crt|.key      a stack's own certificate, where it has one
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { GkmError } from '../errors';
import type {
	ComposeDocker,
	DockerEngine,
	PortHolder,
	StackRef,
} from './docker.js';
import type { ComposeProxy } from './routes.js';
import {
	EDGE_CERTS_DIR,
	EDGE_DYNAMIC_DIR,
	EDGE_NETWORK,
	EDGE_PROJECT,
	EDGE_SERVICE,
	type EdgePorts,
	edgeComposeFile,
	traefikStaticFile,
} from './traefik.js';

/** The edge's compose project, as docker is asked about it. */
export function edgeRef(
	file: string,
	options: Pick<StackRef, 'output' | 'signal' | 'host'> = {},
): StackRef {
	return {
		project: EDGE_PROJECT,
		file,
		cwd: dirname(file),
		...options,
	};
}

/** Writing to or removing from the edge's volumes failed. */
export class EdgeWriteFailed extends GkmError {
	constructor(
		readonly path: string,
		readonly output: string,
	) {
		super(
			`Could not write ${path} in the shared edge (${EDGE_PROJECT}): ${output.trim() || 'it is not running'}. ` +
				`Check it with \`docker compose -p ${EDGE_PROJECT} ps\` on the server, and run gkm compose again.`,
		);
		this.name = 'EdgeWriteFailed';
	}
}

/**
 * Something other than the proxy a stack is set to holds the edge's ports.
 *
 * With `proxy: 'traefik'`, the stack's own Caddy — still running from before
 * the switch — or any other container; with `proxy: 'caddy'`, the shared
 * edge, or another stack's Caddy. Refused before anything is started, so the
 * stack is never left half on one proxy and half on the other.
 */
export class ComposeProxyClash extends GkmError {
	constructor(
		readonly project: string,
		readonly proxy: ComposeProxy,
		readonly port: number,
		readonly holder: PortHolder,
	) {
		const by = holder.project
			? `${holder.container} (compose project ${holder.project})`
			: holder.container;
		const fix =
			proxy === 'traefik'
				? holder.project === project && holder.service === 'caddy'
					? `That is this stack's own Caddy, from before it was switched to proxy: 'traefik'. Move it once: stop it (docker compose -p ${project} stop caddy), then run gkm compose again — the shared edge takes 80/443 and the stack registers with it.`
					: `The shared edge needs ports 80 and 443. Stop ${holder.container}${holder.project ? ` (docker compose -p ${holder.project} down, or its own gkm compose --down)` : ''}, or move the edge with GKM_COMPOSE_HTTPS_PORT/GKM_COMPOSE_HTTP_PORT.`
				: holder.project === EDGE_PROJECT
					? `That is the server's shared Traefik edge, which other stacks register with. Set deploy.compose.proxy to 'traefik' for this stage so the stack registers with it too, or stop the edge once nothing uses it (docker compose -p ${EDGE_PROJECT} down).`
					: `Stop ${holder.container}, or publish this stack's Caddy elsewhere with GKM_COMPOSE_HTTPS_PORT/GKM_COMPOSE_HTTP_PORT.`;
		super(
			`${project} is set to proxy: '${proxy}', and port ${port} is held by ${by}. ${fix}`,
		);
		this.name = 'ComposeProxyClash';
	}
}

/**
 * Refuse a stack whose edge ports are held by anything but its own proxy:
 * the shared edge for `'traefik'`, the stack's own Caddy for `'caddy'`.
 */
export async function assertEdgePorts(
	docker: ComposeDocker,
	options: {
		project: string;
		proxy: ComposeProxy;
		ports: EdgePorts;
		engine: DockerEngine;
	},
): Promise<void> {
	const { project, proxy, ports } = options;
	for (const port of [ports.https, ports.http]) {
		for (const holder of await docker.publishers(options.engine, port)) {
			const own =
				proxy === 'traefik'
					? holder.project === EDGE_PROJECT
					: holder.project === project && holder.service === 'caddy';
			if (!own) throw new ComposeProxyClash(project, proxy, port, holder);
		}
	}
}

/**
 * Write a file into the edge's running container whole or not at all: a
 * temporary name, then a rename. Not `.yml`: the edge reads only `.yml`,
 * `.yaml` and `.toml` files, so it never sees one half written.
 */
async function put(
	docker: ComposeDocker,
	edge: StackRef,
	path: string,
	content: string,
	mode: '600' | '644' = '644',
): Promise<void> {
	const result = await docker.exec(
		edge,
		EDGE_SERVICE,
		[
			'sh',
			'-c',
			'set -e; t="$1.tmp"; cat > "$t"; chmod "$2" "$t"; mv "$t" "$1"',
			'sh',
			path,
			mode,
		],
		content,
	);
	if (result.code !== 0) {
		throw new EdgeWriteFailed(path, `${result.stderr}${result.stdout}`);
	}
}

/** Remove files from the edge's container; whether the first was there. */
async function remove(
	docker: ComposeDocker,
	edge: StackRef,
	paths: readonly string[],
): Promise<boolean> {
	const result = await docker.exec(edge, EDGE_SERVICE, [
		'sh',
		'-c',
		'e=1; [ -f "$1" ] && e=0; rm -f "$@"; exit $e',
		'sh',
		...paths,
	]);
	return result.code === 0;
}

/**
 * The edge, up: its network and its container — started when it is not
 * running, and recreated when its configuration changed. Idempotent: on a
 * server where it already runs as configured, `up` changes nothing. Its
 * compose file is written to `file`, on this machine: compose reads it here.
 */
export async function ensureEdge(
	docker: ComposeDocker,
	options: {
		file: string;
		ports: EdgePorts;
		logging: { driver: string; options: Record<string, string> };
		host?: string;
		output?: StackRef['output'];
		signal?: AbortSignal;
	},
): Promise<string[]> {
	const { file, ports } = options;
	const staticConfig = traefikStaticFile(ports);
	const content = edgeComposeFile({
		ports,
		staticConfig,
		logging: options.logging,
	});
	await mkdir(dirname(file), { recursive: true });
	if ((await readFile(file, 'utf-8').catch(() => undefined)) !== content) {
		await writeFile(file, content);
	}

	const ref = edgeRef(file, {
		...(options.host ? { host: options.host } : {}),
		...(options.output ? { output: options.output } : {}),
		...(options.signal ? { signal: options.signal } : {}),
	});
	await docker.ensureNetwork(ref, EDGE_NETWORK);
	await docker.up(ref, [EDGE_SERVICE]);
	return [file];
}

/** A stack's routes, inside the edge's container. */
export function routesPath(project: string): string {
	return `${EDGE_DYNAMIC_DIR}/${project}.yml`;
}

function certificatePaths(project: string): [string, string] {
	return [
		`${EDGE_CERTS_DIR}/${project}.crt`,
		`${EDGE_CERTS_DIR}/${project}.key`,
	];
}

/**
 * Register a stack with the edge: its certificate first, where it has one,
 * so the routes that need it never load without it — then its routes, in one
 * rename the edge picks up whole. The certificate is read here and written
 * through the engine. The paths written, inside the edge.
 */
export async function writeEdgeRoutes(
	docker: ComposeDocker,
	edge: StackRef,
	project: string,
	routes: string,
	certificate?: { certFile: string; keyFile: string },
): Promise<string[]> {
	const written: string[] = [];
	const [crt, key] = certificatePaths(project);
	if (certificate) {
		await put(docker, edge, crt, await readFile(certificate.certFile, 'utf-8'));
		await put(
			docker,
			edge,
			key,
			await readFile(certificate.keyFile, 'utf-8'),
			'600',
		);
		written.push(crt, key);
	} else {
		await remove(docker, edge, [crt, key]);
	}
	await put(docker, edge, routesPath(project), routes);
	written.push(routesPath(project));
	return written;
}

/** What a stack's file holds for the moment between emptying and removal. */
const UNREGISTERED = '# Unregistered by gkm compose --down.\n';

/**
 * Unregister a stack: its routes, then its certificate. Whether there was
 * anything to remove — false, too, when the edge is not running.
 */
export async function removeEdgeRoutes(
	docker: ComposeDocker,
	edge: StackRef,
	project: string,
): Promise<boolean> {
	const file = routesPath(project);
	const there = await docker.exec(edge, EDGE_SERVICE, ['test', '-f', file]);
	if (there.code !== 0) return false;
	// Emptied by a rename before it is removed: a watcher that misses the
	// removal has still seen the stack's routes go.
	await put(docker, edge, file, UNREGISTERED);
	await remove(docker, edge, [file, ...certificatePaths(project)]);
	return true;
}
