/**
 * Reaching a Dokploy Postgres from where the deploy runs.
 *
 * A Dokploy Postgres answers on the server's Docker network and nowhere else:
 * its address is its service name, which only another container there
 * resolves. Two steps of a deploy need it from outside — the role DDL the
 * provisioners defer, and the migrations `release` applies — so the cluster
 * is published on an external port for exactly as long as they take, and
 * closed again whatever happens.
 */

import { createHash } from 'node:crypto';
import { Client as PgClient } from 'pg';
import { output } from '../../output';
import type { SqlClient, Statement } from '../../reconcile/provision.js';
import { applyDeclared } from './declared';
import type { DokployApi } from './dokploy-api';
import type { DokployCluster } from './fromManifest';

const logger = output;

/** A Postgres published for the role DDL never accepted a connection. */
export class PostgresNotReady extends Error {
	constructor(
		readonly host: string,
		readonly port: number,
		readonly attempts: number,
	) {
		super(
			`Postgres not ready after ${attempts} retries (${host}:${port}). Check that the port is reachable from here — a firewall in front of the server drops it silently — and deploy again.`,
		);
		this.name = 'PostgresNotReady';
	}
}

/** No port could be published for a cluster, so its DDL cannot reach it. */
export class PostgresPortUnavailable extends Error {
	constructor(
		readonly appName: string,
		readonly taken: readonly number[],
	) {
		super(
			`Could not publish a port for ${appName}. ` +
				`In use on this server: ${[...taken].sort((a, b) => a - b).join(', ') || 'none reported'}. ` +
				`The role DDL needs to reach the cluster from here.`,
		);
		this.name = 'PostgresPortUnavailable';
	}
}

/**
 * Wait for Postgres to be ready to accept connections.
 *
 * Polls the Postgres server until it accepts a connection or max retries reached.
 * Used after enabling the external port to ensure the database is accessible
 * before creating users.
 *
 * @throws {PostgresNotReady} if Postgres is not ready after maxRetries
 */
export async function waitForPostgres(
	host: string,
	port: number,
	user: string,
	password: string,
	database: string,
	maxRetries = 30,
	retryIntervalMs = 2000,
): Promise<void> {
	for (let i = 0; i < maxRetries; i++) {
		try {
			// Bounded, because the interesting failure is not a refused connection
			// but a dropped one: while the container restarts around a port change,
			// the host drops the SYN rather than answering it, and an unbounded
			// connect waits out the OS timeout — a minute and a quarter — and then
			// reports ETIMEDOUT from inside a retry loop that never got to retry.
			const client = new PgClient({
				host,
				port,
				user,
				password,
				database,
				connectionTimeoutMillis: 5_000,
			});
			// A socket that dies *after* connecting emits on the client, and an
			// unhandled 'error' event takes the whole process down — which is how
			// a deploy went from "retrying" to a Node stack trace mid-run. The
			// retry loop below is the thing that decides what to do about it.
			client.on('error', () => {});
			await client.connect();
			await client.end();
			return;
		} catch {
			if (i < maxRetries - 1) {
				logger.log(`   Waiting for Postgres... (${i + 1}/${maxRetries})`);
				await new Promise((r) => setTimeout(r, retryIntervalMs));
			}
		}
	}
	throw new PostgresNotReady(host, port, maxRetries);
}

/**
 * A high port for one service, the same one every time.
 *
 * Derived from the service name rather than random so two deploys of the same
 * database agree and two different databases do not collide — and in the
 * ephemeral range, above anything a server is likely to have bound
 * deliberately.
 */
function derivedPort(appName: string): number {
	const digest = createHash('sha256').update(appName).digest();

	return 49152 + (((digest[0]! << 8) | digest[1]!) % 16000);
}

/** A cluster reachable from here, until `close` is called. */
export interface PublishedPostgres {
	cluster: DokployCluster;
	/** The server's own hostname, where the port is published. */
	host: string;
	port: number;
	/**
	 * Unpublish the port, if this opened it. Safe to call more than once; it
	 * never throws — a port it cannot close is reported to close by hand.
	 */
	close(): Promise<void>;
}

/** The hostname of the Dokploy server, from its API endpoint. */
export function serverHostname(endpoint: string): string {
	return new URL(endpoint).hostname;
}

/**
 * Publish `cluster` on an external port of the server at `host`, and wait
 * until it accepts a connection there.
 */
export async function publishPostgres(
	api: DokployApi,
	cluster: DokployCluster,
	host: string,
): Promise<PublishedPostgres> {
	// Reuse whatever is already published, and otherwise pick a high port that
	// nothing on the host is likely to hold.
	//
	// 5432 was hardcoded, which fails the moment a server runs a second Postgres
	// — and this one runs fourteen. The error is `Port 5432 is already in use`,
	// from Docker rather than from anything the deploy could anticipate.
	const existing = await api
		.getPostgres(cluster.postgresId)
		.then((current) => current.externalPort)
		.catch(() => null);

	// 5432 first, then a derived port — and the order matters more than it looks.
	//
	// A high port is the tidier choice on a host running several clusters, and it
	// is also the one a firewall almost certainly drops: a VPS typically permits
	// 22, 80, 443 and whatever was opened deliberately. Publishing 55337 here
	// produced thirty polite retries against a port nothing outside could ever
	// reach, while 5432 had worked minutes earlier.
	//
	// So: the conventional port, which is the one an operator has plausibly
	// allowed, and a derived fallback only when something already holds it.
	// Already published? Use it. Re-saving the port a container already holds is
	// rejected by Docker as a conflict with *itself*, which reads like the port
	// being taken by something else.
	let externalPort = existing ?? undefined;
	const opened = externalPort === undefined;

	if (externalPort === undefined) {
		// Ask the server what it has bound rather than guessing and retrying. A
		// port free from here can be held by a service in another project, and
		// the failure names a container the caller has never heard of.
		const taken = await api.publishedPorts().catch(() => new Set<number>());

		// 5432 first when it is free: it is conventional, and therefore the port
		// an operator has plausibly allowed through the firewall. Being *free* and
		// being *reachable* are different questions and only the first has an API.
		const candidates = [5432, derivedPort(cluster.appName)].filter(
			(port) => !taken.has(port),
		);

		for (const candidate of candidates) {
			try {
				await api.savePostgresExternalPort(cluster.postgresId, candidate);
				externalPort = candidate;
				break;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (!message.includes('already in use')) throw error;

				logger.log(`   Port ${candidate} is taken; trying another...`);
			}
		}

		if (externalPort === undefined) {
			throw new PostgresPortUnavailable(cluster.appName, [...taken]);
		}

		logger.log(`   Publishing ${cluster.appName} on ${externalPort}...`);
	}

	const port = externalPort;
	let closed = false;
	// Whatever happens after this, the database does not stay exposed. A port
	// opened to run DDL and left open is a database on the public internet —
	// which is what a failure part way used to leave behind.
	const close = async () => {
		// Only what this call opened. A port somebody published deliberately is
		// theirs, and closing it would be a deploy quietly changing how their
		// database is reached.
		if (!opened || closed) return;
		closed = true;

		await api
			.savePostgresExternalPort(cluster.postgresId, null)
			.then(() => api.deployPostgres(cluster.postgresId))
			.catch(() => {
				logger.log(
					`   ⚠ Could not close external port ${port} on ${cluster.appName} — close it in Dokploy.`,
				);
			});
	};

	try {
		await api.deployPostgres(cluster.postgresId);
		await waitForPostgres(
			host,
			port,
			cluster.databaseUser,
			cluster.databasePassword,
			cluster.databaseName,
		);
	} catch (error) {
		await close();
		throw error;
	}

	return { cluster, host, port, close };
}

/**
 * A URL the cluster's containers use — its service name, its internal port —
 * pointed at where `published` answers from here instead.
 */
export function publishedUrl(
	url: string,
	published: PublishedPostgres,
): string {
	const parsed = new URL(url);
	parsed.hostname = published.host;
	parsed.port = String(published.port);
	return parsed.toString();
}

/**
 * Run the manifest's DDL against a published Dokploy Postgres.
 *
 * The applier is the local target's, so every statement asks whether it is
 * needed first: a redeploy is free, and a half-applied run recovers by being
 * run again.
 */
export async function applyDeclaredStatements(
	published: PublishedPostgres,
	statements: readonly Statement[],
): Promise<number> {
	const { cluster, host, port } = published;

	// As the cluster master, which is the only credential that exists before any
	// role does — the same reason the AWS bootstrap connects as one.
	const client: SqlClient = {
		async query(database, sql, values) {
			const connection = new PgClient({
				host,
				port,
				user: cluster.databaseUser,
				password: cluster.databasePassword,
				database: database ?? cluster.databaseName,
				connectionTimeoutMillis: 15_000,
			});
			// See `waitForPostgres`: the port is only reachable while published,
			// and the container restarts around that change, so the socket can
			// drop mid-statement. Swallowed here and surfaced by the awaited
			// call, which the retry can actually act on.
			connection.on('error', () => {});

			await connection.connect();
			try {
				const result = await connection.query(sql, values as never[]);
				return result.rows;
			} finally {
				await connection.end();
			}
		},
	};

	// Attempt, then wait for the cluster and attempt again.
	//
	// Publishing an external port *restarts* the container, and a TCP connect
	// succeeds against an instance that is still settling — so a pass can die
	// partway with `terminating connection due to administrator command`, or
	// with the connection dropped outright while the port rule is rewritten.
	// Retrying is safe because the applier is convergent: every statement asks
	// whether it is needed, so a later pass reapplies nothing an earlier one
	// managed. Three passes rather than two because the first restart and the
	// settling after it are separate events, and hitting both in one run is
	// ordinary rather than exceptional.
	let lastError: unknown;
	for (let attempt = 1; attempt <= 3; attempt++) {
		try {
			return await applyDeclared(client, statements);
		} catch (error) {
			lastError = error;
			if (attempt === 3) break;

			const message = error instanceof Error ? error.message : String(error);
			logger.log(
				`   ⏳ Cluster still settling (${message}); retrying (${attempt}/2)...`,
			);

			await new Promise((resolve) => setTimeout(resolve, 10_000));
			await waitForPostgres(
				host,
				port,
				cluster.databaseUser,
				cluster.databasePassword,
				cluster.databaseName,
			).catch(() => {});
		}
	}

	throw lastError;
}
