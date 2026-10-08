import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import type { CacheBackend, DockerConfig, GkmConfig } from '../types';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

/**
 * The turbo every image prunes and builds with when the build root resolves
 * none of its own: a repository without turbo still needs `turbo prune` to
 * cut its slice of the workspace, and an unpinned `turbo` is whatever the
 * registry says on the day of the build.
 */
export const TURBO_VERSION = '2.5.4';

/**
 * Caddy, which serves a static site's files. A 2.x tag, so a rebuild picks
 * up patch releases and never a major.
 */
export const STATIC_SITE_IMAGE = 'caddy:2.10-alpine';

/**
 * How an image is built: every template prunes the build root to the app's
 * slice, installs it, builds it and copies the result into a runner.
 *
 * Every path is relative to the build root — the directory that holds the
 * lockfile, which is the gkm workspace's root in a project of its own and the
 * monorepo's root when the workspace is nested inside one.
 */
export interface ImageTemplateOptions {
	/** The image the Dockerfile builds; informational. */
	imageName?: string;
	baseImage: string;
	port: number;
	/** The app's directory, relative to the build root. */
	appPath: string;
	/** The app's package, which turbo prunes to. */
	turboPackage: string;
	/** Detected package manager */
	packageManager: PackageManager;
	/**
	 * The exact version the build root's `packageManager` field names. Absent,
	 * the image installs the package manager's latest.
	 */
	packageManagerVersion?: string;
	/** The turbo the build root resolves; `TURBO_VERSION` otherwise. */
	turboVersion?: string;
	/**
	 * Whether the build root is a workspace of packages, which turbo prunes. A
	 * single package is copied whole. Defaults to true.
	 */
	monorepo?: boolean;
	/**
	 * Other packages the slice keeps: a gkm workspace nested in a monorepo is a
	 * package of its own, holding the config and constructs the app is built
	 * from.
	 */
	prunePackages?: string[];
	/** The gkm workspace's root, relative to the build root. Defaults to `.` */
	gkmRoot?: string;
	/**
	 * What under the gkm root the build reads besides the app — its config and
	 * the directories its construct globs start in. `turbo prune` keeps
	 * packages; these are copied beside them.
	 */
	gkmPaths?: string[];
}

export interface FrontendDockerfileOptions extends ImageTemplateOptions {
	/**
	 * Public URL build args to include in the Dockerfile.
	 * These will be declared as ARG and converted to ENV for the build.
	 * Example: ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_AUTH_URL']
	 */
	publicUrlArgs?: string[];
}

const LOCKFILES: [string, PackageManager][] = [
	['pnpm-lock.yaml', 'pnpm'],
	['bun.lockb', 'bun'],
	['yarn.lock', 'yarn'],
	['package-lock.json', 'npm'],
];

/**
 * Detect package manager from lockfiles
 * Walks up the directory tree to find lockfile (for monorepos)
 */
export function detectPackageManager(
	cwd: string = process.cwd(),
): PackageManager {
	const lockfile = findLockfilePath(cwd);
	if (!lockfile) return 'pnpm';
	const name = lockfile.slice(dirname(lockfile).length + 1);
	return LOCKFILES.find(([file]) => file === name)?.[1] ?? 'pnpm';
}

/**
 * Find the lockfile path by walking up the directory tree
 * Returns the full path to the lockfile, or null if not found
 */
export function findLockfilePath(cwd: string = process.cwd()): string | null {
	for (const dir of upFrom(cwd)) {
		for (const [lockfile] of LOCKFILES) {
			const lockfilePath = join(dir, lockfile);
			if (existsSync(lockfilePath)) {
				return lockfilePath;
			}
		}
	}
	return null;
}

/**
 * The directory every image is built from: the nearest at or above `cwd`
 * holding a lockfile or a `pnpm-workspace.yaml` — the package manager's root,
 * which is what an install resolves the workspace's dependencies against.
 *
 * In a project of its own that is the gkm workspace's root. A gkm workspace
 * nested inside a monorepo, whose dependencies are the monorepo's
 * `workspace:*` packages, is built from the monorepo's root. `cwd` itself
 * when neither is found.
 */
export function findBuildRoot(cwd: string = process.cwd()): string {
	for (const dir of upFrom(cwd)) {
		if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
		for (const [lockfile] of LOCKFILES) {
			if (existsSync(join(dir, lockfile))) return dir;
		}
	}
	return cwd;
}

/** `cwd` and every directory above it, the filesystem root last. */
function upFrom(cwd: string): string[] {
	const dirs: string[] = [];
	const root = parse(cwd).root;
	let dir = cwd;
	while (dir !== root) {
		dirs.push(dir);
		dir = dirname(dir);
	}
	dirs.push(root);
	return dirs;
}

/** What a build root builds its images with. */
export interface BuildTools {
	packageManager: PackageManager;
	/** From `packageManager` in the build root's package.json, if set. */
	packageManagerVersion?: string;
	/** The turbo the build root resolves, or `TURBO_VERSION`. */
	turboVersion: string;
	/** Whether the build root is a workspace of packages. */
	monorepo: boolean;
}

/** The package manager, its version, turbo's and the shape of a build root. */
export function resolveBuildTools(buildRoot: string): BuildTools {
	const pkg = readJson(join(buildRoot, 'package.json'));
	const packageManager = detectPackageManager(buildRoot);
	const field =
		typeof pkg?.packageManager === 'string' ? pkg.packageManager : '';
	// `pnpm@10.30.1+sha512.…` — the hash is corepack's, the version is ours.
	const match = /^([a-z]+)@(\d[^+\s]*)/.exec(field);
	const packageManagerVersion =
		match && match[1] === packageManager ? match[2] : undefined;

	return {
		packageManager,
		...(packageManagerVersion ? { packageManagerVersion } : {}),
		turboVersion: resolveTurboVersion(buildRoot) ?? TURBO_VERSION,
		monorepo:
			existsSync(join(buildRoot, 'pnpm-workspace.yaml')) ||
			pkg?.workspaces !== undefined,
	};
}

/**
 * The turbo version a build root resolves: what is installed, or what its
 * lockfile pins. Undefined when it has none.
 */
export function resolveTurboVersion(buildRoot: string): string | undefined {
	const installed = readJson(
		join(buildRoot, 'node_modules', 'turbo', 'package.json'),
	);
	if (typeof installed?.version === 'string') return installed.version;

	const read = (file: string) => {
		try {
			return readFileSync(join(buildRoot, file), 'utf-8');
		} catch {
			return undefined;
		}
	};

	const pnpm = read('pnpm-lock.yaml');
	const fromPnpm = pnpm && /^ {2}'?turbo@(\d[^:'(\s]*)'?:/m.exec(pnpm);
	if (fromPnpm) return fromPnpm[1];

	const npm = read('package-lock.json');
	if (npm) {
		const lock = safeParse(npm) as {
			packages?: Record<string, { version?: string }>;
		};
		const version = lock?.packages?.['node_modules/turbo']?.version;
		if (version) return version;
	}

	const yarn = read('yarn.lock');
	const fromYarn =
		yarn && /^"?turbo@[^\n]*:\n\s+version:? "?(\d[^"\s]*)"?/m.exec(yarn);
	if (fromYarn) return fromYarn[1];

	return undefined;
}

function readJson(path: string): Record<string, unknown> | undefined {
	try {
		return safeParse(readFileSync(path, 'utf-8'));
	} catch {
		return undefined;
	}
}

function safeParse(text: string): Record<string, unknown> | undefined {
	try {
		const value = JSON.parse(text);
		return value && typeof value === 'object' ? value : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Get the lockfile name for a package manager
 */
export function getLockfileName(pm: PackageManager): string {
	const lockfileMap: Record<PackageManager, string> = {
		pnpm: 'pnpm-lock.yaml',
		npm: 'package-lock.json',
		yarn: 'yarn.lock',
		bun: 'bun.lockb',
	};
	return lockfileMap[pm];
}

/**
 * Check if we're in a monorepo (lockfile is in a parent directory)
 */
export function isMonorepo(cwd: string = process.cwd()): boolean {
	const lockfilePath = findLockfilePath(cwd);
	if (!lockfilePath) {
		return false;
	}

	// Check if lockfile is in a parent directory (not in cwd)
	const lockfileDir = dirname(lockfilePath);
	return lockfileDir !== cwd;
}

/**
 * Check if turbo.json exists (walks up directory tree)
 */
export function hasTurboConfig(cwd: string = process.cwd()): boolean {
	return upFrom(cwd).some((dir) => existsSync(join(dir, 'turbo.json')));
}

/**
 * Package manager specific commands. `version` pins what corepack (or npm,
 * for bun) installs; without it, the latest.
 */
function getPmConfig(pm: PackageManager, version?: string) {
	const configs = {
		pnpm: {
			install: `corepack enable && corepack prepare pnpm@${version ?? 'latest'} --activate`,
			lockfile: 'pnpm-lock.yaml',
			// turbo prune writes a lockfile for the slice, not the repository's,
			// so the install cannot be frozen to it.
			installCmd: 'pnpm install',
			cacheTarget: '/root/.local/share/pnpm/store',
			cacheId: 'pnpm',
			run: 'pnpm run',
			dlx: 'pnpm dlx',
		},
		npm: {
			install: version ? `npm install -g npm@${version}` : '',
			lockfile: 'package-lock.json',
			installCmd: 'npm install',
			cacheTarget: '/root/.npm',
			cacheId: 'npm',
			run: 'npm run',
			dlx: 'npx --yes',
		},
		yarn: {
			install: `corepack enable && corepack prepare yarn@${version ?? 'stable'} --activate`,
			lockfile: 'yarn.lock',
			installCmd: 'yarn install',
			cacheTarget: '/root/.yarn/cache',
			cacheId: 'yarn',
			run: 'yarn run',
			dlx: 'yarn dlx',
		},
		bun: {
			install: `npm install -g bun@${version ?? 'latest'}`,
			lockfile: 'bun.lockb',
			installCmd: 'bun install',
			cacheTarget: '/root/.bun/install/cache',
			cacheId: 'bun',
			run: 'bun run',
			dlx: 'bunx',
		},
	};
	return configs[pm];
}

/** What every template's first three stages need, resolved from options. */
function layout(options: ImageTemplateOptions) {
	const pm = getPmConfig(options.packageManager, options.packageManagerVersion);
	const turbo = `${pm.dlx} turbo@${options.turboVersion ?? TURBO_VERSION}`;
	const gkmRoot = options.gkmRoot ?? '.';
	return {
		pm,
		turbo,
		installPm: pm.install ? `RUN ${pm.install}` : '',
		monorepo: options.monorepo ?? true,
		gkmRoot,
		/** The app, absolute inside the image. */
		app: `/app/${options.appPath}`.replace(/\/\.$/, ''),
	};
}

/**
 * The pruner stage: the build context cut to the app's slice, in turbo's
 * `out/` layout — `out/json` for the install, `out/full` for the build.
 *
 * `turbo prune` keeps the packages the app depends on and nothing else at
 * the root, so the root's own files (a `tsconfig.base.json` the packages
 * extend, the config their build reads) and what the gkm workspace keeps
 * outside any package are copied in beside them. A single package is copied
 * whole.
 */
function prunerStage(options: ImageTemplateOptions): string {
	const { pm, turbo, installPm, monorepo, gkmRoot } = layout(options);
	const scopes = [options.turboPackage, ...(options.prunePackages ?? [])].join(
		' ',
	);

	if (!monorepo) {
		return `# Stage 1: The build context, in the layout the stages below read
FROM ${options.baseImage} AS pruner
WORKDIR /app
COPY . .
RUN mkdir -p /tmp/out/json /tmp/out/full && \\
    cp package.json /tmp/out/json/ && \\
    cp ${pm.lockfile} /tmp/out/ && \\
    cp -a . /tmp/out/full/ && \\
    mv /tmp/out ./out`;
	}

	const gkmPaths = options.gkmPaths ?? [];
	const nested = gkmRoot !== '.';
	const dest = nested ? `/app/out/full/${gkmRoot}` : '/app/out/full';
	const copyGkm = gkmPaths.length
		? `

# What the gkm workspace keeps outside any package — its config, the
# directories its constructs are declared in — beside the slice.
RUN ${nested ? `cd ${gkmRoot} && ` : ''}for path in ${gkmPaths.join(' ')}; do \\
      if [ -e "$path" ]; then \\
        mkdir -p "${dest}" && cp -rn "$path" "${dest}/"; \\
      fi; \\
    done`
		: '';

	return `# Stage 1: Prune the monorepo to the app's slice
FROM ${options.baseImage} AS pruner
WORKDIR /app
${installPm}
COPY . .
RUN ${turbo} prune ${scopes} --docker

# The root's own files — the tsconfig the packages extend, the config their
# build reads — which turbo prune leaves out. What the install itself reads
# (registry config, local tarballs) goes beside the manifests too.
RUN find . -maxdepth 1 -type f ! -name '${pm.lockfile}' ! -name package.json \\
      -exec cp -n {} out/full/ \\; && \\
    for file in .npmrc .yarnrc.yml .pnpmfile.cjs bunfig.toml *.tgz; do \\
      if [ -f "$file" ]; then cp "$file" out/json/; fi; \\
    done${copyGkm}`;
}

/** The deps stage: the slice's dependencies, installed from its lockfile. */
function depsStage(options: ImageTemplateOptions): string {
	const { pm, installPm } = layout(options);
	return `# Stage 2: Install dependencies
FROM ${options.baseImage} AS deps
WORKDIR /app
${installPm}
COPY --from=pruner /app/out/${pm.lockfile} ./
COPY --from=pruner /app/out/json/ ./
RUN --mount=type=cache,id=${pm.cacheId},target=${pm.cacheTarget} \\
    ${pm.installCmd}`;
}

/**
 * The start of the builder stage: the slice's source over its dependencies,
 * and every workspace package the app depends on built from it.
 *
 * Nothing built on the host reaches the image — `.dockerignore` keeps every
 * `dist` out — so a workspace package (a CLI that is a sibling package) is
 * built here: the root's `build` script if it has one, then turbo's build of
 * the app's dependencies (`^build`).
 */
function builderStage(
	options: ImageTemplateOptions,
	extra: { args?: string[] } = {},
): string {
	const { pm, turbo, monorepo } = layout(options);
	const args = extra.args ?? [];
	const argLines = args.length
		? `\n# Build-time args: public values the bundler inlines\n${args.map((a) => `ARG ${a}=""`).join('\n')}\n${args.map((a) => `ENV ${a}=$${a}`).join('\n')}\n`
		: '';
	const scopes = [options.turboPackage, ...(options.prunePackages ?? [])];
	const dependencies = monorepo
		? `\nRUN ${turbo} run build ${scopes.map((s) => `--filter='${s}^...'`).join(' ')}`
		: '';

	return `# Stage 3: Build
FROM deps AS builder
WORKDIR /app
${argLines}
COPY --from=pruner /app/out/full/ ./

# The workspace packages the app depends on, built from source.
RUN ${pm.run} --if-present build${dependencies}`;
}

/**
 * The PATH a command in the app's directory runs with: the app's binaries,
 * then the gkm workspace's, then the root's — a nested workspace's apps
 * declare nothing, and its CLI is installed where its config is.
 */
function binPath(options: ImageTemplateOptions): string {
	const { app, gkmRoot } = layout(options);
	const dirs = [
		`${app}/node_modules/.bin`,
		gkmRoot === '.' ? '' : `/app/${gkmRoot}/node_modules/.bin`,
		'/app/node_modules/.bin',
	].filter(Boolean);
	return `PATH="${[...new Set(dirs)].join(':')}:$PATH"`;
}

/**
 * Run the gkm CLI the app resolves, from the app's directory: node on its
 * `bin/gkm.mjs`, found the way Node resolves a package — up from the app.
 *
 * Not through `node_modules/.bin`: a CLI that is a workspace package has no
 * bin linked, since its files were not there when the slice's dependencies
 * were installed.
 */
function gkmCommand(args: string): string {
	const find = `let d=process.cwd();const{existsSync:e}=require("fs"),{dirname:u,join:j}=require("path");for(;;){const p=j(d,"node_modules/@geekmidas/cli/bin/gkm.mjs");if(e(p)){console.log(p);break}if(u(d)===d){console.error("@geekmidas/cli is not installed where the app can resolve it");process.exit(1)}d=u(d)}`;
	return `GKM_BIN="$(node -e '${find}')" && node "$GKM_BIN" ${args}`;
}

/**
 * The encrypted credentials, from a build secret — never an ARG, which is
 * recorded in the image history — written where the build embeds them from.
 * Two lines, ciphertext then IV; absent when the app has no secrets.
 *
 * A BuildKit secret is not part of the cache key, so `GKM_CIPHERTEXT_HASH`
 * (a hash of the ciphertext, not a secret) is: credentials encrypted under a
 * new key rebuild the layer that embeds them.
 */
function credentialsStep(appDir: string, then: string): string {
	return `ARG GKM_CIPHERTEXT_HASH=""
RUN --mount=type=secret,id=gkm_credentials,required=false \\
    echo "credentials: \${GKM_CIPHERTEXT_HASH:-none}" && \\
    if [ -s /run/secrets/gkm_credentials ]; then \\
      mkdir -p ${appDir}/.gkm && \\
      sed -n 1p /run/secrets/gkm_credentials > ${appDir}/.gkm/credentials.enc && \\
      sed -n 2p /run/secrets/gkm_credentials > ${appDir}/.gkm/credentials.iv; \\
    fi && \\
    ${then} && \\
    rm -f ${appDir}/.gkm/credentials.enc ${appDir}/.gkm/credentials.iv`;
}

/**
 * The externals a backend's bundle leaves out (esbuild `--external`), each
 * installed for Linux at the version the builder resolved, so the runner has
 * exactly those beside `server.mjs`. Nothing when there are none: the runner
 * is the one file.
 */
function externalsStages(
	options: ImageTemplateOptions & { external?: string[] },
	appDir: string,
): { stage: string; copy: string } {
	const external = options.external ?? [];
	if (external.length === 0) return { stage: '', copy: '' };

	return {
		stage: `
# Stage 4: The packages the bundle leaves external, installed for Linux at the
# versions the build resolved — and nothing else.
FROM builder AS externals-manifest
WORKDIR ${appDir}
RUN node <<'EOF'
const { existsSync, readFileSync, writeFileSync } = require('node:fs');
const { dirname, join } = require('node:path');
const names = ${JSON.stringify(external)};
const dependencies = {};
for (const name of names) {
  let dir = process.cwd();
  for (;;) {
    const manifest = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(manifest)) {
      dependencies[name] = JSON.parse(readFileSync(manifest, 'utf-8')).version;
      break;
    }
    if (dirname(dir) === dir) {
      console.error(name + ' is external to the bundle, and is not installed: add it to the app\\'s dependencies.');
      process.exit(1);
    }
    dir = dirname(dir);
  }
}
writeFileSync('/tmp/externals.json', JSON.stringify({ private: true, dependencies }));
EOF

FROM ${options.baseImage} AS externals
WORKDIR /externals
COPY --from=externals-manifest /tmp/externals.json ./package.json
RUN --mount=type=cache,id=npm,target=/root/.npm \\
    npm install --omit=dev --no-package-lock --no-audit --no-fund
`,
		copy: '\nCOPY --from=externals --chown=hono:nodejs /externals/node_modules ./node_modules',
	};
}

/**
 * Generate .dockerignore file
 *
 * Written at the build root. Nothing built on the host may reach an image —
 * every image builds its packages from source — and nothing secret may reach
 * a build context.
 */
export function generateDockerignore(): string {
	return `# Dependencies: installed in the image, for Linux
**/node_modules
.pnpm-store

# Build output: every image builds from source, never from the host's
**/dist
**/.next
**/.turbo
**/.gkm

# The key gkm build --stage encrypted secrets with: runtime env only, never
# the build context
**/master.key

# gkm compose's stacks: each app's env file holds its stage's secrets
**/.gkm/compose

# IDE and editor
.idea
.vscode
*.swp
*.swo

# Git
.git

# Logs
*.log
npm-debug.log*
pnpm-debug.log*

# Test files
coverage

# Environment files (handle secrets separately)
**/.env
**/.env.*
!**/.env.example

# Docker files (don't copy recursively)
Dockerfile*
docker-compose*
.dockerignore
`;
}

/**
 * Generate docker-entrypoint.sh for custom startup logic
 */
export function generateDockerEntrypoint(): string {
	return `#!/bin/sh
set -e

# Run any custom startup scripts here
# Example: wait for database
# until nc -z $DB_HOST $DB_PORT; do
#   echo "Waiting for database..."
#   sleep 1
# done

# Execute the main command
exec "$@"
`;
}

/**
 * Resolve Docker configuration from GkmConfig with defaults
 */
export function resolveDockerConfig(config: GkmConfig): Required<DockerConfig> {
	const docker = config.docker ?? {};

	return {
		registry: docker.registry ?? '',
		// The project's name, from the config — what somebody types after
		// `docker pull` — never whatever the directory's package.json is called.
		imageName: docker.imageName ?? config.name ?? 'api',
		baseImage: docker.baseImage ?? 'node:22-alpine',
		port: docker.port ?? 3000,
	};
}

/** A site's root answers its health check. */
function siteHealthcheck(port: number): string {
	return `# A site answers at its root; Docker, and Dokploy, read the container's
# health from it rather than from the process merely running. 127.0.0.1, not
# localhost: the server listens on IPv4, and localhost can resolve to ::1.
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \\
  CMD wget -qO- http://127.0.0.1:${port}/ > /dev/null 2>&1 || exit 1`;
}

/**
 * Generate a Dockerfile for Next.js frontend apps using standalone output.
 *
 * Pruned at the build root, Next traces from there, so the standalone
 * server lands at `<appPath>/server.js` under `.next/standalone`.
 * @internal Exported for testing
 */
export function generateNextjsDockerfile(
	options: FrontendDockerfileOptions,
): string {
	const {
		port,
		appPath,
		turboPackage,
		publicUrlArgs = ['NEXT_PUBLIC_API_URL', 'NEXT_PUBLIC_AUTH_URL'],
	} = options;
	const { turbo } = layout(options);

	return `# syntax=docker/dockerfile:1
# Next.js standalone Dockerfile, built from a turbo-pruned slice

${prunerStage(options)}

${depsStage(options)}

${builderStage(options, { args: publicUrlArgs })}

# Ensure public directory exists (may be empty for scaffolded projects)
RUN mkdir -p ${appPath}/public

ENV NEXT_TELEMETRY_DISABLED=1

# Build the application
RUN ${turbo} run build --filter='${turboPackage}'

# The runner needs the standalone server; without it there is nothing to run.
RUN if [ ! -d ${appPath}/.next/standalone ]; then \\
      echo "${appPath}/.next/standalone was not built: set output: 'standalone' in next.config so the image can run the app without node_modules." >&2; \\
      exit 1; \\
    fi

# Stage 4: Production
FROM ${options.baseImage} AS runner

WORKDIR /app

# Install tini for proper signal handling
RUN apk add --no-cache tini

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 nextjs

# Set environment
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=${port}
ENV HOSTNAME="0.0.0.0"

# The standalone server, with its static files and public directory beside it
COPY --from=builder --chown=nextjs:nodejs /app/${appPath}/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/${appPath}/.next/static ./${appPath}/.next/static
COPY --from=builder --chown=nextjs:nodejs /app/${appPath}/public ./${appPath}/public

USER nextjs

EXPOSE ${port}

${siteHealthcheck(port)}

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "${appPath}/server.js"]
`;
}

/**
 * Generate a Dockerfile for a gkm backend: pruned, installed, and bundled by
 * `gkm build --provider server --production` inside the image. The runner is
 * `server.mjs` alone — plus any package the bundle leaves external.
 * @internal Exported for testing
 */
export function generateBackendDockerfile(
	options: ImageTemplateOptions & {
		healthCheckPath?: string;
		/** Packages the bundle leaves external (esbuild `--external`). */
		external?: string[];
		/** The cache backend the entry registers, where not the target's. */
		cache?: CacheBackend;
	},
): string {
	return gkmBundleDockerfile(options, {
		title: 'Backend Dockerfile',
		bundle: 'server.mjs',
		as: 'server.mjs',
		expose: true,
	});
}

/** The port a worker answers its health check on, inside its container. */
export const WORKER_PORT = 3000;

/**
 * A Worker's image: the same build as its host app's backend — a pruned
 * slice, `gkm build --provider server --production` in the image, with the
 * encrypted credentials from the `gkm_credentials` secret — and a runner that
 * is the worker's bundle alone. It publishes nothing: its one route is the
 * health check the HEALTHCHECK asks.
 * @internal Exported for testing
 */
export function generateWorkerDockerfile(
	options: ImageTemplateOptions & {
		/** The worker's construct id, for the comment. */
		worker: string;
		/** Its bundle under the host app's `.gkm/server/dist`. */
		bundle: string;
		healthCheckPath?: string;
		external?: string[];
		/** The cache backend the entry registers, where not the target's. */
		cache?: CacheBackend;
	},
): string {
	return gkmBundleDockerfile(options, {
		title: `Worker Dockerfile (${options.worker})`,
		bundle: options.bundle,
		as: 'worker.mjs',
		expose: false,
	});
}

function gkmBundleDockerfile(
	options: ImageTemplateOptions & {
		healthCheckPath?: string;
		external?: string[];
		cache?: CacheBackend;
	},
	runner: { title: string; bundle: string; as: string; expose: boolean },
): string {
	const { port, healthCheckPath = '/health' } = options;
	const { app } = layout(options);
	const externals = externalsStages(options, app);

	return `# syntax=docker/dockerfile:1
# ${runner.title}: a turbo-pruned slice, bundled by gkm build in the image

${prunerStage(options)}

${depsStage(options)}

${builderStage(options)}

# Bundle the production server, with the encrypted credentials embedded
${credentialsStep(app, `cd ${app} && ${gkmCommand(`build --provider server --production${options.cache ? ` --cache ${options.cache}` : ''}`)}`)}
${externals.stage}
# Production
FROM ${options.baseImage} AS runner

WORKDIR /app

RUN apk add --no-cache tini

RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 hono

# The bundled ${runner.as === 'server.mjs' ? 'server' : 'worker'}
COPY --from=builder --chown=hono:nodejs ${app}/.gkm/server/dist/${runner.bundle} ./${runner.as === runner.bundle ? '' : runner.as}${externals.copy}

ENV NODE_ENV=production
ENV PORT=${port}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \\
  CMD wget -qO- http://localhost:${port}${healthCheckPath} > /dev/null 2>&1 || exit 1

USER hono
${runner.expose ? `\nEXPOSE ${port}\n` : ''}
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "${runner.as}"]
`;
}

/**
 * Options for entry-based Dockerfile generation.
 */
export interface EntryDockerfileOptions extends ImageTemplateOptions {
	/** Entry file path relative to app path (e.g., './src/index.ts') */
	entry: string;
	/** Health check path (default: '/health') */
	healthCheckPath?: string;
}

/**
 * Generate a Dockerfile for apps with a custom entry point.
 * Uses esbuild to bundle the entry point into dist/index.mjs with all dependencies.
 * This is used for apps that don't use gkm routes (e.g., Better Auth servers).
 * @internal Exported for testing
 */
export function generateEntryDockerfile(
	options: EntryDockerfileOptions,
): string {
	const { port, entry, healthCheckPath = '/health' } = options;
	const { app } = layout(options);

	const esbuild = (defines: string) =>
		`esbuild ${entry} --bundle --platform=node --target=node22 --format=esm \\
        --outfile=dist/index.mjs --packages=bundle \\
        --banner:js='import { createRequire } from "module"; const require = createRequire(import.meta.url);'${defines}`;

	return `# syntax=docker/dockerfile:1
# Entry-based Dockerfile: a turbo-pruned slice, bundled by esbuild in the image

${prunerStage(options)}

${depsStage(options)}

${builderStage(options)}

# Bundle the entry point with every dependency (dist/index.mjs), embedding the
# encrypted credentials when there are any.
ARG GKM_CIPHERTEXT_HASH=""
RUN --mount=type=secret,id=gkm_credentials,required=false \\
    echo "credentials: \${GKM_CIPHERTEXT_HASH:-none}" && \\
    cd ${app} && export ${binPath(options)} && \\
    if [ -s /run/secrets/gkm_credentials ]; then \\
      CREDS=$(sed -n 1p /run/secrets/gkm_credentials) && \\
      IV=$(sed -n 2p /run/secrets/gkm_credentials) && \\
      ${esbuild(` \\
        --define:__GKM_ENCRYPTED_CREDENTIALS__="\\"$CREDS\\"" \\
        --define:__GKM_CREDENTIALS_IV__="\\"$IV\\""`)}; \\
    else \\
      ${esbuild('')}; \\
    fi

# Production
FROM ${options.baseImage} AS runner

WORKDIR /app

RUN apk add --no-cache tini

RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 app

# Copy bundled output only (no node_modules needed - fully bundled)
COPY --from=builder --chown=app:nodejs ${app}/dist/index.mjs ./

ENV NODE_ENV=production
ENV PORT=${port}

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \\
  CMD wget -qO- http://localhost:${port}${healthCheckPath} > /dev/null 2>&1 || exit 1

USER app

EXPOSE ${port}

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "index.mjs"]
`;
}

/**
 * Generate a Dockerfile for Node-based SSR web frameworks (TanStack Start,
 * Remix). Builds with turbo, then runs the framework's production start
 * script.
 *
 * Public URL build args are declared so framework bundlers (Vite, Vinxi)
 * can inline them at build time. Per-framework prefix is the caller's job.
 * @internal Exported for testing
 */
export function generateNodeWebDockerfile(
	options: FrontendDockerfileOptions,
): string {
	const { port, appPath, turboPackage } = options;
	const { turbo } = layout(options);

	return `# syntax=docker/dockerfile:1
# Node SSR web Dockerfile (TanStack Start / Remix), from a turbo-pruned slice

${prunerStage(options)}

${depsStage(options)}

${builderStage(options, { args: options.publicUrlArgs ?? [] })}
RUN ${turbo} run build --filter='${turboPackage}'

FROM ${options.baseImage} AS runner
WORKDIR /app
RUN apk add --no-cache tini
RUN addgroup --system --gid 1001 nodejs && \\
    adduser --system --uid 1001 app

# Copy the whole built workspace — frameworks differ on output paths
COPY --from=builder --chown=app:nodejs /app/ ./

ENV NODE_ENV=production
ENV PORT=${port}
ENV HOSTNAME="0.0.0.0"

USER app
EXPOSE ${port}

${siteHealthcheck(port)}

ENTRYPOINT ["/sbin/tini", "--"]
# npm ships with node, and runs the start script whichever package manager
# installed it: the runner needs no other.
CMD ["sh", "-c", "cd ${appPath} && npm start"]
`;
}

/**
 * Generate a Dockerfile for Vite SPA apps. Builds the static bundle with
 * turbo, then serves it with Caddy: Vite's hashed `/assets/*` cached for a
 * year, everything else — `index.html`, and every deep link that falls back
 * to it — revalidated on each request.
 * @internal Exported for testing
 */
export function generateViteStaticDockerfile(
	options: FrontendDockerfileOptions,
): string {
	const { port, appPath, turboPackage } = options;
	const { turbo } = layout(options);

	return `# syntax=docker/dockerfile:1
# Vite SPA Dockerfile — a turbo-pruned slice built to static files, served by Caddy

${prunerStage(options)}

${depsStage(options)}

${builderStage(options, { args: options.publicUrlArgs ?? [] })}
RUN ${turbo} run build --filter='${turboPackage}'

FROM ${STATIC_SITE_IMAGE} AS runner

COPY <<'EOF' /etc/caddy/Caddyfile
{
	admin off
	auto_https off
	persist_config off
}

:${port} {
	root * /srv
	encode zstd gzip

	# Vite names every built asset by its content hash: a changed file is a
	# new URL, so the old one can be cached for good.
	handle /assets/* {
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}

	# index.html, and every client-side route that falls back to it, is
	# asked for again each time so a deploy is seen at once.
	handle {
		header Cache-Control "no-cache"
		try_files {path} /index.html
		file_server
	}
}
EOF

COPY --from=builder /app/${appPath}/dist /srv

RUN addgroup -S -g 1001 site && adduser -S -u 1001 -G site site && \\
    chown -R site:site /data /config

USER site

EXPOSE ${port}

${siteHealthcheck(port)}

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
`;
}
