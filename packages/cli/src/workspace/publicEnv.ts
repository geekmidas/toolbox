import type { BackendFramework, FrontendFramework } from './types.js';

/**
 * All public env-var prefixes the toolbox understands.
 *
 * Used when resolving incoming var names back to a dependency
 * (e.g. `VITE_AUTH_URL` → `auth`). A var matching any of these
 * is considered safe to inline into a client bundle.
 */
export const PUBLIC_ENV_PREFIXES = [
	'NEXT_PUBLIC_',
	'VITE_',
	'EXPO_PUBLIC_',
] as const;

/**
 * Resolve the public env-var prefix that a frontend framework's bundler
 * inlines into client code at build time:
 *
 *  - `nextjs`         → `NEXT_PUBLIC_`
 *  - `vite`           → `VITE_`
 *  - `tanstack-start` → `VITE_` (uses Vite under the hood)
 *  - `expo`           → `EXPO_PUBLIC_`
 *  - `remix`          → `''` (Remix exposes via loaders, no prefix convention)
 *
 * For backend frameworks or unspecified, falls back to `NEXT_PUBLIC_` to
 * preserve the historical default. Backend apps never read these vars
 * from a bundle, so the prefix only affects scaffolding/symmetry.
 */
export function getPublicEnvPrefix(
	framework?: FrontendFramework | BackendFramework,
): string {
	switch (framework) {
		case 'vite':
		case 'tanstack-start':
			return 'VITE_';
		case 'expo':
			return 'EXPO_PUBLIC_';
		case 'remix':
			return '';
		case 'nextjs':
			return 'NEXT_PUBLIC_';
		default:
			return 'NEXT_PUBLIC_';
	}
}

/**
 * Strip a known public prefix from a var name.
 * Returns the un-prefixed name, or `null` if no prefix matched.
 */
export function stripPublicPrefix(name: string): string | null {
	for (const prefix of PUBLIC_ENV_PREFIXES) {
		if (prefix && name.startsWith(prefix)) {
			return name.slice(prefix.length);
		}
	}
	return null;
}
