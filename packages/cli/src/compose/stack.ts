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

import {
	type ConstructManifest,
	provideKey,
	provisionOrder,
	publicEnvFor,
} from '@geekmidas/manifest';
import { isMainFrontendApp, resolveHost } from '../deploy/domain.js';
import { type DeployIdentity, imageRef } from '../deploy/identity.js';
import { validateImageRef } from '../docker/imageRef.js';
import { siteDockerfile } from '../docker/index.js';
import {
	generateSlimDockerfile,
	type PackageManager,
} from '../docker/templates.js';
import { appEnvKeys, networkEnv } from '../reconcile/apps.js';
import { hostFor } from '../reconcile/caddyfile.js';
import { type ComposeService, composeFor } from '../reconcile/compose.js';
import { DEFAULT_IMAGES, portKeys } from '../reconcile/containers.js';
import { localRolePassword } from '../reconcile/env.js';
import { type Plan, type PlannedResource, planFor } from '../reconcile/plan.js';
import type { StageSecrets } from '../secrets/types.js';
import { DEFAULT_CACHE, DEFAULT_EVENTS } from '../types.js';
import { appKey } from '../workspace/derive.js';
import type {
	NormalizedAppConfig,
	NormalizedWorkspace,
} from '../workspace/types.js';
import { edgeCaddyfile } from './caddyfile.js';
import { type AppImage, siteTag } from './images.js';

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
 * Object storage is the stage's own — an externally hosted bucket whose URL
 * the stage's secrets hold — and so is a deployed stage's mail. The AWS
 * emulator never applies: a stack is a server target, whose events are
 * pg-boss.
 */
const NOT_RUN: Readonly<Record<string, true>> = {
	minio: true,
	localstack: true,
	caddy: true,
};

/** Kinds whose `<ID>_URL` a stage must be given, because nothing here runs them. */
const EXTERNAL_KINDS: Readonly<Record<string, true>> = {
	objects: true,
	'file-server': true,
};

/** The S3 client's credentials, read beside a bucket's URL when it has them. */
const STORAGE_KEYS = [
	'AWS_ACCESS_KEY_ID',
	'AWS_SECRET_ACCESS_KEY',
	'AWS_REGION',
] as const;

/** Each image's build, where the stack builds rather than pulls. */
export interface AppBuild {
	/** Relative to the workspace root, which is the build context. */
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

/** A service as the stack's compose file defines it. */
export interface StackService {
	image: string;
	build?: {
		context: string;
		dockerfile: string;
		args?: Record<string, string>;
	};
	restart?: string;
	command?: string;
	env_file?: { path: string; format: 'raw' }[];
	environment?: Record<string, string>;
	ports?: string[];
	volumes?: string[];
	depends_on?: Record<string, { condition: 'service_healthy' }>;
	healthcheck?: ComposeService['healthcheck'];
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
}

export interface StackInput {
	workspace: NormalizedWorkspace;
	manifest: ConstructManifest;
	/** Each owner's runnables' edges, from discovery. */
	runnables?: Readonly<Record<string, readonly string[]>>;
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
	/** The edge's published ports. 443 and 80 by default. */
	ports?: { https?: number; http?: number };
	/** For builds: the package manager the site Dockerfiles install with. */
	packageManager?: PackageManager;
	/** For builds: each app's package name, which turbo prunes by. */
	packages?: Readonly<Record<string, string>>;
}

/** A bucket the stack needs and the stage was not given. */
export class BucketNotConfigured extends Error {
	constructor(
		readonly app: string,
		readonly id: string,
		readonly key: string,
		readonly stage: string,
	) {
		super(
			`'${app}' uses the bucket '${id}', and gkm compose runs no object ` +
				`storage: the stage needs an externally hosted bucket. Set its URL in ` +
				`the stage's secrets: gkm secrets:set ${key} 's3://…' --stage ${stage}`,
		);
		this.name = 'BucketNotConfigured';
	}
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
				`database passwords are derived from it. Run gkm compose without ` +
				`--dry-run once, or gkm deploy, to generate it.`,
		);
		this.name = 'StageSeedMissing';
	}
}

/** A workspace with no API and no site to run. */
export class NothingToCompose extends Error {
	constructor(readonly root: string) {
		super(
			`${root} declares no RestApi and no site, so a stack would run nothing. ` +
				`Workers and mobile apps are not run by gkm compose yet.`,
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
	// one machine running containers, so the cache is a table in the declared
	// database and events are pg-boss beside it.
	const plan = planFor(manifest, stage, provisionOrder(manifest), {
		localStage: workspace.stages.local,
		events: DEFAULT_EVENTS.server,
		cache: DEFAULT_CACHE.server,
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

	const infra = plan.containers
		.filter((c) => !NOT_RUN[c])
		// A deployed stage sends real mail, through whatever its MAIL_URL names.
		.filter((c) => local || c !== 'mailpit')
		.sort();

	const apps = stackApps(workspace, manifest, plan, {
		local,
		stage,
		https,
		identity,
		images: input.images,
	});
	if (apps.length === 0) throw new NothingToCompose(workspace.root);

	// Every key the stage resolves, twice: with each app at its public address
	// — what a browser is handed, and what an app says it is — and with each on
	// the compose network, which is how one service reaches another.
	const derivation = {
		project: workspace.name,
		master: credential.master,
		...(credential.seed ? { seed: credential.seed } : {}),
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
		app: StackApp,
		key: string,
		owner: PlannedResource | undefined,
	): string | undefined => {
		if (owner && EXTERNAL_KINDS[owner.kind] && key === owner.envKey) {
			const value = custom[key];
			if (value === undefined) {
				throw new BucketNotConfigured(app.name, owner.id, key, stage);
			}
			return value;
		}

		// Supplied by somebody: a third party's credentials, and — deployed —
		// the mail server a stage sends through and the secrets it generated.
		if (owner && suppliedBy(owner, key, local)) {
			const value = custom[key];
			if (value === undefined) {
				throw new StageSecretMissing(app.name, key, stage);
			}
			return value;
		}

		// Set by hand wins over derived: it is the stage saying what it is.
		if (custom[key] !== undefined) return custom[key];

		// A backend reaches a sibling surface on the compose network; its own
		// address is the public one, which is what it builds links on. A site
		// runs in a browser, which has only the public addresses.
		const surface = surfaceUrls.get(key);
		if (app.kind === 'rest-api' && surface && surface !== app.id) {
			return inside[key];
		}

		return outside[key];
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

		const keys = appEnvKeys(manifest, app.name, input.runnables) ?? new Set();
		const values: Record<string, string> = {};
		for (const key of [...keys].sort()) {
			const owner = owners.get(key) ?? storageOwner(key, plan);
			// A deployed stage has no inbox: Mailpit runs only locally.
			if (!local && owner?.kind === 'email' && key.endsWith('_INBOX_URL'))
				continue;
			if ((STORAGE_KEYS as readonly string[]).includes(key)) {
				// The bucket is the stage's own, so its credentials are too —
				// when it has any: on AWS an instance role may stand in for them.
				if (custom[key] !== undefined) values[key] = custom[key];
				continue;
			}

			const value = valueFor(app, key, owner);
			if (value !== undefined) values[key] = value;
		}

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

		app.env = {
			...values,
			NODE_ENV: 'production',
			PORT: String(app.port),
			STAGE: stage,
		};

		for (const [key, value] of Object.entries(app.env)) {
			if (/[\r\n]/.test(value)) throw new EnvValueMultiline(app.name, key);
		}
	}

	const compose = stackFile({
		project,
		plan,
		infra,
		apps,
		master: credential.master,
		https,
		http,
	});

	const caddyfile = edgeCaddyfile(
		apps.map((app) => ({
			host: app.host,
			upstream: `${app.name}:${app.port}`,
		})),
		{ local },
	);

	const dockerfiles: Record<string, string> = {};
	for (const app of apps) {
		if (!app.build) continue;
		dockerfiles[app.build.dockerfile] =
			app.kind === 'site'
				? siteDockerfile(app.name, workspace.apps[app.name]!, {
						turboPackage: input.packages?.[app.name] ?? app.name,
						packageManager: input.packageManager ?? 'pnpm',
						manifest,
					})
				: generateSlimDockerfile({
						imageName: app.name,
						baseImage: 'node:22-alpine',
						port: app.port,
						healthCheckPath: '/health',
						prebuilt: true,
						packageManager: input.packageManager ?? 'pnpm',
						bundle: `${app.path}/.gkm/server/dist/server.mjs`,
					});
	}

	return {
		project,
		stage,
		local,
		apps,
		infra,
		compose,
		caddyfile,
		dockerfiles,
		plan,
		credential,
	};

	/** Whether only the stage's secrets can supply `key` to `owner`. */
	function suppliedBy(
		owner: PlannedResource,
		key: string,
		isLocal: boolean,
	): boolean {
		if (owner.kind === 'credential') return true;
		if (owner.kind === 'external-api')
			return key === provideKey(owner.id, 'credentials');
		if (isLocal) return false;
		// Deployed, nothing here derives a secret: the stage generated each one
		// once, and every run reads the same value back.
		if (owner.kind === 'secret' || owner.kind === 'encryption') return true;
		return owner.kind === 'email' && !key.endsWith('_INBOX_URL');
	}
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
	master: string;
	https: number;
	http: number;
}): StackFile {
	const { project, plan, infra, apps } = options;

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

	for (const app of apps) {
		services[app.name] = {
			image: app.ref,
			...(app.build
				? {
						build: {
							context: '../../..',
							dockerfile: app.build.dockerfile,
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

	return { name: project, services, volumes };
}

/** Render an app's env file: one `KEY=value` per line, read raw by compose. */
export function envFile(env: Readonly<Record<string, string>>): string {
	return `${Object.entries(env)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, value]) => `${key}=${value}`)
		.join('\n')}\n`;
}
