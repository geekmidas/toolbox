/**
 * Composing a `postgres://` connection string.
 *
 * One direction only. Parsing exists in `pg` already — every consumer hands the
 * string straight to `new Pool({ connectionString })` — so a parser here would
 * be surface whose only caller is its own round-trip test.
 *
 * What is *not* already solved is composition: a provisioned instance exposes
 * host, port, database, username, and password as five separate values, and the
 * construct reads one URL. Doing that join by hand is where `search_path`
 * quietly goes missing.
 *
 * A URL built here is a secret — it carries the role's password. See
 * {@link redactDatabaseUrl} before writing one anywhere.
 */

import { MissingDatabaseHost, MissingDatabaseName } from '../errors';

/** What a Postgres connection string addresses. */
export interface PostgresAddress {
	host: string;
	port?: number;
	/** The logical database. */
	database: string;
	/** The role connecting — which is what decides DDL versus DML. */
	username?: string;
	password?: string;
	/**
	 * The schema to resolve unqualified names against.
	 *
	 * Normally pinned on the *role* instead (`ALTER ROLE … SET search_path`), so
	 * it does not appear in the URL at all. It is carried here for the one case
	 * with no role of its own to pin — connecting as the cluster master under
	 * `roles: false` — where without it every query looks in `public`.
	 *
	 * Postgres-specific by nature, not just by spelling: it becomes a libpq
	 * connection option, and no other engine accepts one. MySQL has no schemas
	 * distinct from databases at all.
	 */
	searchPath?: string;
	/** Off only for local development, where there is no certificate to verify. */
	ssl?: boolean;
}

const SCHEME = 'postgres:';

const DEFAULT_PORT = 5432;

/**
 * `search_path` travels as a libpq connection option, not a query parameter.
 * The server reads `options`; a plain `?search_path=app` is accepted by the URL
 * parser, ignored by the server, and produces a database that looks empty.
 * The `-c` prefix is what makes it a runtime configuration setting.
 */
function searchPathOption(schema: string): string {
	return `-c search_path=${schema}`;
}

/** Compose an address into a connection string. */
export function build(address: PostgresAddress): string {
	const { host, port, database, username, password, searchPath, ssl } = address;

	if (!host) throw new MissingDatabaseHost();
	if (!database) throw new MissingDatabaseName();

	const url = new URL(`${SCHEME}//`);
	url.hostname = host;
	if (port && port !== DEFAULT_PORT) url.port = String(port);
	// Username before password: WHATWG URL drops a password set without one.
	if (username) url.username = encodeURIComponent(username);
	if (password) url.password = encodeURIComponent(password);
	url.pathname = `/${database}`;

	if (searchPath) url.searchParams.set('options', searchPathOption(searchPath));
	if (ssl === false) url.searchParams.set('sslmode', 'disable');

	return url.toString();
}
