import { type ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cleanupDir, createTempDir } from '../../../__tests__/test-helpers';
import { nextPrerenderManifest } from '../../../docker/templates';
import { edgeFetch } from '../health';
import { NEXT_REVALIDATE_HEADER, nextPreviewModeId, warmSite } from '../warmup';

/**
 * The warm-up against a real Next server — the version this repository
 * pins — built the way a site's image is: `output: 'standalone'`, with
 * `GKM_BUILD_OFFLINE=1`, so each ISR page and the sitemap are prerendered
 * empty and cached as fresh for their `revalidate` window.
 *
 * What it proves is the mechanism the warm-up relies on: a plain request is
 * answered from that cache (`x-nextjs-cache: HIT`, empty), and a request
 * carrying `x-prerender-revalidate: <previewModeId>` — the id read from the
 * standalone output's prerender manifest — renders from the API.
 *
 * Built with webpack (`--webpack`): Turbopack refuses a `node_modules`
 * outside its root, and this app's are this package's. Which bundler built
 * the pages is no part of what the header does at runtime.
 */

const BUILD_TIMEOUT_MS = 180_000;
const cliModules = join(import.meta.dirname, '../../../../node_modules');

const FILES: Record<string, string> = {
	'package.json': JSON.stringify({ name: 'isr-site', private: true }),
	// Traced from the filesystem's root: this app's `node_modules` are links
	// into this repository, outside the app, and a file outside the tracing
	// root is copied above the standalone directory. From `/`, the app sits
	// at its own path under `standalone/` — the layout of a monorepo's app,
	// `<appPath>/server.js`, that the generated Dockerfile copies to `/app`.
	// One build worker, so the build does not starve the suites beside it.
	'next.config.mjs':
		"export default { output: 'standalone', outputFileTracingRoot: '/', experimental: { cpus: 1 } };\n",
	'app/layout.js':
		'export default function Layout({ children }) { return <html><body>{children}</body></html>; }\n',
	// What the compose guide tells a site to do: skip the fetch offline.
	'app/notes.js': `export async function notes() {
  if (process.env.GKM_BUILD_OFFLINE === '1') return [];
  const res = await fetch(process.env.NOTES_API_URL);
  return res.json();
}
`,
	'app/page.js': `import { notes } from './notes';
export const revalidate = 3600;
export default async function Page() {
  const list = await notes();
  return <main>{list.map((n) => <p key={n}>{'note:' + n}</p>)}</main>;
}
`,
	'app/notes/[id]/page.js': `export const revalidate = 3600;
export function generateStaticParams() { return []; }
export default async function Note({ params }) {
  const { id } = await params;
  return <main>{'note:' + id}</main>;
}
`,
	'app/sitemap.js': `import { notes } from './notes';
export const revalidate = 3600;
export default async function sitemap() {
  const site = process.env.SITE_URL ?? 'http://localhost';
  const list = await notes();
  return [{ url: site + '/' }, ...list.map((n) => ({ url: site + '/notes/' + n }))];
}
`,
};

/** A port nothing listens on: Next reads `PORT=0` as its default, 3000. */
function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const probe = createServer();
		probe.once('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address() as AddressInfo;
			probe.close(() => resolve(port));
		});
	});
}

describe('warming a real Next site built offline', () => {
	let dir: string;
	let standalone: string;
	let appPath: string;
	let api: Server;
	let next: ChildProcess | undefined;
	let site: string;

	beforeAll(async () => {
		// By its real path: macOS's temp directory is behind a symlink, and
		// Next's standalone tracing mixes the two spellings.
		dir = realpathSync(await createTempDir('gkm-next-isr-'));
		for (const [file, content] of Object.entries(FILES)) {
			mkdirSync(dirname(join(dir, file)), { recursive: true });
			writeFileSync(join(dir, file), content);
		}
		mkdirSync(join(dir, 'node_modules'));
		for (const name of ['next', 'react', 'react-dom']) {
			symlinkSync(join(cliModules, name), join(dir, 'node_modules', name));
		}

		await promisify(execFile)(
			process.execPath,
			[join(cliModules, 'next/dist/bin/next'), 'build', '--webpack'],
			{
				cwd: dir,
				env: {
					...process.env,
					GKM_BUILD_OFFLINE: '1',
					NEXT_TELEMETRY_DISABLED: '1',
				},
				timeout: BUILD_TIMEOUT_MS,
			},
		);
		standalone = join(dir, '.next', 'standalone');
		appPath = relative('/', dir);

		// The site's API, up only once the build is done — as on a deploy.
		api = createServer((_req, res) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(['alpha', 'beta']));
		});
		await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
		const apiPort = (api.address() as AddressInfo).port;

		const port = await freePort();
		site = `http://127.0.0.1:${port}`;
		next = spawn(process.execPath, [join(appPath, 'server.js')], {
			cwd: standalone,
			env: {
				...process.env,
				PORT: String(port),
				HOSTNAME: '127.0.0.1',
				NOTES_API_URL: `http://127.0.0.1:${apiPort}/notes`,
				SITE_URL: site,
				GKM_BUILD_OFFLINE: '',
			},
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		await new Promise<void>((resolve, reject) => {
			next!.once('exit', (code) =>
				reject(new NextServerExited(code, standalone)),
			);
			next!.stdout!.on('data', (chunk: Buffer) => {
				if (chunk.toString().includes('Ready')) resolve();
			});
		});
	}, BUILD_TIMEOUT_MS + 30_000);

	afterAll(async () => {
		next?.kill();
		await new Promise<void>((resolve) =>
			api ? api.close(() => resolve()) : resolve(),
		);
		if (dir) await cleanupDir(dir);
	});

	const get = async (path: string, headers: Record<string, string> = {}) => {
		const response = await fetch(new URL(path, site), { headers });
		return {
			cache: response.headers.get('x-nextjs-cache'),
			body: await response.text(),
		};
	};

	it('serves the build cache to a plain request, and renders from the API for one with the revalidation header', async () => {
		// Plain: the build's empty copy, fresh for an hour.
		expect(await get('/')).toMatchObject({ cache: 'HIT' });
		expect((await get('/')).body).not.toContain('note:alpha');
		const sitemap = await get('/sitemap.xml');
		expect(sitemap.cache).toBe('HIT');
		expect(sitemap.body).not.toContain('/notes/alpha');

		// A plain warm-up says so: nothing it asked was rendered.
		const plain = await warmSite({ url: site, fetch: edgeFetch });
		expect(plain.warmed).toEqual([`${site}/`]);
		expect(plain.cached).toEqual([`${site}/sitemap.xml`, `${site}/`]);

		// The id, read from the standalone output where the generated
		// Dockerfile puts it: `/app` is the standalone directory.
		const lookup = await nextPreviewModeId(async (command) => {
			const [program, ...args] = command.map((arg) =>
				arg.startsWith('/app/') ? join(standalone, arg.slice(5)) : arg,
			);
			return new Promise((resolve) =>
				execFile(program!, args, (error, stdout, stderr) =>
					resolve({
						code: error ? Number(error.code ?? 1) : 0,
						stdout,
						stderr,
					}),
				),
			);
		}, nextPrerenderManifest(appPath));
		expect(lookup).toEqual({ id: expect.stringMatching(/^[0-9a-f]+$/) });
		const id = (lookup as { id: string }).id;

		const forced = await warmSite({
			url: site,
			fetch: edgeFetch,
			headers: { [NEXT_REVALIDATE_HEADER]: id },
		});
		// The sitemap, rendered again first, lists the API's notes.
		expect(forced.warmed.sort()).toEqual([
			`${site}/`,
			`${site}/notes/alpha`,
			`${site}/notes/beta`,
		]);
		expect(forced.cached).toEqual([]);
		expect(forced.warnings).toEqual([]);

		// Rendered, and cached so: a visitor's plain request gets the data.
		const after = await get('/');
		expect(after.cache).toBe('HIT');
		expect(after.body).toContain('note:alpha');
		expect((await get('/sitemap.xml')).body).toContain('/notes/beta');
	});
});

/** The Next server stopped before it said it was ready. */
class NextServerExited extends Error {
	constructor(
		readonly code: number | null,
		readonly dir: string,
	) {
		super(
			`next's standalone server in ${dir} exited (${code}) before it was ready; run \`node server.js\` there to see why.`,
		);
		this.name = 'NextServerExited';
	}
}
