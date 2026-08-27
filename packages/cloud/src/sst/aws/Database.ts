import * as postgresUrl from '@geekmidas/db/pg/url';
import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `Database` — an Aurora Serverless v2 cluster, and the infra half of the
 * `database` kind.
 *
 * **Aurora rather than an RDS instance**, and the reason is the stage model
 * rather than the engine. This design provisions per stage, which makes stages
 * cheap to create and encourages having several — and a provisioned instance
 * puts a fixed monthly floor under every one of them. Aurora Serverless v2
 * defaults to `min: 0 ACU`, so an idle preview stage costs storage and nothing
 * else. A steady-state production workload may well be cheaper on a provisioned
 * instance; that is a per-stage decision and belongs in `ComponentOverrides`,
 * not in a declaration, because it varies by stage and by month rather than by
 * what the application *is*.
 *
 * :::caution
 * Switching between the two replaces the cluster. It is a different resource,
 * not a different setting.
 * :::
 *
 * **It also answers who provisions the read replica** — nobody does. A reader
 * endpoint is something an Aurora cluster *has*; `DatabaseReader` resolves that
 * endpoint rather than creating a replica behind it. Where a cluster has one
 * instance the reader endpoint still resolves, to that instance, which is the
 * same safe fallback the design already specified for `--target=server`:
 * read-only is enforced by the role's grants, never by which endpoint you
 * happened to reach.
 */
export class Database<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.Aurora
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.SSTPostgres;
	}

	/** The schema pinned on the connection's `search_path`, where one applies. */
	private readonly schema: string | undefined;

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: DatabaseProps,
	) {
		const { schema, ...args } = props;

		super(name, { engine: 'postgres', ...args });
		this._id = name;
		this.schema = schema;
	}

	/**
	 * One key, the URL a running handler connects with.
	 *
	 * The owner URL is deliberately not here. It exists — a migrator needs DDL
	 * rights — but it is wired straight into the migrator by the adapter, so no
	 * edge in any manifest can name it and nothing can be granted it by mistake.
	 *
	 * Composed through `@geekmidas/db`'s codec rather than by hand, which is what
	 * puts `search_path` in as a libpq `options` parameter. A plain
	 * `?search_path=` is accepted by every URL parser, ignored by the server, and
	 * produces a database that looks empty.
	 */
	provides(): Record<string, $util.Input<string>> {
		return { url: this.urlFor({}) };
	}

	/**
	 * This cluster's connection URL, optionally through the reader endpoint or
	 * pinned to a different schema.
	 *
	 * One composition serving three callers — the cluster itself, a reader, and
	 * a schema tenant — so the three cannot come to disagree about how a URL is
	 * put together. That matters more than it sounds: `search_path` is the part
	 * that goes quietly missing when the join is done by hand.
	 */
	urlFor(options: { reader?: boolean; schema?: string }): $util.Input<string> {
		const host = options.reader ? this.reader : this.host;
		const searchPath = options.schema ?? this.schema;

		return $util
			.all([host, this.port, this.database, this.username, this.password])
			.apply(([resolvedHost, port, database, username, password]) =>
				postgresUrl.build({
					host: resolvedHost,
					port,
					database,
					username,
					password,
					...(searchPath ? { searchPath } : {}),
				}),
			);
	}

	override getSSTLink() {
		const link = super.getSSTLink();
		return {
			...link,
			properties: { ...link.properties, ...this.provides() },
		};
	}
}

export interface DatabaseProps extends sst.aws.AuroraArgs {
	/** The schema to pin on the connection's `search_path`. */
	schema?: string;
}

/**
 * A database was declared and the deploy layer supplied no VPC.
 *
 * Not something the adapter can default. Aurora lives in a VPC, and creating one
 * means creating a NAT gateway — a real monthly cost, in an account whose
 * networking may already be someone else's decision. So it is required, named,
 * and supplied where other provider-specific props are.
 */
export class DatabaseNeedsVpc extends Error {
	constructor(readonly id: string) {
		super(
			`'${id}' is a database, and a database needs a VPC to live in. ` +
				`Supply one through the deploy layer — ` +
				`fromManifest(stack, manifest, { ${id}: { vpc } }) — because ` +
				`creating one means creating a NAT gateway, which costs money in an ` +
				`account whose networking may already be someone else's decision.`,
		);
		this.name = 'DatabaseNeedsVpc';
	}
}
