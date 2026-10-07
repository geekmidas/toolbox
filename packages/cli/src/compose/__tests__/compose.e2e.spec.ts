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
import { request as httpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../__tests__/test-helpers';
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
async function dependOnThisCheckout(dir: string, name: string): Promise<void> {
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
	const range = (dep: string) => sink.dependencies[dep] as string;
	writeFileSync(
		join(dir, 'package.json'),
		`${JSON.stringify(
			{
				name,
				private: true,
				type: 'module',
				packageManager: 'pnpm@10.30.1',
				dependencies: {
					...Object.fromEntries(
						[
							'@geekmidas/cli',
							'@geekmidas/constructs',
							'@geekmidas/db',
							'@geekmidas/envkit',
							'@geekmidas/errors',
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
							'kysely',
							'pg',
							'pino',
							'zod',
						].map((dep) => [dep, range(dep)]),
					),
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
	{ command: 'gkm compose', args: ['compose'] },
	{
		command: 'gkm deploy --target compose',
		args: ['deploy', '--target', 'compose', '--stage', 'development'],
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
				writeComposeApp(dir, { name });
				await dependOnThisCheckout(dir, name);

				// What a real project has: a lockfile every image installs from,
				// and a commit its images are tagged with.
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

				const { state } = JSON.parse(
					readFileSync(join(dir, '.gkm', 'deploy-development.json'), 'utf-8'),
				);
				expect(Object.keys(state.releases).sort()).toEqual([
					'api',
					'auth',
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
		},
	);
}
