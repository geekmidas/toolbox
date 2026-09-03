/**
 * The real Docker, behind the small interface reconcile needs.
 *
 * Shells out to `docker compose` rather than talking to the daemon socket: it is
 * what a developer runs by hand when something is wrong, so the two cannot
 * disagree, and it keeps Docker out of this package's dependencies.
 *
 * Every call is scoped to the generated compose file. Nothing here can touch a
 * container this project did not generate.
 */

import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { promisify } from 'node:util';
import type { Docker } from './index';

const run = promisify(execFile);

/** How long to wait for containers to pass their health checks. */
const HEALTH_TIMEOUT_MS = 120_000;

export const dockerCli: Docker = {
	async publishedPort(composePath, service, inside) {
		try {
			const { stdout } = await run('docker', [
				'compose',
				'-f',
				composePath,
				'port',
				service,
				String(inside),
			]);

			// `0.0.0.0:54321` — the part after the last colon is the host port.
			const port = Number(stdout.trim().split(':').pop());

			return Number.isFinite(port) && port > 0 ? port : undefined;
		} catch {
			// Not running, or no such service. Both mean "nothing to reuse".
			return undefined;
		}
	},

	async up(composePath, services) {
		await run('docker', [
			'compose',
			'-f',
			composePath,
			'up',
			'-d',
			// Recreate anything whose definition moved — a changed image pin is
			// exactly the case the hash detects, and leaving the old container
			// running would make the reconcile a lie.
			'--remove-orphans',
			'--wait',
			`--wait-timeout=${Math.floor(HEALTH_TIMEOUT_MS / 1000)}`,
			...services,
		]);
	},

	async copyOut(composePath, service, from, to) {
		await mkdir(dirname(to), { recursive: true });
		await run('docker', [
			'compose',
			'-f',
			composePath,
			'cp',
			`${service}:${from}`,
			to,
		]);
	},

	async reload(composePath, service) {
		// Caddy's own reload is graceful and validates first, so a config it
		// refuses leaves the previous one serving rather than dropping the edge.
		await run('docker', [
			'compose',
			'-f',
			composePath,
			'exec',
			'-T',
			service,
			'caddy',
			'reload',
			'--config',
			'/etc/caddy/Caddyfile',
		]);
	},

	async healthy(composePath, services) {
		if (services.length === 0) return true;

		try {
			const { stdout } = await run('docker', [
				'compose',
				'-f',
				composePath,
				'ps',
				'--format',
				'json',
				...services,
			]);

			const running = new Set<string>();
			for (const line of stdout.trim().split('\n').filter(Boolean)) {
				const entry = JSON.parse(line) as {
					Service?: string;
					State?: string;
					Health?: string;
				};

				// A container with a health check must be passing it; one without
				// only has to be running, since there is nothing better to ask.
				const ok =
					entry.State === 'running' &&
					(entry.Health === undefined ||
						entry.Health === '' ||
						entry.Health === 'healthy');

				if (ok && entry.Service) running.add(entry.Service);
			}

			return services.every((service) => running.has(service));
		} catch {
			// No compose file yet, or no daemon. Either way, not healthy.
			return false;
		}
	},
};

export { HEALTH_TIMEOUT_MS };
