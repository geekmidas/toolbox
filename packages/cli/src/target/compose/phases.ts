/**
 * The compose target's phases: a stage as one Docker Compose stack behind
 * Caddy, on the machine the deploy runs on.
 *
 * The order is the point of this file, and the rules it keeps are these:
 *
 * - A tag is checked before anything happens (`validate`). Every app's image
 *   is asked of the registry first; one missing image stops the run naming
 *   them all, and nothing is written, pulled or started.
 * - The databases exist before the apps do (`provision`). Postgres comes up
 *   alone, its databases, roles and grants are created and its migrations
 *   applied from this machine, and only then do the apps start — so an app
 *   never boots against a schema that is not there yet.
 * - What a stage runs is recorded (`release`). Each app's image, the tag it
 *   was released under and the digest it resolved to are written to the
 *   stage's state, so "what is this stage running" has an exact answer.
 * - What was started answers (`verify`): each app is asked through Caddy,
 *   over HTTPS, with the certificate verified.
 *
 * Every image is built inside Docker from a pruned slice of the build root —
 * the same Dockerfiles `gkm docker` writes — so nothing is built on this
 * machine before `docker compose build`.
 *
 * Docker, the registry, Postgres and the health probe are
 * injected, so the rules are asserted without a daemon; the defaults are the
 * real ones.
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { stringify } from 'yaml';
import {
	type ComposeDocker,
	dockerCompose,
	type StackRef,
} from '../../compose/docker';
import { assertImagesExist } from '../../compose/images';
import {
	type ComposeStack,
	composeProject,
	composeStack,
	credentialsFile,
	EDGE_PORT_ENV,
	envFile,
	type StackApp,
	stackDir,
	withBuildCredentials,
} from '../../compose/stack';
import {
	type BuildCredentials,
	credentialsBuildArg,
	credentialsFileContent,
} from '../../deploy/docker.js';
import type { ResourceChange } from '../../deploy/events';
import { withGeneratedSecrets } from '../../deploy/generated.js';
import { DeployJournal } from '../../deploy/journal';
import {
	createEmptyState,
	type DeployedImage,
	recordRelease,
} from '../../deploy/state.js';
import type { DeployResult } from '../../deploy/types';
import { ensureDockerignore } from '../../docker/index.js';
import { imageLayout } from '../../docker/layout.js';
import { findBuildRoot } from '../../docker/templates.js';
import { migrateDatabases } from '../../migrate/databases.js';
import { pgClient } from '../../reconcile/clients.js';
import { primaryPortKey } from '../../reconcile/containers.js';
import { type ConstructSource, discover } from '../../reconcile/discover.js';
import { envFor } from '../../reconcile/env.js';
import {
	applyPostgres,
	postgresStatements,
} from '../../reconcile/provision.js';
import { constructGlobs } from '../../reconcile/workspace.js';
import { runOutput } from '../../run';
import { encryptSecrets } from '../../secrets/encryption.js';
import { initStageSecrets } from '../../secrets/storage.js';
import type { StageSecrets } from '../../secrets/types.js';
import type { NormalizedWorkspace } from '../../workspace/types.js';
import type { DeployPhaseContext } from '../types';
import {
	ComposeAppsUnhealthy,
	type HealthProbe,
	httpsProbe,
	isHealthy,
} from './health';

/** Every phase's context: the compose target takes no options. */
export type ComposeContext = DeployPhaseContext<undefined>;

/** What the target needs from outside the process, so tests can stand in. */
export interface ComposeDeps {
	docker: ComposeDocker;
	/** The commit a build is tagged with. */
	revision: (root: string) => Promise<string>;
	/** The Postgres client provisioning and migrations connect through. */
	sql: typeof pgClient;
	/** Apply the stage's migrations — `migrateDatabases` by default. */
	migrate: typeof migrateDatabases;
	/** Ask one app, through the edge, whether it answers. */
	probe: HealthProbe;
	/** How many times each app is asked before it counts as down. */
	healthAttempts: number;
	/** How long to wait between two asks of one app. */
	healthIntervalMs: number;
	/** Where the edge's ports are read from (`GKM_COMPOSE_HTTPS_PORT`, …). */
	env: NodeJS.ProcessEnv;
}

/** One app's image, as the stage runs it. */
export interface ComposeImage {
	ref: string;
	tag: string;
	digest?: string;
}

/** A compose deploy in progress: what `validate` found, and what follows. */
export interface ComposeRun {
	/** Build the images from this checkout, or pull the ones a tag names. */
	mode: 'build' | 'pull';
	stack: ComposeStack;
	/** The stack's directory, absolute: `.gkm/compose/<stage>`. */
	dir: string;
	ref: StackRef;
	/** The stage's secrets, with whatever a deployed stage generates once. */
	secrets: StageSecrets | null;
	/** The names of what was generated, written back in `provision`. */
	generated: string[];
	/** Each app's image as the stage's state last recorded it. */
	previous: Record<string, DeployedImage>;
	/** Every file written, absolute. */
	files: string[];
	/**
	 * Each backend's encrypted credentials, for a build: written beside the
	 * compose file as the BuildKit secret its image embeds them from.
	 */
	credentials: Record<string, BuildCredentials>;
	/** Each app's image, once built or pulled. */
	images: Record<string, ComposeImage>;
	/** Every resource the run touched, or for a dry run would. */
	changes: ResourceChange[];
}

/** A port variable that does not hold a port. */
export class EdgePortInvalid extends Error {
	constructor(
		readonly variable: string,
		readonly value: string,
	) {
		super(
			`${variable}=${value} is not a port. Set it to a number between 1 and 65535, or unset it for the default.`,
		);
		this.name = 'EdgePortInvalid';
	}
}

/** A build with no commit to tag its images with. */
export class NoGitRevision extends Error {
	constructor(readonly root: string) {
		super(
			`Images built here are tagged with the commit they were built from, ` +
				`and ${root} is not in a git repository with a commit. Commit, or ` +
				`pass --tag to name the images yourself.`,
		);
		this.name = 'NoGitRevision';
	}
}

/** The commit HEAD is at, short — and `-dirty` when the tree has changes. */
export async function gitRevision(root: string): Promise<string> {
	let sha: string;
	try {
		sha = (
			await runOutput('git', ['rev-parse', '--short', 'HEAD'], { cwd: root })
		).trim();
	} catch {
		throw new NoGitRevision(root);
	}
	if (!sha) throw new NoGitRevision(root);

	// An image built from uncommitted changes is not the commit's image, and a
	// tag that said it was would be the one thing worse than no tag.
	const status = await runOutput('git', ['status', '--porcelain'], {
		cwd: root,
	}).catch(() => '');
	return status.trim() ? `${sha}-dirty` : sha;
}

/** The edge's ports, from the environment — 443 and 80 when unset. */
export function edgePorts(env: NodeJS.ProcessEnv = process.env): {
	https: number;
	http: number;
} {
	const read = (variable: string, fallback: number) => {
		const value = env[variable];
		if (value === undefined || value === '') return fallback;
		const port = Number(value);
		if (!Number.isInteger(port) || port < 1 || port > 65_535) {
			throw new EdgePortInvalid(variable, value);
		}
		return port;
	};
	return {
		https: read(EDGE_PORT_ENV.https, 443),
		http: read(EDGE_PORT_ENV.http, 80),
	};
}

/**
 * The real ones. Each app is asked for three minutes before it counts as
 * down: a deployed stage's first ACME certificate can take that long.
 */
export const defaultDeps: ComposeDeps = {
	docker: dockerCompose,
	revision: gitRevision,
	sql: pgClient,
	migrate: migrateDatabases,
	probe: httpsProbe,
	healthAttempts: 90,
	healthIntervalMs: 2_000,
	env: process.env,
};

// ============================================================================
// validate
// ============================================================================

/**
 * The stack the stage would run, and — for a tag — the registry's word that
 * every image it names exists. Nothing is written: a missing image stops the
 * run here, before a file, a secret or a container is touched.
 */
export async function validateCompose(
	ctx: ComposeContext,
	deps: ComposeDeps,
	forced?: 'build' | 'pull',
): Promise<ComposeRun> {
	const { workspace, stage, identity, tag } = ctx;
	const root = workspace.root;
	const mode = forced ?? (ctx.tagGiven ? 'pull' : 'build');

	// The runnables' edges say which surface reaches which; the manifest the
	// run discovered has the declarations but not them.
	const runnables: Record<string, string[]> = {};
	const manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: root,
		runnables,
	});

	const { secrets, generated } = await stageSecrets(ctx, manifest);

	const masterKeys: Record<string, { masterKey: string; buildArg: string }> =
		{};

	// Where and with what the images are built — only asked when they are.
	const layout = mode === 'build' ? imageLayout(workspace) : undefined;

	const composed = composeStack({
		workspace,
		manifest,
		runnables,
		stage,
		identity,
		images: {
			mode,
			tag,
			...(workspace.deploy?.registry
				? { registry: workspace.deploy.registry }
				: {}),
		},
		secrets,
		ports: edgePorts(deps.env),
		...(layout ? { layout } : {}),
	});

	// Each backend built here embeds its environment, encrypted, the way a
	// Dokploy deploy builds one: handed to the build as a secret, decrypted at
	// runtime with the key its env file holds.
	const credentials: Record<string, BuildCredentials> = {};
	if (mode === 'build') {
		for (const app of composed.apps) {
			if (app.kind !== 'rest-api' || !app.env || !app.build) continue;
			const { encrypted, iv, masterKey } = encryptSecrets(app.env);
			credentials[app.name] = { encrypted, iv };
			ctx.secrets.mask(masterKey);
			masterKeys[app.name] = {
				masterKey,
				buildArg: credentialsBuildArg({ encrypted, iv }),
			};
		}
	}
	const stack = withBuildCredentials(composed, masterKeys);

	// A release is all of its images or none of them. A dry run asks nothing,
	// so it can be run without a registry login.
	if (mode === 'pull' && !ctx.dryRun) {
		await assertImagesExist(deps.docker, tag, stack.apps);
	}

	const dir = join(root, stackDir(stage));
	// What each app ran before this release: its current release, by the same
	// record the Dokploy target keeps, so a rollback reads one shape for both.
	const previous = Object.fromEntries(
		Object.entries((await ctx.state.read(stage))?.state.releases ?? {}).map(
			([name, releases]): [string, DeployedImage] => {
				const { ref, tag, digest } = releases.current;
				return [
					name,
					{ ref, ...(tag ? { tag } : {}), ...(digest ? { digest } : {}) },
				];
			},
		),
	);

	return {
		mode,
		stack,
		dir,
		ref: {
			project: composeProject(identity),
			file: join(dir, 'docker-compose.yml'),
			cwd: root,
			output: ctx.childOutput,
			signal: ctx.signal,
		},
		secrets,
		generated,
		previous,
		files: [],
		credentials,
		images: {},
		changes: [],
	};
}

/**
 * The stage's secrets — and, for a deployed stage, everything it generates
 * once: its seed, and each declared secret and keyring. Kept only once the
 * run goes ahead (`provision`), so a dry run, or a tag that is not there,
 * leaves the stage's secrets as it found them.
 */
async function stageSecrets(
	ctx: ComposeContext,
	manifest: ConstructManifest,
): Promise<{ secrets: StageSecrets | null; generated: string[] }> {
	const stored = await ctx.secrets.read();
	if (ctx.stage === ctx.workspace.stages.local) {
		return { secrets: stored, generated: [] };
	}

	const { secrets, generated } = withGeneratedSecrets(
		stored ?? initStageSecrets(ctx.stage),
		manifest,
	);
	// Read through the store they are masked; made up here, they are not yet.
	if (secrets.seed) ctx.secrets.mask(secrets.seed);
	for (const value of Object.values(secrets.custom ?? {})) {
		ctx.secrets.mask(value);
	}
	return { secrets, generated };
}

// ============================================================================
// plan (dry run)
// ============================================================================

/**
 * A dry run: the stack's files, written so they can be read, and what a real
 * run would do — no image is built or pulled, no container touched, nothing
 * recorded and no secret kept.
 */
export async function planCompose(
	ctx: ComposeContext,
	run: ComposeRun,
): Promise<void> {
	if (run.generated.length > 0) {
		ctx.logger.info(
			`🔑 "${ctx.stage}" has no ${run.generated.join(', ')} yet; this dry run used values it did not keep.`,
		);
	}
	run.files = await writeStack(ctx.cwd, run.dir, run.stack, run.credentials);
	printPlan(ctx, run);

	const planned = (change: ResourceChange) => {
		run.changes.push(change);
		ctx.emit({ type: 'resource.planned', ...change });
	};
	for (const service of run.stack.infra) {
		planned({
			key: `service:${service}`,
			resourceType: 'service',
			action: 'ensure',
		});
	}
	for (const app of run.stack.apps) {
		planned({
			key: `image:${app.name}`,
			resourceType: 'image',
			action: run.mode === 'build' ? 'build' : 'reuse',
			id: app.ref,
		});
		planned({
			key: `service:${app.name}`,
			resourceType: 'service',
			action: run.previous[app.name] ? 'reuse' : 'create',
		});
	}
	planned({ key: 'service:caddy', resourceType: 'service', action: 'ensure' });
}

// ============================================================================
// provision
// ============================================================================

/**
 * What the apps run on: the stage's generated secrets kept, the stack's files
 * written, its infrastructure started, and its databases, roles, grants and
 * migrations applied.
 */
export async function provisionCompose(
	ctx: ComposeContext,
	run: ComposeRun,
	deps: ComposeDeps,
): Promise<void> {
	const { stack, ref } = run;

	if (run.generated.length > 0 && run.secrets) {
		await ctx.secrets.write(run.secrets);
		ctx.logger.info(
			`🔑 Generated for "${ctx.stage}" (${ctx.secrets.store}): ${run.generated.join(', ')}`,
		);
	}

	run.files = await writeStack(ctx.cwd, run.dir, stack, run.credentials);
	printPlan(ctx, run);

	if (stack.infra.length > 0) {
		ctx.logger.info(`\n🗄️  Starting ${stack.infra.join(', ')}…`);
		await deps.docker.up(ref, stack.infra);
		for (const service of stack.infra) {
			applied(ctx, run, {
				key: `service:${service}`,
				resourceType: 'service',
				action: 'ensure',
				id: `${stack.project}/${service}`,
				via: Object.keys(run.previous).length > 0 ? 'recorded' : 'created',
			});
		}
	}

	if (stack.infra.includes('postgres')) {
		await prepareDatabases(ctx, run, deps);
	}
}

/** Create what the plan names in the stack's Postgres, then migrate it. */
async function prepareDatabases(
	ctx: ComposeContext,
	run: ComposeRun,
	deps: ComposeDeps,
): Promise<void> {
	const { stack } = run;
	const workspace: NormalizedWorkspace = ctx.workspace;
	const port = await deps.docker.port(run.ref, 'postgres', 5432);

	const statements = postgresStatements(
		stack.plan,
		workspace.name,
		stack.credential.seed,
	);
	if (statements.length > 0) {
		ctx.logger.info('🗄️  Creating databases, roles and grants…');
		await applyPostgres(deps.sql(port, stack.credential.master), statements);
	}

	// Migrations run here, with the project's own Kysely, the way `gkm
	// migrate` runs them — so the constructs themselves are needed, which
	// only an in-process discovery hands back.
	const sources: Record<string, ConstructSource> = {};
	const manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: workspace.root,
		sources,
	});

	// The owner URLs, on the port published to this machine.
	const env = envFor(stack.plan, {
		ports: { [primaryPortKey('postgres')]: port },
		project: workspace.name,
		master: stack.credential.master,
		...(stack.credential.seed ? { seed: stack.credential.seed } : {}),
	});
	const runs = await deps.migrate({
		root: workspace.root,
		manifest,
		sources,
		env,
	});
	for (const { target, applied } of runs) {
		if (applied.length > 0) {
			ctx.logger.info(`🗄️  ${target.migrations}: applied ${applied.length}`);
		}
	}
}

// ============================================================================
// build
// ============================================================================

/**
 * Each app's image: built from this checkout — inside Docker, every one of
 * them, from a pruned slice of the build root — or pulled at the tag. Nothing
 * live changes.
 */
export async function buildCompose(
	ctx: ComposeContext,
	run: ComposeRun,
	deps: ComposeDeps,
): Promise<void> {
	const { stack, ref } = run;
	const apps = stack.apps.map((app) => app.name);

	if (run.mode === 'build') {
		ctx.logger.info('\n🐳 Building images…');
		await deps.docker.build(ref, apps);
	} else {
		ctx.logger.info(`\n🐳 Pulling ${ctx.tag}…`);
		await deps.docker.pull(ref, apps);
	}

	// What each tag resolved to: the registry's digest for a pulled image, or
	// — for one built here and never pushed — its content id.
	for (const app of stack.apps) {
		const digest = await deps.docker.digest(app.ref);
		run.images[app.name] = {
			ref: app.ref,
			tag: app.tag,
			...(digest ? { digest } : {}),
		};
		ctx.emit({
			type: 'artifact.built',
			app: app.name,
			imageRef: app.ref,
			...(digest ? { digest } : {}),
		});
		run.changes.push({
			key: `image:${app.name}`,
			resourceType: 'image',
			action: run.mode === 'build' ? 'build' : 'reuse',
			id: digest ?? app.ref,
		});
	}
}

// ============================================================================
// release
// ============================================================================

/**
 * The whole stack up — anything it no longer defines removed — and each
 * app's image recorded in the stage's state.
 */
export async function releaseCompose(
	ctx: ComposeContext,
	run: ComposeRun,
	deps: ComposeDeps,
): Promise<void> {
	const { stack, ref } = run;

	ctx.logger.info('\n🚀 Starting the stack…');
	await deps.docker.up(ref);

	if (stack.local) {
		// Caddy's CA is generated on its first start. Copied out so a process —
		// `verify` among them — can trust it without installing anything.
		await deps.docker
			.copyOut(
				ref,
				'caddy',
				'/data/caddy/pki/authorities/local/root.crt',
				caFile(run),
			)
			.catch(() => {});
	}

	await recordImages(ctx, run);

	for (const app of stack.apps) {
		const image = run.images[app.name];
		applied(ctx, run, {
			key: `service:${app.name}`,
			resourceType: 'service',
			action: 'ensure',
			id: `${stack.project}/${app.name}`,
			via: run.previous[app.name] ? 'recorded' : 'created',
		});
		ctx.emit({
			type: 'app.deployed',
			app: app.name,
			applicationId: `${stack.project}/${app.name}`,
			imageRef: image?.ref ?? app.ref,
			url: app.url,
		});
	}

	ctx.logger.info(`\n✅ ${stack.project} is running:`);
	for (const app of stack.apps) {
		ctx.logger.info(`   ${app.name.padEnd(12)} ${app.url}`);
	}
	if (stack.local) {
		ctx.logger.info(
			`\n🔐 Certificates are from Caddy's local CA: NODE_EXTRA_CA_CERTS=${join(stackDir(ctx.stage), 'caddy-root.crt')}`,
		);
	}
}

/**
 * Each app's image in the stage's state — the same `images` a Dokploy deploy
 * records: the ref it runs, the tag it was released under, and the digest
 * the tag resolved to.
 */
async function recordImages(
	ctx: ComposeContext,
	run: ComposeRun,
): Promise<void> {
	const journal = await DeployJournal.open(ctx.state, ctx.stage, () =>
		createEmptyState(ctx.stage, '', ''),
	);
	for (const app of run.stack.apps) {
		const image = run.images[app.name] ?? { ref: app.ref, tag: app.tag };
		recordRelease(journal.state, app.name, image);
	}
	journal.state.identity = ctx.identity.key;
	await journal.save();
}

// ============================================================================
// verify
// ============================================================================

/**
 * Each app asked through Caddy, over HTTPS, the certificate verified: an API
 * at `/health`, a site at `/`. On the local stage the edge is this machine and
 * its certificates are Caddy's internal CA's, so the CA `release` copied out
 * is the one trusted and the request goes to 127.0.0.1.
 */
export async function verifyCompose(
	ctx: ComposeContext,
	run: ComposeRun,
	deps: ComposeDeps,
): Promise<void> {
	const { stack } = run;
	const ca = stack.local
		? await readFile(caFile(run), 'utf-8').catch(() => undefined)
		: undefined;

	ctx.logger.info('\n🩺 Checking each app through Caddy…');
	const results = await Promise.all(
		stack.apps.map((app) =>
			checkApp(ctx, app, deps, { ca, local: stack.local }),
		),
	);

	const down = results
		.filter((result) => !result.healthy)
		.map(({ app, url, last }) => ({ app, url, last }));
	if (down.length > 0) throw new ComposeAppsUnhealthy(stack.project, down);
}

async function checkApp(
	ctx: ComposeContext,
	app: StackApp,
	deps: ComposeDeps,
	options: { ca: string | undefined; local: boolean },
): Promise<{ app: string; url: string; last: string; healthy: boolean }> {
	const url = `${app.url}${app.kind === 'site' ? '/' : '/health'}`;
	let last = 'not asked';

	for (let attempt = 1; attempt <= deps.healthAttempts; attempt++) {
		ctx.signal.throwIfAborted();
		let status: number | undefined;
		try {
			status = await deps.probe({
				url,
				...(options.ca ? { ca: options.ca } : {}),
				...(options.local ? { connectTo: '127.0.0.1' } : {}),
				timeoutMs: 10_000,
				signal: ctx.signal,
			});
			last = `HTTP ${status}`;
		} catch (error) {
			last = error instanceof Error ? error.message : String(error);
		}

		const healthy = status !== undefined && isHealthy(status);
		ctx.emit({
			type: 'health.checked',
			app: app.name,
			url,
			healthy,
			...(status !== undefined ? { status } : {}),
			attempt,
		});
		if (healthy) {
			ctx.logger.info(`   ✓ ${app.name.padEnd(12)} ${url} (${last})`);
			return { app: app.name, url, last, healthy };
		}
		if (attempt < deps.healthAttempts) {
			await new Promise((resolve) =>
				setTimeout(resolve, deps.healthIntervalMs),
			);
		}
	}

	ctx.logger.warn(`   ✗ ${app.name.padEnd(12)} ${url} (${last})`);
	return { app: app.name, url, last, healthy: false };
}

// ============================================================================
// result
// ============================================================================

export function composeResult(
	ctx: ComposeContext,
	run: ComposeRun,
): DeployResult {
	const apps = run.stack.apps.map((app) => {
		const image = run.images[app.name];
		return {
			appName: app.name,
			type: app.kind === 'site' ? ('web' as const) : ('backend' as const),
			success: !ctx.dryRun,
			applicationId: `${run.stack.project}/${app.name}`,
			imageRef: image?.ref ?? app.ref,
			...(image?.digest ? { digest: image.digest } : {}),
			url: app.url,
		};
	});
	return {
		apps,
		projectId: run.stack.project,
		successCount: ctx.dryRun ? 0 : apps.length,
		failedCount: 0,
		stage: ctx.stage,
		identity: ctx.identity.key,
		tag: ctx.tag,
		dryRun: ctx.dryRun,
		environmentId: '',
		skipped: [...ctx.skipped],
		urls: Object.fromEntries(run.stack.apps.map((app) => [app.name, app.url])),
		changes: run.changes,
	};
}

// ============================================================================
// Files
// ============================================================================

function caFile(run: ComposeRun): string {
	return join(run.dir, 'caddy-root.crt');
}

function applied(
	ctx: ComposeContext,
	run: ComposeRun,
	change: ResourceChange & {
		id: string;
		via: 'recorded' | 'resumed' | 'found' | 'created';
	},
): void {
	const { via, ...rest } = change;
	run.changes.push(rest);
	ctx.emit({ type: 'resource.applied', ...rest, via });
}

/** Write the stack's files: owner-only, since the env files hold secrets. */
async function writeStack(
	root: string,
	dir: string,
	stack: ComposeStack,
	credentials: Readonly<Record<string, BuildCredentials>> = {},
): Promise<string[]> {
	await mkdir(dir, { recursive: true, mode: 0o700 });
	await chmod(dir, 0o700);

	const files: string[] = [];
	const write = async (path: string, content: string, mode = 0o644) => {
		await mkdir(dirname(path), { recursive: true });
		await writeFile(path, content, { mode });
		await chmod(path, mode);
		files.push(path);
	};

	await write(join(dir, 'docker-compose.yml'), composeYaml(stack));
	await write(join(dir, 'Caddyfile'), stack.caddyfile);
	for (const app of stack.apps) {
		if (app.env)
			await write(join(dir, `${app.name}.env`), envFile(app.env), 0o600);
	}
	for (const [name, payload] of Object.entries(credentials)) {
		await write(
			join(dir, credentialsFile(name)),
			credentialsFileContent(payload),
			0o600,
		);
	}
	for (const [path, content] of Object.entries(stack.dockerfiles)) {
		await write(join(root, path), content);
	}

	// The build context is the build root, and the env files are under it:
	// its ignore file is what keeps a stage's secrets out of every image's
	// context.
	await ensureDockerignore(findBuildRoot(root));

	return files;
}

function composeYaml(stack: ComposeStack): string {
	const stage = stack.local ? '' : ` --stage ${stack.stage}`;
	return `# Generated by gkm compose from the construct manifest — do not edit.
# The ${stack.stage} stage's APIs and sites behind one Caddy. Each backend
# reads exactly the keys in its own env file beside this one.
#
#   gkm compose${stage}          start or update it
#   gkm compose${stage} --down   stop it
${stringify(stack.compose, { lineWidth: 0, aliasDuplicateObjects: false })}`;
}

function printPlan(ctx: ComposeContext, run: ComposeRun): void {
	const { stack, mode, files } = run;
	ctx.logger.info(`\n🧱 ${stack.project} — stage ${stack.stage}`);
	for (const app of stack.apps) {
		ctx.logger.info(
			`   ${app.name.padEnd(12)} ${app.url.padEnd(40)} ${mode} ${app.ref}`,
		);
	}
	if (stack.infra.length > 0) {
		ctx.logger.info(`   infrastructure: ${stack.infra.join(', ')}`);
	}
	ctx.logger.info(
		`\n📝 Wrote ${files.length} file(s) under ${stackDir(stack.stage)}/`,
	);
}
