/**
 * Creating what the URLs name.
 *
 * Convergent and idempotent: every statement asks whether the thing exists
 * first, so reconciling repeatedly is free and a half-applied run recovers by
 * being run again. That property is what lets `gkm dev` do this on every start.
 *
 * The line the design draws is at data, not at side effects — this creates
 * databases, schemas, and buckets, and it never seeds, resets, or drops. A
 * developer who wants their data gone asks for it explicitly.
 *
 * Statement generation is separated from application for the reason the design
 * gives: the same DDL has to run in-process locally and from a provisioner in a
 * VPC, and one implementation is what stops "works locally, fails deployed".
 * When the role DDL lands in `@geekmidas/db` this delegates to it rather than
 * growing its own.
 */

import { cacheTableStatements } from '@geekmidas/cache/postgres';
import { ownerRole, readerRole, roleStatements } from '@geekmidas/db/pg/roles';
import { cacheTable } from '@geekmidas/manifest';
import { localRole, localRolePassword, rootDatabase } from './env';
import type { Plan, PlannedResource } from './plan';

/** One thing to create, and how to tell whether it already exists. */
export interface Statement {
	/** The construct this is for, so a failure can name it. */
	id: string;
	/** What it does, in the line reconcile prints. */
	describe: string;
	/** The database to connect to. Absent means the cluster's default. */
	database?: string;
	/**
	 * Answers "does this already exist", parameterised.
	 *
	 * Absent for a statement that is idempotent in itself — a `GRANT` re-granting
	 * what is already granted is a no-op, and checking would cost a round trip to
	 * learn nothing. Those run every time and report unchanged.
	 */
	exists?: { sql: string; values: unknown[] };
	/**
	 * The DDL, run only when `exists` returns nothing.
	 *
	 * Not parameterised, because identifiers cannot be — which is why
	 * {@link quoteIdentifier} exists and why names are canonicalised long before
	 * they reach here.
	 */
	create: string;
}

/**
 * The Postgres work a plan implies.
 *
 * Databases before the schemas inside them, which `provisionOrder` already
 * guarantees by putting parents first.
 */
export function postgresStatements(
	plan: Plan,
	/**
	 * Seeds the derived role passwords. The same project seeds the same
	 * passwords, so a restart does not lock a developer out of their own data —
	 * and two checkouts do not share a credential.
	 */
	project = '',
): Statement[] {
	const statements: Statement[] = [];

	for (const resource of plan.resources) {
		if (!resource.provisions || resource.container !== 'postgres') continue;

		if (resource.kind === 'database') {
			statements.push({
				id: resource.id,
				describe: `database ${resource.name}`,
				exists: {
					sql: 'SELECT 1 FROM pg_database WHERE datname = $1',
					values: [resource.name],
				},
				// `CREATE DATABASE` cannot run inside a transaction, which is why
				// each statement is applied on its own rather than batched.
				create: `CREATE DATABASE ${quoteIdentifier(resource.name)}`,
			});

			// After the database, never before: roles are cluster-scoped but their
			// grants are not, so every statement after the first two has to run
			// against a database that exists.
			if (resource.schema) {
				statements.push(...rolesFor(resource, resource.schema, plan, project));
			}
			continue;
		}

		if (resource.kind === 'database-schema' && resource.schema) {
			// The schema *and* the roles that reach it, from one generator shared
			// with the deploy target — the same DDL has to run in-process here and
			// from a provisioner in a VPC, and one implementation is what stops
			// "works locally, fails deployed".
			statements.push(...rolesFor(resource, resource.schema, plan, project));
		}

		// A cache that lives in a database is a table in it, and a table is DDL —
		// so the owner creates it, not the handler's role, which may not create
		// anything. The same reason the driver does not do it lazily.
		//
		// `of` is the whole test: `planFor` resolves a `cache: 'db'` backend into
		// that edge before anything reads the plan, so a cache lands in a
		// database exactly one way and this does not have to know the config
		// existed.
		const cacheHome =
			resource.kind === 'cache' && resource.of
				? plan.resources.find((r) => r.id === resource.of)
				: undefined;

		if (cacheHome) {
			statements.push(...cacheTableDdl(resource, cacheHome, plan));
		}

		// A reader provisions nothing: it is a set of grants on an endpoint that
		// already exists, and falling back to the writer where no replica exists
		// stays safe because read-only is enforced by the role.
	}

	return statements;
}

/**
 * A cache's table, in the schema the role that reads it resolves names in.
 *
 * Two things have to line up, and neither is the table's contents. The driver
 * names the table unqualified and lets the connection's `search_path` place it
 * — which the role carries — so creating it from the master connection, whose
 * path is `public`, leaves a table the application cannot see and a
 * `relation "cache" does not exist` on the first request. And the default
 * privileges that make a tenant's tables reachable are granted *for the owner
 * role*, so nothing covers a table the master created.
 *
 * Hence: qualified with the tenant's schema, handed to its owner, and granted
 * explicitly — `roleStatements` grants what exists at the time it runs, and
 * this table does not exist yet.
 *
 * A database that opted out of roles needs none of it: everything connects as
 * the master, whose `search_path` finds `public`, and the table it creates
 * there is the table it reads.
 */
function cacheTableDdl(
	cache: PlannedResource,
	home: PlannedResource,
	plan: Plan,
): Statement[] {
	const database = rootDatabase(home, plan);
	const schema = home.roles === false ? undefined : home.schema;
	// The same default the URL carries — `cacheTable` is read by both, so the
	// table a client reads and the table a target creates cannot drift.
	const name = cache.table ?? cacheTable(cache.id);
	const table = schema ? `${schema}.${name}` : name;

	const created = cacheTableStatements({ table }).map((statement) => ({
		id: cache.id,
		describe: statement.describe,
		database,
		...(statement.exists ? { exists: statement.exists } : {}),
		create: statement.sql,
	}));

	if (!schema) return created;

	const runtime = localRole(home);
	const owner = ownerRole(runtime);
	const qualified = table
		.split('.')
		.map((part) => quoteIdentifier(part))
		.join('.');

	return [
		...created,
		{
			id: cache.id,
			describe: `cache table ${table} is owned by ${owner}`,
			database,
			create: `ALTER TABLE ${qualified} OWNER TO ${quoteIdentifier(owner)}`,
		},
		{
			id: cache.id,
			describe: `${runtime} may read and write ${table}`,
			database,
			create:
				`GRANT SELECT, INSERT, UPDATE, DELETE ON ${qualified} ` +
				`TO ${quoteIdentifier(runtime)}`,
		},
	];
}

/**
 * The roles and schema for one database or tenant.
 *
 * Skipped entirely when the construct declared `roles: false` — the documented
 * downgrade, where both URLs fall back to the cluster's master credential. It
 * is a choice someone made rather than a default they got.
 */
function rolesFor(
	resource: PlannedResource,
	schema: string,
	plan: Plan,
	project: string,
): Statement[] {
	if (resource.roles === false) return [];

	const runtime = localRole(resource);
	const owner = ownerRole(runtime);

	// A reader role only where something reads through one. Creating roles
	// nothing connects as is noise in `\du` and one more thing to explain.
	const reader = plan.resources.some(
		(r) => r.kind === 'database-reader' && r.of === resource.id,
	)
		? readerRole(runtime)
		: undefined;

	return roleStatements({
		runtime,
		owner,
		...(reader ? { reader } : {}),
		schema,
		passwords: {
			runtime: localRolePassword(project, plan, runtime),
			owner: localRolePassword(project, plan, owner),
			...(reader ? { reader: localRolePassword(project, plan, reader) } : {}),
		},
	}).map((statement) => ({
		id: resource.id,
		describe: statement.describe,
		// Inside the parent's database — a tenant is a schema, never a database
		// of its own. Roles are cluster-scoped, but the grants are not, so all of
		// it has to run against the database the objects live in.
		database: rootDatabase(resource, plan),
		...(statement.exists ? { exists: statement.exists } : {}),
		create: statement.sql,
	}));
}

/** The buckets a plan implies. */
export function bucketNames(plan: Plan): string[] {
	return plan.resources
		.filter((r) => r.provisions && r.kind === 'objects')
		.map((r) => r.name);
}

/**
 * Quote an identifier for use in DDL.
 *
 * Names reaching here are already canonical and stage-suffixed, so this is
 * defence rather than sanitisation — but DDL cannot be parameterised, and an
 * unquoted identifier is the one place a name could ever be more than a name.
 */
export function quoteIdentifier(name: string): string {
	return `"${name.replace(/"/g, '""')}"`;
}

/** What applying a statement did. */
export interface Applied {
	id: string;
	describe: string;
	/** False when it already existed — the converged case. */
	created: boolean;
}

/** The database operations the applier needs, so it can be run against a fake. */
export interface SqlClient {
	/** Run a query against one database, returning its rows. */
	query(
		database: string | undefined,
		sql: string,
		values?: unknown[],
	): Promise<unknown[]>;
}

/**
 * Apply the plan's Postgres statements.
 *
 * Each is checked before it is run, so this converges rather than erroring on a
 * second pass.
 */
export async function applyPostgres(
	client: SqlClient,
	statements: readonly Statement[],
): Promise<Applied[]> {
	const applied: Applied[] = [];

	for (const statement of statements) {
		// No check means the statement is idempotent in itself — a GRANT
		// re-granting what is already granted is a no-op — so it runs and
		// reports unchanged, and a converged reconcile still says converged.
		if (!statement.exists) {
			await client.query(statement.database, statement.create);
			applied.push({
				id: statement.id,
				describe: statement.describe,
				created: false,
			});
			continue;
		}

		const rows = await client.query(
			statement.database,
			statement.exists.sql,
			statement.exists.values,
		);

		if (rows.length > 0) {
			applied.push({
				id: statement.id,
				describe: statement.describe,
				created: false,
			});
			continue;
		}

		await client.query(statement.database, statement.create);
		applied.push({
			id: statement.id,
			describe: statement.describe,
			created: true,
		});
	}

	return applied;
}

/**
 * What each bucket's open paths are, if anything serves it.
 *
 * Keyed by the *origin*, because that is where the policy lives: two servers
 * over one bucket contribute to one policy, so the patterns are unioned rather
 * than the last one winning.
 */
export function bucketPolicies(
	plan: Plan,
): { bucket: string; open: string[] }[] {
	const byBucket = new Map<string, Set<string>>();

	for (const resource of plan.resources) {
		if (resource.kind !== 'file-server' || !resource.open?.length) continue;

		const origin = plan.resources.find((r) => r.id === resource.of);
		if (!origin) continue;

		const patterns = byBucket.get(origin.name) ?? new Set<string>();
		for (const pattern of resource.open) patterns.add(pattern);
		byBucket.set(origin.name, patterns);
	}

	return [...byBucket]
		.map(([bucket, open]) => ({ bucket, open: [...open].sort() }))
		.sort((a, b) => a.bucket.localeCompare(b.bucket));
}

/**
 * One bucket's open paths as an S3 bucket policy.
 *
 * Anonymous `s3:GetObject` on the named prefixes and nothing else — which is
 * what "open" means everywhere: the server serves that path without a
 * signature, and the bucket stays private for everything else.
 *
 * One fidelity note, stated rather than discovered: an S3 policy resource's `*`
 * crosses `/`, so a single-star pattern is *wider* here than the construct's own
 * runtime check, which stops at a segment boundary. The construct is the
 * stricter of the two, so a key it refuses to serve unsigned is never one this
 * policy was relied on to refuse — but a key fetched directly, bypassing the
 * client, can be admitted by the policy where the client would have said no.
 * Prefer `**` where crossing segments is what you meant.
 */
export function bucketPolicy(bucket: string, open: readonly string[]): string {
	return JSON.stringify({
		Version: '2012-10-17',
		Statement: [
			{
				Sid: 'GkmOpenPaths',
				Effect: 'Allow',
				Principal: { AWS: ['*'] },
				Action: ['s3:GetObject'],
				Resource: open.map(
					(pattern) =>
						`arn:aws:s3:::${bucket}/${pattern.replace(/\*\*/g, '*')}`,
				),
			},
		],
	});
}

/** The object-storage operations the applier needs. */
export interface BucketClient {
	exists(bucket: string): Promise<boolean>;
	create(bucket: string): Promise<void>;
	/** The bucket's current policy, or `undefined` where it has none. */
	policy(bucket: string): Promise<string | undefined>;
	setPolicy(bucket: string, policy: string): Promise<void>;
}

/**
 * Apply each served bucket's open-path policy, skipping those already correct.
 *
 * Compared as parsed JSON rather than as text: the same policy re-serialised
 * with different key order is the same policy, and rewriting it every reconcile
 * would report a change on every start.
 */
export async function applyPolicies(
	client: BucketClient,
	policies: readonly { bucket: string; open: string[] }[],
): Promise<Applied[]> {
	const applied: Applied[] = [];

	for (const { bucket, open } of policies) {
		const wanted = bucketPolicy(bucket, open);
		const describe = `open paths on ${bucket}`;

		if (equivalent(await client.policy(bucket), wanted)) {
			applied.push({ id: `${bucket}:policy`, describe, created: false });
			continue;
		}

		await client.setPolicy(bucket, wanted);
		applied.push({ id: `${bucket}:policy`, describe, created: true });
	}

	return applied;
}

/** Whether two policy documents say the same thing. */
function equivalent(current: string | undefined, wanted: string): boolean {
	if (!current) return false;

	try {
		return (
			JSON.stringify(JSON.parse(current)) === JSON.stringify(JSON.parse(wanted))
		);
	} catch {
		return false;
	}
}

/** Create every bucket the plan names, skipping those that exist. */
export async function applyBuckets(
	client: BucketClient,
	buckets: readonly string[],
): Promise<Applied[]> {
	const applied: Applied[] = [];

	for (const bucket of buckets) {
		if (await client.exists(bucket)) {
			applied.push({
				id: bucket,
				describe: `bucket ${bucket}`,
				created: false,
			});
			continue;
		}

		await client.create(bucket);
		applied.push({ id: bucket, describe: `bucket ${bucket}`, created: true });
	}

	return applied;
}

/** Everything a plan implies, for a caller that wants to show it. */
export function summarise(plan: Plan): string[] {
	return [
		...postgresStatements(plan).map((s) => s.describe),
		...bucketNames(plan).map((b) => `bucket ${b}`),
		...bucketPolicies(plan).map((p) => `open paths on ${p.bucket}`),
	];
}

/** Resources the plan resolves a URL for but creates nothing for. */
export function unprovisioned(plan: Plan): PlannedResource[] {
	return plan.resources.filter((r) => !r.provisions);
}
