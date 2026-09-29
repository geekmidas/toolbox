#!/usr/bin/env node
/**
 * `gkm dev` serves every app of a real workspace, each on the port the
 * workspace provisioned for it.
 *
 *   node scripts/check-dev.mjs <workspace> <app>:<path> [<app>:<path> …]
 *
 * Starts the workspace's `pnpm dev`, reads the port each app was given from
 * dev's own listing (`api → http://localhost:3000`), and asks each named app
 * for its path on exactly that port — so an app serving somewhere else, or
 * another app answering on its port, fails rather than passing by accident.
 *
 * Nothing ran `gkm dev` on a whole workspace. Between them the unit suites and
 * `gkm test` never started turbo, so dev recursing into itself from the root,
 * every app asking for port 3000, and frontends ignoring their ports all
 * shipped at once.
 */

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const [workspaceArg, ...probeArgs] = process.argv.slice(2);
if (!workspaceArg || probeArgs.length === 0) {
	console.error(
		'Usage: node scripts/check-dev.mjs <workspace> <app>:<path> [<app>:<path> …]',
	);
	process.exit(2);
}

const cwd = resolve(workspaceArg);
const probes = probeArgs.map((arg) => {
	const at = arg.indexOf(':');
	return { app: arg.slice(0, at), path: arg.slice(at + 1) };
});

/** How long apps get to come up — containers, then four dev servers. */
const TIMEOUT_MS = 5 * 60_000;

/** Output that means an app is not serving, whatever the probes say. */
const FATAL = [
	/EADDRINUSE/,
	/Turbo exited with code/,
	/run dev exited \(/,
	// A worker's crons that could not be scheduled: the server still answers,
	// so only its log says the integration is broken.
	/Failed to schedule crons/,
	/crons have nowhere to keep their schedule/,
];

let output = '';
const dev = spawn('pnpm', ['dev'], {
	cwd,
	// Its own process group, so every server turbo started goes with it.
	detached: true,
	env: { ...process.env, FORCE_COLOR: '0' },
});
for (const stream of [dev.stdout, dev.stderr]) {
	stream.on('data', (chunk) => {
		output += chunk;
		process.stdout.write(chunk);
	});
}

let exited = false;
dev.on('exit', () => {
	exited = true;
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** `app → http://localhost:3000`, as dev lists the apps it starts. */
function provisionedPorts() {
	const ports = {};
	for (const [, app, port] of output.matchAll(
		/(\S+) → http:\/\/localhost:(\d+)/g,
	)) {
		ports[app] = Number(port);
	}
	return ports;
}

async function status(url) {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
		return response.status;
	} catch {
		return undefined;
	}
}

async function check() {
	const deadline = Date.now() + TIMEOUT_MS;
	const pending = new Map(probes.map((probe) => [probe.app, probe]));
	const failures = [];

	while (pending.size > 0) {
		const fatal = FATAL.find((pattern) => pattern.test(output));
		if (fatal) return [`dev reported ${fatal}`];
		if (exited) return ['dev exited before every app was serving'];
		if (Date.now() > deadline) {
			return [
				...failures,
				...[...pending.keys()].map(
					(app) => `${app} did not answer within ${TIMEOUT_MS / 1000}s`,
				),
			];
		}

		const ports = provisionedPorts();
		for (const { app, path } of pending.values()) {
			const port = ports[app];
			if (!port) continue;

			const url = `http://localhost:${port}${path}`;
			const code = await status(url);
			if (code === 200) {
				console.log(`\n✓ ${app} serves ${url}`);
				pending.delete(app);
			}
		}

		await sleep(2_000);
	}

	return failures;
}

let failures;
try {
	failures = await check();
} finally {
	// The group, not the pid: turbo's children are the servers.
	try {
		process.kill(-dev.pid, 'SIGINT');
	} catch {}
	await sleep(5_000);
	try {
		process.kill(-dev.pid, 'SIGKILL');
	} catch {}
}

if (failures.length > 0) {
	console.error(
		`\ngkm dev did not serve the workspace:\n  ${failures.join('\n  ')}`,
	);
	process.exit(1);
}

console.log(
	`\ngkm dev served all ${probes.length} apps on their provisioned ports.`,
);
