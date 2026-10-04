/**
 * Reconcile — the one convergent function `gkm dev`, `gkm test`, and `gkm setup`
 * all call.
 *
 * Three phases, and only this one has side effects: declaring is pure (`gkm
 * build` and the dev watcher), running reads `<NAME>_URL` and provisions
 * nothing. Reconcile computes the desired state, compares, and applies the
 * difference — which is what makes "when does it run" answerable with
 * *whenever, repeatedly*.
 *
 * It is safe to run automatically because its blast radius is entirely local:
 * this project's containers, this project's `.gkm/`. Nothing it does can reach a
 * cloud. The line is drawn at data, not at side effects — it allocates ports,
 * writes compose, starts containers, and creates roles; it never seeds, resets,
 * or drops.
 *
 * Docker is injected rather than imported so the rules above can be asserted
 * without a daemon. The default implementation is the real one.
 */

import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type ConstructManifest, provisionOrder } from '@geekmidas/manifest';
import type { CacheBackend, EventsBackend } from '../types';
import { TEST_STAGE } from '../workspace/stages';
import { caddyfileRoot, sitesFor, toCaddyfile } from './caddyfile';
import { bucketClient, carrierClient, pgClient } from './clients';
import {
	type ComposeFile,
	type ComposeService,
	composeFor,
	toYaml,
} from './compose';
import {
	portKeys,
	portsOf,
	primaryPortKey,
	type ServiceAddress,
	serviceAddresses,
} from './containers';
import { dockerCli } from './docker';
import { envFor } from './env';
import type { LocalFake } from './fakes';
import { lanAddress } from './lan';
import { type Plan, type PlanOptions, planFor } from './plan';
import {
	allocate,
	isPortFree,
	keptPorts,
	type PortAssignments,
	type PortProbe,
} from './ports';
import {
	type Applied,
	applyBuckets,
	applyCarriers,
	applyPolicies,
	applyPostgres,
	type BucketClient,
	bucketNames,
	bucketPolicies,
	type CarrierClient,
	carrierNames,
	databasesExist,
	postgresDatabaseNames,
	postgresStatements,
	type SqlClient,
} from './provision';
import { loadState, planHash, saveState } from './state';

export type { ComposeFile } from './compose';
export type { Plan, PlannedResource } from './plan';
export type { PortAssignments } from './ports';

/**
 * Where the generated compose file is written, relative to the project root.
 *
 * At the root, beside the project's own `docker-compose.yml`, because the two
 * are one stack: this file is everything the constructs imply and is never
 * edited, that one is anything they cannot express — an image pin, an extra
 * service — and is merged over it, so it wins.
 */
export const COMPOSE_PATH = 'docker-compose.constructs.yml';

/** The project's own compose file, merged over the generated one if present. */
export const PROJECT_COMPOSE_PATH = 'docker-compose.yml';

/**
 * The local edge's config, beside the compose file that mounts it.
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
 * Where the local edge's root certificate is copied to.
 *
 * Exported so a process can be pointed at it without installing anything:
 * `NODE_EXTRA_CA_CERTS` is the whole of the trust story for Node, and it needs
 * no sudo. A browser is the case that still wants the root in the system store,
 * which is a one-time `caddy trust` rather than something a reconcile should do
 * on a developer's behalf.
 */
export const LOCAL_CA_PATH = '.gkm/caddy-root.crt';

/** Where Caddy keeps the root of the CA it generated. */
const CADDY_ROOT_IN_CONTAINER = '/data/caddy/pki/authorities/local/root.crt';

/**
 * The Docker operations reconcile needs.
 *
 * Small on purpose: everything else about containers Docker already remembers,
 * so there is no state here to keep in step with it.
 */
export interface Docker {
	/**
	 * The host port a running container publishes for one of its internal ports,
	 * or `undefined` if it is not running.
	 *
	 * Consulted before the saved assignments so that reconcile converges against
	 * what is actually running rather than only against its own file — a
	 * container someone started by hand is still the container serving the app.
	 */
	publishedPort(
		composePath: string,
		service: string,
		inside: number,
	): Promise<number | undefined>;
	/** Bring the named services up, detached. */
	up(composePath: string, services: readonly string[]): Promise<void>;
	/** Whether every named service is running and passing its health check. */
	healthy(composePath: string, services: readonly string[]): Promise<boolean>;
	/**
	 * Copy a file out of a running container.
	 *
	 * One case: the certificate authority the local edge generates. It lives in
	 * the container's volume, and everything that has to *trust* it — Node, the
	 * test suite, curl — lives outside.
	 */
	copyOut(
		composePath: string,
		service: string,
		from: string,
		to: string,
	): Promise<void>;
	/**
	 * Ask a running service to re-read its configuration.
	 *
	 * The local edge is the case: its routes are a mounted file, and a container
	 * that is already up will not notice one changing.
	 */
	reload(composePath: string, service: string): Promise<void>;
}

export interface ReconcileOptions {
	/** The project root — where `.gkm/` lives. */
	root: string;
	/**
	 * The project name, which seeds port allocation and names the compose
	 * project. Two checkouts of the same repo share it deliberately.
	 */
	project: string;
	/** The construct manifest — what the app declared. */
	manifest: ConstructManifest;
	/** The stage being reconciled: the project's local stage, or `test`. */
	stage: string;
	/**
	 * This machine's LAN address, for a mobile app's `exp://` origins and the
	 * address its sign-in links are built on. Read from the network interfaces
	 * when absent; `null` for none.
	 */
	lanAddress?: string | null;
	/** Each mobile app's Metro port, by construct id. */
	metroPorts?: Readonly<Record<string, number>>;
	/** The project's local stage, whose resources carry no suffix. */
	localStage?: string;
	/** The events backend, until `topic` and `queue` are kinds. */
	events?: EventsBackend;
	/** Where a declared cache lives — see {@link CacheBackend}. */
	cache?: CacheBackend;
	/** Containers no construct implies — the config exceptions. */
	extraContainers?: readonly string[];
	/** Each external API's fake, by id — see `readFakes`. */
	fakes?: PlanOptions['fakes'];
	/** Whether the local edge fronts surfaces, sites and file servers. */
	edge?: boolean;
	/**
	 * The apps, as services beside the containers — see `reconcile/apps.ts`.
	 * Handed the derived containers so an app can depend on them.
	 */
	apps?: (containers: readonly string[]) => Record<string, ComposeService>;
	/** Ports assigned by previous runs, from `.gkm/ports.json`. */
	saved?: PortAssignments;
	/** Start containers and wait for health. Off answers "what would change". */
	start?: boolean;
	/**
	 * Create the databases, schemas, and buckets the plan names.
	 *
	 * Requires the containers to be running, so it is skipped when `start` is
	 * off. Never seeds, resets, or drops — the line is at data, not side effects.
	 */
	provision?: boolean;
	/** The address mail is sent from locally. */
	mailFrom?: string;
	/**
	 * Where each address-owning construct answers, keyed by id.
	 *
	 * Surfaces and sites. Assigned by whatever starts them, which is why it
	 * arrives here rather than being read off a published container port.
	 */
	addresses?: Readonly<Record<string, string>>;
	docker?: Docker;
	probe?: PortProbe;
	/** Injected for tests; the defaults talk to the containers just started. */
	sql?: (port: number) => SqlClient;
	buckets?: (port: number) => BucketClient;
	carriers?: (port: number) => CarrierClient;
}

export interface ReconcileResult {
	stage: string;
	plan: Plan;
	compose: ComposeFile;
	/** Every assigned port, keyed by port key. Persist this. */
	ports: PortAssignments;
	/** Every port the containers publish, labelled — consoles and inbox too. */
	services: readonly ServiceAddress[];
	/** The `<NAME>_URL` values this stage resolves. */
	env: Readonly<Record<string, string>>;
	/** What the applier created, or found already there. */
	provisioned: Applied[];
	/**
	 * Each external API's fake, by id. An image fake is already running with
	 * the containers; an app fake is the caller's to serve — `gkm dev` does —
	 * on `ports[fakeKey(id)]`.
	 */
	fakes: Readonly<Record<string, LocalFake>>;
	/** The hash recorded for this state. */
	hash: string;
	/**
	 * Whether anything was applied. False is the fast path — the recorded hash
	 * matched and the containers were healthy, so nothing was written or started.
	 */
	changed: boolean;
}

/**
 * Converge the local target on what the manifest declares.
 *
 * Cheap when there is nothing to do: the hash is compared before the compose
 * file is written or a container is touched, and a converged project pays one
 * hash and one health check.
 */
export async function reconcile(
	options: ReconcileOptions,
): Promise<ReconcileResult> {
	const {
		root,
		project,
		manifest,
		stage,
		start = true,
		provision = true,
		docker = dockerCli,
		probe = isPortFree,
		sql = pgClient,
		buckets = bucketClient,
		carriers = carrierClient,
	} = options;

	const plan = planFor(manifest, stage, provisionOrder(manifest), {
		localStage: options.localStage,
		events: options.events,
		cache: options.cache,
		extraContainers: options.extraContainers,
		...(options.fakes ? { fakes: options.fakes } : {}),
		...(options.edge === undefined ? {} : { edge: options.edge }),
	});

	const composePath = join(root, COMPOSE_PATH);

	// What is already running wins over what was recorded: a container on a port
	// is the fact, and the file is only a memory of one.
	const observed = await observedPorts(
		docker,
		composePath,
		plan.containers,
		plan.fakes,
	);
	const ports = await allocate(
		project,
		portKeys(plan.containers, plan.fakes),
		keptPorts(options.saved, observed),
		probe,
	);

	const compose = composeFor(plan, {
		project,
		ports,
		...(options.apps ? { apps: options.apps(plan.containers) } : {}),
	});

	// The edge's config is part of what "converged" means: a file server added or
	// a bucket renamed changes the routing without changing a container, and a
	// hash that ignored it would leave the old routes in place.
	const caddyfile = toCaddyfile(sitesFor(plan, project, options.addresses));
	// And so is what provisioning runs. A toolbox upgrade that changes the role
	// DDL — a new grant — changes no container and no route, so a hash without
	// it reported convergence and the existing database never got the grant.
	const postgres = postgresStatements(plan, project)
		.map((statement) => statement.create)
		.join(';\n');
	const hash = planHash(plan, compose, { caddyfile, postgres });
	const services = serviceAddresses(plan.containers, ports, plan.fakes);
	// Only a project with a mobile app reads it, so only one looks for it.
	const lan = plan.resources.some((r) => r.kind === 'mobile-app')
		? options.lanAddress === undefined
			? lanAddress()
			: (options.lanAddress ?? undefined)
		: undefined;
	const env = envFor(plan, {
		ports,
		project,
		...(options.mailFrom ? { mailFrom: options.mailFrom } : {}),
		...(options.addresses ? { addresses: options.addresses } : {}),
		...(lan ? { lanAddress: lan } : {}),
		...(options.metroPorts ? { metroPorts: options.metroPorts } : {}),
	});
	// Pointed at whether or not it exists yet: the copy below fills it in, and
	// anything that reads the environment starts after this returns.
	if (plan.containers.includes('caddy')) {
		env.NODE_EXTRA_CA_CERTS = join(root, LOCAL_CA_PATH);
	}

	const result: ReconcileResult = {
		stage,
		plan,
		compose,
		ports,
		services,
		env,
		provisioned: [],
		fakes: options.fakes ?? {},
		hash,
		changed: false,
	};

	const recorded = await loadState(root, stage);
	const postgresPort = ports[primaryPortKey('postgres')];
	const converged =
		recorded?.hash === hash &&
		// The file is gitignored and derived; a fresh checkout with the state
		// still around must write it rather than trust a hash of nothing.
		existsSync(composePath) &&
		(!start || (await docker.healthy(composePath, plan.containers))) &&
		// Every checkout shares one Postgres, so another one's test teardown can
		// drop a database this checkout's state still records as created.
		(!start ||
			!provision ||
			postgresPort === undefined ||
			(await databasesExist(sql(postgresPort), postgresDatabaseNames(plan))));

	// The fast path, and the reason reconciling on every start is acceptable.
	if (converged) return result;

	await write(composePath, toYaml(compose));

	// Before the containers: Caddy reads these at startup, and mounting a file
	// that does not exist yet gets a directory instead.
	if (plan.containers.includes('caddy')) {
		await write(join(root, CADDYFILE_PATH), caddyfileRoot());
		await write(join(root, caddySitesPath(stage)), caddyfile);
		await pruneCaddySites(root, [stage, options.localStage, TEST_STAGE]);
	}

	if (start && plan.containers.length > 0) {
		await docker.up(composePath, plan.containers);
	}

	// A running Caddy does not notice a changed import, so the routes this
	// reconcile just wrote are inert until it is told. Failing is not fatal: the
	// container may have only this second come up, in which case it already read
	// them.
	if (start && plan.containers.includes('caddy')) {
		await docker.reload(composePath, 'caddy').catch(() => {});
	}

	// After `up`, because Caddy generates its CA on first start — and only then,
	// so copying earlier gets nothing.
	if (start && plan.containers.includes('caddy')) {
		await docker
			.copyOut(
				composePath,
				'caddy',
				CADDY_ROOT_IN_CONTAINER,
				join(root, LOCAL_CA_PATH),
			)
			.catch(() => {
				// Not fatal. Without it, `https://` local addresses fail to verify
				// and say so clearly; taking the whole reconcile down would be a
				// worse trade for a developer who is not using them yet.
			});
	}

	// Only once the containers are up: there is nothing to create inside a
	// container that is not running.
	const provisioned =
		start && provision
			? await create(plan, ports, sql, buckets, carriers, project)
			: [];

	await saveState(root, { hash, stage });

	return { ...result, provisioned, changed: true };
}

/**
 * Create the databases, schemas, buckets, topics and queues the plan names.
 *
 * Idempotent throughout, so this runs on every non-converged reconcile rather
 * than being something to remember.
 */
async function create(
	plan: Plan,
	ports: PortAssignments,
	sql: (port: number) => SqlClient,
	buckets: (port: number) => BucketClient,
	emulatorCarriers: (port: number) => CarrierClient,
	/** Seeds the derived role passwords — see `localRolePassword`. */
	project: string,
): Promise<Applied[]> {
	const applied: Applied[] = [];

	const postgresPort = ports[primaryPortKey('postgres')];
	const statements = postgresStatements(plan, project);
	if (postgresPort !== undefined && statements.length > 0) {
		applied.push(...(await applyPostgres(sql(postgresPort), statements)));
	}

	const minioPort = ports[primaryPortKey('minio')];
	const names = bucketNames(plan);
	const policies = bucketPolicies(plan);
	if (minioPort !== undefined && (names.length > 0 || policies.length > 0)) {
		const client = buckets(minioPort);

		// Buckets first: a policy names a bucket, and applying one to a bucket
		// that does not exist yet fails on the first reconcile of a new project.
		if (names.length > 0) applied.push(...(await applyBuckets(client, names)));
		if (policies.length > 0)
			applied.push(...(await applyPolicies(client, policies)));
	}

	const emulatorPort = ports[primaryPortKey('localstack')];
	const carriers = carrierNames(plan);
	if (
		emulatorPort !== undefined &&
		carriers.topics.length + carriers.queues.length > 0
	) {
		applied.push(
			...(await applyCarriers(emulatorCarriers(emulatorPort), carriers)),
		);
	}

	return applied;
}

/**
 * The host ports of containers already running.
 *
 * Keyed the same way allocation keys them, so the two merge without either
 * knowing about the other.
 */
async function observedPorts(
	docker: Docker,
	composePath: string,
	containers: readonly string[],
	fakes?: Plan['fakes'],
): Promise<PortAssignments> {
	const observed: Record<string, number> = {};

	for (const container of containers) {
		for (const port of portsOf(container, fakes)) {
			const running = await docker.publishedPort(
				composePath,
				container,
				port.inside,
			);
			if (running !== undefined) observed[port.key] = running;
		}
	}

	return observed;
}

/** Write a file only when its content would change, so mtimes stay meaningful. */
/**
 * Remove the routes of stages this project no longer reconciles.
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
	const keep = new Set(stages.map((stage) => stage && `${stage}.caddy`));

	for (const file of await readdir(dir)) {
		if (file.endsWith('.caddy') && !keep.has(file)) {
			await rm(join(dir, file));
		}
	}
}

async function write(path: string, content: string): Promise<void> {
	try {
		if ((await readFile(path, 'utf-8')) === content) return;
	} catch {
		// Absent or unreadable — write it.
	}

	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}
