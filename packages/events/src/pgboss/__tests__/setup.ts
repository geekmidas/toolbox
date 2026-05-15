import { Client } from 'pg';

/**
 * Drop the named schemas if they exist. Run before pg-boss tests so that
 * pg-boss's contractor performs a fresh `create` rather than attempting to
 * migrate from a stale layout left behind by an older pg-boss version.
 */
export async function dropSchemas(
	connectionString: string,
	schemas: string[],
): Promise<void> {
	const client = new Client({ connectionString });
	await client.connect();
	try {
		for (const schema of schemas) {
			await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
		}
	} finally {
		await client.end();
	}
}
