/**
 * The server's shared Traefik edge, on disk and in Docker: started when a
 * stack needs it, and each stack's routes written to — and removed from —
 * the directory it watches.
 *
 * The edge lives in the deploy user's gkm home (`$GKM_HOME/edge`, else
 * `~/.gkm/edge`): the user who runs `gkm compose` owns it, so nothing needs
 * root, and it sits beside the stage keys that same user already keeps.
 *
 *   ~/.gkm/edge/
 *     docker-compose.yml   the edge's compose project (gkm-edge)
 *     traefik.yml          its static configuration
 *     dynamic/<project>.yml  one per stack: its routers, services, middlewares
 *     certs/<project>.crt|.key  a stack's own certificate, where it has one
 */

import { existsSync } from 'node:fs';
import {
	chmod,
	copyFile,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { GkmError } from '../errors';
import { gkmHome } from '../home.js';
import type { ComposeDocker, PortHolder, StackRef } from './docker.js';
import type { ComposeProxy } from './routes.js';
import {
	EDGE_NETWORK,
	EDGE_PROJECT,
	EDGE_SERVICE,
	type EdgePorts,
	edgeComposeFile,
	traefikStaticFile,
} from './traefik.js';

/** The edge's directory on this machine. */
export function edgeDir(env: NodeJS.ProcessEnv = process.env): string {
	return join(gkmHome(env), 'edge');
}

/** The edge's compose project, as docker is asked about it. */
export function edgeRef(
	dir: string,
	options: Pick<StackRef, 'output' | 'signal'> = {},
): StackRef {
	return {
		project: EDGE_PROJECT,
		file: join(dir, 'docker-compose.yml'),
		cwd: dir,
		...options,
	};
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
	options: { project: string; proxy: ComposeProxy; ports: EdgePorts },
): Promise<void> {
	const { project, proxy, ports } = options;
	for (const port of [ports.https, ports.http]) {
		for (const holder of await docker.publishers(port)) {
			const own =
				proxy === 'traefik'
					? holder.project === EDGE_PROJECT
					: holder.project === project && holder.service === 'caddy';
			if (!own) throw new ComposeProxyClash(project, proxy, port, holder);
		}
	}
}

/** Write a file whole or not at all: a temporary file, then a rename. */
async function writeAtomic(
	path: string,
	content: string,
	mode = 0o644,
): Promise<void> {
	// Not `.yml`: the edge reads only `.yml`, `.yaml` and `.toml` files, so it
	// never sees one half written.
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, content, { mode });
	await chmod(temporary, mode);
	await rename(temporary, path);
}

/** Write a file only when its content changed; whether it did. */
async function writeIfChanged(path: string, content: string): Promise<boolean> {
	const current = await readFile(path, 'utf-8').catch(() => undefined);
	if (current === content) return false;
	await writeAtomic(path, content);
	return true;
}

/**
 * The edge, up: its network, its files, and its container — started when it
 * is not running, and recreated when its configuration changed. Idempotent:
 * on a server where it already runs as configured, `up` changes nothing.
 */
export async function ensureEdge(
	docker: ComposeDocker,
	options: {
		dir: string;
		ports: EdgePorts;
		logging: { driver: string; options: Record<string, string> };
		output?: StackRef['output'];
		signal?: AbortSignal;
	},
): Promise<string[]> {
	const { dir, ports } = options;
	await mkdir(join(dir, 'dynamic'), { recursive: true });
	await mkdir(join(dir, 'certs'), { recursive: true, mode: 0o700 });

	const staticConfig = traefikStaticFile(ports);
	await writeIfChanged(join(dir, 'traefik.yml'), staticConfig);
	await writeIfChanged(
		join(dir, 'docker-compose.yml'),
		edgeComposeFile({ dir, ports, staticConfig, logging: options.logging }),
	);

	await docker.ensureNetwork(EDGE_NETWORK);
	await docker.up(
		edgeRef(dir, {
			...(options.output ? { output: options.output } : {}),
			...(options.signal ? { signal: options.signal } : {}),
		}),
		[EDGE_SERVICE],
	);
	return [join(dir, 'traefik.yml'), join(dir, 'docker-compose.yml')];
}

/** A stack's file in the edge's directory. */
export function routesFile(dir: string, project: string): string {
	return join(dir, 'dynamic', `${project}.yml`);
}

/**
 * Register a stack with the edge: its certificate first, where it has one,
 * so the routes that need it never load without it — then its routes, in one
 * rename the edge picks up whole.
 */
export async function writeEdgeRoutes(
	dir: string,
	project: string,
	routes: string,
	certificate?: { certFile: string; keyFile: string },
): Promise<string[]> {
	const files: string[] = [];
	if (certificate) {
		const certs = join(dir, 'certs');
		await mkdir(certs, { recursive: true, mode: 0o700 });
		const crt = join(certs, `${project}.crt`);
		const key = join(certs, `${project}.key`);
		await copyFile(certificate.certFile, `${crt}.tmp`);
		await rename(`${crt}.tmp`, crt);
		await copyFile(certificate.keyFile, `${key}.tmp`);
		await chmod(`${key}.tmp`, 0o600);
		await rename(`${key}.tmp`, key);
		files.push(crt, key);
	} else {
		await removeCertificate(dir, project);
	}
	await mkdir(join(dir, 'dynamic'), { recursive: true });
	const file = routesFile(dir, project);
	await writeAtomic(file, routes);
	files.push(file);
	return files;
}

/** What a stack's file holds for the moment between emptying and removal. */
const UNREGISTERED = '# Unregistered by gkm compose --down.\n';

async function removeCertificate(dir: string, project: string): Promise<void> {
	for (const ext of ['crt', 'key']) {
		await rm(join(dir, 'certs', `${project}.${ext}`), { force: true });
	}
}

/**
 * Unregister a stack: its routes, then its certificate. Whether there was
 * anything to remove.
 */
export async function removeEdgeRoutes(
	dir: string,
	project: string,
): Promise<boolean> {
	const file = routesFile(dir, project);
	const existed = existsSync(file);
	if (existed) {
		// Emptied by a rename before it is removed. A watcher that misses the
		// removal — Docker Desktop's file sharing can drop a delete event —
		// has still seen the stack's routes go.
		await writeAtomic(file, UNREGISTERED);
	}
	await rm(file, { force: true });
	await removeCertificate(dir, project);
	return existed;
}
