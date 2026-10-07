/**
 * `gkm compose` — a workspace's APIs and sites for one stage, as one Docker
 * Compose stack behind Caddy.
 *
 * The order is the point of this file, and the rules it keeps are these:
 *
 * - A tag is checked before anything happens. Every app's image is asked of
 *   the registry first; one missing image stops the run naming them all, and
 *   nothing is written, pulled or started.
 * - The databases exist before the apps do. Postgres comes up alone, its
 *   databases, roles and grants are created and its migrations applied from
 *   this machine, and only then do the apps start — so an app never boots
 *   against a schema that is not there yet.
 * - What a stage runs is recorded. Each app's tag and the digest it resolved
 *   to are written to the stage's state, so "what is this stage running" has
 *   an exact answer.
 *
 * Docker, the registry, the build and the clock are injected, so the rules are
 * asserted without a daemon; the defaults are the real ones.
 */

import { existsSync } from 'node:fs';
import {
	appendFile,
	chmod,
	mkdir,
	readFile,
	writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConstructManifest } from '@geekmidas/manifest';
import { stringify } from 'yaml';
import { loadWorkspaceConfig } from '../config';
import { withGeneratedSecrets } from '../deploy/generated.js';
import { deployIdentity } from '../deploy/identity.js';
import { createStateStore, type StateStore } from '../deploy/StateStore.js';
import { createEmptyState } from '../deploy/state.js';
import { appPackageName } from '../docker/index.js';
import {
	detectPackageManager,
	generateDockerignore,
} from '../docker/templates.js';
import { migrateDatabases } from '../migrate/databases.js';
import { pgClient } from '../reconcile/clients.js';
import { primaryPortKey } from '../reconcile/containers.js';
import { type ConstructSource, discover } from '../reconcile/discover.js';
import { envFor } from '../reconcile/env.js';
import { applyPostgres, postgresStatements } from '../reconcile/provision.js';
import { constructGlobs } from '../reconcile/workspace.js';
import { run, runOutput } from '../run';
import { initStageSecrets } from '../secrets/storage.js';
import { secretsStoreFor } from '../secrets/store.js';
import type { StageSecrets } from '../secrets/types.js';
import { assertDeployedStage } from '../workspace/stages.js';
import type { NormalizedWorkspace } from '../workspace/types.js';
import { type ComposeDocker, dockerCompose, type StackRef } from './docker';
import { assertImagesExist } from './images';
import {
	type ComposeStack,
	composeProject,
	composeStack,
	EDGE_PORT_ENV,
	envFile,
	stackDir,
} from './stack';

export { isMissingManifest } from './docker';
export {
	assertImagesExist,
	ImageTagNotFound,
	RegistryUnreachable,
	siteTag,
} from './images';
export {
	BucketNotConfigured,
	composeStack,
	EnvValueMultiline,
	NothingToCompose,
	StageSecretMissing,
	StageSeedMissing,
} from './stack';

const logger = console;

export interface ComposeOptions {
	/** The stage to run. The project's local stage when absent. */
	stage?: string;
	/** A release tag: pull every app's image at it, build nothing. */
	tag?: string;
	/** Build images here, whatever `--tag` says. */
	build?: boolean;
	/** Pull images, whatever `--tag` says — `latest` when no tag is given. */
	pull?: boolean;
	/** Write the files and print the plan; touch nothing else. */
	dryRun?: boolean;
	/** Stop the stage's stack. Its volumes are kept. */
	down?: boolean;
	/** The workspace — the current directory when absent. */
	cwd?: string;
}

/** What `gkm compose` needs from outside the process, so tests can stand in. */
export interface ComposeDeps {
	docker: ComposeDocker;
	/** Bundle one backend for production, in its own directory. */
	bundle: (appRoot: string) => Promise<void>;
	/** The commit a build is tagged with. */
	revision: (root: string) => Promise<string>;
	/** The Postgres client provisioning and migrations connect through. */
	sql?: typeof pgClient;
	/** Apply the stage's migrations — `migrateDatabases` by default. */
	migrate?: typeof migrateDatabases;
	/** Where the stage's state is kept — the workspace's store by default. */
	state?: (workspace: NormalizedWorkspace) => Promise<StateStore>;
	env?: NodeJS.ProcessEnv;
}

export interface ComposeResult {
	stack: ComposeStack;
	/** Every file written, absolute. */
	files: string[];
	/** Each app's recorded image — absent on a dry run. */
	images?: Record<string, { ref: string; tag: string; digest?: string }>;
}

/** `--build` and `--pull` together ask for two different things. */
export class ComposeModeConflict extends Error {
	constructor() {
		super(
			'--build and --pull ask for opposite things: build images from this ' +
				'checkout, or pull a tag CI pushed. Pass one of them.',
		);
		this.name = 'ComposeModeConflict';
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

/**
 * Bundle a backend with the gkm that is running — the same build a deploy
 * makes, so the image holds one file and no dependencies.
 */
async function bundleWithThisCli(appRoot: string): Promise<void> {
	const entry = process.argv[1];
	if (!entry) return;
	await run(
		process.execPath,
		[
			...process.execArgv,
			entry,
			'build',
			'--provider',
			'server',
			'--production',
		],
		{ cwd: appRoot },
	);
}

const defaultDeps: ComposeDeps = {
	docker: dockerCompose,
	bundle: bundleWithThisCli,
	revision: gitRevision,
};

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

/** `gkm compose`. */
export async function composeCommand(
	options: ComposeOptions = {},
	deps: Partial<ComposeDeps> = {},
): Promise<ComposeResult | undefined> {
	const { docker, bundle, revision } = { ...defaultDeps, ...deps };
	const env = deps.env ?? process.env;

	if (options.build && options.pull) throw new ComposeModeConflict();

	const { workspace } = await loadWorkspaceConfig(options.cwd);
	const root = workspace.root;
	const stage = options.stage ?? workspace.stages.local;
	const local = stage === workspace.stages.local;
	// A stage the project does not deploy to is refused before anything is
	// read from it, so a typo does not become a second environment.
	if (!local) assertDeployedStage(workspace.stages, stage);

	const identity = deployIdentity(workspace, stage);
	const dir = join(root, stackDir(stage));
	const file = join(dir, 'docker-compose.yml');
	const ref: StackRef = { project: composeProject(identity), file, cwd: root };

	if (options.down) {
		await docker.down(ref);
		logger.log(`🛑 Stopped ${ref.project}. Its volumes are kept.`);
		return undefined;
	}

	const sources: Record<string, ConstructSource> = {};
	const runnables: Record<string, string[]> = {};
	const manifest = await discover({
		patterns: constructGlobs(workspace),
		cwd: root,
		sources,
		runnables,
	});

	const mode =
		options.build || (!options.pull && !options.tag) ? 'build' : 'pull';
	const tag =
		options.tag ?? (mode === 'pull' ? 'latest' : await revision(root));

	const { secrets, keep } = await stageSecrets(workspace, manifest, stage);

	const packageManager = detectPackageManager(root);
	const stack = composeStack({
		workspace,
		manifest,
		runnables,
		stage,
		identity,
		images: {
			mode,
			tag,
			...(workspace.deploy?.dokploy?.registry
				? { registry: workspace.deploy.dokploy.registry }
				: {}),
		},
		secrets,
		ports: edgePorts(env),
		packageManager,
		packages: Object.fromEntries(
			Object.entries(workspace.apps).map(([name, app]) => [
				name,
				appPackageName(root, name, app.path),
			]),
		),
	});

	// Before a file is written or a container touched: a release is all of its
	// images or none of them.
	if (mode === 'pull' && !options.dryRun) {
		await assertImagesExist(docker, tag, stack.apps);
	}

	// Kept only once the run is going ahead: a dry run, or a tag that is not
	// there, leaves the stage's secrets as it found them.
	if (options.dryRun) keep.skip();
	else await keep.write();

	const files = await writeStack(root, dir, stack);
	printPlan(stack, mode, files);

	if (options.dryRun) return { stack, files };

	const store = deps.state
		? await deps.state(workspace)
		: await createStateStore({
				config: workspace.state,
				workspaceRoot: root,
				workspaceName: workspace.name,
			});
	const lock = await store.lock(stage, { operation: 'compose' });

	try {
		const apps = stack.apps.map((app) => app.name);

		if (mode === 'build') {
			for (const app of stack.apps.filter((a) => a.kind === 'rest-api')) {
				logger.log(`\n📦 Bundling ${app.name}…`);
				await bundle(join(root, app.path));
			}
			logger.log('\n🐳 Building images…');
			await docker.build(ref, apps);
		} else {
			logger.log(`\n🐳 Pulling ${tag}…`);
			await docker.pull(ref, apps);
		}

		if (stack.infra.length > 0) {
			logger.log(`\n🗄️  Starting ${stack.infra.join(', ')}…`);
			await docker.up(ref, stack.infra);
		}

		if (stack.infra.includes('postgres')) {
			await prepareDatabases(stack, workspace, manifest, sources, {
				docker,
				ref,
				sql: deps.sql ?? pgClient,
				migrate: deps.migrate ?? migrateDatabases,
			});
		}

		logger.log('\n🚀 Starting the stack…');
		await docker.up(ref);

		if (stack.local) {
			// Caddy's CA is generated on its first start. Copied out so a
			// process can trust it without installing anything.
			await docker
				.copyOut(
					ref,
					'caddy',
					'/data/caddy/pki/authorities/local/root.crt',
					join(dir, 'caddy-root.crt'),
				)
				.catch(() => {});
		}

		const images = await recordImages(store, stack, docker, mode);

		logger.log(`\n✅ ${ref.project} is running:`);
		for (const app of stack.apps)
			logger.log(`   ${app.name.padEnd(12)} ${app.url}`);
		if (stack.local) {
			logger.log(
				`\n🔐 Certificates are from Caddy's local CA: NODE_EXTRA_CA_CERTS=${join(stackDir(stage), 'caddy-root.crt')}`,
			);
		}

		return { stack, files, images };
	} finally {
		await lock.release();
	}
}

/**
 * The stage's secrets — and, for a deployed stage, everything it generates
 * once: its seed, and each declared secret and keyring. Written back before
 * anything is derived from them, so the next run derives the same passwords.
 */
async function stageSecrets(
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	stage: string,
): Promise<{
	secrets: StageSecrets | null;
	/** Write what was generated back — or say it was not kept. */
	keep: { write(): Promise<void>; skip(): void };
}> {
	const store = await secretsStoreFor(workspace, stage);
	const stored = await store.read(stage);
	const nothing = { write: async () => {}, skip: () => {} };
	if (stage === workspace.stages.local)
		return { secrets: stored, keep: nothing };

	const { secrets, generated } = withGeneratedSecrets(
		stored ?? initStageSecrets(stage),
		manifest,
	);
	if (generated.length === 0) return { secrets, keep: nothing };

	return {
		secrets,
		keep: {
			async write() {
				await store.write(stage, secrets);
				logger.log(
					`🔑 Generated for "${stage}" (${store.name}): ${generated.join(', ')}`,
				);
			},
			skip() {
				logger.log(
					`🔑 "${stage}" has no ${generated.join(', ')} yet; this dry run used values it did not keep.`,
				);
			},
		},
	};
}

/** Write the stack's files: owner-only, since the env files hold secrets. */
async function writeStack(
	root: string,
	dir: string,
	stack: ComposeStack,
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
	for (const [path, content] of Object.entries(stack.dockerfiles)) {
		await write(join(root, path), content);
	}

	// The build context is the workspace, and the env files are in it: the
	// ignore file is what keeps a stage's secrets out of every image's context.
	await ignoreStacks(root);

	return files;
}

/** Make sure the build context leaves `.gkm/compose` out. */
async function ignoreStacks(root: string): Promise<void> {
	const path = join(root, '.dockerignore');
	if (!existsSync(path)) {
		await writeFile(path, generateDockerignore());
		return;
	}
	const current = await readFile(path, 'utf-8');
	if (/^\/?\.gkm\/compose\/?$|^\/?\.gkm\/?$/m.test(current)) return;
	await appendFile(
		path,
		`${current.endsWith('\n') ? '' : '\n'}\n# gkm compose's stacks: each app's env file holds its stage's secrets\n.gkm/compose\n`,
	);
}

function composeYaml(stack: ComposeStack): string {
	return `# Generated by gkm compose from the construct manifest — do not edit.
# The ${stack.stage} stage's APIs and sites behind one Caddy. Each backend
# reads exactly the keys in its own env file beside this one.
#
#   gkm compose${stack.local ? '' : ` --stage ${stack.stage}`}          start or update it
#   gkm compose${stack.local ? '' : ` --stage ${stack.stage}`} --down   stop it
${stringify(stack.compose, { lineWidth: 0, aliasDuplicateObjects: false })}`;
}

/** Create what the plan names in the stack's Postgres, then migrate it. */
async function prepareDatabases(
	stack: ComposeStack,
	workspace: NormalizedWorkspace,
	manifest: ConstructManifest,
	sources: Record<string, ConstructSource>,
	deps: {
		docker: ComposeDocker;
		ref: StackRef;
		sql: typeof pgClient;
		migrate: typeof migrateDatabases;
	},
): Promise<void> {
	const port = await deps.docker.port(deps.ref, 'postgres', 5432);

	const statements = postgresStatements(
		stack.plan,
		workspace.name,
		stack.credential.seed,
	);
	if (statements.length > 0) {
		logger.log('🗄️  Creating databases, roles and grants…');
		await applyPostgres(deps.sql(port, stack.credential.master), statements);
	}

	// The owner URLs, on the port published to this machine: migrations run
	// here, with the project's own Kysely, the way `gkm migrate` runs them.
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
			logger.log(`🗄️  ${target.migrations}: applied ${applied.length}`);
		}
	}
}

/**
 * Record each app's image in the stage's state: the tag it ran and the digest
 * the tag resolved to — or, for an image built here and never pushed, its
 * content id.
 */
async function recordImages(
	store: StateStore,
	stack: ComposeStack,
	docker: ComposeDocker,
	mode: 'build' | 'pull',
): Promise<Record<string, { ref: string; tag: string; digest?: string }>> {
	if (!(await store.read(stack.stage))) {
		await store.write(stack.stage, createEmptyState(stack.stage, '', ''), {
			expectedVersion: null,
		});
	}

	const images: Record<string, { ref: string; tag: string; digest?: string }> =
		{};
	for (const app of stack.apps) {
		const digest = await docker.digest(app.ref);
		images[app.name] = {
			ref: app.ref,
			tag: app.tag,
			...(digest ? { digest } : {}),
		};
		await store.putResource(stack.stage, {
			key: `compose:${app.name}`,
			type: 'compose-image',
			status: 'ready',
			...(digest ? { id: digest } : {}),
			data: {
				project: stack.project,
				ref: app.ref,
				tag: app.tag,
				source: mode,
				...(digest ? { digest } : {}),
			},
		});
	}
	return images;
}

function printPlan(
	stack: ComposeStack,
	mode: 'build' | 'pull',
	files: readonly string[],
): void {
	logger.log(`\n🧱 ${stack.project} — stage ${stack.stage}`);
	for (const app of stack.apps) {
		logger.log(
			`   ${app.name.padEnd(12)} ${app.url.padEnd(40)} ${mode === 'build' ? 'build' : 'pull'} ${app.ref}`,
		);
	}
	if (stack.infra.length > 0) {
		logger.log(`   infrastructure: ${stack.infra.join(', ')}`);
	}
	logger.log(
		`\n📝 Wrote ${files.length} file(s) under ${stackDir(stack.stage)}/`,
	);
}
