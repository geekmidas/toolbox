import { describe, expect, it } from 'vitest';
import {
	generateBackendDockerfile,
	generateEntryDockerfile,
	generateNextjsDockerfile,
	generateNodeWebDockerfile,
	generateViteStaticDockerfile,
	STATIC_SITE_IMAGE,
	TURBO_VERSION,
} from '../templates';

const app = {
	imageName: 'web',
	baseImage: 'node:22-alpine',
	port: 3000,
	appPath: 'apps/web',
	turboPackage: '@shop/web',
};

const backend = {
	imageName: 'api',
	baseImage: 'node:22-alpine',
	port: 3000,
	appPath: 'apps/api',
	turboPackage: '@shop/api',
	packageManager: 'pnpm' as const,
};

/** Every template, as a site or a backend. */
const every = [
	['a gkm backend', generateBackendDockerfile],
	[
		'an entry backend',
		(o: typeof backend) =>
			generateEntryDockerfile({ ...o, entry: './src/index.ts' }),
	],
	['Next.js', generateNextjsDockerfile],
	['a Node SSR site', generateNodeWebDockerfile],
	['a Vite site', generateViteStaticDockerfile],
] as const;

describe('Dockerfiles for npm', () => {
	// npm ships with node: no install step, and turbo runs through npx.
	it('builds a backend with npx, and installs no package manager', () => {
		const dockerfile = generateBackendDockerfile({
			...app,
			packageManager: 'npm',
			healthCheckPath: '/health',
		});

		expect(dockerfile).toContain(`npx --yes turbo@${TURBO_VERSION} prune`);
		expect(dockerfile).not.toContain('corepack');
	});

	it('starts a Node web app with npm', () => {
		const dockerfile = generateNodeWebDockerfile({
			...app,
			packageManager: 'npm',
			publicUrlArgs: [],
		});

		expect(dockerfile).toContain('npx --yes turbo@');
		expect(dockerfile).toContain('npm start');
	});

	it('pins npm itself when the build root names a version', () => {
		expect(
			generateViteStaticDockerfile({
				...app,
				packageManager: 'npm',
				packageManagerVersion: '10.9.2',
			}),
		).toContain('RUN npm install -g npm@10.9.2');
	});
});

describe('the tools every image builds with', () => {
	it.each(
		every,
	)('pins pnpm and turbo to the build root’s (%s)', (_, generate) => {
		const dockerfile = generate({
			...backend,
			packageManagerVersion: '10.30.1',
			turboVersion: '2.5.4',
		});

		expect(dockerfile).toContain('corepack prepare pnpm@10.30.1 --activate');
		expect(dockerfile).toContain(
			'pnpm dlx turbo@2.5.4 prune @shop/api --docker',
		);
		expect(dockerfile).not.toContain('@latest');
		// Every turbo it runs is the pinned one.
		expect(dockerfile).not.toMatch(/dlx turbo /);
	});

	it('falls back to the latest pnpm, and the CLI’s turbo, when the root names neither', () => {
		const dockerfile = generateBackendDockerfile(backend);

		expect(dockerfile).toContain('corepack prepare pnpm@latest --activate');
		expect(dockerfile).toContain(`pnpm dlx turbo@${TURBO_VERSION} prune`);
	});

	it('pins yarn and bun the same way', () => {
		expect(
			generateBackendDockerfile({
				...backend,
				packageManager: 'yarn',
				packageManagerVersion: '4.5.0',
			}),
		).toContain('corepack prepare yarn@4.5.0 --activate');
		expect(
			generateBackendDockerfile({
				...backend,
				packageManager: 'bun',
				packageManagerVersion: '1.1.38',
			}),
		).toContain('npm install -g bun@1.1.38');
	});
});

describe('building from the build root', () => {
	it.each(
		every,
	)('builds the workspace packages the app depends on in the image (%s)', (_, generate) => {
		const dockerfile = generate(backend);

		// The root's own files turbo prune leaves out, beside the slice.
		expect(dockerfile).toContain(
			"RUN find . -maxdepth 1 -type f ! -name 'pnpm-lock.yaml' ! -name package.json",
		);
		// Built from source by turbo's ^build — never the root's own build
		// script, which (`gkm build`) would build apps the slice lacks.
		expect(dockerfile).not.toMatch(/run (--if-present )?build$/m);
		expect(dockerfile).toMatch(
			/^RUN .*turbo.* run build --filter='@shop\/api\^\.\.\.'/m,
		);
	});

	it('keeps a nested gkm workspace’s own package in a backend’s slice, and copies what it keeps outside one', () => {
		const dockerfile = generateBackendDockerfile({
			...backend,
			appPath: 'examples/shop/apps/api',
			prunePackages: ['@shop/workspace'],
			gkmRoot: 'examples/shop',
			gkmPaths: ['gkm.config.*', 'constructs'],
		});

		expect(dockerfile).toContain('prune @shop/api @shop/workspace --docker');
		expect(dockerfile).toContain(
			'RUN cd examples/shop && for path in gkm.config.* constructs; do',
		);
		expect(dockerfile).toContain(
			"--filter='@shop/api^...' --filter='@shop/workspace^...'",
		);
		// Every path inside the image is the build root's.
		expect(dockerfile).toContain('cd /app/examples/shop/apps/api && GKM_BIN=');
		expect(dockerfile).toContain(
			'COPY --from=builder --chown=hono:nodejs /app/examples/shop/apps/api/.gkm/server/dist/server.mjs ./',
		);
	});

	it('copies a single package whole: there is nothing to prune', () => {
		const dockerfile = generateBackendDockerfile({
			...backend,
			appPath: '.',
			monorepo: false,
		});

		expect(dockerfile).not.toMatch(/turbo@/);
		expect(dockerfile).toContain('cp -a . /tmp/out/full/');
		expect(dockerfile).toContain(
			'COPY --from=builder --chown=hono:nodejs /app/.gkm/server/dist/server.mjs ./',
		);
	});

	it('runs the CLI the app resolves, not a bin that was never linked', () => {
		// A CLI that is a workspace package has no bin in node_modules/.bin:
		// its files were not there when the slice was installed.
		const dockerfile = generateBackendDockerfile(backend);

		expect(dockerfile).toContain('node_modules/@geekmidas/cli/bin/gkm.mjs');
		expect(dockerfile).not.toMatch(/&& gkm build/);
	});
});

/** Every site template. */
const sites = [
	['Next.js', generateNextjsDockerfile],
	['a Node SSR site', generateNodeWebDockerfile],
	['a Vite site', generateViteStaticDockerfile],
] as const;

describe('a site that imports a generated client', () => {
	const site = {
		...backend,
		imageName: 'web',
		appPath: 'examples/shop/apps/web',
		turboPackage: '@shop/web',
		gkmRoot: 'examples/shop',
		gkmPaths: ['gkm.config.*', 'apps', 'constructs'],
		prunePackages: ['@shop/api', '@shop/workspace'],
		clients: [{ app: 'api', path: 'examples/shop/apps/api' }],
		publicUrlArgs: ['VITE_API_URL'],
	};

	it.each(
		sites,
	)('carries the gkm workspace, as a backend does (%s)', (_, generate) => {
		const dockerfile = generate(site);

		expect(dockerfile).toContain(
			'RUN cd examples/shop && for path in gkm.config.* apps constructs; do',
		);
		// The backends its client comes from, and the workspace's package —
		// which holds the CLI — in the slice and built.
		expect(dockerfile).toContain(
			'prune @shop/web @shop/api @shop/workspace --docker',
		);
		expect(dockerfile).toContain(
			"--filter='@shop/web^...' --filter='@shop/api^...' --filter='@shop/workspace^...'",
		);
	});

	it.each(
		sites,
	)('generates each client in the image, before the site is built (%s)', (_, generate) => {
		const dockerfile = generate(site);

		const generated = dockerfile.indexOf(
			'RUN cd /app/examples/shop/apps/api && gkm openapi --app api',
		);
		const built = dockerfile.indexOf(
			"run build --filter='@shop/web' --env-mode=loose",
		);
		const dependencies = dockerfile.indexOf("--filter='@shop/web^...'");
		expect(generated).toBeGreaterThan(-1);
		expect(built).toBeGreaterThan(generated);
		// After the workspace packages — the CLI among them — are built.
		expect(generated).toBeGreaterThan(dependencies);
	});

	it.each(
		sites,
	)('puts the CLI the workspace resolves on the PATH as gkm (%s)', (_, generate) => {
		const dockerfile = generate(site);

		// Resolved from the gkm root, never a bin a pruned install never linked.
		expect(dockerfile).toContain(
			'RUN cd /app/examples/shop && GKM_BIN="$(node -e',
		);
		expect(dockerfile).toContain('node_modules/@geekmidas/cli/bin/gkm.mjs');
		expect(dockerfile).toContain('> /usr/local/bin/gkm');
		// Before anything runs it.
		expect(dockerfile.indexOf('/usr/local/bin/gkm')).toBeLessThan(
			dockerfile.indexOf('gkm openapi'),
		);
	});

	it.each(
		sites,
	)('has gkm exec read the build args, never a secret (%s)', (_, generate) => {
		const dockerfile = generate(site);

		expect(dockerfile).toContain('ENV GKM_IMAGE_BUILD=1');
		expect(dockerfile).toContain('ARG VITE_API_URL=""');
		// The site's build sees the environment the Dockerfile set.
		expect(dockerfile).toContain('--env-mode=loose');
		expect(dockerfile).not.toContain('gkm_credentials');
	});

	it.each(
		sites,
	)('generates nothing for a site that calls no API (%s)', (_, generate) => {
		const dockerfile = generate({ ...site, clients: [] });

		expect(dockerfile).not.toContain('gkm openapi');
		expect(dockerfile).toContain('> /usr/local/bin/gkm');
	});

	it.each(
		sites,
	)('generates a client with trace propagation when the site’s telemetry asks (%s)', (_, generate) => {
		const dockerfile = generate({
			...site,
			clients: [
				{
					app: 'api',
					path: 'examples/shop/apps/api',
					telemetry: { sampleRate: 0.1 },
				},
				{ app: 'auth', path: 'examples/shop/apps/auth' },
			],
		});

		expect(dockerfile).toContain(
			'cd /app/examples/shop/apps/api && gkm openapi --app api --telemetry 0.1',
		);
		// Off for a client nothing turned it on for.
		expect(dockerfile).toMatch(/gkm openapi --app auth$/m);
	});

	it('runs from the build root when the gkm workspace is it', () => {
		const dockerfile = generateViteStaticDockerfile({
			...site,
			appPath: 'apps/web',
			gkmRoot: '.',
			clients: [{ app: 'api', path: 'apps/api' }],
		});

		expect(dockerfile).toContain('RUN cd /app && GKM_BIN=');
		expect(dockerfile).toContain(
			'RUN cd /app/apps/api && gkm openapi --app api',
		);
		expect(dockerfile).toContain('into .gkm/client/');
	});
});

describe('a backend’s externals', () => {
	it('leaves the runner a single file when the bundle has none', () => {
		const dockerfile = generateBackendDockerfile(backend);

		expect(dockerfile).not.toContain('AS externals');
		expect(dockerfile).not.toContain('node_modules ./node_modules');
		const runner = dockerfile.slice(dockerfile.indexOf('AS runner'));
		expect(runner.match(/^COPY .*$/gm)).toEqual([
			'COPY --from=builder --chown=hono:nodejs /app/apps/api/.gkm/server/dist/server.mjs ./',
		]);
	});

	it('installs exactly the externals, for Linux, at the versions the build resolved', () => {
		const dockerfile = generateBackendDockerfile({
			...backend,
			external: ['sharp', '@node-rs/argon2'],
		});

		expect(dockerfile).toContain('FROM builder AS externals-manifest');
		expect(dockerfile).toContain('const names = ["sharp","@node-rs/argon2"];');
		expect(dockerfile).toContain('FROM node:22-alpine AS externals');
		expect(dockerfile).toContain(
			'npm install --omit=dev --no-package-lock --no-audit --no-fund',
		);
		expect(dockerfile).toContain(
			'COPY --from=externals --chown=hono:nodejs /externals/node_modules ./node_modules',
		);
	});
});

describe('public URLs a frontend is built with', () => {
	it.each([
		['a Node web app', generateNodeWebDockerfile],
		['a static Vite site', generateViteStaticDockerfile],
	] as const)('become build args and env for %s', (_kind, generate) => {
		const dockerfile = generate({
			...app,
			packageManager: 'pnpm',
			publicUrlArgs: ['VITE_API_URL', 'VITE_AUTH_URL'],
		});

		expect(dockerfile).toContain('ARG VITE_API_URL=""');
		expect(dockerfile).toContain('ENV VITE_API_URL=$VITE_API_URL');
		expect(dockerfile).toContain('ARG VITE_AUTH_URL=""');
		expect(dockerfile).toContain('pnpm dlx turbo@');
	});
});

describe('a Vite site', () => {
	const dockerfile = generateViteStaticDockerfile({
		...app,
		port: 3002,
		packageManager: 'pnpm',
	});
	const caddyfile = dockerfile.slice(
		dockerfile.indexOf("COPY <<'EOF' /etc/caddy/Caddyfile"),
		dockerfile.indexOf('\nEOF\n'),
	);

	it('is served by Caddy, as a user that is not root, on the app’s port', () => {
		expect(dockerfile).toContain(`FROM ${STATIC_SITE_IMAGE} AS runner`);
		expect(STATIC_SITE_IMAGE).toMatch(/^caddy:2\.\d+-alpine$/);
		expect(dockerfile).not.toContain('nginx');
		expect(dockerfile).toContain('USER site');
		expect(caddyfile).toContain(':3002 {');
		expect(dockerfile).toContain('COPY --from=builder /app/apps/web/dist /srv');
	});

	it('writes its Caddyfile from a heredoc', () => {
		expect(dockerfile.startsWith('# syntax=docker/dockerfile:1\n')).toBe(true);
		expect(dockerfile).not.toContain('printf');
	});

	it('serves the files, with the SPA fallback and no admin endpoint', () => {
		for (const line of [
			'admin off',
			'auto_https off',
			'root * /srv',
			'encode zstd gzip',
			'try_files {path} /index.html',
			'file_server',
		]) {
			expect(caddyfile).toContain(line);
		}
	});

	it('caches hashed assets for good and revalidates everything else', () => {
		const assets = caddyfile.slice(caddyfile.indexOf('handle /assets/*'));
		expect(assets).toMatch(
			/^handle \/assets\/\* \{\n\t\theader Cache-Control "public, max-age=31536000, immutable"/,
		);
		const rest = caddyfile.slice(caddyfile.indexOf('\thandle {'));
		expect(rest).toContain('header Cache-Control "no-cache"');
		expect(rest).toContain('try_files {path} /index.html');
	});

	it('is healthy when its root answers', () => {
		expect(dockerfile).toContain(
			'CMD wget -qO- http://127.0.0.1:3002/ > /dev/null 2>&1 || exit 1',
		);
	});
});

describe('a Next.js site', () => {
	const dockerfile = generateNextjsDockerfile({
		...app,
		packageManager: 'pnpm',
		appPath: 'examples/shop/apps/admin',
	});

	it('fails the build, saying why, when the standalone server was not built', () => {
		expect(dockerfile).toContain(
			'if [ ! -d examples/shop/apps/admin/.next/standalone ]; then',
		);
		expect(dockerfile).toContain("set output: 'standalone' in next.config");
	});

	it('runs the standalone server where Next traced it from the build root', () => {
		expect(dockerfile).toContain(
			'COPY --from=builder --chown=nextjs:nodejs /app/examples/shop/apps/admin/.next/standalone ./',
		);
		expect(dockerfile).toContain(
			'CMD ["node", "examples/shop/apps/admin/server.js"]',
		);
	});
});
