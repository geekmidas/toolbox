import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

/**
 * A package left out of a bundle, at the version the build resolved — what
 * an image installs beside the bundle, for its own platform.
 */
export type ExternalPackages = Record<string, string>;

/**
 * The file beside a bundle naming the packages it left out, each at the
 * version the build resolved: a `package.json` an image installs, for its own
 * platform, next to the bundle. `server.mjs` → `server.externals.json`.
 */
export function externalsManifestName(outfile: string): string {
	return `${outfile.replace(/\.mjs$/, '')}.externals.json`;
}

/**
 * Asked to leave a package out of the bundle, and nothing the app depends on
 * provides it: there is no version to install in the image.
 */
export class ExternalNotInstalled extends Error {
	constructor(
		readonly packageName: string,
		readonly root: string,
	) {
		super(
			`'${packageName}' is left out of the bundle, to be installed beside it, but it is not installed for the app at ${root}: add it to the app's dependencies.`,
		);
		this.name = 'ExternalNotInstalled';
	}
}

interface PackageJson {
	name?: string;
	version?: string;
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
	gypfile?: boolean;
	binary?: unknown;
	napi?: unknown;
	os?: string[];
}

/** Packages whose job is loading a compiled addon. */
const NATIVE_LOADERS = new Set([
	'bindings',
	'node-gyp-build',
	'node-gyp-build-optional-packages',
	'node-pre-gyp',
	'@mapbox/node-pre-gyp',
	'prebuild-install',
	'@neon-rs/load',
]);

/** A per-platform binary package: `@node-rs/argon2-linux-x64-gnu`, `@img/sharp-darwin-arm64`. */
const PLATFORM_PACKAGE =
	/(?:^|[-/])(?:linux|darwin|win32|freebsd|android)-(?:x64|arm64|arm|ia32)\b/;

function readPackage(dir: string): PackageJson | undefined {
	try {
		return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
	} catch {
		return undefined;
	}
}

/**
 * Where `name` resolves from `from`, the way Node finds it: the nearest
 * `node_modules/<name>` walking up. Followed through symlinks, so a pnpm
 * store package resolves its own dependencies beside it.
 */
function locate(name: string, from: string): string | undefined {
	let dir = from;
	for (;;) {
		const candidate = join(dir, 'node_modules', name);
		if (existsSync(join(candidate, 'package.json'))) {
			return realpathSync(candidate);
		}
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

/**
 * Whether a package carries compiled code: a `binding.gyp` or prebuilt
 * binaries of its own, a loader for them, or a binary package per platform.
 * Such a package cannot be inlined into a bundle — it loads a `.node` file
 * from beside its own source, for the platform it was installed on.
 */
export function isNativePackage(dir: string, pkg: PackageJson): boolean {
	if (pkg.gypfile || pkg.binary || pkg.napi) return true;
	const deps = Object.keys({
		...pkg.dependencies,
		...pkg.optionalDependencies,
	});
	if (deps.some((dep) => NATIVE_LOADERS.has(dep))) return true;
	if (
		Object.keys(pkg.optionalDependencies ?? {}).some((dep) =>
			PLATFORM_PACKAGE.test(dep),
		)
	) {
		return true;
	}
	if (existsSync(join(dir, 'binding.gyp'))) return true;
	if (existsSync(join(dir, 'prebuilds'))) return true;
	try {
		return readdirSync(dir).some((file) => file.endsWith('.node'));
	} catch {
		return false;
	}
}

/**
 * The packages with native code an app's bundle would otherwise inline, each
 * at the version installed for it.
 *
 * Walks what the app depends on at runtime — `dependencies`, never
 * `devDependencies` — through workspace packages and installed ones alike,
 * since anything reached is bundled. A native package is where the walk
 * stops: installing it brings what it depends on.
 */
export function nativeDependencies(root: string): ExternalPackages {
	const found: ExternalPackages = {};
	const seen = new Set<string>();
	const queue = [realpathSync(root)];

	while (queue.length > 0) {
		const dir = queue.shift()!;
		if (seen.has(dir)) continue;
		seen.add(dir);

		const pkg = readPackage(dir);
		if (!pkg) continue;
		const isRoot = seen.size === 1;
		const installed = dir.split(sep).includes('node_modules');

		if (!isRoot && installed && isNativePackage(dir, pkg)) {
			// One that cannot install on Linux — fsevents — is never in an image;
			// whatever loads it does without.
			const linux =
				!pkg.os ||
				pkg.os.includes('linux') ||
				(pkg.os.every((os) => os.startsWith('!')) &&
					!pkg.os.includes('!linux'));
			if (linux && pkg.name && pkg.version && !(pkg.name in found)) {
				found[pkg.name] = pkg.version;
			}
			continue;
		}

		for (const dep of Object.keys({
			...pkg.dependencies,
			...pkg.optionalDependencies,
		})) {
			const location = locate(dep, dir);
			if (location && !seen.has(location)) queue.push(location);
		}
	}

	return Object.fromEntries(
		Object.entries(found).sort(([a], [b]) => a.localeCompare(b)),
	);
}

/**
 * What a bundle leaves out, with the version of each to install: the native
 * packages found under `root`, and any it was asked to leave out besides,
 * at the version installed for the app.
 */
export function bundleExternals(
	root: string,
	declared: readonly string[],
): ExternalPackages {
	const externals = nativeDependencies(root);
	for (const name of declared) {
		if (name in externals) continue;
		const location = locate(name, root);
		const version = location ? readPackage(location)?.version : undefined;
		if (!version) throw new ExternalNotInstalled(name, root);
		externals[name] = version;
	}
	return Object.fromEntries(
		Object.entries(externals).sort(([a], [b]) => a.localeCompare(b)),
	);
}

/** The package a bare specifier names: `argon2/lib` → `argon2`, `@a/b/c` → `@a/b`. */
function packageOf(specifier: string): string {
	const parts = specifier.split('/');
	return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;
}

/**
 * The packages a bundle imports at runtime rather than inlining, read from
 * esbuild's metafile. Nothing when there is no metafile.
 */
export function importedPackages(metafile: string): Set<string> {
	let meta: {
		outputs?: Record<
			string,
			{ imports?: { path: string; external?: boolean }[] }
		>;
	};
	try {
		meta = JSON.parse(readFileSync(metafile, 'utf-8'));
	} catch {
		return new Set();
	}
	const imported = new Set<string>();
	for (const output of Object.values(meta.outputs ?? {})) {
		for (const { path, external } of output.imports ?? []) {
			if (external && !path.startsWith('.') && !path.startsWith('node:')) {
				imported.add(packageOf(path));
			}
		}
	}
	return imported;
}
