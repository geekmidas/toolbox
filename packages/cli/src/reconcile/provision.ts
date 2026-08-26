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

import { rootDatabase } from './env';
import type { Plan, PlannedResource } from './plan';

/** One thing to create, and how to tell whether it already exists. */
export interface Statement {
	/** The construct this is for, so a failure can name it. */
	id: string;
	/** What it does, in the line reconcile prints. */
	describe: string;
	/** The database to connect to. Absent means the cluster's default. */
	database?: string;
	/** Answers "does this already exist", parameterised. */
	exists: { sql: string; values: unknown[] };
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
export function postgresStatements(plan: Plan): Statement[] {
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
			continue;
		}

		if (resource.kind === 'database-schema' && resource.schema) {
			statements.push({
				id: resource.id,
				describe: `schema ${resource.schema}`,
				// Inside the parent's database — a tenant is a schema, never a
				// database of its own.
				database: rootDatabase(resource, plan),
				exists: {
					sql: 'SELECT 1 FROM information_schema.schemata WHERE schema_name = $1',
					values: [resource.schema],
				},
				create: `CREATE SCHEMA ${quoteIdentifier(resource.schema)}`,
			});
		}

		// A reader provisions nothing: it is a set of grants on an endpoint that
		// already exists, and falling back to the writer where no replica exists
		// stays safe because read-only is enforced by the role.
	}

	return statements;
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
