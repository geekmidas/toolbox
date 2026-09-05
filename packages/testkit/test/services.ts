/**
 * Starting the containers a suite needs, from the suite that needs them.
 *
 * `gkm test` already does this for an *application*: it reconciles what the
 * constructs declare and starts exactly those containers, which is why an app's
 * suite needs no setup. A package suite is not an app — there is no manifest to
 * read — so the containers it wants come from the repo's own
 * `docker-compose.yml`, and until now nothing started them.
 *
 * What that cost is worth stating, because it is not "a few skipped tests". A
 * `globalSetup` that connects at collection time takes the whole *project* down
 * with `ECONNREFUSED` when its database is missing — so a package with one
 * unreachable dependency reports zero tests rather than the ones it could have
 * run, and a suite nobody could run is a suite nobody notices is broken.
 *
 * Idempotent and cheap when everything is already up, which is what makes it
 * acceptable on every run. It also recreates a container whose definition has
 * drifted — the case that bites is one created from an older compose file
 * without its ports published, which is running, healthy, and unreachable.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** The repo root: the nearest ancestor holding a `docker-compose.yml`. */
function repoRoot(): string {
	let current = dirname(fileURLToPath(import.meta.url));

	while (current !== dirname(current)) {
		if (existsSync(join(current, 'docker-compose.yml'))) return current;
		current = dirname(current);
	}

	throw new Error('No docker-compose.yml above this package');
}

/**
 * Bring up the named compose services and wait for them to be usable.
 *
 * `--wait` blocks on healthchecks where a service defines one, so a caller that
 * connects immediately afterwards is not racing the container's startup — which
 * is the flake this replaces.
 *
 * A failure names the services and the command, because the two things that go
 * wrong here are Docker not running and a port already taken by another
 * project, and neither is obvious from a connection refused several frames
 * later.
 */
export async function ensureServices(
	...services: readonly string[]
): Promise<void> {
	if (services.length === 0) return;

	const cwd = repoRoot();

	try {
		await run('docker', ['compose', 'up', '-d', '--wait', ...services], {
			cwd,
			// Pulling an image on a cold machine is slow, and failing at 30s would
			// be a flake rather than a finding.
			timeout: 300_000,
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);

		throw new Error(
			`Could not start ${services.join(', ')} from ${resolve(cwd, 'docker-compose.yml')}. ` +
				`Is Docker running, and are their ports free? ${detail}`,
		);
	}
}
