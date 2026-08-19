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

/** The object-storage operations the applier needs. */
export interface BucketClient {
	exists(bucket: string): Promise<boolean>;
	create(bucket: string): Promise<void>;
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
	];
}

/** Resources the plan resolves a URL for but creates nothing for. */
export function unprovisioned(plan: Plan): PlannedResource[] {
	return plan.resources.filter((r) => !r.provisions);
}
