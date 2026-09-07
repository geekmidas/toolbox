/**
 * What has to be true before any spec runs.
 *
 * Two things, and both are the real ones rather than stand-ins: the generated
 * server entry is regenerated from the current source, and both schemas are
 * migrated in the database `gkm test` reconciled for this stage.
 *
 * Regenerating the entry matters more than it sounds. `.gkm/server/app.ts` is
 * where driver registration lives — the decision about which cache and storage
 * clients exist at all — so a suite that imported a stale one would be testing
 * a wiring nobody is going to run. It is also the file that was wrong in the
 * bug this suite exists to catch: an entry registering the Upstash driver for a
 * `postgres://` URL, invisible to every unit test because no unit test boots
 * the entry.
 */

import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { migrate } from '../../migrate.js';

const run = promisify(execFile);

/** The app root — two levels above `src/__tests__/__helpers__`. */
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export async function setup(): Promise<void> {
	// A child process rather than an import: `buildCommand` is not a public
	// export of `@geekmidas/cli`, and reaching past the package's exports to
	// call it would couple this suite to the CLI's internal layout for no gain.
	// The build needs no injected credentials — it walks the filesystem and
	// imports construct modules, which resolve their URLs lazily.
	await run('npx', ['gkm', 'build', '--providers', 'server'], {
		cwd: appRoot,
	});

	const applied = await migrate();
	if (applied.length > 0) {
		console.log(`  🗄️  migrated: ${applied.join(', ')}`);
	}
}
