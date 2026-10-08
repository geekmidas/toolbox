/**
 * `gkm compose`, end to end: a real stack, built from source, started, and
 * spoken to through its edge over HTTPS.
 *
 * Gated behind GKM_E2E=1 — it builds three images and starts five containers,
 * which takes minutes, not milliseconds. It needs Docker, pnpm, git and the
 * network (each image installs its dependencies), and the packages built
 * (`npx tsdown`), because the CLI is run as a user runs it: `gkm compose`, in
 * the project's directory.
 *
 * Every image is built inside Docker, the way a user's project builds: from
 * its lockfile, with `gkm build` run in the image. The project depends on
 * this checkout's packages as tarballs (`pnpm pack`), so the CLI that builds
 * the backends in the image is the one under test, not the last release.
 *
 * What it proves is the part no unit test can: that the stack the files
 * describe actually works.
 *
 * - (a) signing in from the site's origin, through Caddy, sets a session
 *   cookie on the cookie domain the public hosts share;
 * - (b) the API, called with that cookie, validates the session by calling
 *   the auth server across the compose network;
 * - (c) a state-changing request — sign-out — is accepted from the browser's
 *   origin, and from a sibling service's internal origin, and refused from
 *   one nobody declared: the trusted origins are right for both callers.
 *
 * - (e) a request to the API sends a message to a queue, and the Worker's
 *   own container — no route, no published port, healthy by its own check —
 *   consumes it and writes the row the API then reads back; stopped, it
 *   drains and exits 0 within Docker's timeout.
 *
 * - (g) the stage is migrated, then seeded, before any app starts: the row
 *   the database's seed upserts is what the API reads back.
 *
 * - (f) a value the API caches round-trips through the stack's Redis —
 *   on the network alone, no host port, password protected — and lands in
 *   it, not in a table: the cache was declared from the database.
 *
 * - (d) with `deploy.compose.logs` (the `gkm compose` run), the API's
 *   telemetry reaches the stack's OpenObserve — published on 127.0.0.1
 *   alone — signed in with the root login the stack generated: a line the
 *   handler logged and the request's SERVER span are both found through its
 *   search API, in one trace.
 *
 * The edge is published on free ports (443 and 80 are often taken), and the
 * stack has a compose project of its own; it is torn down, volumes and built
 * images included, whatever happens.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	writeFileSync,
} from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
import { loadWorkspaceSettings } from '../../config';
import { FileSecretsStore } from '../../secrets/file';
import { keystoreProject } from '../../secrets/keystore';
import { initStageSecrets } from '../../secrets/storage';
import { writeComposeApp } from './__helpers__/composeApp';

const RUN = process.env.GKM_E2E === '1';

/** Three images built from cold, the first time: minutes, on a slow line. */
const BUILD_TIMEOUT = 20 * 60_000;

const CLI = join(import.meta.dirname, '..', '..', '..', 'bin', 'gkm.mjs');
const DIST = join(import.meta.dirname, '..', '..', '..', 'dist', 'index.mjs');
const PACKAGES = join(import.meta.dirname, '..', '..', '..', '..');
const KITCHEN_SINK = join(
	PACKAGES,
	'..',
	'apps',
	'kitchen-sink',
	'package.json',
);
const TELESCOPE = join(PACKAGES, 'telescope', 'package.json');

/** What a child is started with: never the suite's `--import tsx`. */
function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
	const { NODE_OPTIONS: _, VITEST: __, ...env } = process.env;
	return { ...env, ...extra };
}

/** Run a program to completion, failing with everything it said. */
function exec(
	command: string,
	args: readonly string[],
	options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, [...args], {
			cwd: options.cwd,
			env: options.env ?? childEnv(),
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let output = '';
		child.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.stderr.on('data', (chunk: Buffer) => {
			output += chunk.toString();
		});
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0
				? resolve(output)
				: reject(
						new Error(
							`${command} ${args.join(' ')} exited ${code}:\n${output.slice(-8000)}`,
						),
					),
		);
	});
}

/**
 * Depend on this checkout's packages the way a project depends on released
 * ones: each packed into a tarball at the project's root, every
 * `@geekmidas/*` — the packages' own dependencies on each other included —
 * resolved to its tarball, and the rest at the ranges the kitchen sink uses.
 */
async function dependOnThisCheckout(
	dir: string,
	name: string,
	options: { telemetry?: boolean } = {},
): Promise<void> {
	const tarballs: Record<string, string> = {};
	for (const entry of readdirSync(PACKAGES, { withFileTypes: true })) {
		const pkgDir = join(PACKAGES, entry.name);
		const manifest = join(pkgDir, 'package.json');
		if (!entry.isDirectory() || !existsSync(manifest)) continue;
		const pkg = JSON.parse(readFileSync(manifest, 'utf-8'));
		if (pkg.private) continue;
		const packed = await exec('pnpm', ['pack', '--pack-destination', dir], {
			cwd: pkgDir,
		});
		const file = packed.trim().split('\n').pop()!.split('/').pop()!;
		tarballs[pkg.name] = `file:./${file}`;
	}

	const sink = JSON.parse(readFileSync(KITCHEN_SINK, 'utf-8'));
	const range = (dep: string) =>
		(sink.dependencies[dep] ?? sink.devDependencies[dep]) as string;
	// What a production server exports telemetry with: telescope, and the
	// OpenTelemetry packages at the ranges telescope is built against.
	const telescope = JSON.parse(readFileSync(TELESCOPE, 'utf-8'));
	const telemetry: Record<string, string> = options.telemetry
		? {
				'@geekmidas/telescope': tarballs['@geekmidas/telescope']!,
				...Object.fromEntries(
					Object.entries(
						telescope.devDependencies as Record<string, string>,
					).filter(([dep]) => dep.startsWith('@opentelemetry/')),
				),
			}
		: {};
	writeFileSync(
		join(dir, 'package.json'),
		`${JSON.stringify(
			{
				name,
				private: true,
				type: 'module',
				packageManager: 'pnpm@10.30.1',
				// What \`gkm init\` scaffolds for a fullstack workspace. An image's
				// slice holds one app, so it must never run this: it builds
				// every app the workspace declares.
				scripts: { build: 'gkm build' },
				dependencies: {
					...Object.fromEntries(
						[
							// The cache's client, over the stack's Redis.
							'@geekmidas/cache',
							'@geekmidas/cli',
							// What the client generated for the site imports.
							'@geekmidas/client',
							'@geekmidas/constructs',
							'@geekmidas/db',
							'@geekmidas/envkit',
							'@geekmidas/errors',
							// The worker's queue, on pg-boss.
							'@geekmidas/events',
							'@geekmidas/logger',
							'@geekmidas/services',
						].map((dep) => [dep, tarballs[dep]!]),
					),
					...Object.fromEntries(
						[
							// The server `gkm build` generates listens with it.
							'@hono/node-server',
							'better-auth',
							'hono',
							// What the stack's Redis is reached with.
							'ioredis',
							'kysely',
							'pg',
							'pg-boss',
							'pino',
							// The generated client's hooks, bundled into the site.
							'@tanstack/react-query',
							'react',
							'zod',
						].map((dep) => [dep, range(dep)]),
					),
					...telemetry,
				},
				pnpm: { overrides: tarballs },
			},
			null,
			2,
		)}\n`,
	);
}

async function freePort(): Promise<number> {
	const server = createServer();
	await new Promise<void>((resolve) => server.listen(0, resolve));
	const address = server.address();
	await new Promise((resolve) => server.close(resolve));
	if (!address || typeof address === 'string') throw new Error('no port');
	return address.port;
}

/**
 * GET /stream through an edge, each chunk with when it arrived. The API
 * writes three lines 700ms apart; through an edge that buffers, they
 * arrive together.
 */
function streamed(options: {
	port: number;
	host: string;
	hostHeader: string;
	ca: string;
}): Promise<{ text: string; at: number }[]> {
	return new Promise((resolve, reject) => {
		const req = httpsRequest(
			{
				host: '127.0.0.1',
				port: options.port,
				servername: options.host,
				path: '/stream',
				ca: options.ca,
				headers: { host: options.hostHeader },
			},
			(res) => {
				const chunks: { text: string; at: number }[] = [];
				res.on('data', (chunk: Buffer) => {
					chunks.push({ text: chunk.toString(), at: Date.now() });
				});
				res.on('end', () =>
					res.statusCode === 200
						? resolve(chunks)
						: reject(new Error(`/stream answered ${res.statusCode}`)),
				);
			},
		);
		req.on('error', reject);
		req.end();
	});
}

interface Response {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: string;
}

/**
 * The two ways a stack comes up — `gkm compose`, and the compose target
 * through `gkm deploy` — each against a project and a stack of its own. They
 * are one code path; both are run so neither entry point can drift.
 */
const ENTRY_POINTS = [
	{
		command: 'gkm compose',
		args: ['compose', '--stage', 'development'],
		logs: true,
	},
	{
		command: 'gkm deploy --target compose',
		args: ['deploy', '--target', 'compose', '--stage', 'development'],
		logs: false,
	},
] as const;

for (const entry of ENTRY_POINTS) endToEnd(entry);

function endToEnd(entry: (typeof ENTRY_POINTS)[number]): void {
	describe.runIf(RUN)(
		`${entry.command}, end to end`,
		{ timeout: 60_000 },
		() => {
			const name = `compose-e2e-${randomBytes(3).toString('hex')}`;
			const project = `${name}-development`;
			let dir: string;
			let https: number;
			let logsPort: number;
			let ca: string;
			let output = '';

			const host = (app: 'api' | 'auth' | 'web') =>
				app === 'web' ? `${name}.localhost` : `${app}.${name}.localhost`;
			const origin = (app: 'api' | 'auth' | 'web') =>
				`https://${host(app)}:${https}`;
			const file = () =>
				join(dir, '.gkm', 'compose', 'development', 'docker-compose.yml');

			/**
			 * A request to the edge, as a browser makes one: to the app's hostname,
			 * verified against Caddy's local CA. The hostname is sent as SNI and Host
			 * and the connection made to loopback, so nothing depends on how this
			 * machine resolves `*.localhost`.
			 */
			function edge(
				app: 'api' | 'auth' | 'web',
				path: string,
				init: {
					method?: string;
					headers?: Record<string, string>;
					body?: unknown;
				} = {},
			): Promise<Response> {
				const body =
					init.body === undefined ? undefined : JSON.stringify(init.body);
				return new Promise((resolve, reject) => {
					const req = httpsRequest(
						{
							host: '127.0.0.1',
							port: https,
							servername: host(app),
							path,
							method: init.method ?? 'GET',
							ca,
							headers: {
								host: `${host(app)}:${https}`,
								...(body
									? {
											'content-type': 'application/json',
											'content-length': Buffer.byteLength(body),
										}
									: {}),
								...init.headers,
							},
						},
						(res) => {
							let text = '';
							res.on('data', (chunk: Buffer) => {
								text += chunk.toString();
							});
							res.on('end', () =>
								resolve({
									status: res.statusCode ?? 0,
									headers: res.headers,
									body: text,
								}),
							);
						},
					);
					req.on('error', reject);
					if (body) req.write(body);
					req.end();
				});
			}

			/** `name=value` for each cookie a response set. */
			const cookies = (response: Response) =>
				([] as string[])
					.concat(response.headers['set-cookie'] ?? [])
					.map((cookie) => cookie.split(';')[0])
					.join('; ');

			/** A request from inside the API's container, across the compose network. */
			const fromApi = (script: string) =>
				exec('docker', [
					'compose',
					'-p',
					project,
					'-f',
					file(),
					'exec',
					'-T',
					'api',
					'node',
					'-e',
					script,
				]);

			beforeAll(async () => {
				if (!existsSync(DIST)) {
					throw new Error(
						`The CLI is not built (${DIST}). Run \`npx tsdown --config ./tsdown.config.ts\` from the repo root first.`,
					);
				}

				dir = realpathSync(await createTempDir('gkm-compose-e2e-'));
				// Never 5080: a developer's own OpenObserve may be on it.
				logsPort = await freePort();
				writeComposeApp(dir, {
					name,
					...(entry.logs ? { logs: { port: logsPort } } : {}),
				});
				await dependOnThisCheckout(dir, name, { telemetry: entry.logs });

				// What a real project has: a lockfile every image installs from,
				// and a commit its images are tagged with.
				await exec('pnpm', ['install', '--lockfile-only'], { cwd: dir });
				// What a scaffolded project ignores: the stage's secrets below
				// live in `.gkm/`, and an untracked one would tag every image
				// `-dirty`.
				writeFileSync(join(dir, '.gitignore'), '.gkm/\n');
				const git = childEnv({
					GIT_AUTHOR_NAME: 'gkm',
					GIT_AUTHOR_EMAIL: 'gkm@example.com',
					GIT_COMMITTER_NAME: 'gkm',
					GIT_COMMITTER_EMAIL: 'gkm@example.com',
				});
				await exec('git', ['init', '-q'], { cwd: dir, env: git });
				await exec('git', ['add', '-A'], { cwd: dir, env: git });
				await exec('git', ['commit', '-q', '-m', 'init'], {
					cwd: dir,
					env: git,
				});

				// The stage started the way a user starts one: its secrets
				// initialised, a key set, and `gkm setup` run over them. Each used
				// to store a `localhost` URL under the auth tenant's key, and a
				// stored key wins: the auth server could not reach its database.
				for (const args of [
					['secrets:init', '--stage', 'development'],
					['secrets:set', 'SOME_KEY', 'x', '--stage', 'development'],
					['setup', '--stage', 'development', '--skip-docker'],
				]) {
					await exec(process.execPath, [CLI, ...args], { cwd: dir });
				}

				https = await freePort();
				const http = await freePort();

				output = await exec(process.execPath, [CLI, ...entry.args], {
					cwd: dir,
					env: childEnv({
						GKM_COMPOSE_HTTPS_PORT: String(https),
						GKM_COMPOSE_HTTP_PORT: String(http),
					}),
				});

				ca = readFileSync(
					join(dir, '.gkm', 'compose', 'development', 'caddy-root.crt'),
					'utf-8',
				);
			}, BUILD_TIMEOUT);

			afterAll(async () => {
				// GKM_E2E_KEEP=1 leaves the stack up to look at after a failure.
				if (process.env.GKM_E2E_KEEP === '1') {
					console.log(`Kept ${project} in ${dir}`);
					return;
				}
				if (dir && existsSync(file())) {
					await exec('docker', [
						'compose',
						'-p',
						project,
						'-f',
						file(),
						'down',
						'--volumes',
						'--remove-orphans',
						'--rmi',
						'local',
					]).catch(() => {});
					// The images this run built: named, so `--rmi local` leaves them.
					const images = await exec('docker', [
						'images',
						'--quiet',
						'--filter',
						`reference=${name}/*`,
					]).catch(() => '');
					const ids = [...new Set(images.split('\n').filter(Boolean))];
					if (ids.length > 0) {
						await exec('docker', ['image', 'rm', '-f', ...ids]).catch(() => {});
					}
				}
				if (dir) await cleanupDir(dir);
			}, 5 * 60_000);

			it('built every image inside Docker, and nothing on this machine', () => {
				// The backends were bundled by `gkm build` in their images, and no
				// bundle was made here for an image to copy in.
				expect(output).toMatch(/#\d+ [\d.]+ 📦 Bundling production server/);
				expect(output).not.toMatch(/📦 Bundling (api|auth)…/);
				for (const app of ['api', 'auth']) {
					expect(existsSync(join(dir, 'apps', app, '.gkm', 'server'))).toBe(
						false,
					);
				}
				expect(existsSync(join(dir, 'apps', 'web', 'dist'))).toBe(false);
			});

			it("hands the auth server its tenant's derived URL, not a stored localhost one", () => {
				const env = readFileSync(
					join(dir, '.gkm', 'compose', 'development', 'auth.env'),
					'utf-8',
				);
				expect(env).toMatch(
					/^AUTH_DATABASE_URL=postgres:\/\/authdatabase:[^@]+@postgres:5432\//m,
				);
			});

			it('starts the stack and says where each app answers', () => {
				expect(output).toContain(`${project} is running`);
				expect(output).toContain(origin('api'));
				expect(output).toContain(origin('web'));
			});

			it('verified each app through Caddy, and recorded what the stage runs', () => {
				// `verify`: every app answered over HTTPS, through the edge.
				expect(output).toContain(`✓ api`);
				expect(output).toContain(`✓ auth`);
				expect(output).toContain(`✓ web`);
				expect(output).toContain(`✓ jobs`);

				const { state } = JSON.parse(
					readFileSync(join(dir, '.gkm', 'deploy-development.json'), 'utf-8'),
				);
				expect(Object.keys(state.releases).sort()).toEqual([
					'api',
					'auth',
					'jobs',
					'web',
				]);
				expect(state.releases.api.current.ref).toMatch(
					new RegExp(`${name}-api:[0-9a-f]+$`),
				);
				expect(state.releases.api.current.digest).toMatch(/^sha256:/);
			});

			it('serves the site, built with the public URLs it was given', async () => {
				const page = await edge('web', '/');
				expect(page.status).toBe(200);

				const script = page.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
				expect(script).toBeDefined();
				const bundle = await edge('web', script!);
				expect(bundle.body).toContain(origin('api'));
				expect(bundle.body).toContain(origin('auth'));

				// Caddy: hashed assets cached for good, the page revalidated, and
				// a client-side route answered with the page.
				expect(bundle.headers['cache-control']).toBe(
					'public, max-age=31536000, immutable',
				);
				expect(page.headers['cache-control']).toBe('no-cache');
				const deep = await edge('web', '/some/client/route');
				expect(deep.status).toBe(200);
				expect(deep.body).toBe(page.body);
			});

			/** The `traceparent` the site's bundle sent to the API, as a browser would. */
			let siteTraceparent: string | undefined;

			it('the site calls the API through the client generated in its image', async () => {
				const page = await edge('web', '/');
				const script = page.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
				const bundle = await edge('web', script!);
				// The generated client is in the bundle: its route map, which only
				// generation from the API's endpoints writes.
				expect(bundle.body).toContain('GET /ping');
				// Generated in the image, not on this machine.
				expect(existsSync(join(dir, '.gkm', 'client'))).toBe(false);

				// The bundle, run as the browser runs it: its `fetch` goes to the
				// edge, from the site's origin.
				const elements: Record<string, { textContent: string }> = {};
				const browser = {
					document: {
						querySelector: (selector: string) => {
							elements[selector] ??= { textContent: '' };
							return elements[selector];
						},
						querySelectorAll: () => [],
						createElement: () => ({ relList: { supports: () => true } }),
					},
					fetch: async (url: string, init: RequestInit = {}) => {
						const target = new URL(url);
						expect(target.origin).toBe(origin('api'));
						siteTraceparent = (init.headers as Record<string, string>)
							?.traceparent;
						const answer = await edge('api', target.pathname, {
							method: init.method ?? 'GET',
							headers: {
								...(init.headers as Record<string, string>),
								origin: origin('web'),
							},
						});
						return new globalThis.Response(answer.body, {
							status: answer.status,
							headers: { 'content-type': 'application/json' },
						});
					},
				};
				const saved = {
					document: (globalThis as Record<string, unknown>).document,
					fetch: globalThis.fetch,
				};
				Object.assign(globalThis, browser);
				try {
					const file = join(dir, 'site-bundle.mjs');
					writeFileSync(file, bundle.body);
					await import(file);
					for (let i = 0; i < 100 && !elements['#ping']?.textContent; i++) {
						await new Promise((resolve) => setTimeout(resolve, 100));
					}
				} finally {
					Object.assign(globalThis, saved);
				}
				expect(elements['#ping']?.textContent).toBe(
					JSON.stringify({ ok: true }),
				);
				// The page's trace context went with it.
				expect(siteTraceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
			});

			it('(a) signs in from the site, setting the session on the shared cookie domain', async () => {
				const email = `a-${randomBytes(4).toString('hex')}@example.com`;
				const signUp = await edge('auth', '/api/auth/sign-up/email', {
					method: 'POST',
					headers: { origin: origin('web') },
					body: { email, password: 'correct-horse-battery', name: 'Ada' },
				});
				expect(signUp.status).toBe(200);

				const signIn = await edge('auth', '/api/auth/sign-in/email', {
					method: 'POST',
					headers: { origin: origin('web') },
					body: { email, password: 'correct-horse-battery' },
				});
				expect(signIn.status).toBe(200);

				const set = ([] as string[]).concat(signIn.headers['set-cookie'] ?? []);
				const session = set.find((cookie) => /session_token=/.test(cookie));
				expect(session).toBeDefined();
				expect(session).toMatch(
					new RegExp(`Domain=\\.?${name}\\.localhost`, 'i'),
				);
				expect(session).toMatch(/Secure/i);
			});

			it('(b) the API validates the session by asking the auth server inside the network', async () => {
				const email = `b-${randomBytes(4).toString('hex')}@example.com`;
				const signUp = await edge('auth', '/api/auth/sign-up/email', {
					method: 'POST',
					headers: { origin: origin('web') },
					body: { email, password: 'correct-horse-battery', name: 'Grace' },
				});
				expect(signUp.status).toBe(200);

				const me = await edge('api', '/me', {
					headers: { cookie: cookies(signUp), origin: origin('web') },
				});
				expect(me.status).toBe(200);
				expect(JSON.parse(me.body)).toEqual({ email });

				const anonymous = await edge('api', '/me');
				expect(anonymous.status).toBe(401);
			});

			it('(c) accepts sign-out from the browser origin and from a sibling service, and refuses an undeclared origin', async () => {
				const email = `c-${randomBytes(4).toString('hex')}@example.com`;
				const signUp = await edge('auth', '/api/auth/sign-up/email', {
					method: 'POST',
					headers: { origin: origin('web') },
					body: { email, password: 'correct-horse-battery', name: 'Barbara' },
				});
				expect(signUp.status).toBe(200);
				const browserSession = cookies(signUp);

				// From the browser, through the edge.
				const signOut = await edge('auth', '/api/auth/sign-out', {
					method: 'POST',
					headers: { cookie: browserSession, origin: origin('web') },
					body: {},
				});
				expect(signOut.status).toBe(200);
				const after = await edge('api', '/me', {
					headers: { cookie: browserSession },
				});
				expect(after.status).toBe(401);

				// From the API's container, to the auth server on the compose network,
				// carrying the API's internal origin.
				const signIn = await edge('auth', '/api/auth/sign-in/email', {
					method: 'POST',
					headers: { origin: origin('web') },
					body: { email, password: 'correct-horse-battery' },
				});
				expect(signIn.status).toBe(200);
				const serviceSession = cookies(signIn);

				const signOutFrom = (from: string) =>
					fromApi(
						`fetch('http://auth:3001/api/auth/sign-out', { method: 'POST', headers: { origin: ${JSON.stringify(from)}, cookie: ${JSON.stringify(serviceSession)}, 'content-type': 'application/json' }, body: '{}' }).then((r) => console.log(r.status))`,
					).then((said) => Number(said.trim().split('\n').pop()));

				expect(await signOutFrom('http://evil.example')).toBe(403);
				expect(await signOutFrom('http://api:3000')).toBe(200);
			});

			it('streams a response through Caddy as it is written', async () => {
				const chunks = await streamed({
					port: https,
					host: host('api'),
					hostHeader: `${host('api')}:${https}`,
					ca,
				});

				expect(chunks.map((chunk) => chunk.text).join('')).toBe(
					'chunk 1\nchunk 2\nchunk 3\n',
				);
				// Written 700ms apart, and received apart: nothing buffered them.
				expect(chunks.at(-1)!.at - chunks[0]!.at).toBeGreaterThan(1000);
			});

			/** `docker compose <args>` against this stack. */
			const compose = (...args: string[]) =>
				exec('docker', ['compose', '-p', project, '-f', file(), ...args]);

			it("(e) the worker's container consumes what the API sends, and the API reads back what it wrote", async () => {
				// Running and healthy by its own check, with nothing published.
				const [ps] = (await compose('ps', '--format', 'json', 'jobs'))
					.trim()
					.split('\n')
					.map((line) => JSON.parse(line));
				expect(ps.State).toBe('running');
				expect(ps.Health).toBe('healthy');
				expect(
					(ps.Publishers ?? []).filter(
						(p: { PublishedPort: number }) => p.PublishedPort > 0,
					),
				).toEqual([]);

				const id = `note-${randomBytes(4).toString('hex')}`;
				const sent = await edge('api', '/notes', {
					method: 'POST',
					body: { id, body: 'from the API' },
				});
				expect(sent.status).toBeLessThan(300);

				let read: Response | undefined;
				for (let attempt = 0; attempt < 60; attempt++) {
					read = await edge('api', `/notes/${id}`);
					if (read.status === 200) break;
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
				expect(read?.status).toBe(200);
				expect(JSON.parse(read!.body)).toEqual({ id, body: 'from the API' });

				// Written in the worker's container, not the API's.
				expect(await compose('logs', 'jobs')).toContain('Wrote a note');
				expect(await compose('logs', 'api')).not.toContain('Wrote a note');
			});

			it('(g) migrates, then seeds, before any app starts, and the API reads the seeded row', async () => {
				const migrated = output.indexOf('🗄️  db/database/migrations: applied 1');
				const seeded = output.indexOf('🌱 db/database/seeds: ran 1');
				const started = output.indexOf('🐳 Building images');
				expect(migrated).toBeGreaterThan(-1);
				expect(seeded).toBeGreaterThan(migrated);
				expect(started).toBeGreaterThan(seeded);
				expect(output).toContain('   ✓ 001_welcome_note');

				const read = await edge('api', '/notes/welcome');
				expect(read.status).toBe(200);
				expect(JSON.parse(read.body)).toEqual({
					id: 'welcome',
					body: 'Seeded by every deploy',
				});
			});

			it('(e) a stopped worker drains and exits 0, inside the stop timeout', async () => {
				const started = Date.now();
				await compose('stop', '--timeout', '10', 'jobs');
				const took = Date.now() - started;

				const container = (await compose('ps', '-a', '-q', 'jobs')).trim();
				const exitCode = (
					await exec('docker', [
						'inspect',
						'--format',
						'{{.State.ExitCode}}',
						container,
					])
				).trim();
				expect(exitCode).toBe('0');
				expect(took).toBeLessThan(10_000);
				expect(await compose('logs', 'jobs')).toContain('Worker stopped');
			});

			it("(f) the API's cache round-trips through the stack's Redis, which publishes nothing", async () => {
				const key = `k-${randomBytes(4).toString('hex')}`;
				const put = await edge('api', `/cache/${key}`, {
					method: 'PUT',
					body: { value: 'from the cache' },
				});
				expect(put.status).toBe(200);

				const got = await edge('api', `/cache/${key}`);
				expect(got.status).toBe(200);
				expect(JSON.parse(got.body)).toEqual({ value: 'from the cache' });

				// In Redis — the cache's own database there — and nowhere else.
				const keys = await compose(
					'exec',
					'-T',
					'redis',
					'redis-cli',
					'-n',
					'0',
					'--scan',
					'--pattern',
					`fixture:${key}`,
				);
				expect(keys.trim()).toBe(`fixture:${key}`);

				// Signed in by the env file alone; a client without it is refused.
				const anonymous = await compose(
					'exec',
					'-T',
					'-e',
					'REDISCLI_AUTH=',
					'redis',
					'redis-cli',
					'ping',
				).catch((error: Error) => error.message);
				expect(anonymous).toMatch(/NOAUTH/);

				// Healthy, with no port on this machine.
				const [ps] = (await compose('ps', '--format', 'json', 'redis'))
					.trim()
					.split('\n')
					.map((line) => JSON.parse(line));
				expect(ps.Health).toBe('healthy');
				expect(
					(ps.Publishers ?? []).filter(
						(p: { PublishedPort: number }) => p.PublishedPort > 0,
					),
				).toEqual([]);
			});

			it.runIf(entry.logs)(
				"(d) sends the API's telemetry to the stack's OpenObserve, on loopback alone",
				{ timeout: 3 * 60_000 },
				async () => {
					// Published on 127.0.0.1 and nothing else.
					const published = await exec('docker', [
						'compose',
						'-p',
						project,
						'-f',
						file(),
						'port',
						'openobserve',
						'5080',
					]);
					expect(published.trim()).toBe(`127.0.0.1:${logsPort}`);
					expect(output).toContain(
						`📜 Logs (OpenObserve) on 127.0.0.1:${logsPort}`,
					);
					expect(output).toContain(
						`ssh -N -L ${logsPort}:localhost:${logsPort}`,
					);

					// The login the stack signs the apps in with, as written.
					const env = readFileSync(
						join(dir, '.gkm', 'compose', 'development', 'openobserve.env'),
						'utf-8',
					);
					const login = (key: string) =>
						new RegExp(`^${key}=(.*)$`, 'm').exec(env)![1]!;
					const auth = `Basic ${Buffer.from(
						`${login('ZO_ROOT_USER_EMAIL')}:${login('ZO_ROOT_USER_PASSWORD')}`,
					).toString('base64')}`;

					// A request whose handler logs a line. The server is one bundle,
					// so nothing hooks pino or node:http: the line is sent by the
					// logger itself and the request's span by the server's own
					// middleware, and they must land in the same trace.
					const ping = await edge('api', '/ping');
					expect(ping.status).toBe(200);

					/** OpenObserve's search API over the `default` stream of a type. */
					const search = async (
						type: 'logs' | 'traces',
						where: string,
					): Promise<Record<string, unknown>[]> => {
						const now = Date.now() * 1000;
						const response = await fetch(
							`http://127.0.0.1:${logsPort}/api/default/_search?type=${type}`,
							{
								method: 'POST',
								headers: {
									authorization: auth,
									'content-type': 'application/json',
								},
								body: JSON.stringify({
									query: {
										sql: `SELECT * FROM "default" WHERE ${where}`,
										start_time: now - 15 * 60 * 1_000_000,
										end_time: now + 60 * 1_000_000,
										from: 0,
										size: 10,
									},
								}),
							},
						);
						if (!response.ok) return [];
						const body = (await response.json()) as {
							hits?: Record<string, unknown>[];
						};
						return body.hits ?? [];
					};
					// Exported in batches: asked until it is there.
					const eventually = async (type: 'logs' | 'traces', where: string) => {
						for (let attempt = 0; attempt < 60; attempt++) {
							const hits = await search(type, where);
							if (hits.length > 0) return hits;
							await new Promise((resolve) => setTimeout(resolve, 2_000));
						}
						return [];
					};

					// The handler's line, from the api, with the trace it ran in.
					const [line] = await eventually(
						'logs',
						`service_name = 'api' AND body = 'Pinged'`,
					);
					expect(line).toBeDefined();
					expect(line!.severity).toBe('INFO');
					const traceId = String(line!.trace_id);
					expect(traceId).toMatch(/^[0-9a-f]{32}$/);

					// The request's SERVER span, in that same trace.
					const [span] = await eventually(
						'traces',
						`trace_id = '${traceId}' AND operation_name = 'GET /ping'`,
					);
					expect(span).toBeDefined();
					expect(span!.service_name).toBe('api');
					expect(String(span!.span_kind)).toBe('2'); // SERVER
					expect(String(span!.http_response_status_code)).toBe('200');
					expect(span!.span_id).toBe(line!.span_id);

					// The site's request — sent by its bundle above, from its origin,
					// through the edge — is a child of the page's trace, not a new one.
					const [, siteTraceId, siteSpanId] = siteTraceparent!.split('-');
					const [continued] = await eventually(
						'traces',
						`trace_id = '${siteTraceId}' AND operation_name = 'GET /ping'`,
					);
					expect(continued).toBeDefined();
					expect(continued!.reference_parent_span_id).toBe(siteSpanId);

					// And the wrong login is refused.
					const refused = await fetch(
						`http://127.0.0.1:${logsPort}/api/default/streams`,
						{ headers: { authorization: 'Basic eDp5' } },
					);
					expect(refused.status).toBe(401);
				},
			);
		},
	);
}

/**
 * CI's half and the server's half of a release, through a real registry:
 * `gkm compose --build --push --tag t1` builds every image and pushes it,
 * starting nothing; `gkm compose --tag t1` then pulls exactly those images
 * and runs them, healthy.
 *
 * And one backend image for every stage: no image embeds a stage's
 * credentials, so the API image pushed once runs with the development env
 * file and with the production one, and each container reads its own
 * stage's secret.
 */
describe.runIf(RUN)(
	'gkm compose --build --push, then --tag, through a registry',
	{ timeout: 60_000 },
	() => {
		const name = `compose-push-${randomBytes(3).toString('hex')}`;
		const project = `${name}-development`;
		const registryName = `gkm-e2e-registry-${randomBytes(3).toString('hex')}`;
		/** Each stage's value of the API's one third-party credential. */
		const stamps = {
			development: `dev-${randomBytes(4).toString('hex')}`,
			production: `prod-${randomBytes(4).toString('hex')}`,
		};
		let dir: string;
		let home: string;
		let registry: string;
		let pushed = '';
		let pulled = '';
		let digests: Record<string, string> = {};
		const containers: string[] = [];

		const file = () =>
			join(dir, '.gkm', 'compose', 'development', 'docker-compose.yml');
		const gkm = (args: readonly string[], env: Record<string, string> = {}) =>
			exec(process.execPath, [CLI, ...args], {
				cwd: dir,
				env: childEnv({ GKM_HOME: home, ...env }),
			});
		const ref = (app: string, tag = 't1') =>
			`${registry}/${name}/${name}-${app}:${tag}`;

		beforeAll(async () => {
			if (!existsSync(DIST)) {
				throw new Error(
					`The CLI is not built (${DIST}). Run \`npx tsdown --config ./tsdown.config.ts\` from the repo root first.`,
				);
			}

			// A registry of its own, on loopback — which Docker pushes to over
			// plain HTTP without being told to.
			const port = await freePort();
			await exec('docker', [
				'run',
				'-d',
				'--rm',
				'--name',
				registryName,
				'-p',
				`127.0.0.1:${port}:5000`,
				'registry:2',
			]);
			registry = `localhost:${port}`;

			dir = realpathSync(await createTempDir('gkm-compose-push-'));
			home = realpathSync(await createTempDir('gkm-compose-push-home-'));
			writeComposeApp(dir, { name, registry });
			// A secret the API reads at runtime, and an endpoint that says it.
			writeFileSync(
				join(dir, 'constructs', 'stamp.ts'),
				`import { Credential } from '@geekmidas/constructs/credential';
import { z } from 'zod';

export const stamp = new Credential('Stamp', {
  schema: z.object({ value: z.string() }),
});
`,
			);
			writeFileSync(
				join(dir, 'apps', 'api', 'endpoints', 'stamp.ts'),
				`import { z } from 'zod';
import { api } from '../../../constructs/api.js';
import { stamp } from '../../../constructs/stamp.js';

export const readStamp = api
  .get('/stamp')
  .dependsOn([stamp])
  .output(z.object({ value: z.string() }))
  .handle(async ({ services }) => ({ value: services.stamp.value }));
`,
			);
			await dependOnThisCheckout(dir, name);
			const store = new FileSecretsStore(
				dir,
				keystoreProject(await loadWorkspaceSettings(dir), home),
			);
			for (const [stage, value] of Object.entries(stamps)) {
				await store.write(stage, {
					...initStageSecrets(stage),
					custom: { STAMP_CREDENTIALS: JSON.stringify({ value }) },
				});
			}

			await exec('pnpm', ['install', '--lockfile-only'], { cwd: dir });
			const git = childEnv({
				GIT_AUTHOR_NAME: 'gkm',
				GIT_AUTHOR_EMAIL: 'gkm@example.com',
				GIT_COMMITTER_NAME: 'gkm',
				GIT_COMMITTER_EMAIL: 'gkm@example.com',
			});
			await exec('git', ['init', '-q'], { cwd: dir, env: git });
			await exec('git', ['add', '-A'], { cwd: dir, env: git });
			await exec('git', ['commit', '-q', '-m', 'init'], {
				cwd: dir,
				env: git,
			});

			// CI's half: build and push, start nothing.
			pushed = await gkm([
				'compose',
				'--stage',
				'development',
				'--build',
				'--push',
				'--tag',
				't1',
				'--digests-file',
				'digests.json',
			]);
			digests = JSON.parse(readFileSync(join(dir, 'digests.json'), 'utf-8'));

			// Nothing of the build left on this machine: the server's half has
			// to pull every image from the registry.
			await exec('docker', [
				'image',
				'rm',
				'-f',
				...['api', 'auth', 'jobs'].map((app) => ref(app)),
				ref('web', 't1-development'),
			]);

			const https = await freePort();
			const http = await freePort();
			pulled = await gkm(['compose', '--stage', 'development', '--tag', 't1'], {
				GKM_COMPOSE_HTTPS_PORT: String(https),
				GKM_COMPOSE_HTTP_PORT: String(http),
			});
		}, BUILD_TIMEOUT);

		afterAll(async () => {
			if (process.env.GKM_E2E_KEEP === '1') {
				console.log(`Kept ${project} and ${registryName} in ${dir}`);
				return;
			}
			for (const container of containers) {
				await exec('docker', ['rm', '-f', container]).catch(() => {});
			}
			if (dir && existsSync(file())) {
				await exec('docker', [
					'compose',
					'-p',
					project,
					'-f',
					file(),
					'down',
					'--volumes',
					'--remove-orphans',
				]).catch(() => {});
			}
			if (registry) {
				const images = await exec('docker', [
					'images',
					'--quiet',
					'--filter',
					`reference=${registry}/${name}/*`,
				]).catch(() => '');
				const ids = [...new Set(images.split('\n').filter(Boolean))];
				if (ids.length > 0) {
					await exec('docker', ['image', 'rm', '-f', ...ids]).catch(() => {});
				}
			}
			await exec('docker', ['rm', '-f', registryName]).catch(() => {});
			if (dir) await cleanupDir(dir);
			if (home) await cleanupDir(home);
		}, 5 * 60_000);

		it('pushed every image with the digest the registry stored, and started nothing', async () => {
			expect(Object.keys(digests).sort()).toEqual([
				'api',
				'auth',
				'jobs',
				'web',
			]);
			expect(digests.api).toMatch(
				new RegExp(
					`^${ref('api').replace(/[.]/g, '\\.')}@sha256:[0-9a-f]{64}$`,
				),
			);
			// The site at <tag>-<stage>, with the stage's public URLs in it.
			expect(digests.web).toContain(`${name}-web:t1-development@sha256:`);
			for (const pinned of Object.values(digests)) {
				expect(pushed).toContain(pinned);
			}
			// Nothing was provisioned, started or recorded by the push.
			expect(pushed).not.toContain('is running');
			expect(pushed).not.toContain('Creating databases');
			// The registry has each one.
			const catalog = await fetch(`http://${registry}/v2/_catalog`).then(
				(r) => r.json() as Promise<{ repositories: string[] }>,
			);
			expect(catalog.repositories.sort()).toEqual(
				['api', 'auth', 'jobs', 'web'].map((app) => `${name}/${name}-${app}`),
			);
		});

		it('pulled exactly the pushed images, and they came up healthy', async () => {
			expect(pulled).toContain(`${project} is running`);
			for (const app of ['api', 'auth', 'web', 'jobs']) {
				expect(pulled).toContain(`✓ ${app}`);
			}

			const { state } = JSON.parse(
				readFileSync(join(dir, '.gkm', 'deploy-development.json'), 'utf-8'),
			);
			for (const [app, pinned] of Object.entries(digests)) {
				expect(
					`${state.releases[app].current.ref}@${state.releases[app].current.digest}`,
				).toBe(pinned);
			}
		});

		it('runs the one API image on every stage, each with its own secrets', async () => {
			// Production's env file, written as a deploy of it would write it.
			await gkm([
				'compose',
				'--stage',
				'production',
				'--tag',
				't1',
				'--dry-run',
			]);
			const image = digests.api!;
			const env = (stage: string) =>
				join(dir, '.gkm', 'compose', stage, 'api.env');

			// Nothing of any stage's is in the image.
			const history = await exec('docker', [
				'history',
				'--no-trunc',
				'--format',
				'{{.CreatedBy}}',
				image,
			]);
			expect(history).not.toMatch(/GKM_CIPHERTEXT_HASH=[0-9a-f]/);
			const environment = await exec('docker', [
				'image',
				'inspect',
				'--format',
				'{{json .Config.Env}}',
				image,
			]);
			expect(environment).not.toContain('STAMP_CREDENTIALS');
			expect(environment).not.toContain('GKM_MASTER_KEY');

			for (const [stage, value] of Object.entries(stamps)) {
				const container = (
					await exec('docker', [
						'run',
						'-d',
						'--env-file',
						env(stage),
						'-p',
						'127.0.0.1::3000',
						image,
					])
				).trim();
				containers.push(container);
				const port = (await exec('docker', ['port', container, '3000']))
					.trim()
					.split('\n')[0]!
					.split(':')
					.pop();

				let body: unknown;
				for (let attempt = 0; attempt < 60; attempt++) {
					const response = await fetch(`http://127.0.0.1:${port}/stamp`).catch(
						() => undefined,
					);
					if (response?.ok) {
						body = await response.json();
						break;
					}
					await new Promise((resolve) => setTimeout(resolve, 500));
				}
				expect(body).toEqual({ value });
			}
		});
	},
);

/** Run openssl, failing with what it said. */
const openssl = (args: readonly string[], cwd: string) =>
	exec('openssl', args, { cwd });

/**
 * A certificate authority made for one run, and a certificate it signed for
 * every host the stacks answer — what `deploy.compose.tls` hands the edge in
 * place of Let's Encrypt, which cannot issue for names nobody can resolve.
 * The CLI trusts the CA through NODE_EXTRA_CA_CERTS, as a server would trust
 * an internal CA.
 */
async function testCertificate(
	dir: string,
	domains: readonly string[],
): Promise<{ ca: string; cert: string; key: string }> {
	await openssl(
		[
			'req',
			'-x509',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-days',
			'2',
			'-subj',
			'/CN=gkm compose e2e CA',
			'-keyout',
			'ca.key',
			'-out',
			'ca.pem',
			'-addext',
			'basicConstraints=critical,CA:TRUE',
			'-addext',
			'keyUsage=critical,keyCertSign,cRLSign',
		],
		dir,
	);
	await openssl(
		[
			'req',
			'-newkey',
			'rsa:2048',
			'-nodes',
			'-subj',
			`/CN=${domains[0]}`,
			'-keyout',
			'edge.key',
			'-out',
			'edge.csr',
		],
		dir,
	);
	writeFileSync(
		join(dir, 'edge.ext'),
		`subjectAltName=${domains.flatMap((d) => [`DNS:${d}`, `DNS:*.${d}`]).join(',')}
basicConstraints=CA:FALSE
extendedKeyUsage=serverAuth
`,
	);
	await openssl(
		[
			'x509',
			'-req',
			'-in',
			'edge.csr',
			'-CA',
			'ca.pem',
			'-CAkey',
			'ca.key',
			'-CAcreateserial',
			'-days',
			'2',
			'-extfile',
			'edge.ext',
			'-out',
			'edge.pem',
		],
		dir,
	);
	return {
		ca: join(dir, 'ca.pem'),
		cert: join(dir, 'edge.pem'),
		key: join(dir, 'edge.key'),
	};
}

/**
 * `proxy: 'traefik'`, end to end: two deployed stages of one project, each
 * its own stack, both behind one shared Traefik edge that the first run
 * started — on free ports, with a certificate from a CA made for the run.
 *
 * - Sign-in from the site's origin through the edge, an API call with that
 *   session, and the trusted origins of a sibling service — reached by its
 *   alias on the shared network.
 * - The site, and a streamed response, through the edge.
 * - The log UI's allowlist: allowed on one stage, refused on the other.
 * - `--down` of one stack: its routes are gone, and the other still serves.
 */
describe.runIf(RUN)(
	"gkm compose with proxy: 'traefik', end to end",
	{ timeout: 60_000 },
	() => {
		const name = `compose-traefik-${randomBytes(3).toString('hex')}`;
		const stages = ['staging', 'production'] as const;
		type Stage = (typeof stages)[number];
		const domain = (stage: Stage) => `${stage}.${name}.localhost`;
		const project = (stage: Stage) => `${name}-${stage}`;
		/** Every private range: whatever address Docker hands the edge. */
		const PRIVATE = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];

		let dir: string;
		let home: string;
		let certs: string;
		let ca: string;
		let caFile: string;
		let https: number;
		let http: number;
		const output: Partial<Record<Stage, string>> = {};

		const host = (stage: Stage, app: 'api' | 'auth' | 'web' | 'logs') =>
			app === 'web' ? domain(stage) : `${app}.${domain(stage)}`;
		const origin = (stage: Stage, app: 'api' | 'auth' | 'web') =>
			`https://${host(stage, app)}`;
		const file = (stage: Stage) =>
			join(dir, '.gkm', 'compose', stage, 'docker-compose.yml');
		const dynamic = () => join(home, 'edge', 'dynamic');

		/** A request to the shared edge, as a browser at the public address. */
		function edge(
			stage: Stage,
			app: 'api' | 'auth' | 'web' | 'logs',
			path: string,
			init: {
				method?: string;
				headers?: Record<string, string>;
				body?: unknown;
			} = {},
		): Promise<Response> {
			const body =
				init.body === undefined ? undefined : JSON.stringify(init.body);
			return new Promise((resolve, reject) => {
				const req = httpsRequest(
					{
						host: '127.0.0.1',
						port: https,
						servername: host(stage, app),
						path,
						method: init.method ?? 'GET',
						ca,
						headers: {
							host: host(stage, app),
							...(body
								? {
										'content-type': 'application/json',
										'content-length': Buffer.byteLength(body),
									}
								: {}),
							...init.headers,
						},
					},
					(res) => {
						let text = '';
						res.on('data', (chunk: Buffer) => {
							text += chunk.toString();
						});
						res.on('end', () =>
							resolve({
								status: res.statusCode ?? 0,
								headers: res.headers,
								body: text,
							}),
						);
					},
				);
				req.on('error', reject);
				if (body) req.write(body);
				req.end();
			});
		}

		const cookies = (response: Response) =>
			([] as string[])
				.concat(response.headers['set-cookie'] ?? [])
				.map((cookie) => cookie.split(';')[0])
				.join('; ');

		const gkm = (args: readonly string[]) =>
			exec(process.execPath, [CLI, ...args], {
				cwd: dir,
				env: childEnv({
					GKM_HOME: home,
					GKM_COMPOSE_HTTPS_PORT: String(https),
					GKM_COMPOSE_HTTP_PORT: String(http),
					// The run's CA, trusted by verify as a server trusts its own.
					NODE_EXTRA_CA_CERTS: caFile,
				}),
			});

		/** The workspace, its log UI open to `allow`. */
		const configure = (allow: readonly string[]) =>
			writeComposeApp(dir, {
				name,
				deployed: [...stages],
				domains: Object.fromEntries(stages.map((s) => [s, domain(s)])),
				compose: {
					proxy: 'traefik',
					logs: { public: { allow } },
					tls: Object.fromEntries(
						stages.map((s) => [
							s,
							{ certFile: '../certs/edge.pem', keyFile: '../certs/edge.key' },
						]),
					),
				},
			});

		beforeAll(async () => {
			if (!existsSync(DIST)) {
				throw new Error(
					`The CLI is not built (${DIST}). Run \`npx tsdown --config ./tsdown.config.ts\` from the repo root first.`,
				);
			}

			const root = realpathSync(await createTempDir('gkm-compose-traefik-'));
			dir = join(root, 'project');
			certs = join(root, 'certs');
			home = join(root, 'home');
			for (const path of [dir, certs, home]) {
				await exec('mkdir', ['-p', path]);
			}
			caFile = (await testCertificate(certs, stages.map(domain))).ca;
			ca = readFileSync(caFile, 'utf-8');

			configure(PRIVATE);
			await dependOnThisCheckout(dir, name, { telemetry: true });
			await exec('pnpm', ['install', '--lockfile-only'], { cwd: dir });
			const git = childEnv({
				GIT_AUTHOR_NAME: 'gkm',
				GIT_AUTHOR_EMAIL: 'gkm@example.com',
				GIT_COMMITTER_NAME: 'gkm',
				GIT_COMMITTER_EMAIL: 'gkm@example.com',
			});
			await exec('git', ['init', '-q'], { cwd: dir, env: git });
			await exec('git', ['add', '-A'], { cwd: dir, env: git });
			await exec('git', ['commit', '-q', '-m', 'init'], { cwd: dir, env: git });

			https = await freePort();
			http = await freePort();

			// The first stack starts the edge; its log UI answers the private
			// ranges, which is where Docker's published ports come from.
			output.staging = await gkm(['compose', '--stage', 'staging']);
			// The second registers with the edge the first started, its log UI
			// open to an address this machine is not.
			const config = join(dir, 'gkm.config.ts');
			writeFileSync(
				config,
				readFileSync(config, 'utf-8').replace(
					JSON.stringify(PRIVATE),
					JSON.stringify(['203.0.113.7']),
				),
			);
			output.production = await gkm(['compose', '--stage', 'production']);
		}, 2 * BUILD_TIMEOUT);

		afterAll(async () => {
			if (process.env.GKM_E2E_KEEP === '1') {
				console.log(`Kept ${name} and gkm-edge in ${dir}`);
				return;
			}
			for (const stage of stages) {
				if (dir && existsSync(file(stage))) {
					await exec('docker', [
						'compose',
						'-p',
						project(stage),
						'-f',
						file(stage),
						'down',
						'--volumes',
						'--remove-orphans',
					]).catch(() => {});
				}
			}
			const edgeFile = join(home, 'edge', 'docker-compose.yml');
			if (home && existsSync(edgeFile)) {
				await exec('docker', [
					'compose',
					'-p',
					'gkm-edge',
					'-f',
					edgeFile,
					'down',
					'--volumes',
				]).catch(() => {});
				await exec('docker', ['network', 'rm', 'gkm-edge']).catch(() => {});
			}
			const images = await exec('docker', [
				'images',
				'--quiet',
				'--filter',
				`reference=${name}/*`,
			]).catch(() => '');
			const ids = [...new Set(images.split('\n').filter(Boolean))];
			if (ids.length > 0) {
				await exec('docker', ['image', 'rm', '-f', ...ids]).catch(() => {});
			}
			if (dir) await cleanupDir(join(dir, '..'));
		}, 5 * 60_000);

		it('runs no Caddy of its own, and verified each app through the shared edge', async () => {
			for (const stage of stages) {
				const said = output[stage]!;
				expect(said).toContain(`${project(stage)} is running`);
				expect(said).toContain('Checking each app through the shared edge');
				for (const app of ['api', 'auth', 'web', 'jobs']) {
					expect(said).toContain(`✓ ${app}`);
				}
				const ps = await exec('docker', [
					'compose',
					'-p',
					project(stage),
					'-f',
					file(stage),
					'ps',
					'--services',
				]);
				expect(ps.split('\n')).not.toContain('caddy');
			}
			// The first run started the edge; the second found it.
			expect(output.staging).toContain('Starting the shared edge');
			expect(readdirSync(dynamic()).sort()).toEqual(
				stages.map((stage) => `${project(stage)}.yml`).sort(),
			);
		});

		it('puts only public services on the shared network, by their aliases', async () => {
			const inspected = JSON.parse(
				await exec('docker', ['network', 'inspect', 'gkm-edge']),
			)[0] as { Containers: Record<string, { Name: string }> };
			const names = Object.values(inspected.Containers).map((c) => c.Name);

			for (const stage of stages) {
				for (const service of ['api', 'auth', 'web', 'openobserve']) {
					expect(names).toContain(`${project(stage)}-${service}-1`);
				}
				for (const service of ['postgres', 'redis', 'jobs']) {
					expect(names).not.toContain(`${project(stage)}-${service}-1`);
				}
			}
			expect(names).toContain('gkm-edge-traefik-1');
		});

		it('redirects plain HTTP to HTTPS', async () => {
			// node:http, not fetch: fetch will not send a Host of our choosing.
			const response = await new Promise<{
				status: number;
				location?: string;
			}>((resolve, reject) => {
				httpRequest(
					{
						host: '127.0.0.1',
						port: http,
						path: '/health',
						headers: { host: host('staging', 'api') },
					},
					(res) => {
						res.resume();
						resolve({
							status: res.statusCode ?? 0,
							location: res.headers.location,
						});
					},
				)
					.on('error', reject)
					.end();
			});
			expect(response.status).toBe(301);
			expect(response.location).toBe(
				`https://${host('staging', 'api')}:${https}/health`,
			);
		});

		it('signs in from the site through the edge, and the API takes the session', async () => {
			const email = `t-${randomBytes(4).toString('hex')}@example.com`;
			const signUp = await edge('staging', 'auth', '/api/auth/sign-up/email', {
				method: 'POST',
				headers: { origin: origin('staging', 'web') },
				body: { email, password: 'correct-horse-battery', name: 'Ada' },
			});
			expect(signUp.status).toBe(200);

			const signIn = await edge('staging', 'auth', '/api/auth/sign-in/email', {
				method: 'POST',
				headers: { origin: origin('staging', 'web') },
				body: { email, password: 'correct-horse-battery' },
			});
			expect(signIn.status).toBe(200);
			const session = ([] as string[])
				.concat(signIn.headers['set-cookie'] ?? [])
				.find((cookie) => /session_token=/.test(cookie));
			expect(session).toMatch(/Secure/i);

			const me = await edge('staging', 'api', '/me', {
				headers: {
					cookie: cookies(signIn),
					origin: origin('staging', 'web'),
				},
			});
			expect(me.status).toBe(200);
			expect(JSON.parse(me.body)).toEqual({ email });
			expect((await edge('staging', 'api', '/me')).status).toBe(401);
		});

		it("trusts a sibling's internal origin — its alias — and refuses one nobody declared", async () => {
			const email = `o-${randomBytes(4).toString('hex')}@example.com`;
			const signUp = await edge('staging', 'auth', '/api/auth/sign-up/email', {
				method: 'POST',
				headers: { origin: origin('staging', 'web') },
				body: { email, password: 'correct-horse-battery', name: 'Grace' },
			});
			expect(signUp.status).toBe(200);
			const session = cookies(signUp);
			const auth = `http://${project('staging')}-auth:3001`;

			const signOutFrom = (from: string) =>
				exec('docker', [
					'compose',
					'-p',
					project('staging'),
					'-f',
					file('staging'),
					'exec',
					'-T',
					'api',
					'node',
					'-e',
					`fetch(${JSON.stringify(`${auth}/api/auth/sign-out`)}, { method: 'POST', headers: { origin: ${JSON.stringify(from)}, cookie: ${JSON.stringify(session)}, 'content-type': 'application/json' }, body: '{}' }).then((r) => console.log(r.status))`,
				]).then((said) => Number(said.trim().split('\n').pop()));

			expect(await signOutFrom('http://evil.example')).toBe(403);
			expect(await signOutFrom(`http://${project('staging')}-api:3000`)).toBe(
				200,
			);
		});

		it('serves the site, built with its public URLs', async () => {
			const page = await edge('staging', 'web', '/');
			expect(page.status).toBe(200);
			const script = page.body.match(/src="(\/assets\/[^"]+\.js)"/)?.[1];
			expect(script).toBeDefined();
			const bundle = await edge('staging', 'web', script!);
			expect(bundle.body).toContain(origin('staging', 'api'));
			// Caddy inside the site's image, unchanged behind Traefik.
			expect(bundle.headers['cache-control']).toBe(
				'public, max-age=31536000, immutable',
			);
		});

		it('streams a response as it is written', async () => {
			const chunks = await streamed({
				port: https,
				host: host('staging', 'api'),
				hostHeader: host('staging', 'api'),
				ca,
			});

			expect(chunks.map((chunk) => chunk.text).join('')).toBe(
				'chunk 1\nchunk 2\nchunk 3\n',
			);
			expect(chunks.at(-1)!.at - chunks[0]!.at).toBeGreaterThan(1000);
		});

		it('answers the log UI only to the addresses each stage allows', async () => {
			// Staging allows the private ranges this request arrives from.
			const allowed = await edge('staging', 'logs', '/web/');
			expect(allowed.status).not.toBe(403);
			expect(allowed.status).toBeLessThan(500);
			// Production allows one address, which this machine is not.
			const denied = await edge('production', 'logs', '/web/');
			expect(denied.status).toBe(403);
		});

		it('serves both stacks at once, each on its own hosts', async () => {
			for (const stage of stages) {
				expect((await edge(stage, 'api', '/health')).status).toBe(200);
				expect((await edge(stage, 'web', '/')).status).toBe(200);
			}
		});

		it('--down of one stack removes its routes, and the other keeps serving', async () => {
			const said = await gkm(['compose', '--stage', 'staging', '--down']);
			expect(said).toContain(`Removed ${project('staging')}'s routes`);
			expect(readdirSync(dynamic())).toEqual([`${project('production')}.yml`]);

			// The edge picks the removal up from its directory.
			let gone = 0;
			for (let attempt = 0; attempt < 30; attempt++) {
				gone = (await edge('staging', 'api', '/health')).status;
				if (gone === 404) break;
				await new Promise((resolve) => setTimeout(resolve, 500));
			}
			expect(gone).toBe(404);

			expect((await edge('production', 'api', '/health')).status).toBe(200);
			expect((await edge('production', 'web', '/')).status).toBe(200);
			// The edge itself is left running for the stacks still on it.
			const edgePs = await exec('docker', [
				'ps',
				'--filter',
				'name=gkm-edge-traefik-1',
				'--format',
				'{{.Status}}',
			]);
			expect(edgePs).toMatch(/healthy/);
		});
	},
);
