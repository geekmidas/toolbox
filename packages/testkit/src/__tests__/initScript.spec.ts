import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseInitScript, runInitScript } from '../initScript';

describe('parseInitScript', () => {
	it('should extract SQL from EOSQL heredoc blocks', () => {
		const script = `#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER api WITH PASSWORD '$API_DB_PASSWORD';
    GRANT ALL ON SCHEMA public TO api;
EOSQL
`;

		const blocks = parseInitScript(script, {
			POSTGRES_USER: 'app',
			POSTGRES_DB: 'mydb',
			API_DB_PASSWORD: 'secret123',
		});

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toContain("CREATE USER api WITH PASSWORD 'secret123'");
		expect(blocks[0]).toContain('GRANT ALL ON SCHEMA public TO api');
	});

	it('should extract multiple heredoc blocks', () => {
		const script = `#!/bin/bash
set -e

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER api WITH PASSWORD '$API_DB_PASSWORD';
EOSQL

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER auth WITH PASSWORD '$AUTH_DB_PASSWORD';
    CREATE SCHEMA auth AUTHORIZATION auth;
EOSQL

echo "Done!"
`;

		const blocks = parseInitScript(script, {
			POSTGRES_USER: 'app',
			POSTGRES_DB: 'mydb',
			API_DB_PASSWORD: 'apipass',
			AUTH_DB_PASSWORD: 'authpass',
		});

		expect(blocks).toHaveLength(2);
		expect(blocks[0]).toContain("CREATE USER api WITH PASSWORD 'apipass'");
		expect(blocks[1]).toContain("CREATE USER auth WITH PASSWORD 'authpass'");
		expect(blocks[1]).toContain('CREATE SCHEMA auth AUTHORIZATION auth');
	});

	it('should substitute $VAR_NAME syntax', () => {
		const script = `psql <<-EOSQL
    CREATE USER $APP_USER WITH PASSWORD '$APP_PASSWORD';
EOSQL`;

		const blocks = parseInitScript(script, {
			APP_USER: 'myuser',
			APP_PASSWORD: 'mypass',
		});

		expect(blocks[0]).toContain("CREATE USER myuser WITH PASSWORD 'mypass'");
	});

	it('should substitute ${VAR_NAME} syntax', () => {
		const script = `psql <<-EOSQL
    CREATE USER \${APP_USER} WITH PASSWORD '\${APP_PASSWORD}';
EOSQL`;

		const blocks = parseInitScript(script, {
			APP_USER: 'myuser',
			APP_PASSWORD: 'mypass',
		});

		expect(blocks[0]).toContain("CREATE USER myuser WITH PASSWORD 'mypass'");
	});

	it('should replace missing vars with empty string', () => {
		const script = `psql <<-EOSQL
    CREATE USER api WITH PASSWORD '$MISSING_VAR';
EOSQL`;

		const blocks = parseInitScript(script, {});

		expect(blocks[0]).toContain("CREATE USER api WITH PASSWORD ''");
	});

	it('should unescape bash-escaped dollar signs for PL/pgSQL blocks', () => {
		const script = `psql <<-EOSQL
    DO \\$\\$
    BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'api') THEN
            CREATE USER api WITH PASSWORD '$API_DB_PASSWORD';
        ELSE
            ALTER USER api WITH PASSWORD '$API_DB_PASSWORD';
        END IF;
    END
    \\$\\$;
EOSQL`;

		const blocks = parseInitScript(script, {
			API_DB_PASSWORD: 'secret',
		});

		expect(blocks).toHaveLength(1);
		expect(blocks[0]).toContain('DO $$');
		expect(blocks[0]).toContain('END\n    $$;');
		expect(blocks[0]).toContain("CREATE USER api WITH PASSWORD 'secret'");
		expect(blocks[0]).not.toContain('\\$');
	});

	it('should return empty array for script with no heredocs', () => {
		const script = `#!/bin/bash
echo "Hello world"
`;

		const blocks = parseInitScript(script, {});

		expect(blocks).toEqual([]);
	});

	it('should handle the full generated init.sh format', () => {
		const script = `#!/bin/bash
set -e

# Auto-generated PostgreSQL init script
# Creates per-app users with separate schemas in a single database
# - api: uses public schema
# - auth: uses auth schema (search_path=auth)

# Create api user (uses public schema)
echo "Creating user api..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER api WITH PASSWORD '$API_DB_PASSWORD';
    GRANT ALL ON SCHEMA public TO api;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO api;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO api;
EOSQL


# Create auth user with dedicated schema
echo "Creating user auth with schema auth..."
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER auth WITH PASSWORD '$AUTH_DB_PASSWORD';
    CREATE SCHEMA auth AUTHORIZATION auth;
    ALTER USER auth SET search_path TO auth;
    GRANT USAGE ON SCHEMA auth TO auth;
    GRANT ALL ON ALL TABLES IN SCHEMA auth TO auth;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA auth TO auth;
    ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON TABLES TO auth;
    ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL ON SEQUENCES TO auth;
EOSQL

echo "Database initialization complete!"
`;

		const blocks = parseInitScript(script, {
			POSTGRES_USER: 'app',
			POSTGRES_DB: 'residentman_dev_test',
			API_DB_PASSWORD: 'apipass123',
			AUTH_DB_PASSWORD: 'authpass456',
		});

		expect(blocks).toHaveLength(2);

		// API block
		expect(blocks[0]).toContain("CREATE USER api WITH PASSWORD 'apipass123'");
		expect(blocks[0]).toContain('GRANT ALL ON SCHEMA public TO api');
		expect(blocks[0]).toContain('ALTER DEFAULT PRIVILEGES IN SCHEMA public');

		// Auth block
		expect(blocks[1]).toContain("CREATE USER auth WITH PASSWORD 'authpass456'");
		expect(blocks[1]).toContain('CREATE SCHEMA auth AUTHORIZATION auth');
		expect(blocks[1]).toContain('ALTER USER auth SET search_path TO auth');
	});
});

const PG_CONFIG = {
	host: 'localhost',
	port: 5432,
	user: 'geekmidas',
	password: 'geekmidas',
};

/**
 * Helper to run queries against the postgres admin database.
 */
async function adminQuery(...queries: string[]): Promise<void> {
	const client = new pg.Client({ ...PG_CONFIG, database: 'postgres' });
	try {
		await client.connect();
		for (const sql of queries) {
			await client.query(sql);
		}
	} finally {
		await client.end();
	}
}

/**
 * Force-drop a role by reassigning owned objects and revoking privileges first.
 */
async function forceDropRole(role: string): Promise<void> {
	// Find all databases where this role might own objects
	const client = new pg.Client({ ...PG_CONFIG, database: 'postgres' });
	try {
		await client.connect();
		const result = await client.query(
			"SELECT datname FROM pg_database WHERE datistemplate = false AND datname != 'postgres'",
		);
		for (const row of result.rows) {
			const dbClient = new pg.Client({
				...PG_CONFIG,
				database: row.datname,
			});
			try {
				await dbClient.connect();
				await dbClient.query(`REASSIGN OWNED BY ${role} TO ${PG_CONFIG.user}`);
				await dbClient.query(`DROP OWNED BY ${role}`);
			} catch {
				// Role might not exist in this database, ignore
			} finally {
				await dbClient.end();
			}
		}
		await client.query(`DROP ROLE IF EXISTS ${role}`);
	} finally {
		await client.end();
	}
}

describe('runInitScript', () => {
	const dbName = `test_init_script_${Date.now()}`;
	const dbUrl = `postgresql://${PG_CONFIG.user}:${PG_CONFIG.password}@${PG_CONFIG.host}:${PG_CONFIG.port}/${dbName}`;

	beforeAll(async () => {
		// Clean up stale state from previous failed runs
		await forceDropRole('test_api');
		await forceDropRole('test_auth');
		await adminQuery(
			`DROP DATABASE IF EXISTS "${dbName}"`,
			`CREATE DATABASE "${dbName}"`,
		);
	});

	afterAll(async () => {
		// Drop the database first (removes object dependencies), then roles
		await adminQuery(`DROP DATABASE IF EXISTS "${dbName}"`);
		await forceDropRole('test_api');
		await forceDropRole('test_auth');
	});

	it('should create users and schemas from init script', async () => {
		// Write a test init script to a temp file
		const scriptPath = join(tmpdir(), `init-${Date.now()}.sh`);
		writeFileSync(
			scriptPath,
			`#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER test_api WITH PASSWORD '$API_DB_PASSWORD';
    GRANT ALL ON SCHEMA public TO test_api;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO test_api;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO test_api;
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE USER test_auth WITH PASSWORD '$AUTH_DB_PASSWORD';
    CREATE SCHEMA IF NOT EXISTS test_auth AUTHORIZATION test_auth;
    ALTER USER test_auth SET search_path TO test_auth;
    GRANT USAGE ON SCHEMA test_auth TO test_auth;
    GRANT ALL ON ALL TABLES IN SCHEMA test_auth TO test_auth;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA test_auth TO test_auth;
    ALTER DEFAULT PRIVILEGES IN SCHEMA test_auth GRANT ALL ON TABLES TO test_auth;
    ALTER DEFAULT PRIVILEGES IN SCHEMA test_auth GRANT ALL ON SEQUENCES TO test_auth;
EOSQL

echo "Done!"
`,
		);

		// Run the init script against the test database
		await runInitScript(scriptPath, dbUrl, {
			POSTGRES_USER: PG_CONFIG.user,
			POSTGRES_DB: dbName,
			API_DB_PASSWORD: 'apipass',
			AUTH_DB_PASSWORD: 'authpass',
		});

		// Verify: connect as test_api and check access to public schema
		const apiClient = new pg.Client({
			...PG_CONFIG,
			user: 'test_api',
			password: 'apipass',
			database: dbName,
		});
		await apiClient.connect();
		await apiClient.query(
			'CREATE TABLE IF NOT EXISTS api_test_table (id serial PRIMARY KEY)',
		);
		const apiResult = await apiClient.query(
			"SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'api_test_table'",
		);
		expect(apiResult.rowCount).toBe(1);
		await apiClient.end();

		// Verify: connect as test_auth and check dedicated schema
		const authClient = new pg.Client({
			...PG_CONFIG,
			user: 'test_auth',
			password: 'authpass',
			database: dbName,
		});
		await authClient.connect();
		const schemaResult = await authClient.query(
			"SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'test_auth'",
		);
		expect(schemaResult.rowCount).toBe(1);
		await authClient.query(
			'CREATE TABLE IF NOT EXISTS test_auth.auth_test_table (id serial PRIMARY KEY)',
		);
		await authClient.end();
	});
});
