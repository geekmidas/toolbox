import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EndpointGenerator } from '../EndpointGenerator';

/**
 * A production server with the optimized handlers `gkm build --production`
 * generates, run as its own process.
 *
 * Two things it used to get wrong that `gkm dev` got right: an endpoint with
 * a session callback and no authorizer was handed `undefined` for its
 * session, and an HttpError it threw — a 401 from that callback — answered
 * 500.
 */
let dir: string;
let child: ChildProcess | undefined;
let port: number;

const freePort = () =>
	new Promise<number>((resolve) => {
		const server = createServer().listen(0, () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});

beforeAll(async () => {
	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-session-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');
	writeFileSync(
		join(dir, 'api.ts'),
		`import { RestApi } from '@geekmidas/constructs/rest-api';

export const api = new RestApi('Api', { path: '.' });
`,
	);
	mkdirSync(join(dir, 'endpoints'));
	writeFileSync(
		join(dir, 'endpoints', 'me.ts'),
		`import { NotFoundError, UnauthorizedError } from '@geekmidas/errors';
import { z } from 'zod';
import { api } from '../api';

const signedIn = api.session(async ({ header }) => {
  const user = header('x-user');
  if (!user) throw new UnauthorizedError('Not signed in');
  return { user };
});

export const me = signedIn
  .get('/me')
  .output(z.object({ user: z.string() }))
  .handle(async ({ session }) => ({ user: session.user }));

export const missing = api
  .get('/missing')
  .handle(async () => {
    throw new NotFoundError('No such thing');
  });
`,
	);

	const outputDir = join(dir, '.gkm', 'server');
	mkdirSync(outputDir, { recursive: true });
	const generator = new EndpointGenerator();
	const constructs = await generator.load('endpoints/*.ts', dir);
	const module = { specifier: join(dir, 'api.ts'), exportName: 'api' };
	await generator.build(
		{
			surface: { id: 'Api', trustedOriginsKey: 'API_TRUSTED_ORIGINS', module },
			owners: { Api: module },
			production: {
				enabled: true,
				bundle: false,
				minify: false,
				healthCheck: '/health',
				gracefulShutdown: true,
				external: [],
				subscribers: 'exclude',
				openapi: false,
				optimizedHandlers: true,
			},
		},
		constructs,
		outputDir,
		{ target: 'server' },
	);

	port = await freePort();
	child = spawn(
		process.execPath,
		['--import', 'tsx', join(outputDir, 'server.ts')],
		{
			cwd: dir,
			env: { ...process.env, PORT: String(port) },
			stdio: 'ignore',
		},
	);
	const deadline = Date.now() + 30_000;
	for (;;) {
		const up = await fetch(`http://localhost:${port}/health`).then(
			(r) => r.ok,
			() => false,
		);
		if (up) break;
		if (Date.now() > deadline) throw new Error('server did not start');
		await new Promise((r) => setTimeout(r, 100));
	}
}, 60_000);

afterAll(() => {
	child?.kill('SIGKILL');
	rmSync(dir, { recursive: true, force: true });
});

describe('a production server', () => {
	it('hands an endpoint the session its callback returned, with no authorizer', async () => {
		const response = await fetch(`http://localhost:${port}/me`, {
			headers: { 'x-user': 'ada' },
		});

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ user: 'ada' });
	});

	it('answers an HttpError a session callback throws with its own status', async () => {
		const response = await fetch(`http://localhost:${port}/me`);

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({
			statusCode: 401,
			message: 'Not signed in',
		});
	});

	it('answers an HttpError a handler throws with its own status, and no stack', async () => {
		const response = await fetch(`http://localhost:${port}/missing`);
		const body = await response.json();

		expect(response.status).toBe(404);
		expect(body).toMatchObject({ statusCode: 404 });
		expect(body).not.toHaveProperty('stack');
	});
});
