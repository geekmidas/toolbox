import * as postgresUrl from '@geekmidas/db/pg/url';
import { type GkmLinkable, ResourceType } from '../Linkable';
import type { StackType } from '../Stack';

/**
 * `Database` — an RDS Postgres instance, and the infra half of the `database`
 * kind.
 *
 * **A provisioned instance rather than Aurora Serverless v2.** Aurora is the
 * more interesting answer on paper — it scales to zero, so an idle preview
 * stage costs storage and nothing else, which suits a design that provisions
 * per stage. It is also a cluster: more moving parts, a different resource
 * type, and pricing that is harder to predict for the steady-state workload
 * most stages actually are. A plain instance is the ordinary thing, and the
 * ordinary thing is the better default.
 *
 * Aurora is not reachable from here: this class *is* the RDS component and its
 * props are that component's args, so a stage wanting a cluster needs a second
 * class rather than an override. Worth adding when something wants it; not
 * worth pretending it already exists.
 *
 * :::caution
 * Moving between the two replaces the database. They are different resources,
 * not different settings — the data does not come with you.
 * :::
 *
 * **Who provisions the read replica** — nobody does, and a reader resolves to
 * the writer's address. An Aurora cluster has a reader endpoint; an RDS
 * instance has no second address to hand out, so `DatabaseReader` returns this
 * one. That is the fallback the design already specified for `--target=server`
 * and it is safe for the same reason: read-only is enforced by the role's
 * grants, never by which endpoint you happened to reach. Adding `replicas`
 * creates instances but no endpoint that balances across them, so it changes
 * nothing here.
 */
export class Database<
		TStage extends string = string,
		TDomain extends string = string,
	>
	extends sst.aws.Postgres
	implements GkmLinkable
{
	readonly _id!: string;

	get _type() {
		return ResourceType.SSTPostgres;
	}

	/** The schema pinned on the connection's `search_path`, where one applies. */
	private readonly schema: string | undefined;

	/**
	 * The VPC this cluster lives in.
	 *
	 * Kept so the bootstrap function can be put in the same one — a database
	 * reachable from outside its VPC is the problem the requirement avoids, and
	 * the DDL has to reach it from inside.
	 */
	readonly vpc: sst.aws.Vpc;

	constructor(
		_stack: StackType<TStage, TDomain>,
		name: string,
		props: DatabaseProps,
	) {
		const { schema, ...args } = props;

		super(name, args);
		this._id = name;
		this.schema = schema;
		this.vpc = args.vpc;
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
	urlFor(options: {
		/**
		 * Ask for the read path.
		 *
		 * Kept in the signature and currently resolved to the same address: an
		 * RDS instance has one endpoint. It states the caller's intent — a reader
		 * wants the read path — so moving a stage to a cluster that *has* a second
		 * endpoint changes one line here rather than every call site. What makes
		 * the connection read-only is the role it authenticates as, not this.
		 */
		reader?: boolean;
		schema?: string;
		/**
		 * Connect as a role other than the master.
		 *
		 * What every tenant does. The master credential exists before any role
		 * does, which is why the bootstrap uses it and why nothing else should: a
		 * handler holding it could drop the database it was reading.
		 */
		as?: { user: $util.Input<string>; password: $util.Input<string> };
	}): $util.Input<string> {
		// One address: an RDS instance has no reader endpoint. Reading through the
		// writer is safe because the reader *role* is what forbids writing.
		const host = this.host;
		// A role carries its own `search_path`, pinned by `ALTER ROLE`. It goes in
		// the URL only for the master, which has no role of its own to pin it on.
		const searchPath = options.as ? undefined : (options.schema ?? this.schema);

		return $util
			.all([
				host,
				this.port,
				this.database,
				options.as?.user ?? this.username,
				options.as?.password ?? this.password,
			])
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

export interface DatabaseProps extends Omit<sst.aws.PostgresArgs, 'vpc'> {
	/** The schema to pin on the connection's `search_path`. */
	schema?: string;
	/**
	 * The VPC the database lives in.
	 *
	 * Narrowed to the component from the wider argument the RDS component
	 * accepts, because the bootstrap function has to run in this same VPC and a
	 * function needs security groups as well as subnets — which the loose form
	 * cannot carry. Requiring the component means one thing is passed and both
	 * halves can use it.
	 */
	vpc: sst.aws.Vpc;
}

/**
 * A database was declared and the deploy layer supplied no VPC.
 *
 * Not something the adapter can default. RDS lives in a VPC, and creating one
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
