/**
 * The optional peers a construct needs only for a feature it opted into.
 *
 * `@geekmidas/audit`, `@geekmidas/rate-limit`, `@geekmidas/db`,
 * `@geekmidas/cache`, `@geekmidas/emailkit`, `@geekmidas/storage`, `hono`,
 * `ws`, `ioredis` and `better-auth` are optional peers of this package: an app
 * that audits nothing, limits nothing, sends no mail and serves no WebSocket
 * need not install them. Entries that every app loads (`./endpoints`,
 * `./crons`, `./worker`, `./testing`, the CLI's discovery) used to import them
 * at the top, so loading any of them needed them all — and a production bundle
 * of an app without them failed to build. They are loaded here instead, when
 * the construct that uses one runs, which is also when the app declaring that
 * construct has installed it.
 *
 * The `try` around each `import()` is load-bearing beyond the error it names:
 * a bundler leaves an import it cannot resolve to run time when the import is
 * guarded, and fails the build when it is not. `scripts/check-optional-peers.mjs`
 * holds every entry to that: an optional peer is reached from its own adaptor
 * subpath, or through a guarded `import()` like these.
 */

/** A construct uses a feature whose optional peer is not installed. */
export class OptionalPeerMissing extends Error {
	constructor(
		readonly packageName: string,
		readonly feature: string,
		cause: unknown,
	) {
		super(
			`${feature} needs '${packageName}', which could not be loaded. ` +
				`Add it to the dependencies of the app that declares it.`,
			{ cause },
		);
		this.name = 'OptionalPeerMissing';
	}
}

/** `@geekmidas/audit`, for an endpoint, function or cron with an auditor. */
export async function loadAudit(): Promise<typeof import('@geekmidas/audit')> {
	try {
		return await import('@geekmidas/audit');
	} catch (cause) {
		throw new OptionalPeerMissing('@geekmidas/audit', 'An auditor', cause);
	}
}

/** `@geekmidas/audit/kysely`, for audits written in the handler's transaction. */
export async function loadAuditKysely(): Promise<
	typeof import('@geekmidas/audit/kysely')
> {
	try {
		return await import('@geekmidas/audit/kysely');
	} catch (cause) {
		throw new OptionalPeerMissing(
			'@geekmidas/audit',
			'An auditor that stores in the database',
			cause,
		);
	}
}

/** `@geekmidas/rate-limit`, for an endpoint with a rate limit. */
export async function loadRateLimit(): Promise<
	typeof import('@geekmidas/rate-limit')
> {
	try {
		return await import('@geekmidas/rate-limit');
	} catch (cause) {
		throw new OptionalPeerMissing(
			'@geekmidas/rate-limit',
			'An endpoint with a rate limit',
			cause,
		);
	}
}

/** `@geekmidas/db/rls`, for an endpoint with row-level security. */
export async function loadRls(): Promise<typeof import('@geekmidas/db/rls')> {
	try {
		return await import('@geekmidas/db/rls');
	} catch (cause) {
		throw new OptionalPeerMissing(
			'@geekmidas/db',
			'An endpoint with row-level security',
			cause,
		);
	}
}

/** `@geekmidas/cache`, for a `Cache` construct's client. */
export async function loadCache(): Promise<typeof import('@geekmidas/cache')> {
	try {
		return await import('@geekmidas/cache');
	} catch (cause) {
		throw new OptionalPeerMissing('@geekmidas/cache', 'A Cache', cause);
	}
}

/** `@geekmidas/emailkit`, for an `Email` construct's client. */
export async function loadEmailkit(): Promise<
	typeof import('@geekmidas/emailkit')
> {
	try {
		return await import('@geekmidas/emailkit');
	} catch (cause) {
		throw new OptionalPeerMissing('@geekmidas/emailkit', 'An Email', cause);
	}
}

/** `@geekmidas/emailkit/autoSubmitted`, for a subscriber to an `Inbox`. */
export async function loadAutoSubmitted(): Promise<
	typeof import('@geekmidas/emailkit/autoSubmitted')
> {
	try {
		return await import('@geekmidas/emailkit/autoSubmitted');
	} catch (cause) {
		throw new OptionalPeerMissing(
			'@geekmidas/emailkit',
			'A subscriber to an Inbox',
			cause,
		);
	}
}

/** `@geekmidas/storage/events`, for a subscriber to a bucket's objects. */
export async function loadStorageEvents(): Promise<
	typeof import('@geekmidas/storage/events')
> {
	try {
		return await import('@geekmidas/storage/events');
	} catch (cause) {
		throw new OptionalPeerMissing(
			'@geekmidas/storage',
			"A subscriber to a bucket's objects",
			cause,
		);
	}
}

/** `hono`, for a surface that serves HTTP itself. */
export async function loadHono(
	feature: string,
): Promise<typeof import('hono')> {
	try {
		return await import('hono');
	} catch (cause) {
		throw new OptionalPeerMissing('hono', feature, cause);
	}
}

/** `hono/cors`, beside {@link loadHono}. */
export async function loadHonoCors(
	feature: string,
): Promise<typeof import('hono/cors')> {
	try {
		return await import('hono/cors');
	} catch (cause) {
		throw new OptionalPeerMissing('hono', feature, cause);
	}
}

/** `ws`, for a `WebSocketApi`'s server. */
export async function loadWs(): Promise<typeof import('ws')> {
	try {
		return await import('ws');
	} catch (cause) {
		throw new OptionalPeerMissing('ws', 'A WebSocketApi', cause);
	}
}

/** `ioredis`, for a `WebSocketApi` that fans out through Redis. */
export async function loadIoredis(): Promise<typeof import('ioredis')> {
	try {
		return await import('ioredis');
	} catch (cause) {
		throw new OptionalPeerMissing(
			'ioredis',
			'A WebSocketApi with a redis:// transport',
			cause,
		);
	}
}

/** `better-auth`, for an `Auth` construct's server. */
export async function loadBetterAuth(): Promise<typeof import('better-auth')> {
	try {
		return await import('better-auth');
	} catch (cause) {
		throw new OptionalPeerMissing('better-auth', 'An Auth', cause);
	}
}

/** `better-auth/db/migration`, for migrating an `Auth` construct's tables. */
export async function loadBetterAuthMigration(): Promise<
	typeof import('better-auth/db/migration')
> {
	try {
		return await import('better-auth/db/migration');
	} catch (cause) {
		throw new OptionalPeerMissing('better-auth', 'An Auth', cause);
	}
}
