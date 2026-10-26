import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeSurfaceEntry, writeSurfaceServer } from '../surfaceEntry';

/**
 * The process a production image runs for a surface that serves itself — an
 * auth server — started the way a container starts it.
 *
 * `app.ts` here stands in for the generated entry, which exports the
 * construct's own Hono app and listens on nothing.
 */
let dir: string;

beforeAll(() => {
	const cache = join(import.meta.dirname, '../../../node_modules/.cache');
	mkdirSync(cache, { recursive: true });
	dir = mkdtempSync(join(cache, 'gkm-surface-'));
	writeFileSync(join(dir, 'package.json'), '{ "type": "module" }\n');
	writeFileSync(
		join(dir, 'app.ts'),
		`import { Hono } from 'hono';

export const app = new Hono();
app.all('/api/auth/*', (c) => c.json({ path: c.req.path }));
`,
	);
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

const freePort = () =>
	new Promise<number>((resolve) => {
		const server = createServer().listen(0, () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});

describe('writeSurfaceServer', { timeout: 60_000 }, () => {
	it('listens on PORT, answers its health check and the surface, and drains on SIGTERM', async () => {
		const entry = await writeSurfaceServer(dir, {
			healthCheck: '/health',
			gracefulShutdown: true,
		});
		const port = await freePort();
		const child = spawn(process.execPath, ['--import', 'tsx', entry], {
			cwd: dir,
			env: { ...process.env, PORT: String(port) },
			stdio: 'ignore',
		});
		const exited = new Promise<number | null>((resolve) =>
			child.once('exit', resolve),
		);

		const deadline = Date.now() + 30_000;
		let health: Response | undefined;
		while (!health) {
			health = await fetch(`http://localhost:${port}/health`).catch(
				() => undefined,
			);
			if (!health) {
				if (Date.now() > deadline) throw new Error('server did not start');
				await new Promise((r) => setTimeout(r, 100));
			}
		}

		expect(health.status).toBe(200);
		expect(await health.json()).toMatchObject({ status: 'ok' });

		const surface = await fetch(
			`http://localhost:${port}/api/auth/get-session`,
		);
		expect(await surface.json()).toEqual({ path: '/api/auth/get-session' });

		child.kill('SIGTERM');
		expect(await exited).toBe(0);
	});
});

describe('a WebSocket surface, served', { timeout: 60_000 }, () => {
	it('takes upgrades on the same port as its health, and closes every socket with 1012 on SIGTERM', async () => {
		const root = mkdtempSync(join(dir, 'ws-'));
		writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n');
		writeFileSync(
			join(root, 'realtime.ts'),
			`import { WebSocketApi } from '@geekmidas/constructs/websocket-api';

export const realtime = new WebSocketApi('Realtime', { path: '.' });
`,
		);
		writeFileSync(
			join(root, 'routes.ts'),
			`import { realtime } from './realtime.js';

export const echo = realtime.route('echo').handle(({ body }) => body);
`,
		);
		const outputDir = join(root, '.gkm', 'server');
		await writeSurfaceEntry(
			outputDir,
			{
				file: join(root, 'realtime.ts'),
				exportName: 'realtime',
				construct: undefined,
			},
			[join(root, 'routes.ts'), join(root, 'realtime.ts')],
		);
		const entry = await writeSurfaceServer(outputDir, {
			healthCheck: '/health',
			gracefulShutdown: true,
		});
		const port = await freePort();
		const child = spawn(process.execPath, ['--import', 'tsx', entry], {
			cwd: root,
			env: { ...process.env, PORT: String(port) },
			stdio: 'ignore',
		});
		const exited = new Promise<number | null>((resolve) =>
			child.once('exit', resolve),
		);

		const deadline = Date.now() + 30_000;
		while (
			!(await fetch(`http://localhost:${port}/health`).catch(() => undefined))
		) {
			if (Date.now() > deadline) throw new Error('server did not start');
			await new Promise((r) => setTimeout(r, 100));
		}

		const socket = new WebSocket(`ws://localhost:${port}/`);
		await new Promise((resolve, reject) => {
			socket.onopen = resolve;
			socket.onerror = reject;
		});
		const reply = new Promise<unknown>((resolve) => {
			socket.onmessage = (event) => resolve(JSON.parse(String(event.data)));
		});
		socket.send(JSON.stringify({ action: 'echo', id: 1, data: 'hi' }));
		expect(await reply).toEqual({ action: 'echo', id: 1, data: 'hi' });

		const closed = new Promise<number>((resolve) => {
			socket.onclose = (event) => resolve(event.code);
		});
		const signalled = Date.now();
		child.kill('SIGTERM');

		expect(await closed).toBe(1012);
		expect(await exited).toBe(0);
		// Released, not waited out: an open socket held the server until the
		// shutdown deadline before.
		expect(Date.now() - signalled).toBeLessThan(5_000);
	});
});
