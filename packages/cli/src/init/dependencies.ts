/**
 * Every third-party range `gkm init` writes, in one place.
 *
 * Templates used to pin their own copies, and those drifted: below the peer
 * ranges the `@geekmidas` packages declare (`kysely ~0.28` against a `~0.29.6`
 * peer is two copies of Kysely, and a `Kysely<DB>` from one is not assignable
 * to the other's), and below what the rest of the scaffold assumed (`turbo
 * ~2.3.0` ignores `$TURBO_ROOT$`, which the root `turbo.json` relies on). No
 * generator writes a version literal; a scan test holds them to that.
 *
 * Hand-maintained, unlike `versions.ts`, which `sync-versions` rewrites whole.
 * Current as of 2026-09-27, inside every `@geekmidas` peer range.
 */
export const DEPENDENCY_VERSIONS = {
	// Server
	'better-auth': '~1.7.6',
	hono: '~4.13.9',
	// 1.x: 2.x changes the server entry this scaffold writes.
	'@hono/node-server': '~1.19.17',
	kysely: '~0.29.6',
	pg: '~8.23.0',
	pino: '~10.3.1',
	zod: '~4.6.5',
	// `@geekmidas/cloud`'s peer floor.
	sst: '~4.17.1',

	// Frontend
	next: '~16.3.6',
	react: '~19.3.0',
	'react-dom': '~19.3.0',
	'@tanstack/react-query': '~5.104.0',
	'@tanstack/react-router': '~1.170.40',
	'@tanstack/react-start': '~1.168.59',
	'@tanstack/router-plugin': '~1.168.41',
	tailwindcss: '~4.3.3',
	'@tailwindcss/postcss': '~4.3.3',
	'@tailwindcss/vite': '~4.3.3',
	'@radix-ui/react-dialog': '~1.1.23',
	'@radix-ui/react-label': '~2.1.15',
	'@radix-ui/react-separator': '~1.1.15',
	'@radix-ui/react-slot': '~1.3.3',
	'@radix-ui/react-tabs': '~1.1.21',
	'@radix-ui/react-tooltip': '~1.2.16',
	'class-variance-authority': '~0.7.1',
	clsx: '~2.1.1',
	'lucide-react': '~1.48.0',
	'tailwind-merge': '~3.7.0',

	// Tooling
	'@biomejs/biome': '~2.5.14',
	// What `@geekmidas/testkit` itself depends on, so factories share one copy.
	'@faker-js/faker': '~10.6.0',
	// 2.4+ is what expands `$TURBO_ROOT$` in the root turbo.json.
	turbo: '~2.11.4',

	// Types. Node's follow the oldest runtime the packages support (22), so
	// nothing typechecks against an API that is not there.
	'@types/node': '~22.20.4',
	'@types/pg': '~8.23.1',
	'@types/react': '~19.3.0',
	'@types/react-dom': '~19.3.0',
	'@types/aws-lambda': '~8.10.163',
} as const;

/**
 * The build and test toolchain, at the versions the repository itself builds
 * and tests with (scripts/dependency-versions.json), so a scaffold compiles
 * with the compiler its own `@geekmidas` packages were checked against.
 */
export const TOOLCHAIN_VERSIONS = {
	typescript: '~7.0.2',
	tsx: '~4.23.15',
	esbuild: '~0.28.2',
	// `@geekmidas/testkit` and `@geekmidas/db` declare this as their peer.
	vitest: '~5.0.2',
	vite: '~8.3.1',
	'@vitejs/plugin-react': '^6.1.1',
} as const;

/**
 * The Expo app's packages, which track an Expo SDK release (57) rather than
 * their own latest: SDK 57 is tested against exactly these, React Native and
 * React included, so they move when the SDK does.
 */
export const EXPO_VERSIONS = {
	expo: '~57.0.26',
	'expo-constants': '~57.0.20',
	'expo-dev-client': '~57.0.19',
	'expo-device': '~57.0.2',
	'expo-linking': '~57.0.11',
	'expo-router': '~57.0.24',
	'expo-splash-screen': '~57.0.9',
	'expo-status-bar': '~57.0.1',
	'expo-secure-store': '~57.0.4',
	react: '19.2.3',
	'react-dom': '19.2.3',
	'react-native': '0.86.3',
	'react-native-gesture-handler': '~2.32.0',
	'react-native-reanimated': '4.5.1',
	// Reanimated 4 runs its worklets on this, pinned by the SDK beside it.
	'react-native-worklets': '0.10.1',
	'react-native-safe-area-context': '~5.7.0',
	'react-native-screens': '~4.26.0',
	'react-native-web': '~0.21.0',
	'@react-navigation/native': '^7.1.0',
	'@babel/core': '^7.25.0',
	'@types/react': '~19.2.2',
	nativewind: '~4.2.0',
	// NativeWind 4 is built on Tailwind 3.
	tailwindcss: '~3.4.0',
} as const;

/**
 * The pnpm a pnpm scaffold runs under, through \`packageManager\`.
 *
 * Pinned in every layout. Without it Corepack takes the newest pnpm, and 11
 * fails the first install on dependencies with build scripts (esbuild) until
 * they are approved — a single-app scaffold that did not pin it could not
 * install at all.
 */
export const PNPM_VERSION = 'pnpm@10.13.1';

/** The Biome config schema matching the Biome the scaffold installs. */
export const BIOME_SCHEMA = `https://biomejs.dev/schemas/${DEPENDENCY_VERSIONS['@biomejs/biome'].replace(/^[~^]/, '')}/schema.json`;
