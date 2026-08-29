import { elasticache } from '@pulumi/aws';
import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `Cache` — a key/value cache, and the infra half of the `cache` kind.
 *
 * The kind where the *backend* is the whole design, because unlike mail the
 * three do not speak the same protocol. What this composes is a URL whose
 * scheme names one of them, and the generated entry registers the matching
 * driver — so the two agree by construction rather than by being kept in step.
 *
 * Only one of the three provisions anything:
 *
 * - **`db`** provisions nothing at all. The cache is a table in the database
 *   already declared, so this resolves that database's URL and the table is
 *   created by the same thing that creates the schema. No second resource, no
 *   second credential, and nothing to pay for while idle.
 * - **`upstash`** provisions nothing either, and for a different reason: it is a
 *   SaaS account rather than infrastructure in yours. The URL is supplied — set
 *   it with `sst secret set` — which is the same shape a `Credential` has.
 * - **`elasticache`** is the one that creates something, and it comes with the
 *   constraints of a thing in a VPC: it is reachable from functions in that VPC
 *   and from nothing else.
 */
export class Cache<
	TStage extends string = string,
	TDomain extends string = string,
> implements GkmLinkable
{
	readonly _id: string;

	private readonly url: $util.Input<string>;

	get _type() {
		return ResourceType.Cache;
	}

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: CacheProps,
	) {
		this._id = name;
		this.url = props.url ?? this.provisionElastiCache(name, props);
	}

	/**
	 * A serverless Valkey cache, in the VPC the caller named.
	 *
	 * Serverless rather than a node group for the same reason the database is
	 * Aurora Serverless: this design provisions per stage, and a node running
	 * around the clock under every preview stage is a bill nobody chose.
	 *
	 * TLS is not optional — ElastiCache Serverless only accepts encrypted
	 * connections — which is why the URL is `rediss://` and why the driver
	 * registers both schemes.
	 */
	private provisionElastiCache(
		name: string,
		props: CacheProps,
	): $util.Input<string> {
		if (!props.vpc) throw new CacheNeedsVpc(name);

		const cache = new elasticache.ServerlessCache(`${name}Cache`, {
			engine: 'valkey',
			name,
			subnetIds: props.vpc.subnets,
			securityGroupIds: props.vpc.securityGroups,
		});

		return $util.output(cache.endpoints).apply((endpoints) => {
			const endpoint = endpoints[0];
			if (!endpoint) throw new CacheNeedsVpc(name);

			return $util
				.all([endpoint.address, endpoint.port])
				.apply(([address, port]) => `rediss://${address}:${port}`);
		});
	}

	/** One key, the URL — and its scheme is the contract with the driver. */
	provides(): Record<string, $util.Input<string>> {
		return { url: this.url };
	}

	getSSTLink() {
		return { properties: { ...this.provides() } };
	}
}

export interface CacheProps {
	/**
	 * The cache's URL, whose scheme picks the driver.
	 *
	 * Supplied for the two backends that are not provisioned here — the declared
	 * database's URL for `db`, a secret for `upstash`. Absent for `elasticache`,
	 * which creates a cluster and composes its own.
	 */
	url?: $util.Input<string>;
	/**
	 * The VPC to put an ElastiCache cluster in.
	 *
	 * Required for that backend and meaningless for the others. A cache in a VPC
	 * is reachable from functions in that VPC and from nothing else, which is
	 * the trade that comes with choosing it.
	 */
	vpc?: {
		subnets: $util.Input<$util.Input<string>[]>;
		securityGroups: $util.Input<$util.Input<string>[]>;
	};
}

/** An ElastiCache-backed cache was declared and no VPC was supplied for it. */
export class CacheNeedsVpc extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' is an ElastiCache cache and needs a VPC to live in. Supply ` +
				`one through the deploy layer — ` +
				`fromManifest(stack, manifest, { ${id}: { vpc } }) — the same one ` +
				`the functions that read it run in, since a cache in a VPC is ` +
				`reachable from nowhere else.`,
		);
		this.name = 'CacheNeedsVpc';
	}
}

/**
 * A cache backed by the database was declared, and no database was.
 *
 * The same rule pg-boss has, and the same reason: provisioning a database to
 * hold only a cache is the resource this design refuses to invent on your
 * behalf.
 */
export class CacheNeedsDatabase extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' is a cache backed by the database, and this app declares no ` +
				`database for it to live in. Declare one, or set services.cache to ` +
				`'upstash' or 'elasticache'.`,
		);
		this.name = 'CacheNeedsDatabase';
	}
}

/**
 * An Upstash-backed cache with no URL set.
 *
 * Upstash is an account somebody creates, not infrastructure this provisions —
 * so the URL is an input, and its absence is a missing setup step rather than
 * something to default. Failing at synth names it; defaulting would produce a
 * cache that resolves and never answers.
 */
export class CacheNeedsUrl extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' is an Upstash cache and no URL was supplied for it. Upstash ` +
				`is an account rather than something to provision, so set the URL ` +
				`with \`sst secret set\` and pass it through the deploy layer — ` +
				`fromManifest(stack, manifest, { ${id}: { url } }).`,
		);
		this.name = 'CacheNeedsUrl';
	}
}
