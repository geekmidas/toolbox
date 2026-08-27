/**
 * The role DDL — an owner, a runtime role, and the grants between them.
 *
 * Generation only. The same statements have to run in-process from `gkm dev`
 * and from a provisioner inside a VPC at deploy, and one implementation is what
 * stops "works locally, fails deployed" — so this composes SQL and applies
 * none of it.
 *
 * **What the split is for.** A handler connects as the runtime role, which can
 * read and write rows and cannot create, alter, or drop anything. A migrator
 * connects as the owner, which can. That is a security property rather than a
 * convention — a compromised handler cannot `DROP TABLE` because its role holds
 * no such grant — and it is only a property at all once these statements have
 * actually run. Until then a schema is a namespace, not a boundary.
 *
 * **Passwords are an input.** This module invents no secrets: a caller derives
 * or fetches them and passes them in, because where a password comes from is
 * the one part that legitimately differs between a laptop and a deploy.
 */

/** The roles and schema one tenant needs. */
export interface RoleSpec {
	/** The role a handler connects as. Reads and writes rows; owns nothing. */
	runtime: string;
	/** The role a migrator connects as. Owns the schema and everything in it. */
	owner: string;
	/**
	 * A third role that may only read, for a reader endpoint.
	 *
	 * Optional because it is only worth creating where something points at it.
	 * Read-only is enforced *here*, by the grants, rather than by which endpoint
	 * a URL happens to name — which is what makes falling back to the writer's
	 * endpoint safe when a cluster has no replica.
	 */
	reader?: string;
	/** The schema they operate in, pinned on every role's `search_path`. */
	schema: string;
	/** Supplied, never generated here. */
	passwords: { runtime: string; owner: string; reader?: string };
}

/** One statement, and how to tell whether it still needs running. */
export interface RoleStatement {
	/** What it does, for the line a reconciler prints. */
	describe: string;
	/**
	 * Answers "does this already exist", parameterised.
	 *
	 * Absent means the statement is idempotent in itself and is run every time —
	 * a `GRANT` re-granting what is already granted is a no-op, and checking
	 * would cost a round trip to learn nothing.
	 */
	exists?: { sql: string; values: unknown[] };
	sql: string;
}

/**
 * Everything one tenant's roles need, in dependency order.
 *
 * The owner before the schema it owns, the schema before the grants on it. A
 * caller applies them in sequence and may stop at the first failure without
 * leaving a half-granted role that looks complete.
 */
export function roleStatements(spec: RoleSpec): RoleStatement[] {
	const { runtime, owner, schema, passwords } = spec;

	return [
		{
			describe: `role ${owner}`,
			exists: roleExists(owner),
			sql: `CREATE ROLE ${ident(owner)} LOGIN PASSWORD ${literal(passwords.owner)}`,
		},
		{
			describe: `role ${runtime}`,
			exists: roleExists(runtime),
			sql: `CREATE ROLE ${ident(runtime)} LOGIN PASSWORD ${literal(passwords.runtime)}`,
		},
		{
			describe: `schema ${schema}`,
			exists: {
				sql: 'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
				values: [schema],
			},
			// Owned by the owner from the moment it exists. Creating it as the
			// cluster master and granting afterwards leaves a window where the
			// master owns objects the owner is supposed to.
			sql: `CREATE SCHEMA ${ident(schema)} AUTHORIZATION ${ident(owner)}`,
		},
		{
			describe: `${runtime} may use ${schema}`,
			sql: `GRANT USAGE ON SCHEMA ${ident(schema)} TO ${ident(runtime)}`,
		},
		{
			// The important half: *future* tables. A grant on what exists today
			// covers nothing the next migration creates, which is how a runtime
			// role silently loses access one deploy later.
			describe: `${runtime} may read and write future tables in ${schema}`,
			sql:
				`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(owner)} IN SCHEMA ${ident(schema)} ` +
				`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ident(runtime)}`,
		},
		{
			describe: `${runtime} may use future sequences in ${schema}`,
			sql:
				`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(owner)} IN SCHEMA ${ident(schema)} ` +
				`GRANT USAGE, SELECT ON SEQUENCES TO ${ident(runtime)}`,
		},
		{
			// And the tables that are already there, for a schema that existed
			// before its roles did.
			describe: `${runtime} may read and write existing tables in ${schema}`,
			sql:
				`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${ident(schema)} ` +
				`TO ${ident(runtime)}`,
		},
		{
			describe: `${runtime} may use existing sequences in ${schema}`,
			sql: `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${ident(schema)} TO ${ident(runtime)}`,
		},
		{
			// Pinned on the role rather than carried in every URL. A connection
			// string that has to remember `search_path` is one that eventually
			// forgets, and the forgetting looks like an empty database.
			describe: `${runtime} resolves names in ${schema}`,
			sql: `ALTER ROLE ${ident(runtime)} SET search_path TO ${ident(schema)}`,
		},
		{
			describe: `${owner} resolves names in ${schema}`,
			sql: `ALTER ROLE ${ident(owner)} SET search_path TO ${ident(schema)}`,
		},
		...(spec.reader ? readerStatements(spec, spec.reader) : []),
	];
}

/**
 * A role that may read and nothing else.
 *
 * `SELECT` and no more, on what exists and on what the owner creates later. No
 * `INSERT`, no `UPDATE`, no `DELETE`, and no sequence `USAGE` — a reader that
 * could take a sequence value could not write the row it was for, so granting
 * it would be surface with no use.
 */
function readerStatements(spec: RoleSpec, reader: string): RoleStatement[] {
	const { owner, schema, passwords } = spec;
	const password = passwords.reader;

	if (!password) throw new ReaderNeedsPassword(reader);

	return [
		{
			describe: `role ${reader}`,
			exists: roleExists(reader),
			sql: `CREATE ROLE ${ident(reader)} LOGIN PASSWORD ${literal(password)}`,
		},
		{
			describe: `${reader} may use ${schema}`,
			sql: `GRANT USAGE ON SCHEMA ${ident(schema)} TO ${ident(reader)}`,
		},
		{
			describe: `${reader} may read future tables in ${schema}`,
			sql:
				`ALTER DEFAULT PRIVILEGES FOR ROLE ${ident(owner)} IN SCHEMA ${ident(schema)} ` +
				`GRANT SELECT ON TABLES TO ${ident(reader)}`,
		},
		{
			describe: `${reader} may read existing tables in ${schema}`,
			sql: `GRANT SELECT ON ALL TABLES IN SCHEMA ${ident(schema)} TO ${ident(reader)}`,
		},
		{
			describe: `${reader} resolves names in ${schema}`,
			sql: `ALTER ROLE ${ident(reader)} SET search_path TO ${ident(schema)}`,
		},
	];
}

/** A reader role was named and no password was supplied for it. */
export class ReaderNeedsPassword extends Error {
	constructor(readonly role: string) {
		super(
			`'${role}' is a reader role and no password was supplied for it. ` +
				`This module composes DDL and invents no secrets: pass ` +
				`passwords.reader alongside the role name.`,
		);
		this.name = 'ReaderNeedsPassword';
	}
}

/** The read-only role's name for a given runtime role. */
export function readerRole(runtime: string): string {
	return `${runtime}_reader`;
}

/** The owner role's name for a given runtime role. */
export function ownerRole(runtime: string): string {
	return `${runtime}_owner`;
}

function roleExists(role: string): { sql: string; values: unknown[] } {
	return { sql: 'SELECT 1 FROM pg_roles WHERE rolname = $1', values: [role] };
}

/**
 * Quote an identifier for use in DDL.
 *
 * Names reaching here are already canonical, so this is defence rather than
 * sanitisation — but DDL cannot be parameterised, and an unquoted identifier is
 * the one place a name could ever be more than a name.
 */
function ident(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Quote a string literal.
 *
 * A password cannot be a bind parameter in `CREATE ROLE`, which is the one
 * place in this module where a value rather than a name is interpolated — so it
 * is escaped rather than trusted, whatever the caller believes it derived.
 */
function literal(value: string): string {
	return `'${value.replace(/'/g, "''")}'`;
}
