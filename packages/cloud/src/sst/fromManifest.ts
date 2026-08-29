/**
 * Manifest → SST.
 *
 * Split deliberately into decisions and instantiation. The decisions —
 * which component provisions a kind, whether what it supplies matches what the
 * app declared — are pure functions, so they can be asserted as data. Only
 * {@link fromManifest} touches Pulumi, and it is thin enough that little is
 * hidden behind a runtime nothing can unit-test.
 *
 * Built for AWS. Extending to another provider means adding entries to
 * {@link PROVISIONERS}, not restructuring: the manifest names a *kind*, never a
 * cloud.
 */

import { ownerRole, readerRole } from '@geekmidas/db/pg/roles';
import { resolveEnvKeys } from '@geekmidas/envkit/sst';
import type {
	ConstructManifest,
	Declaration,
	DeclarationKind,
	Dependency,
	SiteDeclaration,
} from '@geekmidas/manifest';
import {
	PUBLIC,
	PUBLIC_PREFIX,
	providedKeyFor,
	provisionOrder,
} from '@geekmidas/manifest';
import { Cache, CacheNeedsDatabase, type CacheProps } from './aws/Cache';
import { Credential } from './aws/Credential';
import { Database, DatabaseNeedsVpc } from './aws/Database';
import { DatabaseBootstrap } from './aws/DatabaseBootstrap';
import { DatabaseReader, DatabaseSchema } from './aws/DerivedDatabase';
import { Email } from './aws/Email';
import { FileServer } from './aws/FileServer';
import { ObjectStorage } from './aws/ObjectStorage';
import { Queue } from './aws/Queue';
import { Secret } from './aws/Secret';
import { StaticSite } from './aws/StaticSite';
import { Topic } from './aws/Topic';
import {
	ProvidesMismatch,
	UnknownDeclarationKind,
	UnresolvedDependency,
} from './errors';
import type { GkmLinkable } from './Linkable';
import type { StackType } from './Stack';

/**
 * A provisioned construct — the component, which *is* the linkable.
 *
 * `provides()` returns its values keyed by role. They reach the running code by
 * being spread into the link's properties, which SST injects and envkit's
 * resolvers flatten into env; keeping them behind a method is what lets the
 * contract be asserted at synth without a deploy.
 */
export interface Provisioned extends GkmLinkable {
	provides(): Record<string, $util.Input<string>>;
}

/** Everything the manifest declared, keyed by id — the shape edges resolve against. */
export type ProvisionedManifest = Record<string, Provisioned>;

/**
 * What a provisioner can see beyond its own declaration.
 *
 * Two kinds need it, and both are consequences of decisions the design took
 * deliberately. A bucket has to know whether anything serves it, because the
 * file server is a construct of its own rather than a flag — the cost that
 * decision names, paid here by looking rather than by reading a flag. And a
 * derived node needs the component its parent became, since it provisions
 * nothing and resolves an address off that one.
 */
export interface ProvisionContext {
	manifest: ConstructManifest;
	/** Everything already provisioned. Parents are present; siblings may not be. */
	provisioned: ProvisionedManifest;
	/**
	 * The role bootstrap for each cluster, keyed by the cluster's id.
	 *
	 * Populated as tenants are provisioned and run once at the end: Pulumi can
	 * generate a password and store it but cannot run `CREATE ROLE`, so the DDL
	 * is a function invoked after everything it operates on exists.
	 */
	bootstraps: Map<string, DatabaseBootstrap>;
	/**
	 * Where a declared cache lives, and who delivers mail.
	 *
	 * Deployment choices rather than declarations, for the same reason
	 * `services.events` is: the same application code caches into any of them and
	 * sends through any of them. They reach the provisioner here because it is
	 * the only place that knows both the choice and the manifest.
	 */
	cache?: 'upstash' | 'elasticache' | 'db';
	email?: 'resend' | 'ses' | 'smtp';
}

type Provisioner = (
	stack: StackType,
	declaration: Declaration,
	props: Record<string, unknown>,
	context: ProvisionContext,
) => Provisioned;

/**
 * Provider-specific props, per construct id.
 *
 * Neutral options — `versioned`, and later `cdn` — travel in the declaration,
 * because the app legitimately has an opinion about them. Anything with S3 in
 * its name does not belong in application code, so lifecycle rules, CORS, and
 * canned ACLs are supplied here, in the deploy layer, keyed by the id they
 * apply to and typed against the component that receives them.
 *
 * A third escape hatch needs no API at all: `fromManifest` returns the
 * components, so `provisioned.Uploads.nodes.bucket` is reachable for anything
 * neither route covers.
 */
export type ComponentOverrides = Record<string, Record<string, unknown>>;

/**
 * Which component provisions which kind.
 *
 * The extension point: a second provider adds entries here, and nothing above
 * this line changes.
 */
const PROVISIONERS: Partial<Record<DeclarationKind, Provisioner>> = {
	objects: (stack, d, props, context) =>
		new ObjectStorage(stack, d.id, {
			// Neutral options the app declared, mapped to this provider's words.
			...(d.kind === 'objects' && d.versioned ? { versioning: true } : {}),
			// A served bucket has to let CloudFront read it, and only the manifest
			// knows whether anything serves it — the cost of making the file
			// server its own construct, paid here rather than by a flag on the
			// bucket that every consumer would then branch on.
			...(isServed(d.id, context.manifest) ? { access: 'cloudfront' } : {}),
			// Overrides win: they are the more specific statement, and the escape
			// hatch is worthless if it cannot override the general case.
			...props,
		}),

	'file-server': (stack, d, props, context) => {
		if (d.kind !== 'file-server') throw new UnknownDeclarationKind(d.kind, []);

		const origin = context.provisioned[d.of];
		if (!origin) {
			throw new UnresolvedDependency(d.of, Object.keys(context.provisioned));
		}

		return new FileServer(stack, d.id, {
			origin: origin as unknown as sst.aws.Bucket,
			...props,
		});
	},

	site: (stack, d, props, context) => {
		if (d.kind !== 'site') throw new UnknownDeclarationKind(d.kind, []);

		return new StaticSite(stack, d.id, {
			path: d.path,
			environment: siteEnvironment(d, context),
			...props,
		});
	},

	queue: (stack, d, props) =>
		new Queue(stack, d.id, {
			// FIFO is a neutral option — the app legitimately has an opinion about
			// ordering — and `fifo` is also what SST calls it.
			...(d.kind === 'queue' && d.fifo ? { fifo: true } : {}),
			...props,
		}),

	// A topic declares nothing beyond its id: which events it carries is the
	// producer's and subscribers' business, and SNS has no per-event
	// configuration to map it onto.
	topic: (stack, d, props) => new Topic(stack, d.id, props),

	database: (stack, d, props) => {
		if (d.kind !== 'database') throw new UnknownDeclarationKind(d.kind, []);
		// Required rather than defaulted: creating a VPC means creating a NAT
		// gateway, which is a monthly cost in an account whose networking may
		// already be someone else's decision.
		if (!('vpc' in props)) throw new DatabaseNeedsVpc(d.id);

		return new Database(stack, d.id, {
			...(d.schema ? { schema: d.schema } : {}),
			...(props as unknown as sst.aws.AuroraArgs),
		});
	},

	'database-reader': (stack, d, props, context) =>
		derived(d, context, (id, parent) => {
			// A reader reads through the *parent's* read-only role: read-only is
			// enforced by the grants, which is what makes falling back to the
			// writer's endpoint safe where a cluster has no replica.
			const source = parentOf(d, context);
			const roles = context.bootstraps.get(rootId(source, context));
			const runtime = roleNameFor(source, context);
			const reader = roles?.readerFor(runtime);

			return new DatabaseReader(id, parent, reader);
		}),

	'database-schema': (stack, d, props, context) => {
		if (d.kind !== 'database-schema')
			throw new UnknownDeclarationKind(d.kind, []);

		return derived(d, context, (id, parent) => {
			const bootstrap = bootstrapFor(parent, rootId(d, context), context);
			const runtime = roleNameFor(d, context);

			// Registering the tenant is what creates its passwords and its secret;
			// the DDL that uses them runs at the end, from one function.
			const credentials = bootstrap?.add({
				id,
				schema: d.schema,
				runtime,
				owner: ownerRole(runtime),
				...(hasReader(d.id, context) ? { reader: readerRole(runtime) } : {}),
			});

			return new DatabaseSchema(
				id,
				parent,
				d.schema,
				credentials
					? { user: runtime, password: credentials.runtime }
					: undefined,
			);
		});
	},

	cache: (stack, d, props, context) => {
		const backend = context.cache ?? 'upstash';

		if (backend === 'db') {
			// The database the app already declared. Resolving its URL rather than
			// composing a new one is what makes this backend free: same address,
			// same role, one more table.
			const database = Object.entries(context.manifest).find(
				([, declaration]) => declaration.kind === 'database',
			);
			const provisioned = database && context.provisioned[database[0]];

			if (!provisioned) throw new CacheNeedsDatabase(d.id);

			return new Cache(stack, d.id, { url: provisioned.provides().url! });
		}

		const supplied = props as {
			url?: $util.Input<string>;
			vpc?: CacheProps['vpc'];
			region?: string;
		};

		// Both remaining backends create something, and both take a URL instead
		// for a cache that already exists.
		return new Cache(stack, d.id, {
			backend,
			...(supplied.url ? { url: supplied.url } : {}),
			...(supplied.vpc ? { vpc: supplied.vpc } : {}),
			...(supplied.region ? { region: supplied.region } : {}),
		});
	},

	email: (stack, d, props, context) => {
		const backend = context.email ?? 'ses';
		const supplied = props as {
			url?: $util.Input<string>;
			region?: $util.Input<string>;
		};

		return new Email(stack, d.id, {
			backend,
			...(supplied.url ? { url: supplied.url } : {}),
			// SES derives its own credential and needs to know which region's
			// endpoint to derive it for; the others were handed a URL already.
			region: supplied.region ?? $app.providers?.aws?.region ?? 'us-east-1',
		});
	},

	secret: (stack, d, props) => new Secret(stack, d.id, props),

	// The same storage as a secret, under a different role — see the component.
	credential: (stack, d, props) => new Credential(stack, d.id, props),
};

/**
 * A site's build-time environment: the actual values, under the names its
 * bundler inlines.
 *
 * The names come from the shared derivation, so a site built by `gkm dev` and
 * the same site built here inline the same keys. The *values* can only come
 * from the provisioned components — a static site has no server half to read a
 * link at runtime, so an address it needs has to be an input to its build.
 *
 * @throws {UnresolvedDependency} when an edge names something not provisioned.
 * Silently emitting a smaller environment would produce a frontend that builds
 * and then fails against `http:///`, with nothing to point at.
 */
export function siteEnvironment(
	declaration: SiteDeclaration,
	context: ProvisionContext,
): Record<string, $util.Input<string>> {
	const prefix = PUBLIC_PREFIX[declaration.variant];
	const environment: Record<string, $util.Input<string>> = {};

	for (const edge of declaration.dependencies) {
		const target = context.manifest[edge.target];
		if (!target) continue;

		const roles = PUBLIC[target.kind] ?? [];
		if (roles.length === 0) continue;

		const component = context.provisioned[edge.target];
		if (!component) {
			throw new UnresolvedDependency(
				edge.target,
				Object.keys(context.provisioned),
			);
		}

		const provided = component.provides();
		for (const role of roles) {
			const value = provided[role as string];
			if (value === undefined) continue;

			environment[
				`${prefix}${providedKeyFor(edge.target, target.kind, role as string)}`
			] = value;
		}
	}

	return environment;
}

/**
 * Resolve a derived database node against the cluster its parent became.
 *
 * A reader and a schema tenant provision nothing, so the whole of their
 * provisioning is finding the parent — which `provisionOrder` guarantees is
 * already there, and `assertDerivations` guarantees exists at all.
 *
 * @throws {UnresolvedDependency} if neither guarantee held, which would mean the
 * manifest reached here without its own validation having run.
 */
function derived(
	declaration: Declaration,
	context: ProvisionContext,
	build: (id: string, parent: Database) => Provisioned,
): Provisioned {
	if (!('of' in declaration)) {
		throw new UnknownDeclarationKind(declaration.kind, []);
	}

	const parent = context.provisioned[declaration.of];
	if (!parent) {
		throw new UnresolvedDependency(
			declaration.of,
			Object.keys(context.provisioned),
		);
	}

	// A tenant may derive from another tenant, and what both ultimately need is
	// the cluster underneath. `DerivedDatabase` holds its parent, so walking up
	// is following the same chain `provisionOrder` walked to get here.
	return build(declaration.id, rootCluster(parent));
}

/** The declaration a derived node hangs off. */
function parentOf(
	declaration: Declaration,
	context: ProvisionContext,
): Declaration {
	if (!('of' in declaration)) return declaration;

	return context.manifest[declaration.of] ?? declaration;
}

/**
 * The id of the cluster at the bottom of a chain of derived nodes.
 *
 * A tenant may derive from another tenant, and what both ultimately live in is
 * one database — so this follows `of` to the end rather than reading the
 * immediate parent.
 */
function rootId(declaration: Declaration, context: ProvisionContext): string {
	let current = declaration;

	while ('of' in current) {
		const parent = context.manifest[current.of];
		if (!parent) break;
		current = parent;
	}

	return current.id;
}

/**
 * The runtime role a node connects as: its own id, lowercased.
 *
 * The same rule the local target uses, so a role a developer sees in `\du` is
 * the role that exists in production. Roles are cluster-scoped, so two stages
 * sharing a cluster would collide — which is why a deployed stage gets its own.
 */
function roleNameFor(
	declaration: Declaration,
	_context: ProvisionContext,
): string {
	return declaration.id.toLowerCase();
}

/** Whether anything in the manifest reads through this node. */
function hasReader(id: string, context: ProvisionContext): boolean {
	return Object.values(context.manifest).some(
		(declaration) =>
			declaration.kind === 'database-reader' && declaration.of === id,
	);
}

/**
 * The bootstrap for a cluster, created on first use.
 *
 * One per cluster rather than one per tenant: the DDL for every tenant runs on
 * the same connection, as the same master, so a function each would be the same
 * work done N times with N cold starts.
 */
function bootstrapFor(
	cluster: Database,
	clusterId: string,
	context: ProvisionContext,
): DatabaseBootstrap | undefined {
	// `roles: false` is the documented downgrade: no roles, and both URLs fall
	// back to the master. Nothing to bootstrap.
	const declaration = context.manifest[clusterId];
	if (declaration && 'roles' in declaration && declaration.roles === false) {
		return undefined;
	}

	const existing = context.bootstraps.get(clusterId);
	if (existing) return existing;

	const created = new DatabaseBootstrap(clusterId, cluster);
	context.bootstraps.set(clusterId, created);

	return created;
}

/** The `Database` at the bottom of a chain of derived nodes. */
function rootCluster(component: Provisioned): Database {
	const parent = (component as { parent?: Provisioned }).parent;

	return parent ? rootCluster(parent) : (component as unknown as Database);
}

/**
 * Whether anything in the manifest serves this bucket.
 *
 * The question the design's chosen shape makes you ask. Under a `cdn: true`
 * flag you read one declaration; here you find whoever points at it — which is
 * a real regression in auditability, answered by making the lookup one function
 * that every consumer shares rather than something each caller re-derives.
 */
export function isServed(id: string, manifest: ConstructManifest): boolean {
	return Object.values(manifest).some(
		(declaration) =>
			declaration.kind === 'file-server' && declaration.of === id,
	);
}

/** The provisioner for a kind. Pure — the lookup is testable without Pulumi. */
export function provisionerFor(kind: DeclarationKind): Provisioner {
	const provisioner = PROVISIONERS[kind];
	if (!provisioner) {
		throw new UnknownDeclarationKind(kind, Object.keys(PROVISIONERS));
	}
	return provisioner;
}

/**
 * Assert that a link yields exactly the env keys the app declared.
 *
 * `supplied` comes from `resolveEnvKeys`, which derives the keys a resource type
 * produces — the same derivation that runs for real. The app↔infra contract is
 * the one guarantee spanning two packages, two build phases, and two authors,
 * and the one a JavaScript consumer gets no compiler help with, so it is checked
 * at synth rather than trusted.
 */
export function assertProvides(
	id: string,
	declared: readonly string[] = [],
	supplied: readonly string[] = [],
): void {
	const missing = declared.filter((key) => !supplied.includes(key));
	const extra = supplied.filter((key) => !declared.includes(key));

	if (missing.length || extra.length) {
		throw new ProvidesMismatch(id, missing, extra);
	}
}

/**
 * Provision everything the manifest declares.
 *
 * In `provisionOrder`, which puts every parent before its children — a schema
 * tenant, a read replica, and the surface over a bucket all resolve an address
 * off something else, and a pass in map order would find it half the time.
 */
export function fromManifest(
	stack: StackType,
	manifest: ConstructManifest,
	overrides: ComponentOverrides = {},
	/**
	 * The backend choices that are config rather than declaration.
	 *
	 * Defaulted the same way the local target defaults them, so a stage deployed
	 * without saying gets the same backend a developer ran against.
	 */
	backends: {
		cache?: 'upstash' | 'elasticache' | 'db';
		email?: 'resend' | 'ses' | 'smtp';
	} = {},
): ProvisionedManifest {
	const provisioned: ProvisionedManifest = {};

	// In provisioning order, so a derived node finds the component its parent
	// became. `assertDerivations` has already ruled out a missing parent, so the
	// order is total rather than best-effort.
	//
	// Sites come last, and separately, because `provisionOrder` orders `of` and
	// not `dependencies` — a site needs its edges' *values* at construction
	// time, since a static site has no server half to read a link at runtime.
	// It is a pure consumer of addresses, so building it after everything else
	// is enough; the day a kind needs a site's URL at construction, this needs a
	// real topological sort rather than a second pass.
	const order = provisionOrder(manifest);
	const sites = order.filter((id) => manifest[id]?.kind === 'site');
	const rest = order.filter((id) => manifest[id]?.kind !== 'site');

	const context: ProvisionContext = {
		manifest,
		provisioned,
		bootstraps: new Map<string, DatabaseBootstrap>(),
		...(backends.cache ? { cache: backends.cache } : {}),
		...(backends.email ? { email: backends.email } : {}),
	};

	for (const id of [...rest, ...sites]) {
		const declaration = manifest[id];
		if (!declaration) continue;

		const component = provisionerFor(declaration.kind)(
			stack,
			declaration,
			overrides[id] ?? {},
			context,
		);

		assertProvides(
			id,
			declaration.provides,
			// A role becomes the env key the app declared: `url` → `UPLOADS_URL`.
			// Through the shared derivation, not a local copy of it — a secret's
			// name *is* its key, and a check that derived it differently from the
			// thing being checked would pass on drift instead of catching it.
			Object.keys(component.provides()).map((role) =>
				providedKeyFor(id, declaration.kind, role),
			),
		);

		provisioned[id] = component;
	}

	// Last, and only now: the roles exist as passwords and secrets from the
	// moment each tenant was provisioned, but nothing has run `CREATE ROLE`.
	// Pulumi cannot — so one function per cluster does, inside the VPC, invoked
	// with an input that changes only when the roles or the cluster do.
	for (const [clusterId, bootstrap] of context.bootstraps) {
		const cluster = provisioned[clusterId] as unknown as Database | undefined;
		if (cluster) bootstrap.run(cluster.vpc);
	}

	return provisioned;
}

/** What one function receives from its edges. */
export interface ResolvedEdges {
	/** The components it may reach. SST turns these into IAM *and* injects their
	 * properties, so this is the whole delivery mechanism. */
	link: Provisioned[];
	/**
	 * The env keys those links yield.
	 *
	 * Not values: the values are injected at runtime by the link, and a map of
	 * key→placeholder would be a lie that ships. Keys are what the adapter needs,
	 * so a function's `requires` can be checked against what its own edges cover.
	 */
	envKeys: string[];
}

/**
 * Resolve one function's dependencies into what it is given.
 *
 * A function is linked to exactly the constructs it declared, never the app's
 * full set — so least privilege falls out of the edges rather than out of
 * discipline. Adding an unrelated construct to the manifest cannot widen what
 * an existing function can reach, which is the property worth testing as an
 * exclusion.
 *
 * Pure: given a provisioned map, this is data in and data out, so the whole
 * filtering rule is assertable without a deploy.
 */
export function resolveEdges(
	dependencies: readonly Dependency[] = [],
	provisioned: ProvisionedManifest,
): ResolvedEdges {
	const link: Provisioned[] = [];
	const envKeys = new Set<string>();

	for (const dependency of dependencies) {
		const component = provisioned[dependency.target];
		if (!component) {
			throw new UnresolvedDependency(
				dependency.target,
				Object.keys(provisioned),
			);
		}

		link.push(component);
		for (const key of resolveEnvKeys({
			[dependency.target]: { type: component._type as string },
		})) {
			envKeys.add(key);
		}
	}

	return { link, envKeys: [...envKeys].sort() };
}
