import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Client } = pg;

/**
 * Parse a shell init script (like docker/postgres/init.sh) and extract
 * SQL blocks from heredoc sections (<<-EOSQL ... EOSQL).
 *
 * @param content - The shell script content
 * @param env - Environment variables to substitute ($VAR_NAME references)
 * @returns Array of SQL strings ready to execute
 * @internal Exported for testing
 */
export function parseInitScript(
	content: string,
	env: Record<string, string>,
): string[] {
	const blocks: string[] = [];
	const lines = content.split('\n');
	let inHeredoc = false;
	let currentBlock: string[] = [];

	for (const line of lines) {
		if (inHeredoc) {
			// Check for heredoc terminator (EOSQL at start of line, with optional leading whitespace)
			if (/^\s*EOSQL\s*$/.test(line)) {
				const sql = substituteEnvVars(currentBlock.join('\n'), env);
				blocks.push(sql);
				currentBlock = [];
				inHeredoc = false;
			} else {
				currentBlock.push(line);
			}
		} else if (
			line.includes('<<-EOSQL') ||
			line.includes('<< EOSQL') ||
			line.includes('<<EOSQL')
		) {
			inHeredoc = true;
			currentBlock = [];
		}
	}

	return blocks;
}

/**
 * Replace shell variable references ($VAR_NAME and ${VAR_NAME})
 * with values from the provided env object.
 */
function substituteEnvVars(sql: string, env: Record<string, string>): string {
	// Replace ${VAR_NAME} syntax
	let result = sql.replace(/\$\{(\w+)\}/g, (_, name) => env[name] ?? '');
	// Replace $VAR_NAME syntax (word boundary after)
	result = result.replace(/\$(\w+)/g, (_, name) => env[name] ?? '');
	// Unescape bash-escaped dollar signs (\$ → $) AFTER variable substitution
	// This handles PL/pgSQL dollar-quoting like DO \$\$ ... END \$\$;
	result = result.replace(/\\\$/g, '$');
	return result;
}

/**
 * Read a postgres init script, parse out the SQL blocks,
 * substitute environment variables, and execute against a database.
 *
 * This is intended to run `docker/postgres/init.sh` against a test database
 * so that per-app users and schemas are created (matching what Docker does
 * on first volume initialization).
 *
 * Uses `CREATE ... IF NOT EXISTS` and `DO $$ ... END $$` wrappers where
 * needed so the script is idempotent.
 *
 * @param scriptPath - Path to the init.sh file
 * @param databaseUrl - PostgreSQL connection URL (should point to the test database)
 *
 * @example
 * ```typescript
 * // In your globalSetup.ts
 * import { runInitScript } from '@geekmidas/testkit/postgres';
 * import { Credentials } from '@geekmidas/envkit/credentials';
 *
 * const cleanup = await migrator.start();
 *
 * // Create per-app users in the test database
 * await runInitScript('docker/postgres/init.sh', Credentials.DATABASE_URL, {
 *   ...process.env,
 *   ...Credentials,
 * });
 * ```
 */
export async function runInitScript(
	scriptPath: string,
	databaseUrl: string,
	env?: Record<string, string>,
): Promise<void> {
	const content = readFileSync(scriptPath, 'utf-8');
	const resolvedEnv = env ?? ({ ...process.env } as Record<string, string>);
	const blocks = parseInitScript(content, resolvedEnv);

	if (blocks.length === 0) {
		return;
	}

	const url = new URL(databaseUrl);
	const client = new Client({
		user: url.username,
		password: decodeURIComponent(url.password),
		host: url.hostname,
		port: parseInt(url.port, 10),
		database: url.pathname.slice(1),
	});

	try {
		await client.connect();
		for (const sql of blocks) {
			await client.query(sql);
		}
	} finally {
		await client.end();
	}
}
