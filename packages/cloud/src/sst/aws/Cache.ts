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
 * - **`upstash`** provisions a Redis database through Upstash's own Pulumi
 *   provider, which SST installs on demand: `sst add upstash`. It is not one of
 *   the two providers SST preloads, so the component checks for its global and
 *   says which command is missing rather than failing on an undefined name. A
 *   URL can still be supplied instead, for a database that already exists.
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
		this.url = props.url ?? this.provision(name, props);
	}

	/**
	 * Create the cache, for the two backends that can be created.
	 *
	 * `db` never reaches here — it resolves the declared database's URL, which
	 * the caller passes in as `url`.
	 */
	private provision(name: string, props: CacheProps): $util.Input<string> {
		return props.backend === 'upstash'
			? this.provisionUpstash(name, props)
			: this.provisionElastiCache(name, props);
	}

	/**
	 * An Upstash Redis database, over HTTP.
	 *
	 * The default backend, because HTTP with a token is reachable from a Lambda
	 * with no VPC and no connection pool — the same argument that makes it worth
	 * running a proxy in front of Redis locally so both speak one protocol.
	 *
	 * The token goes in the URL's userinfo rather than a second key, because an
	 * address and the credential that opens it are one fact.
	 */
	private provisionUpstash(
		name: string,
		props: CacheProps,
	): $util.Input<string> {
		// Upstash is installed on demand rather than preloaded, so its global is
		// absent until `sst add upstash` has run. Checking for it turns an
		// undefined-name crash into a sentence naming the command.
		if (typeof upstash === 'undefined') throw new CacheNeedsProvider(name);

		const database = new upstash.RedisDatabase(`${name}Cache`, {
			databaseName: name,
			// `global` needs a primary region named alongside it, so a plain
			// region is the default that needs no second decision.
			region: props.region ?? 'eu-west-1',
			// In transit, always. The client speaks HTTPS either way, and a cache
			// reachable unencrypted over the public internet is not one.
			tls: true,
		});

		return $util
			.all([database.endpoint, database.restToken])
			.apply(
				([endpoint, token]) =>
					`https://:${encodeURIComponent(token)}@${endpoint}`,
			);
	}

	/**
	 * A serverless Valkey cache, in the VPC the caller named.
	 *
	 * Serverless rather than a node group because this design provisions per
	 * stage, and a node running around the clock under every preview stage is a
	 * bill nobody chose. The database went the other way — a plain RDS instance —
	 * because a cluster buys complexity there rather than savings; the two are
	 * separate calls, not one principle applied twice.
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
	/** Which backend to create. `db` never creates anything and never gets here. */
	backend?: 'upstash' | 'elasticache' | 'db';
	/** The region to create an Upstash database in. */
	region?: string;
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
 * An Upstash cache was declared and Upstash's provider is not installed.
 *
 * SST preloads two providers and installs the rest on demand, so the global this
 * component reaches for does not exist until somebody runs the command. Naming
 * the command beats an undefined-name crash halfway through a synth.
 */
export class CacheNeedsProvider extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' is an Upstash cache and the Upstash provider is not ` +
				`installed. Run \`sst add upstash\` in the app, or supply a URL for ` +
				`a database that already exists — ` +
				`fromManifest(stack, manifest, { ${id}: { url } }).`,
		);
		this.name = 'CacheNeedsProvider';
	}
}
