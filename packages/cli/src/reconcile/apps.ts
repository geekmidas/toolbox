/**
 * The apps, as services beside the containers their constructs derive.
 *
 * `gkm docker` used to write these by hand: every backend got
 * `DATABASE_URL=postgresql://…@postgres:5432/app` and `REDIS_URL=redis://redis`,
 * which was right only for a project whose single database happened to be
 * called `Database` — an `Orders` database publishes `ORDERS_URL`, a schema
 * tenant has a URL of its own, and buckets and mail were not wired at all.
 *
 * Now an app's environment is exactly what reconcile hands `gkm dev`: every key
 * the declared constructs provide, from the same derivation. The only
 * difference is where the addresses point — at the containers by service name
 * on the compose network, rather than at `localhost` on the ports published for
 * the host.
 *
 * Always from the *local* stage's plan, whichever stage is being reconciled:
 * `gkm test` rewrites the same file, and running the tests must not quietly
 * point these apps at the test databases.
 */

import {
	type ConstructManifest,
	dependenciesOf,
	dependentsOf,
	EDGE_TOKEN_KEY,
	isPublicDeclaration,
	providedKeyFor,
	provisionOrder,
	publicEnvFor,
	TELEMETRY_KEYS,
} from '@geekmidas/manifest';
import {
	ProcessorsHaveNoApp,
	processorUnits,
	WorkerHasNoApp,
	WorkerNameTaken,
	workerUnits,
} from '../build/workers.js';
import { publicBuildValues } from '../compose/siteBuild.js';
import { composeBuildPaths } from '../docker/layout.js';
import { findBuildRoot } from '../docker/templates.js';
import { isStackKey } from '../secrets/stackKeys.js';
import { appTelemetry, scopeTelemetryEnv } from '../telemetry/edges.js';
import { appKey } from '../workspace/derive.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import type { ComposeService } from './compose.js';
import { portKeys, portsOf } from './containers.js';
import { eventsEdgeBucket, workerEdges } from './edges.js';
import { type EnvOptions, envFor, stageEnv } from './env.js';
import { INBOX_RELAY_TOKEN_KEY } from './inboxRelay.js';
import type { LocalCredentials } from './localCredentials.js';
import { type Plan, type PlanOptions, planFor } from './plan.js';
import { backendsOf, surfaceAddresses } from './workspace.js';

/** The profile app services carry, so `gkm dev` starts only the containers. */
export const APPS_PROFILE = 'apps';

/**
 * Where an app's image is built from.
 *
 * An app at the project root is a single-app project, whose `gkm docker`
 * writes `.gkm/docker/Dockerfile`; a workspace writes one per app.
 */
export function dockerfileOf(appName: string, path: string): string {
	return path === '.'
		? '.gkm/docker/Dockerfile'
		: `.gkm/docker/Dockerfile.${appName}`;
}

/**
 * Every construct key, addressed across the compose network.
 *
 * `envFor` is asked with a placeholder port for every port key, so each
 * `localhost:<placeholder>` in its answer names exactly one container port —
 * two containers listening on the same port inside cannot be confused — and is
 * rewritten to `<container>:<inside>`.
 */
export function inNetworkEnv(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	/** The workspace's local logins — see `localCredentials.ts`. */
	credentials: LocalCredentials,
	/**
	 * External APIs' fakes. An image fake is a container on the network like
	 * any other; a module fake is served by `gkm dev` on the host, which an app
	 * container does not reach, so its URL is left as the host sees it.
	 */
	fakes: PlanOptions['fakes'] = {},
): Record<string, string> {
	return networkEnv(localPlan(workspace, manifest, fakes), {
		project: workspace.name,
		credentials,
		seed: credentials.seed,
		addresses: surfaceAddresses(
			workspace,
			manifest,
			(app, port) => `http://${app}:${port}`,
		),
	});
}

/**
 * The local stage's plan, which the app services are always written from.
 *
 * Without the edge: these apps reach each other by service name and a browser
 * reaches them on the ports this file publishes. Behind the edge every
 * surface resolved to its `*.localhost` host on the edge's port, which the
 * rewrite to the compose network then turned into an address nothing answers.
 */
function localPlan(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	fakes: PlanOptions['fakes'] = {},
	credentialFakes: PlanOptions['credentialFakes'] = {},
): Plan {
	return planFor(manifest, workspace.stages.local, provisionOrder(manifest), {
		localStage: workspace.stages.local,
		...backendsOf(workspace),
		...(workspace.protectedSubdomains
			? { protectedSubdomains: workspace.protectedSubdomains }
			: {}),
		fakes,
		credentialFakes,
		edge: false,
	});
}

/**
 * The values a site's bundler inlines, by the name it inlines them under —
 * `{ VITE_API_URL: 'http://localhost:3000' }`.
 *
 * Build arguments, not environment: a static bundle is finished when it is
 * built, so a value handed to its container at runtime reaches nothing. And
 * addresses a *browser* can open, since that is where the bundle runs — the
 * host's port for each app, never a name on the compose network.
 */
export function sitePublicArgs(
	manifest: ConstructManifest,
	appName: string,
	/** Every key the stage resolves, with surfaces at their public addresses. */
	env: Readonly<Record<string, string>>,
): Record<string, string> {
	const declaration = Object.entries(manifest).find(
		([id, d]) => d.kind === 'site' && appKey(id) === appName,
	)?.[1];
	if (declaration?.kind !== 'site') return {};

	// The image build's own rule, so a site built here gets what a stage's
	// image does. No stage secrets: the local stage's reach a site through
	// `gkm exec`, which hands it every one.
	return publicBuildValues(declaration, manifest, (key) => env[key], {});
}

/**
 * Every key a plan resolves, with each container addressed by its service
 * name on the compose network — `postgres:5432` rather than the port
 * published for the host.
 *
 * The addresses of surfaces and sites are the caller's: `gkm compose` hands
 * every process the public ones, which one app calls another on through the
 * edge; `gkm docker`'s apps profile, which runs no edge, the compose
 * network's.
 */
export function networkEnv(
	plan: Plan,
	options: Omit<EnvOptions, 'ports'>,
	/**
	 * The name a container is reached by, where it is not its service name —
	 * a stack behind a shared edge reaches its public services by an alias
	 * unique on the network the edge shares.
	 */
	hostOf: (container: string) => string = (container) => container,
): Record<string, string> {
	const placeholders: Record<string, number> = {};
	const targets = new Map<number, string>();
	let next = 49_152;
	for (const container of [...plan.containers].sort()) {
		for (const port of portsOf(container, plan.fakes)) {
			placeholders[port.key] = next;
			targets.set(next, `${hostOf(container)}:${port.inside}`);
			next += 1;
		}
	}
	// Every key allocation would have assigned, so envFor finds each one.
	for (const key of portKeys(plan.containers, plan.fakes)) {
		placeholders[key] ??= next++;
	}

	const env = envFor(plan, { ...options, ports: placeholders });

	const rewrite = (value: string) =>
		value.replace(/(?:localhost|127\.0\.0\.1):(\d+)/g, (match, port) => {
			return targets.get(Number(port)) ?? match;
		});

	return Object.fromEntries(
		Object.entries(env).map(([key, value]) => [key, rewrite(value)]),
	);
}

/**
 * The keys one app's environment may hold: what its own declaration provides
 * and requires, what each construct it has an edge to provides, and — for a
 * surface — the identity of each client with an edge to it.
 *
 * The one rule for every command and stage: `gkm dev`, `gkm exec` and `gkm
 * test` hand an app these keys (through `processEnvKeys`), `gkm compose`
 * writes them to its env file, and `gkm docker`'s apps profile to its
 * service. A key missing here is missing everywhere, so an app that reads it
 * fails on its first local request rather than in production.
 *
 * What an edge `caller.dependsOn([target])` hands each side, `<C>` and `<T>`
 * being the caller's and the target's ids (`providedKeyFor`) — keep this list and
 * `apps/docs/guide/edges.md` in step with the code below:
 *
 * - `rest-api`: the caller gets `<T>_URL`. The target gets `<C>_URL` from a
 *   site caller and `<C>_SCHEME` from a mobile app caller (`callerKeys`).
 * - `websocket-api`: the caller gets `<T>_URL`, and a server process also
 *   `<T>_PUBLISHER_CONNECTION_STRING`. The target gets what a `rest-api`
 *   does.
 * - `queue`, `topic`: the caller gets the target's `provides` and
 *   `EVENT_PUBLISHER_CONNECTION_STRING`. The target gets nothing.
 * - `objects`: the target's `provides`, its file server's, and the S3 key
 *   pair (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`).
 * - `inbox`: the target's `provides`, and the local relay token.
 * - anything else (a database, cache, secret, credential, external API…):
 *   the target's `provides`. The target gets nothing.
 *
 * Beside the keys, a surface's `<T>_TRUSTED_ORIGINS` lists every caller's
 * origin (a mobile app's as its scheme) and `<T>_COOKIE_DOMAIN` the parent
 * they share — values of the surface's own keys, derived from the same
 * inbound edges (`surfaceEnv`).
 *
 * A site or mobile app is a bundle: it also gets the public-prefixed name of
 * each of those its bundler inlines (`publicEnvFor`: `VITE_API_URL`,
 * `EXPO_PUBLIC_API_URL`), and never a `Telemetry` node's keys.
 *
 * The edges, not the manifest. Every app used to be handed every key the
 * workspace resolved — a web app got the database's owner URL and the auth
 * server's signing secret, and the API got the auth server's database — which
 * is exactly what a declared edge exists to rule out. A deploy composes an
 * app's environment from its edges; so does this.
 *
 * One hop: a surface an app calls is reached over HTTP, so its URL is the
 * app's business and its database is not.
 *
 * A surface's process runs its own endpoints and nothing else. A Worker's
 * crons, queue consumers and subscribers run in the worker's own process
 * (`workerEnvKeys`), so no surface is handed a worker's edges — however its
 * endpoints were found.
 *
 * `undefined` for an app no declaration describes, which gets nothing but its
 * port.
 */
export function appEnvKeys(
	manifest: ConstructManifest,
	appName: string,
): Set<string> | undefined {
	const entry = Object.entries(manifest).find(
		([id, d]) =>
			(d.kind === 'rest-api' ||
				d.kind === 'websocket-api' ||
				d.kind === 'site' ||
				d.kind === 'mobile-app') &&
			appKey(id) === appName,
	);
	if (!entry) return undefined;
	const [id, declaration] = entry;

	const keys = new Set<string>([
		...(declaration.provides ?? []),
		...(declaration.requires ?? []),
		// A handler the surface declares itself — an auth server's wildcard —
		// states what it needs on the handler.
		...(declaration.kind === 'rest-api'
			? declaration.endpoints.flatMap((endpoint) => endpoint.requires ?? [])
			: []),
	]);

	// A surface's own edges and its endpoints' — every route it serves.
	const edges = dependenciesOf(declaration).map((edge) => edge.target);
	addEdgeKeys(manifest, edges, keys, isPublicDeclaration(declaration));

	// The other direction: who calls this surface, by the identity it links
	// and redirects back to (`APP_SCHEME`, `WEB_URL`).
	if (declaration.kind === 'rest-api' || declaration.kind === 'websocket-api') {
		for (const key of callerKeys(manifest, id)) keys.add(key);
	}

	if (isPublicDeclaration(declaration)) {
		// A site's edge to a `Telemetry` node hands it none of the node's keys:
		// an exporter's endpoint and headers are a server's, and a site's
		// environment is a bundle's.
		for (const key of TELEMETRY_KEYS) keys.delete(key);
		for (const key of Object.keys(publicEnvFor(declaration, manifest))) {
			keys.add(key);
		}
	}

	return keys;
}

/**
 * The keys a Worker's own process reads: what the worker and everything built
 * from it declared an edge to — the queues its consumers drain and the topics
 * its subscribers are bound to among them (see `workerEdges`) — and the
 * broker its crons schedule through.
 *
 * `undefined` when no worker has that id.
 */
export function workerEnvKeys(
	manifest: ConstructManifest,
	workerId: string,
): Set<string> | undefined {
	const declaration = manifest[workerId];
	if (declaration?.kind !== 'worker') return undefined;

	const keys = new Set<string>([
		...(declaration.provides ?? []),
		...(declaration.requires ?? []),
		// A server schedules its crons through the broker.
		'EVENT_PUBLISHER_CONNECTION_STRING',
	]);
	addEdgeKeys(manifest, workerEdges(manifest, workerId), keys);
	return keys;
}

/**
 * The keys a file server's processor unit reads: its bucket's, and what each
 * of its processors depends on. `undefined` for a file server with none.
 */
export function processorEnvKeys(
	manifest: ConstructManifest,
	fileServerId: string,
): Set<string> | undefined {
	const server = manifest[fileServerId];
	if (server?.kind !== 'file-server' || !server.processors?.length) {
		return undefined;
	}

	const keys = new Set<string>();
	addEdgeKeys(
		manifest,
		[
			server.of,
			...server.processors.flatMap((p) => p.dependencies.map((d) => d.target)),
		],
		keys,
	);
	return keys;
}

/**
 * What one process runs: an app's surface or site, and the workers and file
 * servers' processors whose work it carries.
 *
 * The same app is a different process on different commands — under `gkm
 * dev` an API's own process runs the crons of the workers it hosts, while a
 * stack runs each worker in a container of its own — so a command names what
 * its process runs, and the keys follow from that alone.
 */
export interface ProcessUnits {
	/** The app's name, `api` or `web`. */
	app?: string;
	/** Worker ids, `Jobs`. */
	workers?: readonly string[];
	/** File servers' ids whose processors it runs, `AssetsServer`. */
	processors?: readonly string[];
}

/**
 * The keys the declared constructs hand to some process — each scoped to the
 * processes with an edge to it. A stage key outside this set is the stage's
 * own: one set by hand, which nothing declares a reader of.
 */
export function constructKeys(manifest: ConstructManifest): Set<string> {
	const keys = new Set<string>();
	const add = (more: Iterable<string> | undefined) => {
		for (const key of more ?? []) keys.add(key);
	};
	for (const [id, declaration] of Object.entries(manifest)) {
		add(declaration.provides);
		add(declaration.requires);
		if (declaration.kind === 'worker') add(workerEnvKeys(manifest, id));
		if (declaration.kind === 'file-server') {
			add(processorEnvKeys(manifest, id));
		}
		if (
			declaration.kind === 'rest-api' ||
			declaration.kind === 'websocket-api' ||
			declaration.kind === 'site' ||
			declaration.kind === 'mobile-app'
		) {
			add(appEnvKeys(manifest, appKey(id)));
		}
	}
	return keys;
}

/**
 * The keys one process is handed — the one rule `gkm dev`, `gkm exec` and
 * `gkm compose` all apply, so an app gets the same keys whichever runs it:
 *
 * - **What its constructs reach**, by their edges: `appEnvKeys` for its app,
 *   `workerEnvKeys` for each worker it runs, `processorEnvKeys` for each
 *   file server's processors. A key a construct provides reaches only a
 *   process with an edge to it, a stored one included — an auth server's
 *   signing secret stays with the auth server.
 * - **The stack's edge token** (`EDGE_TOKEN_KEY`), which a call to a
 *   sibling through the edge carries beside the client's address.
 * - **Every one of the stage's own keys** (`stageKeys` no construct
 *   provides): a value set with `gkm secrets:set` that the code reads with
 *   `get('X')`. Nothing declares which process reads it, so every process is
 *   handed it — but for what gkm keeps for the stack itself (`isStackKey`):
 *   a container's login, the backups key, the server's address.
 *
 * `undefined` for an app no declaration describes, which nothing narrows.
 */
export function processEnvKeys(
	manifest: ConstructManifest,
	units: ProcessUnits,
	stageKeys: Iterable<string>,
): Set<string> | undefined {
	const keys = new Set<string>();
	if (units.app !== undefined) {
		const own = appEnvKeys(manifest, units.app);
		if (!own && !units.workers?.length && !units.processors?.length) {
			return undefined;
		}
		for (const key of own ?? []) keys.add(key);
	}
	for (const id of units.workers ?? []) {
		for (const key of workerEnvKeys(manifest, id) ?? []) keys.add(key);
	}
	for (const id of units.processors ?? []) {
		for (const key of processorEnvKeys(manifest, id) ?? []) keys.add(key);
	}

	// Every process may call a sibling through the edge, with the stack's
	// token beside the client's address.
	keys.add(EDGE_TOKEN_KEY);

	const owned = constructKeys(manifest);
	for (const key of stageKeys) {
		if (!owned.has(key) && !isStackKey(key)) keys.add(key);
	}
	return keys;
}

/**
 * One process's environment, from the stage's stored keys and every value
 * it resolved (`stageEnv`'s merge): exactly {@link processEnvKeys}.
 */
export function processEnv(
	manifest: ConstructManifest,
	units: ProcessUnits,
	stored: Readonly<Record<string, string>>,
	resolved: Readonly<Record<string, string>>,
): Record<string, string> {
	const env = stageEnv(stored, resolved);
	const keys = processEnvKeys(manifest, units, Object.keys(stored));
	if (!keys) return env;
	return Object.fromEntries(
		Object.entries(env).filter(([key]) => keys.has(key)),
	);
}

/**
 * What an app's own process runs locally: its surface or site, and the
 * workers and processors whose code it holds — the same choice `gkm build`
 * makes (`workerUnits`, `processorUnits`).
 *
 * A worker no app can build is left out here: `gkm build` says so, and a
 * dev loop has nothing to run it in.
 */
export function appProcess(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	background: Readonly<Record<string, readonly string[]>>,
	appName: string,
): ProcessUnits {
	const hosted = <T extends { id: string; app: string }>(units: () => T[]) => {
		try {
			return units()
				.filter((unit) => unit.app === appName)
				.map((unit) => unit.id);
		} catch (error) {
			if (
				error instanceof WorkerHasNoApp ||
				error instanceof WorkerNameTaken ||
				error instanceof ProcessorsHaveNoApp
			) {
				return [];
			}
			throw error;
		}
	};
	return {
		app: appName,
		workers: hosted(() => workerUnits(workspace, manifest, background)),
		processors: hosted(() => processorUnits(workspace, manifest)),
	};
}

/**
 * What a surface is told about the clients that call it: the identity it
 * links and redirects back to.
 *
 * An API that finishes an OAuth callback by sending a phone back into the app
 * builds `<scheme>://…`; one that mails a link to the site builds it on the
 * site's address. Both are the caller's own key, named by the caller's id —
 * `APP_SCHEME` for `MobileApp('App')`, `WEB_URL` for `StaticSite('Web')` — so
 * two apps calling one API arrive as `APP_SCHEME` and `ADMIN_APP_SCHEME`.
 *
 * Clients only. A surface or a worker that calls this one is something it
 * answers, never somewhere it sends a user, so nothing of theirs comes back
 * along the edge. Their origins still reach the surface, folded into its
 * `<ID>_TRUSTED_ORIGINS`.
 */
export function callerKeys(
	manifest: ConstructManifest,
	surfaceId: string,
): string[] {
	const keys: string[] = [];
	for (const caller of dependentsOf(manifest, surfaceId)) {
		const declaration = manifest[caller];
		if (declaration?.kind === 'mobile-app') {
			keys.push(providedKeyFor(caller, declaration.kind, 'scheme'));
		} else if (declaration?.kind === 'site') {
			keys.push(providedKeyFor(caller, declaration.kind, 'url'));
		}
	}
	return keys;
}

/**
 * What a caller gets for each construct it has an edge to — the left half of
 * the table on {@link appEnvKeys}.
 */
function addEdgeKeys(
	manifest: ConstructManifest,
	edges: readonly string[],
	keys: Set<string>,
	/** The process is a bundle a browser or a phone runs. */
	client = false,
): void {
	for (const id of edges) {
		// A bucket's events: its subscribers' process reads where they are
		// delivered from, and nothing else of the bucket.
		const bucket = eventsEdgeBucket(id);
		if (bucket) {
			if (manifest[bucket]?.kind === 'objects') {
				keys.add(providedKeyFor(bucket, 'objects', 'eventsConnectionString'));
				keys.add(providedKeyFor(bucket, 'objects', 'eventsToken'));
			}
			continue;
		}

		const target = manifest[id];
		if (!target) continue;
		// A surface is reached over HTTP, so its caller is given its address
		// and nothing else it provides: who it trusts and the domain its
		// cookies are scoped to are the surface's own settings, read by its own
		// process. For an auth server that is the whole point — the API gets
		// AUTH_URL, and the auth app alone holds its secret, tenant and mailer.
		if (target.kind === 'rest-api') {
			keys.add(providedKeyFor(id, target.kind, 'url'));
			continue;
		}
		// A WebSocket surface is opened at its address, and sent to through its
		// publisher — which writes to every socket, so a client is handed the
		// address alone.
		if (target.kind === 'websocket-api') {
			keys.add(providedKeyFor(id, target.kind, 'url'));
			if (!client)
				keys.add(providedKeyFor(id, target.kind, 'publisherConnectionString'));
			continue;
		}
		for (const key of target.provides ?? []) keys.add(key);

		// Locally Mailpit posts what an inbox receives to the worker that
		// runs its subscriber, with this token.
		if (target.kind === 'inbox') keys.add(INBOX_RELAY_TOKEN_KEY);

		if (target.kind === 'queue' || target.kind === 'topic') {
			keys.add('EVENT_PUBLISHER_CONNECTION_STRING');
		}
		// The S3 client's shared key pair, for a bucket whose URL carries no key
		// of its own — handed over only where the stage has one. A file server
		// is reached by its URL alone.
		if (target.kind === 'objects') {
			// A FileServer is one construct declaring two nodes — the bucket,
			// which the edge points at, and the domain that serves it — and its
			// client reads both: a handler signs uploads to the bucket and hands
			// out URLs on the domain. The domain's address comes with the edge.
			for (const other of Object.values(manifest)) {
				if (other.kind === 'file-server' && other.of === id) {
					for (const key of other.provides ?? []) keys.add(key);
				}
			}
			keys.add('AWS_ACCESS_KEY_ID');
			keys.add('AWS_SECRET_ACCESS_KEY');
			keys.add('AWS_REGION');
		}
	}
}

/** One compose service per app the workspace runs, behind the apps profile. */
export function appServices(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	containers: readonly string[],
	/** The workspace's local logins — see `localCredentials.ts`. */
	credentials: LocalCredentials,
	fakes: PlanOptions['fakes'] = {},
	/**
	 * Each credential's fake value, under `gkm dev --fake` — handed to the
	 * apps that read the credential, as an external API's fake is.
	 */
	credentialFakes: PlanOptions['credentialFakes'] = {},
): Record<string, ComposeService> {
	const plan = localPlan(workspace, manifest, fakes, credentialFakes);
	const derivation = {
		project: workspace.name,
		credentials,
		seed: credentials.seed,
	};
	const env = networkEnv(plan, {
		...derivation,
		addresses: surfaceAddresses(
			workspace,
			manifest,
			(app, port) => `http://${app}:${port}`,
		),
	});
	// What a browser is handed: each app on the port this file publishes it on.
	const browser = networkEnv(plan, {
		...derivation,
		addresses: surfaceAddresses(workspace, manifest),
	});
	const services: Record<string, ComposeService> = {};
	const buildRoot = findBuildRoot(workspace.root);

	for (const [name, app] of Object.entries(workspace.apps)) {
		// A mobile app ships through its own toolchain; nothing here runs it.
		if (app.type === 'mobile' || !app.port) continue;

		const key = appKey(name);
		const health = app.type === 'web' ? '/' : '/health';
		// Built from the build root — the package manager's, which is above the
		// workspace when it is nested in a monorepo — by the Dockerfile `gkm
		// docker` writes under the workspace.
		const build = composeBuildPaths({
			composeDir: workspace.root,
			buildRoot,
			workspaceRoot: workspace.root,
			dockerfile: dockerfileOf(name, app.path),
		});
		const ports = [`${app.port}:${app.port}`];

		// A site is a bundle: its public URLs are inlined when it is built, so
		// they are build arguments, and it reads nothing at runtime — no server
		// env, and nothing to wait for but its own server.
		if (app.type === 'web') {
			const args = sitePublicArgs(manifest, name, browser);
			services[key] = {
				image: `${key}:\${TAG:-latest}`,
				build: {
					...build,
					...(Object.keys(args).length ? { args } : {}),
				},
				profiles: [APPS_PROFILE],
				ports,
				healthcheck: healthcheck(app.port, health),
			};
			continue;
		}

		const allowed = appEnvKeys(manifest, name);
		// The local stage's telemetry, named for this app, where it has the
		// edge — and none of it where it has not.
		const own = scopeTelemetryEnv(
			Object.fromEntries(
				Object.entries(env).filter(([envKey]) => allowed?.has(envKey)),
			),
			{
				uses: appTelemetry(manifest, name) !== undefined,
				serviceName: name,
				telemetry: env,
			},
		);

		services[key] = {
			image: `${key}:\${TAG:-latest}`,
			build,
			profiles: [APPS_PROFILE],
			ports,
			environment: {
				NODE_ENV: 'production',
				PORT: String(app.port),
				...own,
			},
			// The edge fronts the host's browser; apps talk to each other directly.
			...(containers.some((c) => c !== 'caddy')
				? { depends_on: containers.filter((c) => c !== 'caddy') }
				: {}),
			healthcheck: healthcheck(app.port, health),
		};
	}

	return services;
}

/** An app's health check: its own server answering on `path`. */
export function healthcheck(
	port: number,
	path: string,
): NonNullable<ComposeService['healthcheck']> {
	return {
		test: ['CMD', 'wget', '-q', '--spider', `http://localhost:${port}${path}`],
		interval: '10s',
		timeout: '5s',
		retries: 5,
	};
}
