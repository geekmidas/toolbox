/**
 * The stack a workspace runs as for one stage — pure.
 *
 * Everything `gkm compose` writes is decided here, as data: the compose file,
 * the Caddyfile, one env file per backend, and the image each app runs. The
 * command around it reads the workspace, asks the registry, writes the files
 * and starts Docker; none of those decide anything, so all of it can be
 * asserted without a daemon.
 *
 * The values come from the same derivations every other target uses. The
 * plan is reconcile's `planFor`, the keys an app reads are `appEnvKeys`, and
 * every URL is `envFor`'s — asked twice, once with each app at its public
 * address and once on the compose network, because a browser and a sibling
 * service reach the same API by different names.
 */

import { join } from 'node:path';
import {
	type ConstructManifest,
	provideKey,
	provisionOrder,
	publicEnvFor,
} from '@geekmidas/manifest';
import { type WorkerUnit, workerUnits } from '../build/workers.js';
import {
	assertExternalServices,
	type DevService,
	type DevServiceUse,
	devServicesUsed,
	type ExternalServices,
	type ServiceDeclaration,
	suppliedOnly,
} from '../deploy/devServices.js';
import { isMainFrontendApp, resolveHost } from '../deploy/domain.js';
import { type DeployIdentity, imageRef } from '../deploy/identity.js';
import { otelEnv } from '../deploy/otel.js';
import { validateImageRef } from '../docker/imageRef.js';
import { appDockerfile, workerDockerfile } from '../docker/index.js';
import { composeBuildPaths, type ImageLayout } from '../docker/layout.js';
import { TURBO_VERSION, WORKER_PORT } from '../docker/templates.js';
import { appEnvKeys, networkEnv, workerEnvKeys } from '../reconcile/apps.js';
import { hostFor } from '../reconcile/caddyfile.js';
import { type ComposeService, composeFor } from '../reconcile/compose.js';
import { DEFAULT_IMAGES, portKeys } from '../reconcile/containers.js';
import { localRolePassword } from '../reconcile/env.js';
import { type Plan, type PlannedResource, planFor } from '../reconcile/plan.js';
import { bucketPolicies } from '../reconcile/provision.js';
import type { StageSecrets } from '../secrets/types.js';
import { NoDomainForStage } from '../target/dokploy/domain.js';
import { DEFAULT_EVENTS } from '../types.js';
import { appKey } from '../workspace/derive.js';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';
import { type EdgeSite, edgeCaddyfile } from './caddyfile.js';
import { type AppImage, siteTag } from './images.js';
import {
	LOGS_SERVICE,
	logsService,
	type StackLogs,
	stackLogs,
} from './logs.js';
import { LOGS_PORT, resolveLogs } from './logsConfig.js';
import {
	REDIS_SERVICE,
	redisService,
	STACK_CACHE,
	type StackRedis,
	stackRedis,
} from './redis.js';

/** Where a stack's files are written, relative to the workspace root. */
export function stackDir(stage: string): string {
	return `.gkm/compose/${stage}`;
}

/**
 * The compose project a stage's stack runs as.
 *
 * The deploy identity's scope, so two workspaces with one name in different
 * namespaces never share containers or volumes — and the stage, so a
 * machine can run two stages side by side.
 */
export function composeProject(identity: DeployIdentity): string {
	return `${identity.scope}-${identity.stage}`;
}

/** The ports the edge is published on, and the variables that move them. */
export const EDGE_PORT_ENV = {
	https: 'GKM_COMPOSE_HTTPS_PORT',
	http: 'GKM_COMPOSE_HTTP_PORT',
} as const;

/**
 * Containers this target does not run.
 *
 * The AWS emulator never applies: a stack is a server target, whose events
 * are pg-boss. Reconcile's Caddy fronts `gkm dev`'s host processes; the stack
 * brings its own edge.
 *
 * MinIO and Mailpit run on the local stage always, and on a deployed stage
 * only where `--allow-dev-services` allowed them and its secrets configure no
 * real bucket or mail server — see `devServices.ts`.
 */
const NOT_RUN: Readonly<Record<string, true>> = {
	localstack: true,
	caddy: true,
};

/** The kinds a deployed stage takes from its secrets, or a dev service. */
const SERVICE_KINDS: Readonly<Record<string, ServiceDeclaration['kind']>> = {
	email: 'email',
	objects: 'objects',
	'file-server': 'file-server',
};

/** The region MinIO is addressed with. It has no regions; the SDK wants one. */
const MINIO_REGION = 'us-east-1';

/** The S3 client's credentials, read beside a bucket's URL when it has them. */
const STORAGE_KEYS = [
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'AWS_REGION',
] as const;

/**
 * Every service's Docker logs, rotated. The json-file driver keeps a
 * container's output in one file that grows until the disk is full — on a
 * small server, in weeks. Three files of 10 MB each per container is enough
 * to see what happened and never fills anything. A project's own override
 * file that sets `logging` wins over it.
 */
export const LOG_ROTATION = {
	driver: 'json-file',
	options: { 'max-size': '10m', 'max-file': '3' },
} as const;

/** Each image's build, where the stack builds rather than pulls. */
export interface AppBuild {
	/** Where the Dockerfile is written, relative to the workspace root. */
	dockerfile: string;
	/** A site's public URLs, inlined by its bundler. */
	args?: Record<string, string>;
}

/** One app in the stack. */
export interface StackApp extends AppImage {
	/** Its compose service name — the app key, `api`. */
	name: string;
	/** The construct it serves. */
	id: string;
	kind: 'rest-api' | 'site';
	/** Its directory, relative to the workspace root. */
	path: string;
	port: number;
	/** The host the edge answers it on. */
	host: string;
	/** `https://<host>` — with the edge's port where it is not 443. */
	url: string;
	build?: AppBuild;
	/** A backend's environment, exactly the keys it reads. Absent for a site. */
	env?: Record<string, string>;
}

/**
 * A Worker in the stack: its crons, queue consumers and subscribers in a
 * container of their own. Nothing routes to it and nothing is published —
 * its one route is the health check Docker asks.
 */
export interface StackWorker extends AppImage {
	/** Its compose service name — `jobs`. */
	name: string;
	/** The Worker construct. */
	id: string;
	/** The app whose build writes its entry, which its image is built from. */
	host: string;
	/** Where its health check answers, inside the container. */
	port: number;
	build?: AppBuild;
	/** Exactly the keys the worker's constructs read. */
	env?: Record<string, string>;
}

/** A service as the stack's compose file defines it. */
export interface StackService {
	image: string;
	build?: {
		context: string;
		dockerfile: string;
		args?: Record<string, string>;
	};
	restart?: string;
	command?: string | string[];
	env_file?: { path: string; format: 'raw' }[];
	environment?: Record<string, string>;
	ports?: string[];
	volumes?: string[];
	depends_on?: Record<string, { condition: 'service_healthy' }>;
	healthcheck?: ComposeService['healthcheck'];
	logging?: {
		driver: string;
		options: Record<string, string>;
	};
}

export interface StackFile {
	name: string;
	services: Record<string, StackService>;
	volumes: Record<string, Record<string, never>>;
}

export interface ComposeStack {
	project: string;
	stage: string;
	/** The project's local stage, served with Caddy's internal CA. */
	local: boolean;
	apps: StackApp[];
	/** Each Worker with background work, in a container of its own. */
	workers: StackWorker[];
	/** The infrastructure containers, by compose service name. */
	infra: string[];
	compose: StackFile;
	caddyfile: string;
	/** Generated Dockerfiles, by path relative to the workspace root. */
	dockerfiles: Record<string, string>;
	/** The plan the stack was derived from — what provisioning creates. */
	plan: Plan;
	/** The Postgres master's password, and the seed role passwords take. */
	credential: { master: string; seed?: string };
	/**
	 * The stack's MinIO, where it runs one: its root credential — what the
	 * backends sign with — and the buckets and open paths provisioning
	 * creates in it.
	 */
	storage?: StackStorage;
	/** The dev services a deployed stage runs (`--allow-dev-services`). */
	devServices: DevServiceUse[];
	/**
	 * The stack's OpenObserve, when `deploy.compose.logs` runs one — every
	 * backend sends its logs and traces to it.
	 */
	logs?: StackLogs;
	/**
	 * The stack's Redis, where a declared cache lives in it — every cache
	 * whose URL the stage's secrets do not set.
	 */
	redis?: StackRedis;
}

/** The stack's MinIO, and what is created in it. */
export interface StackStorage {
	user: string;
	password: string;
	/** Each bucket's stage-scoped name. */
	buckets: string[];
	/** The open paths of each served bucket. */
	policies: { bucket: string; open: string[] }[];
}

export interface StackInput {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	/** Each owner's runnables' edges, from discovery. */
	runnables?: Readonly<Record<string, readonly string[]>>;
	/**
	 * Each Worker's crons', queues' and subscribers' files, from discovery —
	 * which workers run, and which app each is built from.
	 */
	background?: Readonly<Record<string, readonly string[]>>;
	stage: string;
	identity: DeployIdentity;
	images: {
		mode: 'build' | 'pull';
		/** A release tag, or — building — the commit. */
		tag: string;
		registry?: string;
	};
	/** The stage's secrets — set by hand, and what a deployed stage generated. */
	secrets?: StageSecrets | null;
	/**
	 * The dev services a deployed stage may run for mail and buckets its
	 * secrets do not configure. The local stage runs both regardless.
	 */
	allowDevServices?: readonly DevService[];
	/** The edge's published ports. 443 and 80 by default. */
	ports?: { https?: number; http?: number };
	/**
	 * The stack only builds its images, to push them (`--build --push`): no
	 * backend's or worker's runtime environment is resolved and no service
	 * reads an env file, so building needs none of the stage's backend
	 * secrets. A site's build args — its public URLs — are still resolved.
	 */
	buildOnly?: boolean;
	/**
	 * For builds: where the images are built from and with what — the build
	 * root, its package manager and turbo. The workspace's root, with pnpm,
	 * when not given.
	 */
	layout?: ImageLayout;
}

/** A value only the stage's secrets can hold, and they do not. */
export class StageSecretMissing extends Error {
	constructor(
		readonly app: string,
		readonly key: string,
		readonly stage: string,
	) {
		super(
			`'${app}' reads ${key}, and the stage '${stage}' has none. Nothing in ` +
				`the stack can derive it; set it in the stage's secrets: ` +
				`gkm secrets:set ${key} '…' --stage ${stage}`,
		);
		this.name = 'StageSecretMissing';
	}
}

/** A deployed stage's secrets with no seed to derive its passwords from. */
export class StageSeedMissing extends Error {
	constructor(readonly stage: string) {
		super(
			`The stage '${stage}' has no seed in its secrets, and a deployed stage's ` +
				`database passwords are derived from it. Run gkm compose --stage ${stage} ` +
				`without --dry-run once, or gkm deploy, to generate it.`,
		);
		this.name = 'StageSeedMissing';
	}
}

/** A workspace with no API and no site to run. */
export class NothingToCompose extends Error {
	constructor(readonly root: string) {
		super(
			`${root} declares no RestApi, no site and no Worker with work to do, ` +
				`so a stack would run nothing. Mobile apps ship through their own ` +
				`toolchain.`,
		);
		this.name = 'NothingToCompose';
	}
}

/** A value that cannot be written to an env file a line at a time. */
export class EnvValueMultiline extends Error {
	constructor(
		readonly app: string,
		readonly key: string,
	) {
		super(
			`${key} for '${app}' spans more than one line, and an env file holds ` +
				`one value per line. Store it on one line — base64, or JSON — and ` +
				`decode it where it is read.`,
		);
		this.name = 'EnvValueMultiline';
	}
}

/** The services a stack's apps wait on and the edge waits on in turn. */
const HEALTHY = { condition: 'service_healthy' } as const;

/**
 * An app's health check: its own server, asked on 127.0.0.1 — not
 * `localhost`, which resolves to `::1` first in an Alpine container while a
 * server may listen on IPv4 alone.
 */
function probe(port: number, path: string): StackService['healthcheck'] {
	return {
		test: [
			'CMD',
			'wget',
			'-q',
			'-O',
			'/dev/null',
			`http://127.0.0.1:${port}${path}`,
		],
		interval: '5s',
		timeout: '3s',
		retries: 20,
		start_period: '10s',
	};
}

/** The stack for one stage. */
export function composeStack(input: StackInput): ComposeStack {
	const { workspace, manifest, stage, identity } = input;
	const local = stage === workspace.stages.local;
	const project = composeProject(identity);
	const custom = input.secrets?.custom ?? {};
	const https = input.ports?.https ?? 443;
	const http = input.ports?.http ?? 80;

	// A server target's backends, whatever `deploy.default` says: the stack is
	// one machine running containers, so events are pg-boss beside the
	// declared database — and every cache, one declared from that database
	// included, is in the stack's own Redis.
	const plan = planFor(manifest, stage, provisionOrder(manifest), {
		localStage: workspace.stages.local,
		events: DEFAULT_EVENTS.server,
		cache: STACK_CACHE,
		// The stack brings its own edge; reconcile's would front the host.
		edge: false,
	});
	const byId = new Map(plan.resources.map((r) => [r.id, r]));

	const seed = local ? undefined : input.secrets?.seed;
	if (!local && !seed) throw new StageSeedMissing(stage);
	const credential = {
		master: local
			? 'geekmidas'
			: localRolePassword(workspace.name, plan, 'master', seed),
		...(seed ? { seed } : {}),
	};

	const apps = stackApps(workspace, manifest, plan, {
		local,
		stage,
		https,
		identity,
		images: input.images,
	});
	const workers = stackWorkers(
		workerUnits(workspace, manifest, input.background ?? {}),
		{ stage, identity, images: input.images },
	);
	if (apps.length === 0 && workers.length === 0) {
		throw new NothingToCompose(workspace.root);
	}

	// Which construct each key belongs to, so a key is resolved by what it is
	// rather than by its spelling.
	const owners = new Map<string, PlannedResource>();
	for (const resource of plan.resources) {
		owners.set(resource.envKey, resource);
		if (resource.kind === 'email') {
			owners.set(provideKey(resource.id, 'from'), resource);
			owners.set(provideKey(resource.id, 'inboxUrl'), resource);
		}
		if (resource.kind === 'external-api') {
			owners.set(provideKey(resource.id, 'credentials'), resource);
		}
	}

	// The keys each app reads: a backend's environment, and the keys a
	// site's build args rename.
	const reads = new Map<string, string[]>();
	for (const app of apps) {
		const site = manifest[app.id];
		reads.set(
			app.name,
			site?.kind === 'site'
				? Object.values(publicEnvFor(site, manifest))
				: [...(appEnvKeys(manifest, app.name, input.runnables) ?? [])],
		);
	}
	for (const worker of workers) {
		reads.set(worker.name, [
			...(workerEnvKeys(manifest, worker.id, input.runnables) ?? []),
		]);
	}
	const domain = workspace.deploy?.domains?.[stage];

	// The log UI, when the workspace asks for one: its root login, how it is
	// reached, and what each backend is handed to send to it.
	const logsConfig = resolveLogs(workspace.deploy?.compose?.logs);
	const logs = logsConfig
		? stackLogs({
				config: logsConfig,
				stage,
				local,
				project: workspace.name,
				...(domain ? { domain } : {}),
				custom,
				https,
			})
		: undefined;

	// Mail and storage: the local stage runs Mailpit and MinIO for all of it.
	// A deployed stage takes each from its secrets — or, where allowed, from a
	// dev service — and one missing anything stops here, naming every key.
	const services: ExternalServices = local
		? {
				missing: [],
				minio: plan.resources
					.filter((r) => r.kind === 'objects')
					.map((r) => r.id),
				mailpit: plan.resources
					.filter((r) => r.kind === 'email')
					.map((r) => r.id),
			}
		: assertExternalServices({
				stage,
				declarations: serviceDeclarations(plan, reads, owners),
				supplied: custom,
				allow: input.allowDevServices ?? [],
				...(domain ? { domain } : {}),
			});

	// The caches: in the stack's Redis, unless the stage set a cache's URL —
	// a managed Redis — and with every one set, there is no Redis to run.
	const redis = stackRedis({ plan, stage, local, custom });

	const infra = [
		...plan.containers
			.filter((c) => !NOT_RUN[c])
			.filter((c) => c !== 'minio' || services.minio.length > 0)
			.filter((c) => c !== 'mailpit' || services.mailpit.length > 0)
			.filter((c) => c !== REDIS_SERVICE || redis !== undefined),
		...(logs ? [LOGS_SERVICE] : []),
	].sort();

	// The stack's MinIO signs with the stage's own key pair where it set one,
	// and otherwise with a credential derived like every other: the fixed
	// local one, or — deployed — from the stage's seed.
	const storage: StackStorage | undefined = infra.includes('minio')
		? (() => {
				const buckets = services.minio
					.map((id) => byId.get(id)?.name)
					.filter((name): name is string => Boolean(name))
					.sort();
				return {
					user:
						custom.AWS_ACCESS_KEY_ID ??
						(local ? 'geekmidas' : `${workspace.name}-minio`),
					password:
						custom.AWS_SECRET_ACCESS_KEY ??
						(local
							? 'geekmidas'
							: localRolePassword(workspace.name, plan, 'minio', seed)),
					buckets,
					policies: bucketPolicies(plan).filter((p) =>
						buckets.includes(p.bucket),
					),
				};
			})()
		: undefined;

	// Every key the stage resolves, twice: with each app at its public address
	// — what a browser is handed, and what an app says it is — and with each on
	// the compose network, which is how one service reaches another.
	const derivation = {
		project: workspace.name,
		master: credential.master,
		...(credential.seed ? { seed: credential.seed } : {}),
		// Mailpit on a deployed stage sends as the stage's domain.
		...(!local && domain ? { mailFrom: `noreply@${domain}` } : {}),
	};
	const outside = networkEnv(plan, {
		...derivation,
		addresses: Object.fromEntries(apps.map((app) => [app.id, app.url])),
	});
	const inside = networkEnv(plan, {
		...derivation,
		addresses: Object.fromEntries(
			apps.map((app) => [app.id, `http://${app.name}:${app.port}`]),
		),
	});

	// Each file server over the stack's MinIO, at a host of its own on the
	// edge — the shape it has deployed: a domain serving a bucket.
	const fileServers = new Map<string, { url: string; site: EdgeSite }>();
	if (storage) {
		for (const resource of plan.resources) {
			if (resource.kind !== 'file-server' || !resource.of) continue;
			if (!services.minio.includes(resource.of)) continue;
			if (custom[resource.envKey] !== undefined) continue;
			const bucket = byId.get(resource.of);
			if (!bucket) continue;

			let host: string;
			if (local) {
				host = hostFor(resource, workspace.name);
			} else {
				if (!domain) throw new NoDomainForStage(stage);
				host = `${resource.subdomain ?? appKey(resource.id)}.${domain}`;
			}
			fileServers.set(resource.id, {
				url: `https://${host}${local && https !== 443 ? `:${https}` : ''}`,
				site: {
					host,
					upstream: 'minio:9000',
					rewrite: `/${bucket.name}{uri}`,
				},
			});
		}
	}

	const surfaceUrls = new Map(
		plan.resources
			.filter((r) => r.kind === 'rest-api' || r.kind === 'site')
			.map((r) => [r.envKey, r.id]),
	);
	const appById = new Map(apps.map((app) => [app.id, app]));

	/**
	 * What a key resolves to for one app, from the stage's secrets where only
	 * they can hold it, and the derivations otherwise.
	 */
	const valueFor = (
		app: Pick<StackApp, 'name' | 'id' | 'kind'>,
		key: string,
		owner: PlannedResource | undefined,
	): string | undefined => {
		// Mail and storage: what the stage set — a real server, a real bucket —
		// and otherwise the dev service it runs, which `services` has already
		// checked it may.
		if (owner && SERVICE_KINDS[owner.kind]) {
			if (custom[key] !== undefined) return custom[key];
			if (owner.kind === 'file-server') return fileServers.get(owner.id)?.url;
			return outside[key];
		}

		// Supplied by somebody: a third party's credentials, and — deployed —
		// the secrets the stage generated.
		if (owner && suppliedOnly(owner.kind, owner.id, key, local)) {
			const value = custom[key];
			if (value === undefined) {
				throw new StageSecretMissing(app.name, key, stage);
			}
			return value;
		}

		// Set by hand wins over derived: it is the stage saying what it is.
		if (custom[key] !== undefined) return custom[key];

		// A cache, in the stack's Redis, by its name on the network.
		if (owner?.kind === 'cache') return redis?.urls[key];

		// A backend reaches a sibling surface on the compose network; its own
		// address is the public one, which is what it builds links on. A site
		// runs in a browser, which has only the public addresses.
		const surface = surfaceUrls.get(key);
		if (app.kind === 'rest-api' && surface && surface !== app.id) {
			return inside[key];
		}

		return outside[key];
	};

	/** Each key one backend process reads, resolved for this stage. */
	const valuesFor = (
		app: Pick<StackApp, 'name' | 'id' | 'kind'>,
		keys: ReadonlySet<string>,
	): Record<string, string> => {
		const values: Record<string, string> = {};
		for (const key of [...keys].sort()) {
			const owner = owners.get(key) ?? storageOwner(key, plan);
			// A deployed stage has no inbox: Mailpit runs only locally.
			if (!local && owner?.kind === 'email' && key.endsWith('_INBOX_URL'))
				continue;
			if ((STORAGE_KEYS as readonly string[]).includes(key)) {
				// The stage's own key pair where it set one — an external bucket
				// signs with it — and otherwise the stack's MinIO's.
				const value = custom[key] ?? storageValue(key, storage);
				if (value !== undefined) values[key] = value;
				continue;
			}

			const value = valueFor(app, key, owner);
			if (value !== undefined) values[key] = value;
		}
		return values;
	};

	for (const app of apps) {
		if (app.kind === 'site') {
			const site = manifest[app.id];
			if (site?.kind !== 'site') continue;

			const args: Record<string, string> = {};
			for (const [key, source] of Object.entries(
				publicEnvFor(site, manifest),
			)) {
				const value = valueFor(app, source, owners.get(source));
				if (value !== undefined) args[key] = value;
			}
			if (app.build && Object.keys(args).length > 0) app.build.args = args;
			continue;
		}
		// Built to be pushed, a backend's image is every stage's: what it reads
		// at runtime is the deploy's business, not the build's.
		if (input.buildOnly) continue;

		const keys = appEnvKeys(manifest, app.name, input.runnables) ?? new Set();
		const values = valuesFor(app, keys);

		// The origins Better Auth trusts are the browser's and, now, each
		// service that calls this surface across the compose network: its CSRF
		// check applies to every caller, and a sibling's request carries its
		// own origin, not a browser's.
		const trusted = provideKey(app.id, 'trustedOrigins');
		if (keys.has(trusted)) {
			const internal = (byId.get(app.id)?.callers ?? [])
				.map((caller) => appById.get(caller))
				.filter((caller): caller is StackApp => caller?.kind === 'rest-api')
				.map((caller) => `http://${caller.name}:${caller.port}`);
			const origins = [
				...(values[trusted] ?? '').split(',').filter(Boolean),
				...internal,
			];
			values[trusted] = [...new Set(origins)].join(',');
		}

		// Telemetry: the stage's own `OTEL_*`, or the stack's OpenObserve.
		app.env = {
			...values,
			...otelEnv({ ...custom, ...logs?.appEnv }, app.name),
			NODE_ENV: 'production',
			PORT: String(app.port),
			STAGE: stage,
		};

		for (const [key, value] of Object.entries(app.env)) {
			if (/[\r\n]/.test(value)) throw new EnvValueMultiline(app.name, key);
		}
	}

	// A worker reaches every surface across the compose network: it is never
	// one, so no address is its own.
	for (const worker of input.buildOnly ? [] : workers) {
		const keys =
			workerEnvKeys(manifest, worker.id, input.runnables) ?? new Set();
		worker.env = {
			...valuesFor(
				{ name: worker.name, id: worker.id, kind: 'rest-api' },
				keys,
			),
			...otelEnv({ ...custom, ...logs?.appEnv }, worker.name),
			NODE_ENV: 'production',
			PORT: String(worker.port),
			STAGE: stage,
		};
		for (const [key, value] of Object.entries(worker.env)) {
			if (/[\r\n]/.test(value)) throw new EnvValueMultiline(worker.name, key);
		}
	}

	const layout = input.layout ?? defaultLayout(workspace.root);
	const compose = stackFile({
		project,
		plan,
		infra,
		apps,
		workers,
		master: credential.master,
		...(storage ? { storage } : {}),
		...(logs ? { logs } : {}),
		...(redis ? { redis } : {}),
		https,
		http,
		composeDir: join(workspace.root, stackDir(stage)),
		buildRoot: layout.buildRoot,
		workspaceRoot: workspace.root,
		envFiles: !input.buildOnly,
	});

	const caddyfile = edgeCaddyfile(
		[
			...apps.map((app) => ({
				host: app.host,
				upstream: `${app.name}:${app.port}`,
			})),
			...[...fileServers.values()].map(({ site }) => site),
			...(logs?.host && logs.public
				? [
						{
							host: logs.host,
							upstream: `${LOGS_SERVICE}:${LOGS_PORT}`,
							allow: logs.public.allow,
						},
					]
				: []),
		],
		{ local },
	);

	const dockerfiles: Record<string, string> = {};
	for (const app of apps) {
		if (!app.build) continue;
		// The same Dockerfile `gkm docker` writes: the image is built inside
		// Docker from a pruned slice of the build root, and nothing is built
		// here first.
		dockerfiles[app.build.dockerfile] = appDockerfile(
			app.name,
			workspace.apps[app.name]!,
			{
				layout,
				workspaceRoot: workspace.root,
				apps: workspace.apps,
				manifest,
				cache: STACK_CACHE,
			},
		);
	}
	for (const worker of workers) {
		if (!worker.build) continue;
		dockerfiles[worker.build.dockerfile] = workerDockerfile(
			{ id: worker.id, name: worker.name, app: worker.host },
			workspace.apps[worker.host]!,
			{ layout, workspaceRoot: workspace.root, cache: STACK_CACHE },
		);
	}

	return {
		project,
		stage,
		local,
		apps,
		workers,
		infra,
		compose,
		caddyfile,
		dockerfiles,
		plan,
		credential,
		...(storage ? { storage } : {}),
		devServices: local ? [] : devServicesUsed(services),
		...(logs ? { logs } : {}),
		...(redis ? { redis } : {}),
	};
}

/**
 * The mail and storage constructs a deployed stage's apps read, with who
 * reads each — and every file server's bucket, which serves it whether or
 * not an app reads it directly.
 */
function serviceDeclarations(
	plan: Plan,
	reads: ReadonlyMap<string, readonly string[]>,
	owners: ReadonlyMap<string, PlannedResource>,
): ServiceDeclaration[] {
	const byId = new Map(plan.resources.map((r) => [r.id, r]));
	const readers = new Map<string, Set<string>>();
	const add = (id: string, app?: string) => {
		const set = readers.get(id) ?? new Set<string>();
		if (app) set.add(app);
		readers.set(id, set);
	};

	for (const [app, keys] of reads) {
		for (const key of keys) {
			const owner = owners.get(key);
			if (!owner || !SERVICE_KINDS[owner.kind]) continue;
			// The inbox is Mailpit's own, never a deployed stage's to set.
			if (owner.kind === 'email' && key.endsWith('_INBOX_URL')) continue;
			add(owner.id, app);
			if (owner.kind === 'file-server' && owner.of) add(owner.of);
		}
	}

	return [...readers].flatMap(([id, apps]) => {
		const resource = byId.get(id);
		const kind = resource && SERVICE_KINDS[resource.kind];
		if (!resource || !kind) return [];
		return [
			{
				id,
				kind,
				...(resource.of ? { of: resource.of } : {}),
				apps: [...apps].sort(),
			},
		];
	});
}

/** The stack's MinIO's value for one of the S3 client's keys. */
function storageValue(
	key: string,
	storage: StackStorage | undefined,
): string | undefined {
	if (!storage) return undefined;
	if (key === 'AWS_ACCESS_KEY_ID') return storage.user;
	if (key === 'AWS_SECRET_ACCESS_KEY') return storage.password;
	if (key === 'AWS_REGION') return MINIO_REGION;
	return undefined;
}

/** Which bucket an S3 credential key belongs to — the first one declared. */
function storageOwner(key: string, plan: Plan): PlannedResource | undefined {
	if (!(STORAGE_KEYS as readonly string[]).includes(key)) return undefined;
	return plan.resources.find((r) => r.kind === 'objects');
}

/** The apps a stack runs: every API and every site, at its stage address. */
function stackApps(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	plan: Plan,
	options: {
		local: boolean;
		stage: string;
		https: number;
		identity: DeployIdentity;
		images: StackInput['images'];
	},
): StackApp[] {
	const apps: StackApp[] = [];
	const resources = new Map(plan.resources.map((r) => [r.id, r]));

	for (const [id, declaration] of Object.entries(manifest)) {
		if (declaration.kind !== 'rest-api' && declaration.kind !== 'site')
			continue;

		const name = appKey(id);
		const app = workspace.apps[name];
		const resource = resources.get(id);
		if (!app || !resource || !app.port) continue;

		const host = hostOf(name, app, workspace, resource, options);
		const site = declaration.kind === 'site';
		const tag = site
			? siteTag(options.images.tag, options.stage)
			: options.images.tag;
		const ref = validateImageRef(
			imageRef(options.identity, name, options.images.registry, tag),
		);

		apps.push({
			app: name,
			name,
			id,
			kind: declaration.kind,
			path: app.path,
			port: app.port,
			host,
			url: `https://${host}${options.local && options.https !== 443 ? `:${options.https}` : ''}`,
			ref,
			tag,
			...(options.images.mode === 'build'
				? {
						build: {
							dockerfile: `${stackDir(options.stage)}/Dockerfile.${name}`,
						},
					}
				: {}),
		});
	}

	return apps.sort((a, b) => a.name.localeCompare(b.name));
}

/** Each worker's image, and where it is built from. */
function stackWorkers(
	units: readonly WorkerUnit[],
	options: {
		stage: string;
		identity: DeployIdentity;
		images: StackInput['images'];
	},
): StackWorker[] {
	return units.map((unit) => ({
		app: unit.name,
		name: unit.name,
		id: unit.id,
		host: unit.app,
		port: WORKER_PORT,
		ref: validateImageRef(
			imageRef(
				options.identity,
				unit.name,
				options.images.registry,
				options.images.tag,
			),
		),
		tag: options.images.tag,
		...(options.images.mode === 'build'
			? {
					build: {
						dockerfile: `${stackDir(options.stage)}/Dockerfile.${unit.name}`,
					},
				}
			: {}),
	}));
}

/**
 * The host an app answers on for a stage: the `gkm dev` edge's
 * `*.localhost` names for the local stage, and the stage's domain — by the
 * same rule a deploy follows — for any other.
 */
function hostOf(
	name: string,
	app: NormalizedAppConfig,
	workspace: NormalizedWorkspace,
	resource: PlannedResource,
	options: { local: boolean; stage: string },
): string {
	if (options.local) return hostFor(resource, workspace.name);

	return resolveHost(
		name,
		app,
		options.stage,
		workspace.deploy?.domains,
		isMainFrontendApp(name, app, workspace.apps),
	);
}

/** The compose document: the infrastructure, the apps, and the edge. */
function stackFile(options: {
	project: string;
	plan: Plan;
	infra: readonly string[];
	apps: readonly StackApp[];
	workers: readonly StackWorker[];
	master: string;
	storage?: StackStorage;
	logs?: StackLogs;
	redis?: StackRedis;
	https: number;
	http: number;
	composeDir: string;
	buildRoot: string;
	workspaceRoot: string;
	/** Whether services read env files — not in a stack that only builds. */
	envFiles: boolean;
}): StackFile {
	const { project, plan, apps } = options;
	// What reconcile defines; OpenObserve is the stack's own.
	const infra = options.infra.filter((name) => name !== LOGS_SERVICE);

	// Reconcile's definitions — images, health checks, volumes — with nothing
	// published to the host. Ports are allocation's business there; here the
	// edge is the only way in.
	const derived = composeFor(
		{ ...plan, containers: [...infra] },
		{
			project,
			ports: Object.fromEntries(
				portKeys(infra, plan.fakes).map((key) => [key, 0]),
			),
		},
	);

	const services: Record<string, StackService> = {};
	const volumes: Record<string, Record<string, never>> = {
		...derived.volumes,
		'caddy-data': {},
		'caddy-config': {},
		...(options.logs ? { 'openobserve-data': {} } : {}),
	};

	for (const name of infra) {
		const {
			ports: _ports,
			depends_on,
			profiles: _profiles,
			...service
		} = derived.services[name]!;
		services[name] = {
			...service,
			...(depends_on?.length
				? {
						depends_on: Object.fromEntries(
							depends_on.map((dep) => [dep, HEALTHY]),
						),
					}
				: {}),
		};
	}

	const postgres = services.postgres;
	if (postgres) {
		postgres.environment = {
			...postgres.environment,
			POSTGRES_PASSWORD: options.master,
		};
		// Loopback only, on a port Docker picks: gkm creates the databases and
		// roles and runs the migrations from this machine, and nothing else
		// should reach the database from outside the stack.
		postgres.ports = ['127.0.0.1::5432'];
	}

	const minio = services.minio;
	if (minio && options.storage) {
		minio.environment = {
			...minio.environment,
			MINIO_ROOT_USER: options.storage.user,
			MINIO_ROOT_PASSWORD: options.storage.password,
		};
		// Loopback only, like Postgres: gkm creates the buckets and their
		// policies from this machine. The apps reach it on the network, and a
		// browser through a file server's host on the edge.
		minio.ports = ['127.0.0.1::9000'];
	}

	// Its own definition rather than reconcile's: `gkm dev`'s Redis is an
	// open, unbounded scratch store; this one is a production cache.
	if (services[REDIS_SERVICE] && options.redis) {
		services[REDIS_SERVICE] = redisService(options.redis);
	}

	// Started with the infrastructure, but nothing waits on it: an app whose
	// telemetry cannot be delivered still serves.
	if (options.logs) services[LOGS_SERVICE] = logsService(options.logs);

	for (const app of apps) {
		services[app.name] = {
			image: app.ref,
			...(app.build
				? {
						build: {
							...composeBuildPaths({
								composeDir: options.composeDir,
								buildRoot: options.buildRoot,
								workspaceRoot: options.workspaceRoot,
								dockerfile: app.build.dockerfile,
							}),
							...(app.build.args ? { args: app.build.args } : {}),
						},
					}
				: {}),
			restart: 'unless-stopped',
			// A site is a bundle and reads nothing at runtime; a backend reads
			// exactly the keys in its own file.
			...(app.kind === 'rest-api'
				? {
						env_file: [{ path: `./${app.name}.env`, format: 'raw' as const }],
						...(infra.length
							? {
									depends_on: Object.fromEntries(
										infra.map((name) => [name, HEALTHY]),
									),
								}
							: {}),
					}
				: {}),
			healthcheck: probe(app.port, app.kind === 'site' ? '/' : '/health'),
		};
	}

	// A worker: no route, no published port — its health check is Docker's.
	for (const worker of options.workers) {
		services[worker.name] = {
			image: worker.ref,
			...(worker.build
				? {
						build: composeBuildPaths({
							composeDir: options.composeDir,
							buildRoot: options.buildRoot,
							workspaceRoot: options.workspaceRoot,
							dockerfile: worker.build.dockerfile,
						}),
					}
				: {}),
			restart: 'unless-stopped',
			env_file: [{ path: `./${worker.name}.env`, format: 'raw' as const }],
			...(infra.length
				? {
						depends_on: Object.fromEntries(
							infra.map((name) => [name, HEALTHY]),
						),
					}
				: {}),
			healthcheck: probe(worker.port, '/health'),
		};
	}

	services.caddy = {
		image: DEFAULT_IMAGES.caddy!,
		restart: 'unless-stopped',
		ports: [`${options.https}:443`, `${options.http}:80`],
		volumes: [
			'./Caddyfile:/etc/caddy/Caddyfile:ro',
			'caddy-data:/data',
			'caddy-config:/config',
		],
		depends_on: Object.fromEntries(apps.map((app) => [app.name, HEALTHY])),
		healthcheck: {
			test: ['CMD', 'caddy', 'version'],
			interval: '10s',
			timeout: '5s',
			retries: 5,
		},
	};

	for (const service of Object.values(services)) {
		if (!options.envFiles) delete service.env_file;
		service.logging = {
			driver: LOG_ROTATION.driver,
			options: { ...LOG_ROTATION.options },
		};
	}

	return { name: project, services, volumes };
}

/**
 * A build without a layout: the workspace is the build root, with pnpm.
 * What a caller that never looked at the filesystem gets.
 */
function defaultLayout(root: string): ImageLayout {
	return {
		buildRoot: root,
		gkmRoot: '.',
		tools: {
			packageManager: 'pnpm',
			turboVersion: TURBO_VERSION,
			monorepo: true,
		},
		gkmPaths: ['gkm.config.*'],
	};
}

/** Render an app's env file: one `KEY=value` per line, read raw by compose. */
export function envFile(env: Readonly<Record<string, string>>): string {
	return `${Object.entries(env)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}=${value}`)
		.join('\n')}\n`;
}
