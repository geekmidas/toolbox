/**
 * What has to be true before any spec runs: both schemas migrated — Better
 * Auth's and the application's — in the database `gkm test` reconciled for this
 * stage.
 *
 * Nothing is built or booted. The harness `gkm test` generates serves the API
 * and the auth server in-process, from the real handlers, so a spec runs the
 * source it is testing rather than an entry built from it earlier.
 */
import { migrate } from '../../migrate.js';

export async function setup(): Promise<void> {
	const applied = await migrate();
	if (applied.length > 0) {
		console.log(`  🗄️  migrated: ${applied.join(', ')}`);
	}
}
