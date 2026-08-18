/**
 * `KyselyDatabase` — a declared Postgres database, typed by its schema.
 *
 * It declares a logical database, a schema, and the roles that reach it, and
 * hands back a Kysely client built from the one URL the adapter supplied. It
 * names no cloud: `--target=aws` fills that URL from RDS, local dev from the
 * Postgres container.
 *
 * Transactions and RLS context are the execution wrapper's job — it opens the
 * transaction and puts it in `ctx.db`. This construct does not resolve
 * connections per request.
 */

import {
	type ConstructName,
	canonicalId,
	type Declaration,
	provideKey,
	serviceKey,
} from '@geekmidas/manifest';
import type { Service, ServiceRegisterOptions } from '@geekmidas/services';
import { Kysely, type KyselyConfig, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { Construct } from '../construct-interface';

/** The schema a database uses when it does not say otherwise. */
const DEFAULT_SCHEMA = 'app';

/**
 * Everything Kysely takes, plus what this construct declares.
 *
 * `dialect` is omitted because the construct owns it — it is built from the one
 * URL the adapter supplied, which is the whole point of the construct. The rest
 * of `KyselyConfig` (`plugins`, `log`) is the app's business and passes
 * straight through, so anything Kysely adds later arrives without being
 * tracked here.
 */
export interface KyselyDatabaseOptions extends Omit<KyselyConfig, 'dialect'> {
	/**
	 * The schema, pinned on both roles' `search_path`.
	 *
	 * Defaults to `app` — the role the schema plays, rather than a restatement
	 * of the database's own name, which reads correctly beside `auth` and
	 * `pgboss` and keeps the application off `public`.
	 */
	schema?: string;
	/**
	 * Provision the owner/runtime role split. Defaults to on.
	 *
	 * Off falls back to the cluster's master credential in both URLs, giving up
	 * the DDL/DML split and putting credentials that can drop a table into the
	 * function's environment. A deliberate downgrade, not a default.
	 */
	roles?: boolean;
}

/** What makes a construct derived rather than a database in its own right. */
interface DerivedFrom {
	kind: 'database-reader' | 'database-schema';
	of: string;
	schema?: string;
}

/**
 * @typeParam DB - the database's schema.
 * @typeParam TName - the canonical id. TypeScript has no partial
 * type-argument inference, so `new KyselyDatabase<OrdersDB>('orders')` leaves
 * this at its default and the service key widens to `string`. `db` still types
 * through `.database()`, which infers from the service.
 */
export class KyselyDatabase<DB = unknown, TName extends string = string>
	implements Construct<TName, Kysely<DB>>
{
	readonly id: TName;
	readonly service: Service<Uncapitalize<TName>, Kysely<DB>>;

	/**
	 * Declared once and read by both `declare()` and `connect()`, so the key the
	 * build publishes and the key the client reads cannot drift.
	 */
	private readonly config: { url: string };
	private readonly schemaName: string;
	private readonly roles: boolean;
	private readonly derivedFrom?: DerivedFrom;

	constructor(
		id: ConstructName<TName>,
		private readonly options: KyselyDatabaseOptions = {},
		derivedFrom?: DerivedFrom,
	) {
		// Canonicalises, so `orders` and `Orders` are one construct rather than
		// two that collide. Throws on anything that cannot become a valid id.
		const canonical = canonicalId(id as string);

		this.id = canonical as TName;
		this.config = { url: provideKey(canonical, 'url') };
		this.schemaName = options.schema ?? DEFAULT_SCHEMA;
		this.roles = options.roles ?? true;
		this.derivedFrom = derivedFrom;

		// A field, not a getter: service discovery caches by object identity.
		this.service = {
			serviceName: serviceKey(canonical) as Uncapitalize<TName>,
			// Forwards the whole options object — cherry-picking `envParser` strips
			// `context` and with it the request-scoped logger.
			register: (registerOptions) => this.connect(registerOptions),
		};
	}

	declare(): Declaration[] {
		if (this.derivedFrom) {
			const { kind, of, schema } = this.derivedFrom;

			return [
				kind === 'database-schema'
					? {
							kind,
							id: this.id,
							of,
							schema: schema ?? this.schemaName,
							provides: Object.values(this.config),
						}
					: { kind, id: this.id, of, provides: Object.values(this.config) },
			];
		}

		return [
			{
				kind: 'database',
				id: this.id,
				engine: 'postgres',
				schema: this.schemaName,
				// One key, the runtime role's. The owner URL is wired straight to the
				// migrator by the adapter, so no edge in any manifest can name it.
				provides: Object.values(this.config),
				...(this.roles ? {} : { roles: false }),
			},
		];
	}

	/**
	 * A read-only endpoint on this database.
	 *
	 * Read-only is enforced by the reader role's grants rather than by which
	 * endpoint it resolves to, so falling back to the writer where no replica
	 * exists is safe rather than a silently writable connection behind a name
	 * that says reader. There is no `writer()`: the database *is* the writer, so
	 * a replica can never be reached by accident.
	 */
	reader(): KyselyDatabase<DB, `${TName}Reader`> {
		return new KyselyDatabase<DB, `${TName}Reader`>(
			`${this.id}Reader` as ConstructName<`${TName}Reader`>,
			this.options,
			{ kind: 'database-reader', of: this.id },
		);
	}

	/**
	 * A second schema in this database, with its own role(s) and its own URL —
	 * so this database's role holds no grant on those tables at all.
	 *
	 * Typed separately because a tenant has its own tables: the point is that
	 * `auth.selectFrom('sessions')` type-checks and
	 * `orders.selectFrom('sessions')` does not.
	 */
	schema<TenantDB, TTenant extends string>(
		id: ConstructName<TTenant>,
		options: KyselyDatabaseOptions = {},
	): KyselyDatabase<TenantDB, TTenant> {
		return new KyselyDatabase<TenantDB, TTenant>(id, options, {
			kind: 'database-schema',
			of: this.id,
			schema: options.schema ?? (id as string).toLowerCase(),
		});
	}

	private async connect(options: ServiceRegisterOptions): Promise<Kysely<DB>> {
		const { url } = options.envParser
			.create((get) => ({ url: get(this.config.url).string() }))
			.parse();

		// Split what the manifest declared from what Kysely takes, so neither
		// leaks into the other: `schema` and `roles` describe infrastructure and
		// mean nothing to a client.
		const { schema: _schema, roles: _roles, ...kysely } = this.options;

		return new Kysely<DB>({
			...kysely,
			dialect: new PostgresDialect({
				pool: new pg.Pool({ connectionString: url }),
			}),
		});
	}
}
