/**
 * How a mobile app is reached: its URL scheme, and the origins a surface trusts
 * for it.
 *
 * Stated once, here, because three targets ask — the local one (`gkm dev`,
 * `gkm test`), Dokploy and AWS — and a scheme one of them derived differently
 * would be an app whose sign-in callback the auth server refuses on exactly one
 * of them.
 */

/**
 * An app's scheme: the one given, or the project's name made a valid scheme.
 *
 * One for every stage. A development build and the store build register the
 * same scheme, so the auth server of whichever stage a build talks to trusts
 * it, and nothing about the app differs between stages but its URLs.
 *
 * A scheme is a letter followed by letters, digits, `+`, `-` or `.` — so
 * `Corner Shop` becomes `corner-shop`, and a name that starts with a digit gets a
 * leading `app`.
 */
export function schemeBase(project: string, given?: string): string {
	const raw = (given ?? project)
		.toLowerCase()
		.replace(/[^a-z0-9+.-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!raw) return 'app';
	return /^[a-z]/.test(raw) ? raw : `app${raw}`;
}

/** Where an Expo development server runs, for the `exp://` origins it sends. */
export interface MetroHost {
	/** The hosts a device reaches it on: the LAN address, `localhost`. */
	hosts: readonly string[];
	/** Metro's port, when the target placed it — otherwise any port. */
	port?: number;
}

/**
 * The origins a surface trusts for a mobile caller.
 *
 * Better Auth's Expo plugin sends the app's scheme as its origin
 * (`shop://`), and a link can carry a path after it (`shop://*`).
 * In development, Expo Go sends `exp://<host>:<port>` instead — so a local
 * stage adds the hosts a device actually reaches Metro on, and Metro's port
 * when the target placed it: a whole subnet is not trusted because one phone
 * is on it.
 */
export function mobileOrigins(scheme: string, metro?: MetroHost): string[] {
	return [
		`${scheme}://`,
		`${scheme}://*`,
		...(metro?.hosts ?? []).flatMap((host) => [
			`exp://${host}:${metro?.port ?? '*'}`,
			`exp://${host}:${metro?.port ?? '*'}/**`,
		]),
	];
}

/** Whether an origin is a web one — what a cookie domain is derived from. */
export function isWebOrigin(origin: string): boolean {
	return origin.startsWith('http://') || origin.startsWith('https://');
}
