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
import { HOST_PORT_DEFAULTS, type HostPortVariable, hostPort } from './ports';

const run = promisify(execFile);

/** The repo root: the nearest ancestor holding a `docker-compose.yml`. */
function repoRoot(): string {
	let current = dirname(fileURLToPath(import.meta.url));

	while (current !== dirname(current)) {
		if (existsSync(join(current, 'docker-compose.yml'))) return current;
		current = dirname(current);
	}

	throw new NoComposeFile(dirname(fileURLToPath(import.meta.url)));
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

	// Several checkouts share these containers, and `up` recreates one whose
	// definition differs in anything at all — so it is only asked when a
	// service is down, unhealthy, or not on the ports this run expects.
	if (await alreadyUp(cwd, services)) return;

	try {
		await run('docker', ['compose', 'up', '-d', '--wait', ...services], {
			cwd,
			// Pulling an image on a cold machine is slow, and failing at 30s would
			// be a flake rather than a finding.
			timeout: 300_000,
		});
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		const taken = takenHostPort(detail);

		if (taken !== undefined) {
			throw new HostPortTaken(
				services,
				taken,
				variableForHostPort(taken),
				detail,
			);
		}

		throw new ServicesDidNotStart(
			services,
			resolve(cwd, 'docker-compose.yml'),
			detail,
		);
	}
}

interface ComposeContainer {
	Service: string;
	State: string;
	Health: string;
	Publishers?: { PublishedPort: number }[] | null;
}

/**
 * Whether every service is running, healthy where it has a healthcheck, and
 * published on the host ports the `*_HOST_PORT` variables resolve to now.
 *
 * The ports are the one part of a container's definition this checks, and
 * deliberately: they are what a suite connects through, so a container on the
 * wrong ones has to be recreated. Anything else that differs — another
 * checkout's absolute paths, say — is not worth killing the connections of
 * whatever suite that checkout is running.
 */
async function alreadyUp(
	cwd: string,
	services: readonly string[],
): Promise<boolean> {
	try {
		const [config, ps] = await Promise.all([
			run('docker', ['compose', 'config', '--format', 'json', ...services], {
				cwd,
			}),
			run('docker', ['compose', 'ps', '--format', 'json', ...services], {
				cwd,
			}),
		]);
		const declared: Record<
			string,
			{ ports?: { published?: string | number }[] }
		> = JSON.parse(config.stdout).services ?? {};
		const containers = parseComposePs(ps.stdout);

		return services.every((service) => {
			const container = containers.find((c) => c.Service === service);
			if (!container || container.State !== 'running') return false;
			if (container.Health !== '' && container.Health !== 'healthy') {
				return false;
			}
			const published = new Set(
				(container.Publishers ?? []).map((p) => p.PublishedPort),
			);
			return (declared[service]?.ports ?? []).every(
				(port) =>
					port.published === undefined || published.has(Number(port.published)),
			);
		});
	} catch {
		// Whatever went wrong, `up` will say it better.
		return false;
	}
}

/** `docker compose ps --format json`: one object per line, or one array. */
function parseComposePs(output: string): ComposeContainer[] {
	const trimmed = output.trim();
	if (trimmed === '') return [];
	if (trimmed.startsWith('[')) return JSON.parse(trimmed);
	return trimmed.split('\n').map((line) => JSON.parse(line));
}

/**
 * The host port Docker refused to bind, read from `docker compose`'s output.
 *
 * Docker words it two ways depending on who noticed: the daemon itself
 * (`Bind for 0.0.0.0:5432 failed: port is already allocated`) or the kernel
 * underneath it (`listen tcp 0.0.0.0:5432: bind: address already in use`).
 */
export function takenHostPort(output: string): number | undefined {
	const match =
		/:(\d+) failed: port is already allocated/.exec(output) ??
		/:(\d+): bind: address already in use/.exec(output);

	return match ? Number(match[1]) : undefined;
}

/** Which `*_HOST_PORT` variable currently resolves to `port`, if any does. */
export function variableForHostPort(
	port: number,
): HostPortVariable | undefined {
	return (Object.keys(HOST_PORT_DEFAULTS) as HostPortVariable[]).find(
		(variable) => hostPort(variable) === port,
	);
}

/**
 * Another process holds a host port the compose stack publishes on — another
 * project's Postgres on 5432 is the usual one. Names the variable that moves
 * it, because the alternative is an `ECONNREFUSED` several frames later that
 * says nothing about ports at all.
 */
export class HostPortTaken extends Error {
	constructor(
		readonly services: readonly string[],
		readonly port: number,
		readonly variable: HostPortVariable | undefined,
		readonly detail: string,
	) {
		const example =
			port + 20_000 <= 65_535 ? ` (e.g. ${variable}=${port + 20_000})` : '';
		const fix = variable
			? `Set ${variable} to a free port${example} and run again`
			: 'Move it with the matching *_HOST_PORT variable (see packages/testkit/test/ports.ts) and run again';

		super(
			`Could not start ${services.join(', ')}: host port ${port} is already taken by another process. ` +
				`${fix} — the suites read the same variable, so they follow the container. ${detail}`,
		);
		this.name = 'HostPortTaken';
	}
}

/** No `docker-compose.yml` in any directory above the suite. */
export class NoComposeFile extends Error {
	constructor(readonly from: string) {
		super(
			`No docker-compose.yml above ${from}. The test services are defined in the repo root's.`,
		);
		this.name = 'NoComposeFile';
	}
}

/**
 * `docker compose up` failed. The two usual causes — Docker not running, and a
 * host port another project holds — both read as a bare connection refusal
 * several frames later, so this says which services and which file.
 */
export class ServicesDidNotStart extends Error {
	constructor(
		readonly services: readonly string[],
		readonly composeFile: string,
		readonly detail: string,
	) {
		super(
			`Could not start ${services.join(', ')} from ${composeFile}. Is Docker running, and are their ports free? ` +
				`Another project holding one can be worked around with *_HOST_PORT (see testkit/test/ports.ts). ${detail}`,
		);
		this.name = 'ServicesDidNotStart';
	}
}
