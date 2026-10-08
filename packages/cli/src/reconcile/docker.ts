/**
 * The real Docker, behind the small interface reconcile needs.
 *
 * Shells out to `docker compose` rather than talking to the daemon socket: it is
 * what a developer runs by hand when something is wrong, so the two cannot
 * disagree, and it keeps Docker out of this package's dependencies.
 *
 * Every call that acts is scoped to the generated compose file. Nothing here
 * can touch a container this project did not generate; `publisher` only reads
 * who holds a port.
 */

import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import type { Docker } from './index';

const run = promisify(execFile);

/**
 * The generated file, then the project's own if it has one.
 *
 * Merged in that order so the project's wins — an `image:` there pins a
 * container this file derived, and a service there is added beside them.
 */
export function composeFiles(composePath: string): string[] {
	const project = join(dirname(composePath), 'docker-compose.yml');
	return ['-f', composePath, ...(existsSync(project) ? ['-f', project] : [])];
}

/** How long to wait for containers to pass their health checks. */
const HEALTH_TIMEOUT_MS = 120_000;

/** `docker compose up` exited unsuccessfully; its own output said why. */
export class ComposeUpFailed extends Error {
	constructor(
		readonly services: readonly string[],
		readonly code: number | null,
	) {
		super(
			`docker compose could not start ${services.join(', ')} (exit ${code ?? 'signal'}). Its output above names the container; \`docker compose logs <service>\` shows why it stopped.`,
		);
		this.name = 'ComposeUpFailed';
	}
}

/** Run compose with its output on this terminal rather than captured. */
function shown(args: readonly string[], services: readonly string[]) {
	return new Promise<void>((resolve, reject) => {
		const child = spawn('docker', args, {
			stdio: ['ignore', 'inherit', 'inherit'],
		});
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? resolve() : reject(new ComposeUpFailed(services, code)),
		);
	});
}

export const dockerCli: Docker = {
	async publishedPort(composePath, service, inside) {
		try {
			const { stdout } = await run('docker', [
				'compose',
				...composeFiles(composePath),
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

	async publisher(port) {
		try {
			// Not scoped to the compose file: the point is to name whoever holds
			// the port, which is usually another project.
			const { stdout } = await run('docker', [
				'ps',
				'--filter',
				`publish=${port}`,
				'--format',
				'{{.Label "com.docker.compose.project"}}',
			]);

			return stdout.trim().split('\n')[0] || undefined;
		} catch {
			return undefined;
		}
	},

	async up(composePath, services, options = {}) {
		const args = [
			'compose',
			...composeFiles(composePath),
			'up',
			'-d',
			// Recreate anything whose definition moved — a changed image pin is
			// exactly the case the hash detects, and leaving the old container
			// running would make the reconcile a lie.
			'--remove-orphans',
			'--wait',
			`--wait-timeout=${Math.floor(HEALTH_TIMEOUT_MS / 1000)}`,
			...services,
		];

		if (options.show) return shown(args, services);
		await run('docker', args);
	},

	async copyOut(composePath, service, from, to) {
		await mkdir(dirname(to), { recursive: true });
		await run('docker', [
			'compose',
			...composeFiles(composePath),
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
			...composeFiles(composePath),
			'exec',
			'-T',
			service,
			'caddy',
			'reload',
			'--config',
			'/etc/caddy/Caddyfile',
		]);
	},

	async exec(composePath, service, argv) {
		try {
			const { stdout, stderr } = await run('docker', [
				'compose',
				...composeFiles(composePath),
				'exec',
				'-T',
				service,
				...argv,
			]);
			return { ok: true, output: `${stdout}${stderr}` };
		} catch (error) {
			const { stdout = '', stderr = '' } = error as {
				stdout?: string;
				stderr?: string;
			};
			return { ok: false, output: `${stdout}${stderr}` };
		}
	},

	async healthy(composePath, services) {
		if (services.length === 0) return true;

		try {
			const { stdout } = await run('docker', [
				'compose',
				...composeFiles(composePath),
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
