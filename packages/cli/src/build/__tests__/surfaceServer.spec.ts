import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeSurfaceServer } from '../surfaceEntry';

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
