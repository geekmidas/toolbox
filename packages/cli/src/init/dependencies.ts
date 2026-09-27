/**
 * Third-party ranges a scaffold installs beside the `@geekmidas` packages.
 *
 * Held to the peer ranges those packages declare, in one place, because a
 * template that pinned its own copy drifted below them: `kysely ~0.28` against
 * a `~0.29.6` peer is two copies of Kysely and a `Kysely<DB>` from one that is
 * not assignable to the other's.
 *
 * Hand-maintained, unlike `versions.ts`, which `sync-versions` rewrites whole.
 */
export const DEPENDENCY_VERSIONS = {
	'@tanstack/react-query': '~5.80.0',
	'better-auth': '~1.7.5',
	hono: '~4.13.8',
	kysely: '~0.29.6',
	'kysely-ctl': '~0.21.0',
	pg: '~8.23.0',
	pino: '~10.3.1',
	zod: '~4.6.5',
} as const;
