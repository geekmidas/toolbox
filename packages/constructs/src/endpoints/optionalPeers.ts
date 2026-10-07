/**
 * The optional peers an endpoint needs only for a feature it opted into.
 *
 * `@geekmidas/audit`, `@geekmidas/rate-limit` and `@geekmidas/db` are optional
 * peers of this package: an app that audits nothing, limits nothing and sets
 * no row-level security need not install them. The adaptor every endpoint is
 * served by used to import them at the top, so serving any endpoint needed
 * them all — and a production bundle of an app without them failed to build.
 * They are loaded here, when an endpoint that uses one is served, which is
 * also when the app declaring that endpoint has installed it: an auditor's
 * storage, a rate limit's store and an RLS policy's database come from these
 * packages.
 *
 * The `try` is load-bearing beyond the error it names: a bundler leaves an
 * import it cannot resolve to run time when the import is guarded, and fails
 * the build when it is not.
 */

/** An endpoint uses a feature whose optional peer is not installed. */
export class OptionalPeerMissing extends Error {
	constructor(
		readonly packageName: string,
		readonly feature: string,
		cause: unknown,
	) {
		super(
			`${feature} needs '${packageName}', which could not be loaded. ` +
				`Add it to the dependencies of the app that serves this endpoint.`,
			{ cause },
		);
		this.name = 'OptionalPeerMissing';
	}
}

/** `@geekmidas/audit`, for an endpoint with an auditor. */
export async function loadAudit(): Promise<typeof import('@geekmidas/audit')> {
	try {
		return await import('@geekmidas/audit');
	} catch (cause) {
		throw new OptionalPeerMissing(
			'@geekmidas/audit',
			'An endpoint with an auditor',
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
