/**
 * The local edge, as reconcile drives it: the stage's routes (`routes.ts`)
 * handed to whichever proxy the local stage runs — `deploy.compose.proxy`,
 * resolved by `proxyFor` as `gkm compose` resolves it.
 *
 * Two adapters over one route plan:
 *
 * - **Caddy** — a container of this project's, on a port it was assigned.
 *   Its routes are files under `.gkm/`, one per stage, and a running Caddy is
 *   told about a change with `caddy reload`.
 * - **Traefik** — this machine's shared edge, the same one `gkm compose`
 *   registers the local stage with: started where it is not running, and the
 *   stage's routes and certificate written into the directory it watches
 *   (`compose/edge.ts`), under the stage's compose project. Traefik picks a
 *   changed file up on its own.
 *
 * Either way the certificate is gkm's local authority's, so a browser that
 * trusts it needs nothing new.
 */

import { readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { LocalCertificate } from '@geekmidas/edge/certificates/local';
import {
	EDGE_PROJECT,
	edgeCertificatePaths,
	traefikDynamicFile,
} from '@geekmidas/edge/proxy/traefik';
import type { EdgeRoute } from '@geekmidas/edge/routes';
import type { ComposeDocker } from '../compose/docker.js';
import {
	assertEdgePorts,
	edgeRef,
	ensureEdge,
	readEdgeFile,
	routesPath,
	writeEdgeRoutes,
} from '../compose/edge.js';
import { LOG_ROTATION } from '../compose/stack.js';
import { TEST_STAGE } from '../workspace/stages';
import {
	CADDY_SITES_IN_CONTAINER,
	caddyfileRoot,
	toCaddyfile,
} from './caddyfile';
import { write } from './files';
import type { Docker } from './index';
import type { LocalEdge } from './plan';

/**
 * The local edge's Caddy config, beside the compose file that mounts it.
 *
 * Relative in the compose volume, so it resolves against `.gkm/` wherever the
 * project lives.
 */
export const CADDYFILE_PATH = '.gkm/Caddyfile';

/**
 * Where one stage's routes live, imported by the file above.
 *
 * Per stage because one edge serves every stage, the same way one Postgres
 * holds `orders` and `orders_test`. A single file would mean `gkm test`
 * deleting the routes `gkm dev` is serving.
 */
export const caddySitesPath = (stage: string) =>
	`.gkm/caddy-sites/${stage}.caddy`;

/**
 * Where one stage's certificate is kept: certificate and key in one PEM,
 * issued from gkm's local authority (`@geekmidas/edge/certificates/local`),
 * beside the stage's Caddy routes — so Caddy reads it through the mount it
 * already has, and a stage removed takes its certificate with it. The shared
 * Traefik edge is handed the same one.
 */
export const edgeCertificatePath = (stage: string) =>
	`.gkm/caddy-sites/${stage}.pem`;

/**
 * The shared edge's compose file, as this machine hands it to compose — the
 * same document `gkm compose` writes beside a stack.
 */
export const EDGE_COMPOSE_PATH = `.gkm/${EDGE_PROJECT}.yml`;

/** One proxy, driven through the steps every reconcile takes. */
export interface LocalEdgeAdapter {
	/**
	 * The stage's routes as the proxy reads them: part of what "converged"
	 * means, since a route can change without any container doing so.
	 */
	readonly generated: Readonly<Record<string, string>>;
	/** Whether the running edge already serves exactly that. */
	serving(): Promise<boolean>;
	/** Before the project's containers start: what they read at startup. */
	prepare(): Promise<void>;
	/** Once they run: the edge told about the routes, and their certificate. */
	apply(certificate: LocalCertificate): Promise<void>;
}

/** The Caddy of this project's. */
export function caddyEdge(options: {
	root: string;
	stage: string;
	/** The project's local stage, whose routes are kept beside `test`'s. */
	localStage?: string;
	routes: readonly EdgeRoute[];
	edgeToken: string;
	docker: Docker;
	composePath: string;
}): LocalEdgeAdapter {
	const { root, stage } = options;
	const caddyfile = toCaddyfile(options.routes, {
		certificate: `${CADDY_SITES_IN_CONTAINER}/${stage}.pem`,
		// What the apps are handed (`envFor`), so a service calling a sibling
		// through this edge keeps the client's address.
		edgeToken: options.edgeToken,
	});
	return {
		generated: { caddyfile },
		// A container of this project's: its health is reconcile's own check.
		serving: async () => true,
		// Before the containers: Caddy reads these at startup, and mounting a
		// file that does not exist yet gets a directory instead.
		async prepare() {
			await write(join(root, CADDYFILE_PATH), caddyfileRoot());
			await write(join(root, caddySitesPath(stage)), caddyfile);
			await pruneCaddySites(root, [stage, options.localStage, TEST_STAGE]);
		},
		// A running Caddy does not notice a changed import or a certificate
		// issued again, so what this reconcile just wrote is inert until it is
		// told. Failing is not fatal: the container may have only this second
		// come up, in which case it already read them.
		async apply() {
			await options.docker.reload(options.composePath, 'caddy').catch(() => {});
		},
	};
}

/** This machine's shared Traefik edge. */
export function traefikEdge(options: {
	root: string;
	edge: Extract<LocalEdge, { proxy: 'traefik' }>;
	routes: readonly EdgeRoute[];
	edgeToken: string;
	docker: ComposeDocker;
}): LocalEdgeAdapter {
	const { docker } = options;
	const { project, ports } = options.edge;
	// What `gkm compose` registers for a stack on the local stage: its routes,
	// with the certificate gkm's local authority issued it.
	const routes = traefikDynamicFile(options.routes, {
		project,
		tls: { kind: 'files', ...edgeCertificatePaths(project) },
		edgeToken: options.edgeToken,
	});
	const file = join(options.root, EDGE_COMPOSE_PATH);
	const edge = edgeRef(file);
	return {
		generated: { traefik: routes },
		// The edge is shared, so what it serves is only known by asking it: one
		// restarted, or this stage's file replaced by `gkm compose` for the
		// same stage, is registered again.
		serving: async () =>
			(await readEdgeFile(docker, edge, routesPath(project))) === routes,
		// Nothing of this project's reads the routes: the edge is not one of
		// its containers.
		prepare: async () => {},
		async apply(certificate) {
			// Nothing but the shared edge may hold its ports. The stage's own
			// Caddy from `gkm compose` — before the stage was switched — is the
			// one holder moved rather than refused, as `gkm compose` moves it.
			const own = await assertEdgePorts(docker, {
				project,
				proxy: 'traefik',
				ports,
				engine: {},
			});
			if (own) await docker.remove({}, project, 'caddy');
			await ensureEdge(docker, {
				file,
				ports,
				logging: {
					driver: LOG_ROTATION.driver,
					options: { ...LOG_ROTATION.options },
				},
			});
			await writeEdgeRoutes(docker, edge, project, routes, {
				cert: certificate.cert,
				key: certificate.key,
			});
		},
	};
}

/**
 * Remove the Caddy routes of stages this project no longer reconciles.
 *
 * Only the local stage and `test` are ever written, so any other file is left
 * over from a stage that was renamed — `development` becoming `dev`. Caddy
 * imports every file, and the leftover declares the same hosts as its
 * replacement: it refuses the whole config as ambiguous, and every URL behind
 * the edge goes with it.
 */
async function pruneCaddySites(
	root: string,
	stages: ReadonlyArray<string | undefined>,
): Promise<void> {
	const dir = dirname(join(root, caddySitesPath(TEST_STAGE)));
	const keep = new Set(
		stages.flatMap((stage) =>
			stage ? [`${stage}.caddy`, `${stage}.pem`] : [],
		),
	);

	for (const file of await readdir(dir)) {
		// A stage's certificate goes with its routes.
		if (/\.(caddy|pem)$/.test(file) && !keep.has(file)) {
			await rm(join(dir, file));
		}
	}
}
